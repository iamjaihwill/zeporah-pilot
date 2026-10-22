# Zeporah Enterprise: phased implementation plan (full demo)

Status: **plan for founder review, 2026-10-21.** It covers the six workstreams approved in decision 58. Nothing is built until the founder approves this plan; each phase then ends with a review in
the preview before the next one starts.

Screen detail is in [enterprise-record-and-exceptions-spec.md](enterprise-record-and-exceptions-spec.md).
Deferred policy is in [enterprise-decision-register.md](enterprise-decision-register.md). The
narrative is in [enterprise-demo-map.md](enterprise-demo-map.md).

**Status values:**

- **Existing**: in the pilot now.
- **Approved—build**: approved on 2026-10-21.
- **Founder decision required**: blocked on the register (R-nn).
- **Future**: not in this release.

**Sizes:** S (under a day), M (1–3 days), L (3–5 days). These are build effort only; review is
separate.

## Constraints that hold for every story

- **Data and services:**
  - synthetic data only;
  - no external services;
  - no deployment;
  - no Git operations.
- **Separate experiences:**
  - enterprise and family keep separate sign-ins and shells;
  - no role switcher;
  - family pages stay pixel-unchanged, except where a story says otherwise (none in this plan
    does).
- **Privacy:** no PHI in URLs, toasts, notifications or exports.
- **Sensitive actions:**
  - restate the scope, consequence, recipient and end date where they apply;
  - a reason is required where the spec says so.
- **Wording:** the four decision-1 confirmation messages stay word for word.
- **Clinical and copy:**
  - no clinical interpretation or decision support;
  - no clinical risk scores;
  - no revenue-cycle framing;
  - no generic SaaS copy.
- **Accessibility:**
  - no WCAG conformance claims;
  - no axe rules suppressed or accessibility assertions weakened.
- **AI:** nothing unattended. Copilot is never the actor.

**Definition of done for every story:**

- type-check;
- unit and integration tests;
- full browser suite;
- accessibility sweep;
- schema-upgrade suite, including a downgrade fixture for each new migration;
- family-unchanged screenshots;
- a new or updated browser test for the story;
- the dev-database checksum unchanged.

## Phase 0: Foundations (audit readiness first)

**Why first:** every later story writes audit events in the approved shape, and the exception rules
need thresholds and demo data.

