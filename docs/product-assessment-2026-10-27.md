# Product-wide assessment, enterprise contexts and partner foundation (2026-10-27)

**Status: an assessment and proposal, not a decision or an implementation.** This answers Track A of
the consolidated master prompt the founder pasted on 2026-10-27. Nothing here is built, approved,
selected or ready. Labels follow [production-readiness.md](production-readiness.md): **[Code]**,
**[Test]**, **[Doc]**, **[Assumption]**, **[Policy]**, **[Pending review]**. Competitor evidence uses the
prompt's categories: _publicly described_, _requires vendor demonstration_, _hands-on verified_,
_unverified_, _proposed_.

Companion: [brief-reconciliation-2026-10-27.md](brief-reconciliation-2026-10-27.md) (the previous
brief's gap plan and increments 1–6).

## 1. Executive status and actual enablement

- **What runs:** a synthetic pre-pilot on one embedded database. Family app and separate hospice
  workspace; controlled sharing; append-only, hash-chained audit; enrollment and activation (decisions
  66–70); security headers, cross-site refusal, send-once messaging and a retention guard. [Code],
  [Test] 560 of 560 unit and integration tests on 2026-10-27; end-to-end suites last passed
  2026-10-22 and weren't re-run.
- **Live:** nothing. No real data, no deployment, no integrations (all adapters refuse calls, guard
  test `tests/unit/integrations.test.ts`). All 17 pilot blockers are open or in progress.
- **Enterprise contexts B (employer leave and caregiving) and C (partner legal and estate):** not
  present in the code at all, and outside the approved pilot (see §2).
- **Track B (synthetic partner gateway): not started.** It conflicts with three standing holds (§2,
  conflicts 1–3) and needs a founder decision first.

## 2. Baseline found, missing, and conflicts

**Found:** the standing product context ([product-context.md](product-context.md), 2026-10-11),
founder decisions 1–70, the product register R-01 to R-19, readiness decisions D-01 to D-14, the frozen
baseline and its lift records, and the previous brief's reconciliation.

**Missing:**

- **The "last approved master prompt"** isn't in the repository; only the standing product context
  and the two briefs pasted on 2026-10-27 exist. Nothing here treats an earlier prompt as approved.
- **The synthetic handoff package** (`openapi-core.json`, `mock_partner.py`, `test_contract.py`,
  `validation-report.txt`, `README.md`, `partner-review.md`, `release-gates.csv`, `runbook.md`,
  `endpoint-backlog.csv`, `implementation-brief.md`) is **not on this computer**: a search of the
  Zeporah folder and Downloads found none of them. It wasn't inspected, imported or run, so its
  reported "14 synthetic tests passed" is unverified here.
- **The 83-item catalog** (previous brief) isn't in the repository either.

**Conflicts (the safer boundary is kept; only the affected work stops):**

| #   | Conflict                                                      | Standing boundary                                                                                                                                                                                  | Effect                                                                                                     |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Track B asks for a synthetic adapter returning sample matters | [integration-readiness.md](integration-readiness.md) (decision 18): "no live integrations, and none are simulated … no stub returns sample data"; guard test fails if any service calls an adapter | Track B blocked until the founder amends decision 18 for a labelled synthetic adapter                      |
| 2   | Planning, legal and estate partner services (context C)       | Product context: the first product is not "a legal-tech product", "an estate-administration system" or "a broad consumer marketplace"                                                              | Context C stays assessment-only until the founder changes the product scope                                |
| 3   | Employer leave and caregiving (context B)                     | Product context: the hospice is the customer; one hospice, 10–25 households; "do not design … around … high-volume consumer acquisition"                                                           | Context B stays assessment-only and disabled (the prompt agrees)                                           |
| 4   | Any code for Track B                                          | The frozen demo baseline                                                                                                                                                                           | Needs a freeze lift                                                                                        |
| 5   | "Person-centered, not hospice-exclusive" (previous brief)     | Product context: "hospice-configured household coordination workspace"                                                                                                                             | Already raised in the reconciliation (§3 item 1); still undecided **Decided 2026-10-28: decisions 74–78.** |
| 6   | Bereavement "13 months" vs a statutory duration               | Decision 10: seven steps to 13 months, an internal default                                                                                                                                         | No statutory claim is made anywhere; the product says "support", not entitlement. Keep it                  |
| 7   | Commercial terms                                              | Product context: paid 90-day pilot, hospice pays, families free                                                                                                                                    | Unchanged; any household charge or separately paid partner service needs an explicit decision              |

## 3. Product-wide inventory, gaps and priorities

Classification: **implemented**, **partial**, **proposed**, **partner-dependent**, **deferred**,
**blocked**. Priority: **P0** safety and correctness, **P1** pilot workflows, **P2** validated competitive
gaps, **P3** future breadth.

### Patient and household

| Capability                                          | Status      | Evidence                                                                                               | Priority                    |
| --------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ | --------------------------- |
| Enrollment and onboarding                           | implemented | `enrollment.ts`, 4-step onboarding; decisions 66–70                                                    | —                           |
| Help before onboarding is complete                  | partial     | Support page and 24-hour line reachable from every family page; messaging waits for setup step 3       | P1                          |
| First useful action                                 | partial     | Tracked on the activation checklist; no guided "first action" for the family                           | P1                          |
| Team and contact visibility                         | implemented | Care team card, 24-hour line, reply-time expectation (decisions 24, 46)                                | —                           |
| Shared and private tasks                            | implemented | Task audience and visibility (decisions 44, 48b)                                                       | —                           |
| Appointments and visit expectations                 | partial     | Free-text visit rhythm on the care record only; no appointment model                                   | P1                          |
| Caregiver availability and backup                   | proposed    | Not in code                                                                                            | P2                          |
| Equipment, supplies, transport                      | proposed    | Only as demo task wording                                                                              | P2                          |
| Communication and acknowledgements                  | implemented | One household thread, acknowledgements, send-once (increment 3)                                        | —                           |
| Independent supporters (doulas, outside clinicians) | proposed    | Roles are household roles plus helpers and packet recipients only                                      | P1 decision (conflict 5)    |
| Planning and documents                              | partial     | Vault is metadata and location only (decision 43); no creation                                         | P3, partner-dependent       |
| Estate work                                         | deferred    | Bereavement plan steps only; no estate tasks model                                                     | P3, partner-dependent       |
| Emotional and bereavement support                   | implemented | Bereavement plan (decision 10), check-ins, "rather not be contacted" (decision 36)                     | —                           |
| Leave, work and benefits navigation                 | proposed    | Not in code; context B                                                                                 | P3                          |
| Personal wishes and legacy                          | partial     | Patient view "wishes and preferences" (decision 46); no legacy content                                 | P2                          |
| Low-tech and assisted participation                 | proposed    | Invitations can be opened together at a visit (decision 67); no phone/print path                       | P1                          |
| Language and accessibility                          | partial     | English only (PC-01); automated axe and keyboard checks; no manual assistive-technology review (PB-16) | P0 for accessibility review |
| Export, correction, account recovery                | partial     | Consent correction requests; family password reset (decision 27); no household data export             | P1                          |

### Hospice enterprise

| Capability                         | Status      | Evidence                                                                                          | Priority    |
| ---------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- | ----------- |
| Staff provisioning and offboarding | implemented | Staff invitations, deactivation (`team.ts`)                                                       | —           |
| Household activation               | implemented | Increment 6                                                                                       | —           |
| Assigned and unassigned work       | implemented | Exceptions, claims, queue                                                                         | —           |
| Ownership and acceptance           | partial     | Claims and handoffs accept; one lifecycle across requests is undecided (reconciliation §3 item 5) | P1 decision |
| Coverage and shift handover        | implemented | Decisions 59–62                                                                                   | —           |
| Aging, blocked, reopened requests  | partial     | Aging via exception thresholds; no "blocked" or "reopened" request states                         | P1          |
| External provider handoffs         | proposed    | Packet release to a named recipient is one-way                                                    | P2          |
| Contact routing and downtime       | partial     | 24-hour line, read-only mode; the line isn't verified (PB-22 proposed)                            | P0          |
| Configuration governance           | implemented | Org settings, audited, operations vs administrators (decision 39)                                 | —           |
| Training and support tools         | partial     | Staff guide (`staff-guide.ts`), policy scenarios page; no training programme (PB-15)              | P1          |
| Reporting and workload             | implemented | Reports (decisions 41, 57)                                                                        | —           |
| Audit and minimum-necessary access | partial     | Writes audited; staff reads aren't (PB-12, D-04); operations see every household (PC-04)          | P0          |

### Partner services (context C)

All **proposed and partner-dependent**: eligibility and coverage, intake, human assistance,
professional engagement, pricing and acceptance, completion evidence, complaints, referral quality,
continuity and exit. None exists in code; conflict 2 applies.

### Platform

| Capability                        | Status                      | Evidence                                                                                       |
| --------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| Identity and recovery             | partial                     | Local passwords, scrypt, lockout; no staff MFA (PB-08); recovery by re-invitation (decision 9) |
| Tenant and relationship isolation | implemented on tested paths | Composite foreign keys, scoped services, second-hospice tests; one tenant per hospice          |
| Authorization                     | implemented on tested paths | Default-deny matrix, server-side scope checks                                                  |
| Consent and authority             | implemented                 | Proposal → confirmation → activation; authority is workflow status only                        |
| Audit                             | partial                     | Chain with serialized appends and findings (increment 2); no external anchoring (SB-04)        |
| Reliability                       | partial                     | Single process, no pooling, no failover (PB-02)                                                |
| Accessibility                     | partial                     | See above                                                                                      |
| Data lifecycle                    | partial                     | Retention guard, no periods (increment 5, PB-11)                                               |
| Incident response                 | proposed                    | PB-13                                                                                          |
| Release governance                | partial                     | CI checks locally, freeze manifest; GitLab pipeline not run (PB-01)                            |

## 4. Competitive evidence and uncertainty

**Benchmark: Empathy** (empathy.com). Reviewed 2026-10-27 from public pages and press releases only;
nothing was demonstrated or tested. Figures on those pages are company-reported.

| Capability                                                                                               | Empathy evidence (category, source, offering)                                                          | Zeporah evidence                                                                             | Coverage                      | Decision                                           |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------- |
| Loss support: funeral, claims, accounts, probate guidance with a care team                               | _Publicly described_; "Loss Support"; search summaries of Empathy and Transamerica releases (Jan 2026) | Bereavement plan and check-ins; no estate or claims work                                     | Low                           | **Partner or defer** (conflict 2)                  |
| Legacy and estate planning: guided will and wishes                                                       | _Publicly described_; employer page ("put a will and their wishes in place")                           | Vault metadata only                                                                          | None                          | **Partner, later**                                 |
| Leave support, planning to return to work                                                                | _Publicly described_; "Leave Support", launched with MetLife Oct 2025 per Empathy's 2025 recap         | None                                                                                         | None                          | **Defer** (context B)                              |
| Caregiving: shared hub for the care circle, each member with own access                                  | _Publicly described_; caregiving page                                                                  | Household with roles and invitations; patient has own access                                 | Medium (hospice context only) | **Match where the pilot needs it**                 |
| Trained human care team from the first question; AI triage and routing; 24/7 in the caregiver's language | _Publicly described_; caregiving page                                                                  | Care guide (the hospice's staff), not a Zeporah service; no AI (R-01 deferred); English only | Different model               | **Do not copy** an unstaffed 24/7 claim; **guide** |
| Arranging services through a provider network                                                            | _Publicly described_; caregiving page; states it doesn't provide hands-on care itself                  | None                                                                                         | None                          | **Partner, later**                                 |
| Organization-facing activity hub ("Empathy Connect": clients, completed estate documents)                | _Publicly described_; employer page; appears advisor- or insurer-facing                                | Hospice workspace (coordination desk)                                                        | Different buyer               | **Differentiate**                                  |
| Hospice admission-to-first-use, ownership, coverage handoffs, patient-understandable access              | Not described publicly. **That doesn't mean Empathy lacks it**                                         | Implemented (increment 6; decisions 46, 58–62)                                               | Candidate differentiation     | **Differentiate, with evidence**                   |

