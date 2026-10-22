# Pre-pilot plan: what remains after the synthetic build

> On 2026-10-22 the remaining production work moved into
> [production-readiness.md](production-readiness.md). This plan is kept for its history and
> human-validation steps; one stale item (no staff reactivation) was removed, since decision 38
> built it.

The synthetic pre-pilot build is feature-complete for the planned program, and every check below passes on synthetic data. **It isn't approved for real users, real data or deployment.** This plan lists what remains and who owns it. Nothing here is done unless it says so.

Status key: **Done** (verified in this repo) · **Human** (needs a person to perform and record it) · **Policy** (needs a founder or governance decision or document) · **Ops** (infrastructure and operations work outside feature code) · **External** (vendor, legal, security, clinical or compliance review).

## 1. Code complete (done)

- Auth, invitations, sessions; route and service authorization; tenant and organization boundaries; household-bound family access.
- Care-guide assignment, roster, reassignment, handoffs; staff lifecycle (role change, deactivation).
- Consent, authority, correction and release workflows; sharing register and consent history.
- Notifications with fixed-wording and visibility rules; messaging without attachments or read receipts.
- Household member administration; 13-month bereavement follow-up; household closure.
- Audit review with chain verification; operational reports; system status; read-only incident mode; error references.
- Integration contracts with every adapter disconnected.
- **Verification on 2026-10-12:**
  - type-check clean; 260/260 unit and integration tests; 71/71 end-to-end tests;
  - no schema drift (14 migrations);
  - automated axe checks on the new screens and dialogs, including the change-role dialog;
  - read-only incident mode tested end to end on its own server (`bun run test:e2e:readonly`, 2 tests);
  - the one intermittent test failure was found and fixed (a test-helper bug).
- Founder decisions 1–18 are applied and recorded in [founder-decision-log.md](founder-decision-log.md).

## 2. Human validation pending

### 2a. Manual accessibility review (Human)

The protocol is [manual-accessibility-review-protocol.md](manual-accessibility-review-protocol.md). **No manual review of the new screens has been performed.** The 2026-10-12 session was partial and covered only the start page, queue and a staff dialog.

| Session | Scope                                                                                                                                                                                                                                                                                                      | Setup                                                                                       | Est. time | Exit                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------- |
| 1       | Resume the original matrix from Family Sharing and the correction dialog, then the rest of the "Not tested" list in the [2026-10-12 log](accessibility-sessions/2026-10-12-manual-safari-voiceover.md): status notes, zoom 200%/400%, narrow reflow, grayscale priority, duplicate withdrawal, bereavement | `zeporah-pilot-dev-personas`, **Reset synthetic data**                                      | 2–3 h     | Logged; no open Blocker                           |
| 2       | Slice A (sign-in, invitations) and Slice B (assignment, Team page, Reassign)                                                                                                                                                                                                                               | As above. Dana invites a care guide (`@example.invalid`); open the link in a private window | 1.5 h     | Logged                                            |
| 3       | Slices C (staff lifecycle), D (handoffs), E (sharing register)                                                                                                                                                                                                                                             | Reset between C and D (deactivation changes the data)                                       | 1.5 h     | Logged                                            |
| 4       | Slices F (household members, also at 375 px), G (bereavement follow-up), H (audit review), I (reports, closing), J (status, read-only banner: restart with `ZEPORAH_READ_ONLY=1`)                                                                                                                          | Reset before G and before I                                                                 | 2 h       | Logged                                            |
| 5       | Optional iPhone VoiceOver spot check; second reviewer on the Blocker-severity rows                                                                                                                                                                                                                         | —                                                                                           | 1–2 h     | Required before any discussion with outside users |

Record each session in a new dated log from the [template](manual-accessibility-observation-log-template.md). Fix Blocker and High findings, then re-run those rows. Even after all sessions, **no WCAG conformance claim** follows. Testing with disabled users and a formal audit remain production gates.

### 2b. Founder walkthrough (Human)

Run [founder-review-walkthrough.md](founder-review-walkthrough.md) (about 36 minutes) on the gated environment after a reset. Note anything to change; changes become new founder decisions.