| ID  | Story                                                                                                                                                                                                                                                                                                                                                                                                                            | Status           | Primary role | Decision or action | Objects                                               | Visible vs hidden                                               | Approval gate                         | Audit event                              | Family app                                                                  | Size |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------ | ------------------ | ----------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- | ---- |
| F-1 | Every new audit event carries `actorRoles` (all of the actor's roles at the time), `source`, `reason`, `before`/`after`, `approval` and `prepared` in `context`, through one helper                                                                                                                                                                                                                                              | Built 2026-10-21 | System       | —                  | `audit_events.context`                                | Readers see only what their visibility class allows (unchanged) | —                                     | All new events                           | Nothing                                                                     | M    |
| F-2 | Audit review shows role at the time, source badge and approval chain; older events say "(current role)"                                                                                                                                                                                                                                                                                                                          | Built 2026-10-21 | Operations   | Read the audit     | `audit_events`                                        | Unchanged visibility classes                                    | —                                     | `audit.exported` (existing)              | Nothing                                                                     | M    |
| F-3 | Migration `0021_enterprise_record`: `exception_claims`, `staff_absences`, `handoffs`, `partner_events`, `memberships.cover_for_actor_id` and `grant_reason`, `care_coordination_records.ehr_reference`, plus downgrade fixture                                                                                                                                                                                                   | Built 2026-10-21 | —            | —                  | New tables                                            | —                                                               | —                                     | —                                        | Nothing                                                                     | M    |
| F-4 | New exception thresholds as their own settings group ("Exception thresholds"), validated and audited. Its card in Hospice settings › Workflow ships with Exceptions in Phase 2, when the thresholds first change something on screen.                                                                                                                                                                                            | Built 2026-10-21 | Operations   | Set the thresholds | `organizations.settings.queue`                        | Administrators view; operations change (decision 39)            | Save bar and confirm (existing)       | `settings.changed` with before/after     | Nothing                                                                     | S    |
| F-5 | Demo-week seed for the Okafor household (see the demo map): partner events labelled simulated, an absence, a handoff, an update needing acknowledgement, a near-ending access, `ehr_reference`. Two snapshots, both reachable from the existing development-only Reset: **mid-week** ("now" is Day 4, 9 AM; Days 1–3 are history) for the live beats, and **end of week** ("now" is Day 7, 9 AM) for the audit and return beats. | Built 2026-10-21 | —            | —                  | Seed (`src/fixtures/synthetic.ts`), development reset | Synthetic only; documented in `docs/synthetic-data.md`          | Reset keeps its existing confirmation | `system.seeded` (with the snapshot name) | The default seed's family pages stay unchanged (verified by the pixel test) | L    |

**Exit criteria:**

- all suites green;
- Audit review shows the new fields on new events;
- the upgrade and downgrade path passes.

## Phase 1: Coordination record v2 (workstream 1)

| ID  | Story                                                                                                                                 | Status                            | Primary role                     | Decision or action                       | Objects                                                               | Visible vs hidden                                                                   | Approval gate                                                      | Audit event               | Family app                          | Size |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------- | ----------------------------------- | ---- |
| R-1 | Header strip: stage, team (with cover and handoff state), 24-hour line, open-exception count, Catch me up, Reassign                   | Built 2026-10-21                  | Care guide                       | Orient                                   | Household, memberships, handoffs, exceptions                          | No clinical data                                                                    | Reassign: existing                                                 | —                         | Nothing                             | M    |
| R-2 | Unified timeline: exact time, actor, role at the time, source badge, one line, object link; filters; density                          | Built 2026-10-21                  | Care guide                       | Understand what happened                 | `audit_events`, partner events                                        | Protected items shown generically to people without access; private notes never     | —                                                                  | — (reading isn't audited) | Nothing                             | L    |
| R-3 | Context column: open exceptions, participants, care team and history, organizations and active access, care-plan context, EHR pointer | Built 2026-10-21                  | Care guide                       | See who's involved and what's open       | Memberships, consents, packets, recipient access, coordination record | Ended members and access collapsed; admins never                                    | —                                                                  | —                         | Nothing                             | L    |
| R-4 | Who can see what: grid generated from the policy functions, with a "why" on every cell and exact end times                            | Built 2026-10-21                  | Care guide, operations, reviewer | Explain access                           | Policy functions, memberships, consents, recipient access             | Administrators: no access. Patient private notes: "—" for everyone but the patient. | —                                                                  | —                         | Nothing                             | L    |
| R-5 | Log a partner event (staff-entered, simulated)                                                                                        | Built 2026-10-21                  | Care guide, operations           | Record what an outside organization said | `partner_events`                                                      | Staff only; never shown to partners or families                                     | Confirm (restates household and organization; "not sent anywhere") | `partner_event.logged`    | Nothing unless staff post an update | M    |
| R-6 | Responsive layouts: context drawer on iPad; stacked on phone; no sideways scroll                                                      | Built 2026-10-21                  | All                              | —                                        | —                                                                     | —                                                                                   | —                                                                  | —                         | Nothing                             | M    |
| R-7 | Deep-work tabs kept; Overview replaced by the timeline; "Audit" tab keeps the full log                                                | Existing, adjusted                | Care guide                       | —                                        | —                                                                     | Unchanged                                                                           | Unchanged                                                          | Unchanged                 | Unchanged                           | S    |
| R-8 | Full-record export                                                                                                                    | **Not built** (approved boundary) | —                                | —                                        | —                                                                     | —                                                                                   | —                                                                  | —                         | —                                   | —    |

**Exit criteria:**

- The Who-can-see-what grid matches the policy decisions for every seeded persona.
- Axe is clean at three widths.
- Founder review in the preview.

**Built on 2026-10-21, with these differences from the spec:**

- The header's count and the context column's list are **open items** (the coordination queue's
  rows for the household) until Exceptions replace them in Phase 2.
- **Catch me up** moves to Phase 5 (P-1), where the prepared summary is built.
- Below 1024px the context column **stacks under the timeline** (open items first) instead of
  opening as a drawer. Who can see what is a **page** (`/staff/households/:id/access`), with cards
  below 1024px; each cell opens to say why.
- A **`partner_event.log` permission** (care guides and operations) carries decision 60, so the
  rule lives in the permission matrix like every other action.

## Phase 2: Exception-first operating model (workstream 2)

| ID  | Story                                                                                                                                                                                                                                                                             | Status           | Primary role                     | Decision or action                 | Objects                                                                           | Visible vs hidden                                                        | Approval gate                                                    | Audit event                                                        | Family app                                                    | Size |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- | ---- |
| E-1 | `domain/exceptions.ts`: the `ExceptionRow` model, categories, deterministic rules, urgency Now/Today/This week with a reason on every row                                                                                                                                         | Built 2026-10-21 | System                           | —                                  | Source records, thresholds                                                        | Subjects named only to viewers who can open them                         | —                                                                | —                                                                  | Nothing                                                       | L    |
| E-2 | Regroup the existing queue kinds into categories (correction, consent and authority → Consent held; packet → Release incomplete; message → Family contact; acknowledgement → Unread critical update; task → Overdue task); Family request, Setup and Transition keep their labels | Built 2026-10-21 | —                                | —                                  | `domain/queue.ts`                                                                 | Unchanged                                                                | Unchanged                                                        | Unchanged                                                          | Nothing                                                       | M    |
| E-3 | New rules: Missing consent, Access ending, Stalled handoff (after Phase 3), Coverage gap, Bereavement contact due (joined from bereavement follow-up), Coordination risk (lists its signals)                                                                                      | Built 2026-10-21 | System                           | —                                  | Consents, recipient access, memberships, handoffs, absences, bereavement contacts | As E-1                                                                   | —                                                                | —                                                                  | Nothing                                                       | L    |
| E-4 | `/staff/exceptions`: views by role, filters, list and detail, "Why this is here", next step, history (last 5), Open in record                                                                                                                                                     | Built 2026-10-21 | Care guide, operations, reviewer | Take, act, reassign, wait, dismiss | `ExceptionRow`, `exception_claims`, escalations                                   | Care guides: assigned and covered households only. Administrators: none. | See 3.3 of the spec                                              | See 3.6 of the spec                                                | Nothing                                                       | L    |
| E-5 | Take ownership, mark waiting, release ownership                                                                                                                                                                                                                                   | Built 2026-10-21 | Care guide, operations           | Own the work                       | `exception_claims`, escalations                                                   | —                                                                        | One click; confirm for release                                   | `exception.taken`, `exception.waiting`, `exception.owner_released` | Nothing                                                       | M    |
| E-6 | Assign to… (single and bulk)                                                                                                                                                                                                                                                      | Built 2026-10-21 | Operations                       | Route the work                     | Same                                                                              | —                                                                        | Preview; reason required in bulk; confirm                        | `exception.assigned`                                               | Nothing                                                       | M    |
| E-7 | Dismiss with a reason; refused for the categories that must be resolved through their workflow                                                                                                                                                                                    | Built 2026-10-21 | Owner, operations                | Close without acting               | `exception_claims`                                                                | —                                                                        | Reason required; server refuses consent and authority categories | `exception.dismissed`                                              | Nothing                                                       | S    |
| E-8 | "Reached by phone" for Unread critical update                                                                                                                                                                                                                                     | Built 2026-10-21 | Care guide                       | Record contact outside the app     | Acknowledgement context                                                           | Staff only                                                               | Confirm with the person's name                                   | `update.reached_by_phone`                                          | Nothing (the family's own acknowledgement state is unchanged) | S    |
| E-9 | Sidebar counts, notifications and old URLs (`/staff/queue`, `/staff/escalations`) redirect to Exceptions views                                                                                                                                                                    | Built 2026-10-21 | All staff                        | —                                  | Shell                                                                             | Counts only for what the viewer can see                                  | —                                                                | —                                                                  | Nothing                                                       | S    |

**Exit criteria:**

- every category fires, clears and audits correctly;
- the dismissal refusals are tested on the server;
- role scoping is tested for Maya, Sofia, Dana, Priya and Lena;
- founder review.

**Built on 2026-10-21, with these differences from the spec:**

- **Waiting on partner** is its own rule: a released packet the named recipient hasn't opened after
  the threshold.
- **Missing consent** fires from a logged partner request with no active consent. A packet draft
  without one stays under Release incomplete, so nothing is listed twice.
- **Family contact unresolved** covers unanswered household messages; unaccepted invitations and
  bounced email aren't rules yet.
- **The All view comes first and is the default.** Role homes with their own defaults are Phase 4.
- **Bulk assign** needs a reason. For escalations the reason isn't stored yet (their own assign
  has no reason field); for rule-derived exceptions it's in the audit event.