**Not claimed as unique to Zeporah:** whole-care-circle participation, shared coordination, document
organization, before- and after-loss support, personalized checklists, and technology plus human
support. Empathy publicly describes most of these.

**Candidate differentiation, still to be shown with pilot evidence:** hospice-specific ownership and
routing, coverage and shift handoffs, admission-to-first-use activation, patient-understandable
access ("Who can see what"), and lifecycle continuity into bereavement. Each needs the measurement in
§12 before it can be stated outside the team.

**Uncertainty:** pricing, packages and contract terms are unknown; operational depth needs a vendor
demonstration; the pages may change. Re-review before any external comparison.

Sources: [Empathy caregiving support](https://www.empathy.com/solutions/caregiving-support),
[Empathy for employers](https://www.empathy.com/employers),
[Empathy 2025 recap](https://www.empathy.com/blog/2025-recap),
[Business Wire, Caregiving Support, 22 Jul 2026](https://www.businesswire.com/news/home/20260722004757/en/),
[Business Wire, Transamerica collaboration, 28 Jan 2026](https://www.businesswire.com/news/home/20260128372756/en/Empathy-Announces-Strategic-Collaboration-with-Transamerica-to-Deliver-Comprehensive-Family-Support).

## 5. Enterprise leave support (context B): requirements, proposed and disabled

**Status: proposed; disabled; outside the approved pilot (conflict 3).**

**Roles.** Employer (sponsor), benefits administrator, leave provider or third-party administrator,
employee, care recipient, dependent. Sponsorship gives an **entitlement to the service**, never access
to the employee's household, care or legal data.

**Eligibility.** Source of truth is the sponsor's eligibility feed or the administrator, verified
per employee and dated. Zeporah records "eligible for the service until <date>" only. Multiple
employers and multiple sponsorships per person are allowed; each is a separate entitlement.

**Cases.** One person may have several care recipients and several leave events, overlapping or
intermittent. Each leave event is its own record with its own dates, provider and documents. Changes
(extension, changed circumstances) are new versions, not edits.

**Lifecycle, kept as five separate statuses:**

1. **Zeporah coordination status:** preparing, ready to submit, waiting on employee, waiting on provider, closed.
2. **Submission/delivery status:** not sent, sent, received, failed. Sent never means accepted.
3. **Administrator decision:** recorded as reported by the administrator, with source and date.
4. **Benefit/payment status:** as reported.
5. **Employment-related determination:** never stored as Zeporah's own judgment.

Zeporah never infers legal eligibility, job protection, benefit entitlement or approval.

**Requests for information and deadlines.** Each request is a task with the requester, the deadline
the administrator stated, and who owns the reply. Missed deadlines raise an owned exception; nothing
auto-submits.

**Denial, withdrawal, dispute, appeal.** Recorded as reported; appeal is a referral to the provider or
an advisor, never handled by Zeporah.

**Return to work.** A checklist the employee owns, shared with the employer only by the employee's
explicit, scoped choice.

**Benefit ends mid-case.** The service continues to a defined end (proposed: 30 days, unvalidated),
the household keeps its own data, and the sponsor learns only that the entitlement ended.

**Employer reporting.** Aggregates only, with a minimum cell size (proposed: 10, unvalidated) and no
care recipient, diagnosis, document, message or identifiable sensitive event. Small groups (a team of
three, one leave in a small office) are suppressed. Re-identification risk is reviewed before any
report ships.

## 6. Enterprise caregiving (context B): requirements, proposed and disabled

**Status: proposed; disabled.** Specifies, for a future context-B increment:

- Many recipients per caregiver and many caregivers per recipient, each relationship separate.
- Shared and private responsibilities (reuses task audience and visibility, decisions 44 and 48b).
- Availability windows and a named backup per commitment; a missed commitment raises an owned
  exception, never an automatic clinical escalation.
- Respite: a request, a provider who must accept, and fulfilment; "requested" is not "arranged".
- Recurring tasks with a stated series end; cancelled occurrences never fire reminders.
- Reassignment and declined work, using the handoff model (decisions 61 and 59).
- Appointments, transport, equipment and supplies as logistics tasks with a responsible party.
- Caregiver-capacity concerns go to human follow-up (the existing support request), not triage.
- Service referrals require provider acceptance; unavailable or unsuitable providers are recorded as
  such, with an owner for the next attempt.
- Out-of-hours expectations stated per service; Zeporah promises no monitoring.
- Sponsor eligibility is separate from household access.

Information, coordination, human assistance and clinical response stay four separate things.

## 7. Care-team and domain model

### Entities (proposed, mapped to today's tables)

| Entity                            | Today                                                      | Proposed                                                              | Cardinality and lifecycle               |
| --------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| Person                            | `actors` (one per tenant)                                  | A person across tenants, linked to accounts                           | 1 person : many accounts                |
| Account / identity                | `users`, `sessions`                                        | Unchanged; staff via an identity provider later (PB-08)               | 1 account : 1 actor today               |
| Organization                      | `organizations` (one per tenant)                           | Hospices, sponsors, service providers as organizations                | many per tenant (proposed)              |
| Sponsorship / entitlement         | none                                                       | Sponsor, person, service, dates, source                               | Ends without deleting the person's data |
| Household / support circle        | `households`                                               | Unchanged                                                             | 1 per care episode today                |
| Care episode / hospice enrollment | the household's lifecycle                                  | A separate episode so transfer, discharge and readmission are visible | many per household (proposed)           |
| Team membership                   | `memberships`                                              | Add states and provenance (below)                                     | many per person                         |
| Coverage assignment               | care-guide memberships, cover (decisions 48a, 59)          | Unchanged                                                             | time-bounded                            |
| Legal coordination matter         | none                                                       | Partner-owned; Zeporah keeps a coordination reference                 | context C only                          |
| Professional engagement           | none                                                       | Separate from matter creation                                         | context C only                          |
| Service order and quote           | none                                                       | Price state: included, fixed price, quote required, unavailable       | context C only                          |
| Document / version                | `vault_items` (metadata)                                   | Metadata and status only; no originals in the MVP                     | versions superseded, never edited       |
| Authority claim and review        | `authority_evidence`, versions, reviews                    | Unchanged                                                             | claim ≠ verified authority              |
| Consent grant                     | `consents`, confirmations                                  | Unchanged                                                             | revocation is a new state, not deletion |
| Participant access grant          | memberships with task or collaboration scope (decision 42) | Generalize to scoped grants                                           | time-bounded                            |
| Task                              | `tasks`                                                    | Unchanged                                                             | open, done, closed                      |
| Handoff                           | `handoffs`                                                 | Generalize to external providers (states in §8)                       | requested → accepted …                  |

**Membership (proposed shape):** person, organization or affiliation, context (household or
episode), participation role, authority reference (never implied), object and action permissions,
effective dates, invitation and approval provenance, state, coverage relationship, and a historical
visibility policy (new members don't see earlier sensitive history by default).

**Membership states (proposed):** invited, pending_review, active, restricted, suspended, declined,
expired, removed. Today: active and ended, plus invitation states. [Code] `memberships.status`.

**Participation categories, never permission bundles:** patient; primary and backup caregivers;
chosen family and practical helpers; reviewed representatives; hospice nurses, physicians, aides,
social workers, spiritual care, bereavement staff, volunteers and operational staff; outside
clinicians and care organizations; independent caregivers and death doulas; pharmacy, equipment,
transport and practical services; legal and estate professionals in separate engagement spaces.

### Permission matrix (today's code, plus proposed rows)

Legend: **V** view, **A** act, **–** none, **P** proposed only.

| Resource → / Actor ↓        | Household home                | Tasks              | Thread              | Vault (standard / protected) | Consents          | Packets                    | Audit     | Enroll / invite               |
| --------------------------- | ----------------------------- | ------------------ | ------------------- | ---------------------------- | ----------------- | -------------------------- | --------- | ----------------------------- |
| Patient                     | V                             | V A (own, add)     | V A                 | V / with protected access    | V A (confirm)     | V (status)                 | –         | –                             |
| Coordinator                 | V                             | V A                | V A                 | V A / with protected access  | V A               | V                          | –         | Invite family                 |
| Family member               | V                             | V A (assigned)     | V A (if allowed)    | V / –                        | V                 | –                          | –         | –                             |
| Proxy                       | V                             | V                  | V                   | V / reviewed authority only  | V A               | V                          | –         | –                             |
| Helper (task-only)          | –                             | the one task       | –                   | –                            | –                 | –                          | –         | –                             |
| Packet recipient            | –                             | –                  | –                   | –                            | –                 | released packet, read-only | –         | –                             |
| Care guide (assigned)       | V                             | V A                | V A                 | V (by audience)              | record            | draft                      | V         | Invite patient or coordinator |
| Hospice operations          | V (all)                       | V A                | –                   | V (by audience)              | revoke on request | release                    | V, export | Enroll, invite                |
| Reviewer                    | V (all)                       | –                  | –                   | V                            | activate          | release                    | V, export | –                             |
| Administrator               | name only (coverage)          | –                  | –                   | –                            | –                 | –                          | V, export | Enroll                        |
| Outside clinician           | P                             | P (assigned)       | P (selected thread) | P (by grant)                 | –                 | –                          | –         | –                             |
| Death doula                 | P                             | P (legacy, ritual) | P (approved)        | –                            | –                 | –                          | –         | –                             |
| Sponsor (employer)          | –                             | –                  | –                   | –                            | –                 | –                          | –         | P (aggregates only)           |
| Legal / estate professional | – (separate engagement space) | P                  | P                   | P (matter documents)         | –                 | –                          | –         | –                             |

Source: [Code] `src/domain/permissions.ts`, `src/server/context.ts`, decisions 39, 42, 43, 45, 46, 69.
The proposed rows need decisions (conflict 5) before any build.

### Cross-context information flow

- **Hospice → household:** updates, messages, tasks, packets by consent. Never staff notes.
- **Household → hospice:** messages, support requests, setup choices, consent confirmations.
- **Household → sponsor (proposed):** nothing by default. Only entitlement use, aggregated with
  small-cell suppression.
- **Sponsor → household (proposed):** eligibility only.
- **Household ↔ partner (proposed):** the minimum references in §9; detailed legal intake stays
  partner-hosted. Never clinical notes, diagnoses, government IDs, account numbers or hospice
  affiliation unless needed and approved.
- **Partner → hospice:** nothing. A legal matter doesn't appear in the hospice workspace.

## 8. Domain states and field ownership (proposed)

**Matter states:** intake_in_progress, awaiting_user, awaiting_authority_review, in_review,
awaiting_execution, on_hold, completed, declined, withdrawn, closed. Unsupported coverage is a
validation error: no matter is created. **Completed** means the contracted service, never all legal
obligations.

**Document states:** draft_created, awaiting_review, awaiting_execution, execution_reported,
execution_confirmed, superseded, revoked. "Reported" (the person said so) and "confirmed" (evidence
from the responsible party) are different.

**Handoff states:** requested, accepted, in_progress, resolved, declined, unavailable, expired. "Sent"
never means accepted. Today's staff handoffs use offered, accepted, declined, withdrawn
([Code] `handoffs.state`).

**Allowed transitions** are listed per state in the contract appendix when Track B is approved;
terminal states (completed, declined, withdrawn, closed; superseded, revoked; resolved, declined,
unavailable, expired) can only be reopened as a new version with a reason.

**Field ownership:**

| Field                   | Source of truth                                       | Writer            | Sync              | On conflict                                              |
| ----------------------- | ----------------------------------------------------- | ----------------- | ----------------- | -------------------------------------------------------- |
| Matter status, version  | Partner                                               | Partner           | Partner → Zeporah | Higher version wins; never lower                         |
| External reference      | Zeporah                                               | Zeporah on create | Zeporah → partner | Immutable                                                |
| Participant access      | Zeporah                                               | Zeporah           | Zeporah → partner | Stricter local restriction always wins; revocation first |
| Consent reference       | Zeporah                                               | Zeporah           | Zeporah → partner | Revocation precedence                                    |
| Price state, acceptance | Partner (price); Zeporah (person's acceptance record) | Each its own      | Both ways         | No paid action without a recorded acceptance             |
| Document content        | Partner                                               | Partner           | Never copied      | —                                                        |
| Coordination tasks      | Zeporah                                               | Zeporah           | —                 | Local                                                    |

## 9. Partner contract (proposals only, not accepted vendor APIs)

Architecture: Zeporah UI → server-side gateway → adapter → partner API or hosted flow. No partner
secret in browser code. The prompt's endpoint, idempotency, cache, session, pricing, engagement,
contact and minimization rules are adopted as **proposals** and fit what the code already does:

- **Idempotency:** the send-once pattern from increment 3 (`createOnce`, unique per actor and
  submission ID) is the model; the prompt's per-organization `external_ref` uniqueness and
  "changed body returns conflict" match it. Seven-day retention is a proposal.
- **No-store and safe errors:** consistent with the read paths; uniform 404 for missing or
  inaccessible matters.
- **Live mode:** unavailable while delegation, trusted consent or required controls are absent. A
  no-op stub is not a security control.

Endpoints, events and limits (create, fetch, reconciliation; signed webhooks, 5-minute tolerance,
72-hour retries, 30-day replay, 15-minute reconciliation, page size 25 / 100, 60 reads and 10
writes per minute) are **all unvalidated proposals**.

## 10. Service completion definitions (proposed)

Service levels: **explain, prepare, coordinate, perform, advise/represent.** For each future service,
the record must name the responsible organization, entry criteria, required authority, sharing basis,
price state, paid acceptance, included work, exclusions, response expectation, completion criteria,
evidence source, remaining obligations, and cancellation or reopening rules. A service is
"completed" only against its own definition. No service may be shown without a staffed owner.

## 11. Failure-scenario register (summary)

Status vocabulary: specified, implemented, automated-tested, manually-tested, partner-tested,
blocked.

| Scenario                                              | Status                                            | Evidence                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Forwarded or wrong-account invitation                 | implemented, automated-tested                     | Invitation bound to the invited email; existing account needs its own password ([Code] `acceptInvitation`) |
| Membership expiry during use                          | implemented, automated-tested                     | Helper and collaboration expiry (decision 42); access ends on next request                                 |
| Staff organization change                             | specified                                         | One organization per staff account (PC-03)                                                                 |
| Revocation during view, download, send or queued work | partial                                           | Packet access rechecked on read; no queued sends exist                                                     |
| Multiple recipients, overlapping episodes             | specified                                         | One household per family account today (PC-03)                                                             |
| Conflicting ownership, unavailable backup             | implemented, automated-tested                     | Handoff acceptance and stalled-handoff exceptions                                                          |
| Coercion, disputed authority                          | partial                                           | Authority conflict hold and escalation; no private-concern route                                           |
| Transfer, discharge, readmission                      | specified                                         | Lifecycle has no episode model                                                                             |
| Incorrect death report and correction                 | partial                                           | Two-person bereavement confirmation; no correction flow                                                    |
| Pending work after death                              | partial                                           | Bereavement narrows access; open tasks aren't reviewed                                                     |
| Employment or benefit ending mid-case                 | specified                                         | Context B                                                                                                  |
| Overlapping leave, missed deadlines                   | specified                                         | Context B                                                                                                  |
| Reassignment / completion races                       | implemented, automated-tested                     | Conditional updates (`concurrency.test.ts`)                                                                |
| Recurrence duplication, cancelled reminders           | specified                                         | No recurrence                                                                                              |
| Time zone and DST                                     | implemented, automated-tested                     | Display zone; quiet hours tests                                                                            |
| SMS failure, email bounce, opt-out, shared devices    | partial                                           | No live channels; "Remember me" offered on the family sign-in only, never for staff (decision 53)          |
| Remote write succeeds, response lost                  | implemented, automated-tested and manually-tested | Increment 3                                                                                                |
| Partial batch failure                                 | implemented, automated-tested                     | Bulk actions report per item                                                                               |
| Stale coverage                                        | implemented, automated-tested                     | Cover ends at its exact time (decision 59)                                                                 |
| Provider migration or outage                          | specified                                         | No providers                                                                                               |
| Wrong-person upload                                   | specified                                         | No uploads                                                                                                 |
| Superseded or revoked documents, stale sessions       | partial                                           | Sessions revoked on reset and deactivation; no documents                                                   |
| Small-group reporting disclosure                      | specified                                         | Context B rule above                                                                                       |
| Expired exports                                       | specified                                         | Audit export downloads immediately; nothing is stored                                                      |
| Restore that duplicates work or revives access        | specified                                         | No backups yet (PB-03)                                                                                     |

## 12. Measurement plan (proposed)

| Measure                                   | Denominator                       | Source                                      | Owner           |
| ----------------------------------------- | --------------------------------- | ------------------------------------------- | --------------- |
| Activation                                | Households enrolled in the period | Activation checklist (increment 6)          | Operations lead |
| First useful action                       | Activated households              | First family message or request             | Operations lead |
| Handoff acceptance                        | Handoffs offered                  | `handoffs`                                  | Operations lead |
| Unowned work                              | Open exceptions                   | Exceptions with no owner, by age            | Operations lead |
| Repeat unresolved contacts                | Households with a request         | Requests reopened or repeated within 7 days | Care-guide lead |
| Coordination time                         | Staff hours, sampled              | Time study (not telemetry)                  | Hospice sponsor |
| Comprehension                             | Participants interviewed          | Structured interview                        | Design lead     |
| Support cost                              | Households                        | Support log                                 | Operations lead |
| Planning abandonment, provider completion | Started services                  | Partner records                             | Context C only  |
| Buyer value, renewal intent               | Hospice sponsor                   | Pilot review                                | Founder         |

Counts only, no content, no sensitive events in analytics. Usage, coordination outcomes, clinical
outcomes and regulatory measures are reported separately and never inferred from one another.

## 13. Human-service dependencies

Every human service needs an owner, qualifications, hours, languages, backup, response target,
escalation, missed-commitment handling, quality review, complaints and a cost per household before
it's shown. Today the only human service is **the hospice's own care team**; Zeporah runs none.
Product support (PB-15, D-11), bereavement staffing (hospice), legal advice (partner, context C) and
crisis resources (public lines, no monitoring) are all unstaffed by Zeporah.

## 14. External blockers

| Blocker                                                            | Responsible role              |
| ------------------------------------------------------------------ | ----------------------------- |
| Product scope for contexts B and C (conflicts 2, 3, 5)             | Founder                       |
| Amending decision 18 for a labelled synthetic adapter (conflict 1) | Founder                       |
| Partner selection, coverage verification, agreements, pricing      | Founder with counsel; partner |
| Identity and delegation (staff MFA, D-03)                          | Engineering lead; founder     |
| Hosting, BAA, backups (PB-02, PB-03)                               | Founder; engineering lead     |
| Retention schedule (D-05)                                          | Founder with counsel          |
| Staffed support model (D-11)                                       | Founder; operations lead      |
| Manual accessibility validation (PB-16, D-12)                      | Design lead                   |

## 15. Prioritized roadmap

1. **P0, no decision needed:** staff read-access logging design (D-04 brief), a verified 24-hour line
   (PB-22), manual accessibility review plan (PB-16).
2. **P1, after the reconciliation's open decisions:** request lifecycle (increment 8), care network
   (increment 7), offline status (increment 9), household export.
3. **P2:** caregiver logistics (availability, equipment, transport), external provider handoffs.
4. **P3:** contexts B and C, only after the scope decisions and a selected partner.

**Track B** (disabled partner gateway, synthetic adapter, matter create and fetch) is ready to specify
in detail but **blocked** by conflicts 1, 2 and 4. If the founder lifts them, it should still come
after the P0 items, as the prompt itself asks.
