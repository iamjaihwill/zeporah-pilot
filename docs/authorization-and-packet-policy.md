# Authorization and packet policy

Zeporah is multi-tenant and **default deny**. Nothing is allowed unless a rule explicitly allows it, and protected sharing needs far more than a role.

## Layers

1. **Identity (prototype only).** A session cookie maps to one synthetic actor in one tenant. The server rebuilds the actor's context — tenant, staff roles, household roles, assigned households — from the database on every call ([src/server/context.ts](../src/server/context.ts)). Nothing the browser sends is trusted as a claim.
2. **Tenant isolation.**
   - Every query in the services filters by the actor's `tenant_id`; there is no cross-tenant query path.
   - Every reference between tenant-owned rows is a composite foreign key `(tenant_id, id)`, so the database refuses a row that points into another tenant ([schema.ts](../src/server/db/schema.ts); tested in `tests/integration/database.test.ts`).
   - A record in another tenant is indistinguishable from one that doesn't exist: the answer is `OUT_OF_SCOPE` and the attempt is audited in the actor's own tenant.
3. **Scope.** Family members act only in their own household. Care guides act only in households they are assigned to (an active care-guide membership; see [authentication-and-access.md](authentication-and-access.md#care-guide-assignment)); operations users and authority/consent reviewers act across their own hospice. One rule, `staffSeesHousehold` in `src/server/context.ts`, decides this for every staff page and action.
4. **Permissions.** A fixed matrix maps each role to named permissions ([src/domain/permissions.ts](../src/domain/permissions.ts)). Unlisted = denied. The household lifecycle narrows permissions: at bereavement the patient's own permissions end; a closed household is read-only.
5. **Protected access.** Household roles never open protected items on their own. The patient sees their own protected items while living; anyone else needs an authority workflow that is active **and** applies in the current lifecycle (a healthcare-agent workflow ends at death; a personal-representative workflow applies only after) ([src/domain/lifecycle.ts](../src/domain/lifecycle.ts)). Protected items are omitted, not shown as locked, for everyone else — including from the activity timeline and notifications.
6. **Policy evaluation for release.** See below.

## Role summary

| Role                       | Can                                                                                                                                                                 | Cannot                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Patient                    | See household coordination, tasks, updates, thread, vault (including own protected items while living); invite people; confirm and withdraw consent that names them | Release packets; see staff notes                                                                    |
| Household coordinator      | Organize setup, tasks, people, vault review, messages; view consents                                                                                                | See protected items without an active authority workflow; release packets                           |
| Proxy                      | Help with tasks, thread, vault                                                                                                                                      | See protected items unless their authority workflow is active                                       |
| Family member              | See updates and their own tasks                                                                                                                                     | See the vault, the care-guide thread, consents, or protected items                                  |
| Care guide                 | Compose family-visible updates, message, internal notes, tasks, record authority/consent metadata, draft packets, propose bereavement                               | Release packets; review authority; activate consent; confirm bereavement; see unassigned households |
| Hospice operations         | Operational view of queues and enrollment; release or revoke packets when every check passes; confirm bereavement (not one they proposed)                           | Review authority; activate consent                                                                  |
| Authority/consent reviewer | Review authority evidence; activate or withdraw consent; release or revoke packets when every check passes                                                          | Make legal determinations (Zeporah records workflow status only)                                    |
| Named external recipient   | — (later phase; not active in pilot one)                                                                                                                            | Everything                                                                                          |

## Packet release: the ten gates

`evaluateRelease` ([src/domain/policy/evaluate-release.ts](../src/domain/policy/evaluate-release.ts)) is a pure function. Checks run in a fixed order and stop at the first failure, so the same situation always yields the same reason code:

| #   | Gate                                                                                                                                                                                                                          | Failure → decision · reason code                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Correct tenant (actor, household, packet; and later the linked authority and consent)                                                                                                                                         | deny · `TENANT_MISMATCH` (evaluator only — at runtime a cross-tenant request is stopped earlier by the tenant-scoped lookup and answered `OUT_OF_SCOPE`)                                                                                               |
| 2   | Authenticated actor                                                                                                                                                                                                           | deny · `NOT_AUTHENTICATED`                                                                                                                                                                                                                             |
| 3   | Explicit role permission (`packet.release`)                                                                                                                                                                                   | deny · `ROLE_NOT_PERMITTED`                                                                                                                                                                                                                            |
| —   | Household not closed; packet still draft or held                                                                                                                                                                              | deny · `HOUSEHOLD_CLOSED`; hold · `PACKET_NOT_RELEASABLE`                                                                                                                                                                                              |
| 4   | Named purpose                                                                                                                                                                                                                 | hold · `PURPOSE_MISSING`                                                                                                                                                                                                                               |
| 5   | Named recipient                                                                                                                                                                                                               | hold · `RECIPIENT_MISSING`                                                                                                                                                                                                                             |
| 6   | Non-empty minimum-necessary manifest; no care-period categories after bereavement                                                                                                                                             | hold · `SCOPE_EMPTY`, `LIFECYCLE_SCOPE_NARROWED`                                                                                                                                                                                                       |
| 7   | Active authority workflow that applies in this lifecycle, whose holder is linked to one household person (a different-person conflict, or a rival record that can't be compared, among records of the same type counts)       | hold · `AUTHORITY_MISSING`, `AUTHORITY_CONFLICT`, `AUTHORITY_IDENTITY_UNRESOLVED`, `AUTHORITY_REVIEW_PENDING`, `AUTHORITY_NOT_ACTIVE`, `AUTHORITY_ENDED_BY_LIFECYCLE`                                                                                  |
| 8   | Consent with no open correction request, whose current version the named person confirmed and a different reviewer activated; started, unexpired, not withdrawn; purpose and recipient match; scope covers the whole manifest | hold · `CONSENT_MISSING`, `CONSENT_CORRECTION_PENDING`, `CONSENT_NOT_CONFIRMED`, `CONSENT_NOT_ACTIVE`, `CONSENT_REVOKED`, `CONSENT_EXPIRED`, `CONSENT_NOT_STARTED`, `CONSENT_RECIPIENT_MISMATCH`, `CONSENT_PURPOSE_MISMATCH`, `CONSENT_SCOPE_MISMATCH` |
| 9   | Packet expiry in the future                                                                                                                                                                                                   | hold · `PACKET_EXPIRED`                                                                                                                                                                                                                                |
| 10  | Immutable audit event                                                                                                                                                                                                         | deny · `AUDIT_UNAVAILABLE`                                                                                                                                                                                                                             |

Only a full pass returns `allow · RELEASE_ALLOWED`. **There is no permissive fallback**: unexpected states, missing links and errors all end in hold or deny.

**Deny vs hold.** _Deny_ means the person asking is wrong for this request (wrong organization, not signed in, wrong role, closed household, or the release couldn't be recorded). _Hold_ means the workflow isn't ready and a person can fix it (review, renew consent, correct the manifest, set a new expiry).

**Every outcome** returns: the decision; a stable reason code ([reason-codes.ts](../src/domain/policy/reason-codes.ts)) whose meaning never changes; a plain-language explanation safe to show the person who asked; and internal audit context (the checks that ran and their results — never packet contents).

### How a release request is executed

`requestRelease` ([src/server/services/sharing.ts](../src/server/services/sharing.ts)) runs in one database transaction:

1. Look up the packet **inside the actor's tenant and scope**. If it isn't there → deny `OUT_OF_SCOPE`, audited.
2. Load the household, manifest, linked consent and the _effective_ authority state.
3. Evaluate.
4. Write the audit event (`packet.released` or `packet.release_requested`) with decision, reason code and checks.
5. On **allow**: mark the packet released, write the release receipt (purpose, recipient, manifest, expiry, audit event id), and tell household members who can view consents. On **hold**: mark the packet held and, for reasons that need a person (authority problems, revoked consent, lifecycle narrowing), open an escalation for the reviewers. On **deny**: change nothing about the packet (so an unauthorized attempt can't disrupt it), except a closed household marks it denied.
6. If anything throws — including the audit write — the transaction rolls back and the answer is deny `AUDIT_UNAVAILABLE`. Nothing is released without its audit event.

Viewing a packet shows a **preview** of the decision (same evaluator, no audit event, labelled as a preview). Only an explicit request records an outcome.

## Consent

Consent has three required stages, and only the third makes it usable for a release:

1. **Recorded.** A care guide or reviewer records the proposed consent: the named household grantor (a current household member), purpose, named recipient, scope (categories), start and expiry, and how to withdraw it. This is version 1.
2. **Confirmed by the named grantor.** Only that person can confirm, in the app, and only the exact current version. Each confirmation stores the actor, timestamp, method, consent version and the confirmation statement they saw, and writes an audit event. The patient can confirm while they are an active household member (Zeporah never infers capacity). Anyone else can confirm only with an active authority workflow, linked to them, that permits confirming at the household's current stage — household membership alone is never enough. If the named grantor can't confirm in the app, the consent is held as `needs_review` and an escalation opens for a person to review; it is never confirmed on their behalf.
3. **Activated by a different reviewer.** A person with the `consent.activate` permission who did not record (or last change) it activates the confirmed version; the activation is audited with the confirmation it relied on.

Any material change — purpose, recipient, scope, start, expiry or withdrawal terms — creates a new version, clears the confirmation and activation for it, holds dependent packets (`CONSENT_NOT_CONFIRMED`) and starts again at stage 2. Earlier confirmations are kept for history.

The grantor, or the patient, can withdraw a consent directly in the family app at any open stage; anyone else who can see it can ask the care team, which opens an escalation. Staff can withdraw it on the household's request with a stated reason. Withdrawal immediately holds any open packet that depends on it. A consent past its end date is treated as expired whether or not anyone marked it. The interface states exactly: "Future access through Zeporah is revoked. Nothing is recalled, and no external recipient was contacted."

### The named grantor's own view

A person named as giving consent can always see that consent and act on it, even without the Sharing page (for example a family member). This is a check on the consent itself — they are its named grantor, a current member of its household, in their own tenant — not a broader role: they see only consents that name them, at `/family/consents`, and never the household's other sharing. Notification links go to `/family/consents/{id}`, and the server repeats the check on every load, so a link never grants access by itself. If they leave the household, the check fails.

On that view they can confirm (when eligible), request a correction, and cancel their own request. Being named doesn't let them withdraw the consent; withdrawal still needs Sharing access under the policy above. Whether they can _confirm_ still follows the three-stage rule above. When they can't, the consent is held for review and they see why, in plain words. Staff are warned when they choose a grantor who can't confirm in the app — with the reason and the next step — but are not blocked from recording it.

### Correction requests

"Request a correction" is not a withdrawal. Only the consent's named grantor can ask for a correction, choosing any of: who receives it, why it's being shared, what's included, the dates, the person named, or something else — and may add their own words. At most one request is open per consent (the database enforces it). Other household members who can see the consent are pointed to a Support request instead, which holds nothing. While one is open:

- the consent keeps its version and stage, but it can't be confirmed or activated, and every release under it is held with `CONSENT_CORRECTION_PENDING` (fail closed);
- the person's own words are stored on the request and shown only to the care team on the household's consent; audit events, escalations, notifications and the queue carry the categories alone.

A request ends when the person cancels it, or a care guide or reviewer resolves it: changing the terms (a new version that needs confirming again), withdrawing the consent, or dismissing it with a required reason that stays with the care team; the person who asked is told only that it was reviewed and no change was made. It also closes itself if the consent is withdrawn or ends at bereavement. Correction escalations can't be resolved from the generic Escalations page, so the request and the consent always stay in step.

## Authority evidence

Authority evidence is **metadata and workflow status only** — never the document, and never a legal determination ("This is a workflow status, not a legal determination."). Each record has version lineage (each new version points at the one it replaces) and a review history. States: `review_pending`, `workflow_active`, `conflict`, `superseded`, `withdrawn`.

**Holder identity is decided from linked people, never from how a name is spelled.** Each record can be linked to one current household person; each link records its basis — named in the submitted evidence, confirmed by the household, or a reviewer's documented basis (a note is required) — and who linked it, when. Re-linking keeps the earlier link, marked superseded. A link is a workflow association, not a legal determination.

- Two records of the same type linked to the **same** person (for example "Ada Okafor" and "Ada N. Okafor") are versions of one person's paperwork, not a conflict.
- Records linked to **different** people go to `conflict`: an escalation opens and dependent sharing is held. A reviewer cannot mark one active while a rival is still active or in conflict.
- If a record isn't linked, or a rival record can't be compared, the effective state is **`identity_unresolved`** (fails closed): an identity-review escalation opens, competing evidence can't be activated, protected access that depends on it closes, and protected release is held (`AUTHORITY_IDENTITY_UNRESOLVED`) until a reviewer links it with a stated basis.

Zeporah never chooses between people.

## Audit events

[src/server/audit.ts](../src/server/audit.ts) is the only writer. Events are append-only: a database trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` on `audit_events`. Each event stores a SHA-256 hash of its canonical content chained to the previous event in the same tenant. Appends to a tenant's chain happen one at a time (an advisory lock), and the database refuses a fork (migration `0024`). `auditChainFindings` reports each changed, removed or forked event; it can't detect events removed from the end until checkpoints are kept outside the database (SB-04). Summaries are written to be safe — message bodies, note text and document contents are never copied in. Each event has a visibility: `family` (every household member), `sharing` (members who can view consents), `protected` (members with protected access), `staff` (care team only).

## Escalation

Anything that needs a person rather than a rule becomes an escalation: authority conflicts, unresolved authority identity, consents whose named grantor can't confirm in the app, policy holds that need review, privacy concerns (e.g. a request to withdraw someone else's consent), and family requests for a person to follow up. Staff take ownership and resolve with a note. The system closes an escalation itself only when a reviewer has cleared the authority conflict or linked the unresolved identity that caused it. Creating an escalation contacts no one outside Zeporah. After a family support request the person sees (founder decision 26): "Your request was sent to your care team. A person will decide how to follow up. If it's urgent, call {24-hour line}." The hospice's expected reply time is added when it's set.

## Operational views

- **Sharing register** (`/staff/sharing`) lists every consent in the households a staff member can already see, under the same visibility rule as each household's Sharing tab. Operations and reviewers see the whole hospice; care guides see their assigned households. Filters:
  - needs a person;
  - correction requested;
  - active;
  - ending soon (14 days);
  - withdrawn or ended.
- **Consent history** (`/staff/sharing/<consent>`) is read-only. It shows the current terms and every audited step, newest first: recorded, each change of terms with its version and changed fields, confirmations, correction requests and their outcomes, activation and withdrawal. It also lists the packets under the consent. Actions still happen in the household's Sharing tab, where every existing check applies.
- Family-facing wording is unchanged; these views are staff-only.

## Audit review

**Audit review** (`/staff/audit`, operations and reviewers) shows the tenant's append-only, hash-chained audit log, newest first.

- **Filters:** kind (access and sign-in; people and staff; sharing, consent and authority; care coordination), household, and the last 7, 30 or 90 days.
- **Household events** appear only for households the person can see.
- **Organization-level events** (sign-ins, sessions, access refusals, staff and invitation changes) appear only to hospice operations.
- **Integrity:** every load re-verifies the whole chain and says whether it passed.
- **Summaries** never include message or note text, and staff-only notes (for example bereavement check-in notes) are never copied into the log.
- **Export (founder decision 28, reopening decision 15, [log](founder-decision-log.md)):**
  - **Who:** hospice operations and authority/consent reviewers (`audit.export`). Care guides can't.
  - **What:** "Export CSV" downloads exactly what the person can see under the current filters, at most 90 days.
  - **Columns:** `timestamp`, `event_code`, `summary`, `actor`, `household`, `decision`.
  - **No free text:** the summary column is the app's fixed event label, never the stored summary, which can quote a task title or a purpose. So no message or note text can appear.
  - **Spreadsheet safety:** cells that would start a formula are prefixed with `'`.
  - **Logged:** each export is itself recorded (`audit.exported`, with the filters and row count).
  - **Confirmed first (decision 29f):** a dialog says what the file contains, that it's confidential, and that it's stored and shared only under the hospice's own records policy.
  - **Labelled (decision 29g):** the file opens with a confidentiality line, who exported it and when, and the filters. Then a blank line and the column header.
  - **Left to the hospice:** storage, retention and onward sharing after download fall under each hospice's own records policy. Zeporah doesn't define that policy.