- **Coordination risk** comes back 7 days after being dismissed, if its signals still hold.
- Table checkboxes are 24px, so every row can be selected and still meet the minimum target size.

## Phase 3: Team coverage and handoffs (workstream 3)

| ID  | Story                                                                                     | Status                         | Primary role | Decision or action           | Objects                                   | Visible vs hidden                                                                                    | Approval gate                                                           | Audit event                                                               | Family app                                                                   | Size |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------ | ------------ | ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---- |
| C-1 | Record a planned absence (start, end, reason) on Team & coverage                          | Built 2026-10-22               | Operations   | Plan cover                   | `staff_absences`                          | Staff only. Reasons are free text with the guidance "No health details".                             | Confirm restating the person and dates                                  | `absence.recorded`, `absence.cancelled`                                   | Nothing                                                                      | M    |
| C-2 | Offer cover per household to a care guide, with a note                                    | Built 2026-10-22               | Operations   | Choose who covers            | `handoffs` (kind `cover`)                 | —                                                                                                    | Confirm restating the households, the covering guide, the start and end | `handoff.offered`                                                         | Nothing                                                                      | M    |
| C-3 | Accept or decline (decline needs a reason) by the receiving guide                         | Built 2026-10-22               | Care guide   | Take on the households       | `handoffs`                                | Before acceptance, the receiving guide sees the household names and note only, with no record access | Confirm restating the households and the end time                       | `handoff.accepted`, `handoff.declined`                                    | Nothing                                                                      | M    |
| C-4 | On acceptance, grant a time-limited care-guide membership (`expires_at` = end of absence) | Built 2026-10-22               | System       | —                            | `memberships`                             | Shown as "Temporary" in Who can see what with the exact end                                          | Comes from C-3                                                          | `coverage.granted`                                                        | Nothing                                                                      | M    |
| C-5 | Automatic expiry at the end time (checked on every access decision, not by a timer)       | Built 2026-10-22               | System       | —                            | `memberships.expires_at`                  | Access ends at the exact time                                                                        | —                                                                       | `coverage.ended` (actor: System), written on the first check after expiry | Nothing                                                                      | S    |
| C-6 | Stalled-handoff exception after `handoffAcceptHours`                                      | Built 2026-10-22               | Operations   | Re-route                     | `handoffs`                                | —                                                                                                    | —                                                                       | via the exception rules                                                   | Nothing                                                                      | S    |
| C-7 | Household transfer handoff (permanent reassignment with acceptance)                       | Built 2026-10-22               | Operations   | Reassign with a warm handoff | `handoffs` (kind `transfer`), memberships | —                                                                                                    | Confirm                                                                 | `handoff.*`, `assignment.created`, `assignment.ended`                     | Nothing (the family app's care-guide name changes, as with today's Reassign) | M    |
| C-8 | Tell families about temporary cover when it becomes active (decision 62)                  | Built 2026-10-22 (decision 62) | —            | —                            | —                                         | —                                                                                                    | —                                                                       | —                                                                         | —                                                                            | —    |