### 2c. Pre-pilot validation checklist (Human + Policy)

| Check                                                                                                             | Owner                    | Status                                             |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------- |
| Founder walkthrough completed and notes recorded                                                                  | Founder                  | Pending                                            |
| Manual accessibility sessions 1–4 logged; no open Blocker                                                         | Reviewer                 | Pending                                            |
| Clinical/hospice-operations review of the wording on family screens (consent, bereavement, "not for emergencies") | Hospice partner          | Pending                                            |
| Bereavement programme cadence confirmed against the partner hospice's programme                                   | Hospice bereavement lead | Pending (default in place, decision 10)            |
| Consent and authority workflow reviewed by privacy/legal counsel                                                  | External                 | Pending                                            |
| Staff roles and permissions matrix reviewed with the partner hospice                                              | Founder + hospice        | Pending                                            |
| Synthetic usability sessions (if approved): protocol, consent forms, synthetic scripts only                       | Founder                  | Not approved (v0.1 excludes external participants) |

## 3. Policy and governance pending (Policy)

The register of open policies; each one is needed before the related feature or claim.

| Policy                                                                   | Needed for                             | Current state                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------ |
| Audit export and governance (who, format, redaction, logging the export) | Decision 15, superseded by decision 28 | CSV export for operations and reviewers; downloaded-file governance still open |
| Family closure communication (copy, timing, channel)                     | Decision 14                            | No notice sent                                                                 |
| Account recovery model (identity proofing, who can reset)                | Decision 9                             | Care-team re-invitation                                                        |
| Data retention and deletion (households after closure, audit, notes)     | Real data                              | Not defined                                                                    |
| Out-of-app notification policy (channels, quiet hours, content)          | Decisions 6, 18 and 23                 | Opt-in family email nudges via the development mail sink; no provider          |
| Bereavement programme configuration per hospice                          | Decision 10                            | Fixed default                                                                  |
| Pilot enrollment and cap governance                                      | Decision 16                            | 25 documented, not enforced                                                    |
| Incident response and breach notification                                | Real data                              | Prototype runbook only                                                         |
| Access review cadence (who reviews staff access, how often)              | Real staff                             | Not defined                                                                    |
| Clinical-safety boundaries (non-clinical scope, emergency language)      | Any live use                           | Copy in product; not formally reviewed                                         |

## 4. Infrastructure and operations pending (Ops)

- **Hosting.** A production-grade database with managed backups and point-in-time recovery, replacing embedded PGlite. Encryption at rest and in transit.
- **Secrets management.** None exists; no keys may live in the repo.
- **Logging and monitoring.** Ship the structured error lines to a reviewed log service; alerting; on-call ownership.
- **Rate limiting and abuse protection** beyond per-account sign-in lockout (per-IP and per-endpoint).
- **Environments.** Separate staging and production with `ZEPORAH_ENVIRONMENT` set; the development gate is verified off.
- **Backup and restore drills**, beyond the local copy procedure in [operations-runbook.md](operations-runbook.md).
- **Dependency and supply-chain process:** updates, vulnerability scanning and licence review.
- **CI.** A pipeline running type-check, unit/integration and end-to-end tests on every change. Git isn't set up in this workspace, so this needs a repository first.

## 5. Integration activation gates (External + Policy)

All four integrations are disconnected ([integration-readiness.md](integration-readiness.md)). Each needs, in order:

1. Founder approval to begin.
2. Vendor selection and review, and a BAA where PHI is involved.
3. A security review and data-flow update.
4. Secrets management in place.
5. Retry, timeout and failure design, plus a runbook entry.
6. Wording review for any screen whose claims change, such as release notes once delivery is real.
7. Tests against the vendor's sandbox, never production.
8. Explicit founder approval to connect.

| Integration          | Extra dependency                                                                        |
| -------------------- | --------------------------------------------------------------------------------------- |
| Identity provider    | Replaces local staff passwords; the deprovisioning mapping to Deactivate must be tested |
| Out-of-app messages  | The notification policy (section 3); quiet hours applied only here                      |
| EHR / hospice system | Hospice data agreement; the inbound-proposals-only rule is kept                         |
| Partner delivery     | Changes release and revocation wording; recipient agreements                            |