**Exit criteria:**

- the cover window is tested before, during and after, in access checks and in Who can see what;
- expiry needs no running job;
- founder review.

**Built on 2026-10-22, with these differences from the spec:**

- **Migration `0022`** adds `memberships.starts_at`, so accepted cover gives access only from the
  absence's start (decision 59: "for the cover window only"), not from the moment it's accepted.
  Every access check honours it, as it already honoured the end time.
- **Handoffs offered to a care guide are on My work** (with the household's name, the dates, who
  offered it and the note), not an Exceptions view: before accepting, the guide can't open the
  household, so its exception rows wouldn't be theirs. A generic notification ("A household was
  offered to you") links there.
- **The absence board says when cover is optional:** a household with another assigned guide who
  isn't away shows "also assigned; cover optional".
- **Cancelling an absence** withdraws open offers and ends cover already accepted, at once.
- **Ended cover is recorded on the next workspace load** (`coverage.ended`, actor System); access
  already stopped at the exact time, without any job running.

## Phase 4: Command-center homes (workstream 4)

All widgets follow one pattern: a count plus the three oldest items, and the count links to the
filtered list. Dashboards are read-only; actions happen in the record or workflow.

| ID  | Story                                                                                                                                                                                                             | Status            | Primary role  | Decision or action                      | Objects                                       | Visible vs hidden                           | Approval gate | Audit event | Family app | Size |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------- | --------------------------------------- | --------------------------------------------- | ------------------------------------------- | ------------- | ----------- | ---------- | ---- |
| H-1 | Care guide home (`/staff`): Needs you now, Due or overdue, Waiting on family, Waiting on partners, Access ending, Changed since you last looked; plus the getting-started guide (existing)                        | Built 2026-10-22  | Care guide    | Pick the first thing                    | Exceptions, tasks                             | Own and covered households                  | —             | —           | Nothing    | M    |
| H-2 | Operations home: No owner, Needs you now, Coverage (households per guide, absences, gaps), Releases in progress, Waiting on partners, Access ending                                                               | Built 2026-10-22  | Operations    | Spot what's slipping across the hospice | Exceptions, memberships, absences             | All households                              | —             | —           | Nothing    | M    |
| H-3 | Reviewer home: Review backlog (age), Consent & access, Releases in progress                                                                                                                                       | Built 2026-10-22  | Reviewer      | Clear reviews in age order              | Exceptions, reviews                           | All households                              | —             | —           | Nothing    | S    |
| H-4 | Administrator home (evolves Administration): Governance changes (recent settings and role changes; "awaiting a second approver" stays empty until R-06), Audit integrity, coverage counts with no household names | Built 2026-10-22  | Administrator | Oversee governance                      | Audit, settings history, memberships (counts) | No household names or details (decision 39) | —             | —           | Nothing    | M    |
| H-5 | Leadership home                                                                                                                                                                                                   | **Future (R-07)** | —             | —                                       | —                                             | —                                           | —             | —           | —          | —    |

**Exit criteria:**

- each count equals the length of its linked list;
- no household names on the administrator home;
- founder review.

**Built on 2026-10-22, with these differences from the spec:**

- **My work's tiles and tables are replaced by the widgets**, so taking ownership from My work
  moved to Exceptions (the home is read-only, as approved). The page keeps its "My work" title for
  every role, with a line saying what the home covers.
- **"Changed since you last looked" is "Changed in the last day"**: there's no per-person "last
  looked" record yet, and the last day is accurate to what's shown. Its items are the newest, not
  the oldest.
- **The administrator's "Governance changes awaiting a second approver"** isn't shown: two-person
  approval is undecided (register R-06), so it would always be empty. Recent changes to people,
  access and settings are already on that page.

## Phase 5: Demo-safe Copilot foundation (workstream 5)

| ID  | Story                                                                                                                                                                        | Status                                           | Primary role                     | Decision or action        | Objects                       | Visible vs hidden                                                            | Approval gate                          | Audit event                                                              | Family app                                                                     | Size |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------- | ------------------------- | ----------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---- |
| P-1 | Catch me up: a template-built summary from the viewer's own visible record, every line citing source events, "as of" time                                                    | Built 2026-10-22                                 | Care guide, operations, reviewer | Orient fast               | Timeline, context, exceptions | Only what the viewer can open; never private notes; never for administrators | —                                      | `summary.prepared` (source IDs only)                                     | Nothing                                                                        | M    |
| P-2 | Gap finding and next steps: the exception rules, shown under "Prepared" in the detail panel                                                                                  | Built 2026-10-22                                 | All staff                        | Act on a suggestion       | Exceptions                    | As exceptions                                                                | The underlying action's gate           | The underlying action's event                                            | Nothing                                                                        | S    |
| P-3 | Synthetic prepared drafts for named demo moments (reply to Daniel; handoff note for Sofia; packet manifest suggestion), labelled "Prepared with Copilot · synthetic example" | Built 2026-10-22                                 | Care guide, operations           | Edit and send, or discard | Seed drafts                   | Staff only                                                                   | The person edits and confirms the send | `message.sent` and others with `prepared: true`; the person is the actor | The message arrives from the staff member; attribution to families is **R-02** | M    |
| P-4 | Live model integration                                                                                                                                                       | **Founder decision required (R-01)**. Not built. | —                                | —                         | —                             | —                                                                            | —                                      | —                                                                        | —                                                                              | —    |