## 6. Production-readiness gaps (External + Ops + Policy)

These remain even though the synthetic build is complete. Also see [production-readiness-gates.md](production-readiness-gates.md).

- **Not HIPAA-compliant, and no compliance claim:** no risk analysis, BAAs, policies or training.
- **No security certification and no penetration test.** A threat model and a current data-flow diagram are both needed.
- **Production identity:** MFA for staff, SSO, account recovery, session and device management.
- **Accessibility:** manual review incomplete; no audit; no testing with disabled users; **no WCAG conformance claim.**
- **Data:** a single embedded database; no row-level security in the database (tenant isolation is in services and composite keys); no retention or deletion.
- **Clinical, legal and hospice-operations review** of the product's boundaries, consent model and authority workflow.
- **Operational readiness:** support line, training, escalation playbooks, human-override procedure.
- **Known prototype simplifications:**
  - one role per staff member;
  - one household per family account;
  - fixed bereavement plan;
  - pilot cap not enforced;
  - display polish: bereavement due dates show a time of day where a date alone would read better.

## 7. Open risk register

Evidence-backed open items as of 2026-10-12. **Blocks** says what each one stands in the way of: founder review, pilot readiness or production readiness.

| Risk                                                       | Why it matters                                                                                         | Current control                                                                                                                                       | Next action                                                                                                                        | Owner                                          | Blocks                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| The walkthrough lagged the built product                   | A reviewer following only the script missed the register, follow-up, audit, reports and status screens | The walkthrough now has an **Operational screens** section (O1–O7) with expected seeded states                                                        | Founder runs O1–O7 after step 13's reset and records notes in [founder-review-notes-template.md](founder-review-notes-template.md) | Founder                                        | Founder review (until O1–O7 are done)                                                     |
| Change-role dialog needs manual review                     | An accessibility failure in a sensitive staff action could go unnoticed                                | **Automated since 2026-10-12:** axe with the dialog open, plus Escape and focus return (`e2e/team.spec.ts`). Automated checks don't replace a person. | Manual keyboard and screen-reader check in session 3 (protocol Slice C)                                                            | Accessibility reviewer                         | Pilot readiness                                                                           |
| Read-only banner needs manual review                       | During an incident, everyone must see and hear that changes are paused                                 | **Automated since 2026-10-12** (`e2e-readonly/readonly.spec.ts`): shown once as a status, axe passes, no sideways scroll at 375/320 px                | Manual visual, screen-reader and responsive check in session 4, with the server restarted with `ZEPORAH_READ_ONLY=1`               | Accessibility reviewer                         | Pilot readiness                                                                           |
| Read-only mode end-to-end coverage (**closed 2026-10-12**) | The incident control was unproven in a running server                                                  | `bun run test:e2e:readonly` runs a separate server with `ZEPORAH_READ_ONLY=1`; staff and family changes are refused and nothing is written            | Run it with every full verification (there's no CI yet)                                                                            | Engineer                                       | None                                                                                      |
| Bereavement due dates show a time of day                   | "Due around Oct 14, 5:13 PM" reads oddly precise and shifts with daylight saving                       | Display only; due dates are stored correctly                                                                                                          | Product-polish review after founder review (show the date alone); classify via the notes template                                  | Founder (decide), engineer                     | None now (polish)                                                                         |
| No CI and no Git repository in this workspace              | "Green" depends on someone running the suites locally; there's no change history or review             | Full suites run manually and recorded in reports; last full run 260/260 and 71/71                                                                     | Founder approves creating a repository; then CI runs type-check, unit/integration and end-to-end tests on every change             | Founder (approve), engineer                    | Pilot readiness, production readiness                                                     |
| Manual accessibility review pending                        | Automated checks catch only part of real barriers; no new screen has had a human review                | Protocol with slices A–J, session order and finding rules; automated axe on most screens                                                              | Sessions 1–4 (§2a) after founder-review changes settle; fix Blocker and High findings and retest                                   | Accessibility reviewer (designer/QA); engineer | Pilot readiness (Blocker/High); production readiness (audit, testing with disabled users) |