**Exit criteria:**

- every summary line has a working citation;
- the protected-item leakage test passes;
- the "synthetic example" label appears on every prepared draft;
- nothing can be sent without a person's confirmation.

**Built on 2026-10-22, with these differences from the spec:**

- **Catch me up says how it was made:** "Prepared from this household's record by fixed rules, not
  AI", so a deterministic summary is never mistaken for a model's. Its source links open the
  household's timeline at the cited event.
- **Gap finding and next steps (P-2)** are the exception rules' "Why this is here" and "Next step",
  already in the Exceptions panel since Phase 2; nothing further was added.
- **A draft only counts as prepared if one was on offer:** the server checks that a demo snapshot
  is loaded and a draft exists for that household before recording "Prepared with Copilot".

## Phase 6: Audit readiness pass and demo hardening (workstream 6)

| ID  | Story                                                                                                                                                                                                                                                            | Status           | Primary role | Decision or action         | Objects        | Visible vs hidden            | Approval gate | Audit event                | Family app | Size |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------ | -------------------------- | -------------- | ---------------------------- | ------------- | -------------------------- | ---------- | ---- |
| A-1 | Sweep every new and existing sensitive action for the approved audit shape; fill the gaps. This includes `packet.recipient_access_ended`, written by the system on the first check after access expires (today expiry is enforced but not recorded as an event). | Built 2026-10-22 | —            | —                          | All services   | —                            | —             | —                          | Nothing    | M    |
| A-2 | Audit review filters for source, "prepared" and approval chain; household filter shows the full simulated week                                                                                                                                                   | Built 2026-10-22 | Operations   | Show exactly what happened | `audit_events` | Visibility classes unchanged | —             | `audit.exported` on export | Nothing    | M    |
| A-3 | Demo run-through on the review server; screenshots to `docs/review-screenshots/enterprise/`; update `docs/staff-workspace.md`                                                                                                                                    | Built 2026-10-22 | —            | —                          | —              | —                            | —             | —                          | Nothing    | M    |

**Built on 2026-10-22, with these differences from the spec:**

- **What the sweep (A-1) filled in:** consent activation and bereavement confirmation now record
  who requested and who approved (`approval`); consent amendments record the previous version
  (`before`); role changes record `before` and `after`. `packet.recipient_access_ended` is written
  by the system once per grant, on the first workspace load after the access ends, alongside
  `coverage.ended`; it isn't a timer.
- **The Source filter (A-2)** is one control with eight choices: the six sources, "Prepared with
  Copilot" and "Two-person approvals". The detail panel shows the approval chain as "Requested by …
  Approved by …". The CSV export records the filter as `sourceFilter`, so it doesn't collide with
  the export event's own source.
- **The run-through (A-3)** is `e2e-verify/enterprise-shots.spec.ts`, run with
  `ENTERPRISE_SHOTS=1`; it resets to the mid-week and end-of-week snapshots and writes 18 screenshots
  to `docs/review-screenshots/enterprise/`. It's skipped in the ordinary verification run, so that
  stays read-only.

## Phase 7: Direction refinements (design only)

From the enterprise direction (published 2026-10-22 for founder review), approved by the founder's
"continue" on 2026-10-22. Each refinement changes what a screen shows, not who may see or do
anything: no permission, policy or decision-1 wording changes.

| ID  | Story                                                                                                                                       | Status           | Primary role           | Objects                      | Visible vs hidden                                                         | Audit event | Family app |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------- | ---------------------------- | ------------------------------------------------------------------------- | ----------- | ---------- |
| D-1 | Record context column grouped by the questions: what's waiting and who owns it, who is involved, what has been agreed, what has been shared | Built 2026-10-22 | Care guide             | Record context               | Unchanged                                                                 | —           | Nothing    |
| D-2 | "Based on" and "Closes when" in Why this is here: the consent version and state, or authority record, behind each sharing row               | Built 2026-10-22 | All staff              | Consents, packets, authority | Only on rows the viewer already sees, about records they can already open | —           | Nothing    |
| D-3 | Where work is waiting: open items by category and age band, for operations, each count opening that part of the list                        | Built 2026-10-22 | Operations             | Exception rows               | Counts of rows already on the page                                        | —           | Nothing    |
| D-4 | The same three lines (Used, Suggests, You approve) on every prepared item: the three drafts and Catch me up                                 | Built 2026-10-22 | Care guide, operations | Prepared drafts, summaries   | Unchanged                                                                 | —           | Nothing    |
| D-5 | Each resolved item links to the event that closed it, open in Audit review                                                                  | Built 2026-10-22 | All staff              | `audit_events`               | Audit review's own visibility                                             | —           | Nothing    |
| D-6 | Reports: prepared work (Catch me up opened; prepared replies, handoff notes and packet contents used), counted from recorded events         | Built 2026-10-22 | Operations             | `audit_events`               | Counts only                                                               | —           | Nothing    |

**Built on 2026-10-22, with these differences from the direction page:**

- **What's waiting comes first** in the context column, not last as the direction's question order
  suggested: the record is exception-first, and on a phone it already led.
- **Drafts say they used nothing from the record.** The prepared drafts are fixed synthetic
  examples, so the "Used" line says that rather than citing events they weren't made from.
- **Reports count what is recorded:** summaries opened and drafts used. Drafts offered or discarded
  aren't recorded, so they aren't counted.
- **The demo week now records Dana's Day 4 cover offer as prepared**, as the demo map always said.
- **The run-through** has two more screenshots: 19, where work is waiting, and 20, prepared work in
  Reports.

## Quality pass (2026-10-22)

A correctness review of the Phase 0–7 server code and a keyboard pass on the enterprise screens,
chosen by the founder after Phase 7. No permission, policy or decision-1 wording changed.

| #   | Finding                                                                                                                                                                                                   | Severity | Status                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| Q-1 | "Reached by phone" cleared an unread update for everyone, though the update lists every household member who hasn't acknowledged it. It now counts for the person reached only.                           | High     | Fixed; test in `exceptions.test.ts`; demo map Day 4 updated                               |
| Q-2 | Cancelling an absence ended any of that guide's cover expiring before its end, including cover for a different, earlier absence, and didn't record the end.                                               | High     | Fixed: only cover for that absence's window ends, each recorded as `coverage.ended`; test |
| Q-3 | Accept, decline and withdraw didn't re-check the offer's state inside their transaction, so a guide could gain access to an offer withdrawn a moment before. An offer could be accepted after its window. | Medium   | Fixed: each update requires the expected state; an ended window is refused; test          |
| Q-4 | A dismissal hid its row for good: a packet held after its draft row was dismissed, or access renewed and ending again, stayed hidden.                                                                     | Medium   | Fixed: a dismissal covers the occurrence it was made on; test                             |
| Q-5 | Chart columns in Reports took keyboard focus but showed no focus indicator.                                                                                                                               | Medium   | Fixed: a ring inside the focused column; `e2e/keyboard-focus.spec.ts` checks every stop   |
| Q-6 | Two workspace loads at the same moment could each record the same recipient access ending (a duplicate audit line; nothing is shown or shared twice).                                                     | Low      | Fixed: the check and the write share a transaction with a lock; a test runs two at once   |

Checked and found sound: exception actions find the row as the viewer sees it before acting;
partner events follow decision 60; the access map comes from the same policy functions as access;
message rows are keyed by the newest unanswered message, so a dismissal can't hide later ones;
cover ends at its exact time through access checks, with the event recorded on the next load.

## Sequence and dependencies

```
Phase 0 ──► Phase 1 (record) ──► Phase 2 (exceptions) ──► Phase 3 (coverage) ──► Phase 4 (homes) ──► Phase 5 (Copilot) ──► Phase 6 ──► Phase 7 (refinements)
                    └─ R-4 needs C-4 for the "Temporary" rows; it ships first with permanent access, and cover rows are added in Phase 3
```

**Phases 1 and 2 come first** because together they prove the thesis.

**Phase 3's cover access scope is decided** (decision 59), so C-4 can ship with C-1 to C-3.

**Risks:**

- The household page is already large (2,500 lines). Record v2 splits it into components rather
  than growing it.
- Merging Queue and Escalations moves a lot of existing tests. Old URLs redirect, so links in
  notifications keep working.
