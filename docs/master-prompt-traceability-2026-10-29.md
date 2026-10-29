# Master-prompt traceability (2026-10-29)

**Status: a traceability record, not an approval or a readiness claim.** It maps each major
requirement of the consolidated master prompt (pasted by the founder on 2026-10-27; its text isn't
stored in the repository) to where it lives, its status and its evidence, at `main` =
`453a2fb1a413fe0e61f245933abdd1e1da1f47fc`. Companion documents:
[stage1-closure-2026-10-29.md](stage1-closure-2026-10-29.md) and
[register-reconciliation-2026-10-29.md](register-reconciliation-2026-10-29.md).

**Status vocabulary.** **Implemented:** code exists and an executed test covers it. **Assessed:**
written up as an assessment or specification only; no code. **Proposed:** a design or number put
forward and not approved. **Blocked:** stopped by a standing hold, decision or the freeze.
**Deferred:** set aside by a decision or by scope. An assessment never counts as implementation.

**Test evidence** names the test file; the 2026-10-29 run at this revision is in
[stage1-closure-2026-10-29.md §2](stage1-closure-2026-10-29.md#2-verification-at-the-final-revision).
"None" means no executed test covers it.

## Precedence, baseline and positioning (prompt §1–2)

| Requirement                                                                | Where                                                                                                       | Status                | Test evidence                                       | Remaining decision or dependency                                                                                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locate the last approved master prompt; say if missing                     | [product-assessment-2026-10-27.md §2](product-assessment-2026-10-27.md)                                     | Assessed              | —                                                   | Not in the repository. Nothing treats an earlier prompt as approved                                                                                  |
| Conflicts identified; safer boundary kept                                  | Assessment §2, conflicts 1–7                                                                                | Assessed              | —                                                   | Conflicts 1–4 and 7 still open (decision 18, product scope, freeze, commercial terms)                                                                |
| Hospice-first accountable coordination (who, may, next, owner, accepted …) | Household and staff workspaces; `src/server/services/staff.ts` (queue, claims, handoffs, offers)            | Implemented (partial) | `handoff.test.ts`, `request-lifecycle.test.ts`, e2e | Follow-through is shown for staff work; no outcome measurement yet (§23)                                                                             |
| Non-negotiable boundaries (no EHR, no clinical or legal determination …)   | [product-context.md](product-context.md); `tests/unit/integrations.test.ts`; `tests/unit/ui-claims.test.ts` | Implemented (guarded) | `integrations.test.ts`, `ui-claims.test.ts`         | —                                                                                                                                                    |
| Confirm the pilot scope (one state, one hospice, 10–25 households, paid)   | [product-context.md](product-context.md) §pilot; decision 70 (cap 25)                                       | Assessed              | `enrollment.test.ts` (cap only)                     | Pilot terms and the state are unconfirmed: brief in [outstanding briefs](decision-register/outstanding-briefs-2026-10-29.md#1-pilot-terms-and-state) |
| Bereavement duration without a statutory claim                             | Decision 10; assessment conflict 6                                                                          | Implemented           | `bereavement-followup.test.ts`                      | —                                                                                                                                                    |

## Enterprise contexts (prompt §3)

| Requirement                                                              | Where                              | Status              | Test evidence | Remaining decision or dependency                                     |
| ------------------------------------------------------------------------ | ---------------------------------- | ------------------- | ------------- | -------------------------------------------------------------------- |
| Three separate contexts (A hospice, B employer, C partner)               | Assessment §1, §5–7                | Assessed            | —             | Only context A exists in code                                        |
| Boundaries between organization, tenant, sponsor, provider, engagement … | Assessment §7 entity table         | Assessed (proposed) | —             | Sponsor, provider and engagement entities don't exist; product scope |
| Sponsor/payer gets no automatic data access                              | Assessment §5, §7 information flow | Assessed            | —             | No sponsor exists in code                                            |
| Employer functionality disabled                                          | Not in code                        | Deferred (absent)   | —             | Product scope (assessment conflict 3)                                |

## Competitive parity (prompt §4)

| Requirement                                                     | Where                           | Status                | Test evidence | Remaining decision or dependency                                                                                |
| --------------------------------------------------------------- | ------------------------------- | --------------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| Empathy benchmark, with source, date, offering and limitations  | Assessment §4                   | Assessed              | —             | Public pages only (2026-10-27); vendor demonstration needed; re-review before any external use                  |
| Full parity matrix (operating cost, owner, acceptance scenario) | Assessment §4 (partial columns) | Assessed (incomplete) | —             | The matrix lacks operating cost, owner role and acceptance scenario columns the prompt asked for. Not yet added |
| No uniqueness claims; differentiation only with evidence        | Assessment §4                   | Assessed              | —             | Measurement (§23) needed before any claim                                                                       |

## Product inventory (prompt §5)

Classified in [product-assessment-2026-10-27.md §3](product-assessment-2026-10-27.md). Items built
since then, which the assessment's table already reflects or which change its row:

| Capability                            | Status now                                                                              | Where                                                 | Test evidence                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Enrollment and onboarding             | Implemented                                                                             | `src/server/services/enrollment.ts`; decisions 66–70  | `enrollment.test.ts`, `e2e/enrollment.spec.ts`                           |
| Independent supporters                | Implemented (listing only; grants nothing)                                              | `src/server/services/contacts.ts`; decisions 74–78    | `contacts.test.ts`, `e2e/family-contacts.spec.ts`                        |
| Aging, blocked, reopened requests     | Implemented                                                                             | `src/server/services/requests.ts`; decisions 79–83    | `request-lifecycle.test.ts`, `e2e/request-lifecycle.spec.ts`             |
| Contact routing and downtime          | Implemented (verified line; read-only mode); no hosted downtime path                    | `src/server/services/contact-line.ts`; decision 72    | `contact-line.test.ts`, `e2e-readonly/readonly.spec.ts`                  |
| Audit and minimum-necessary access    | Partial: staff reads logged (decision 71); operations still see every household (PC-04) | `src/server/services/access-log.ts`                   | `access-log.test.ts`, `e2e/access-log.spec.ts`                           |
| Low-connectivity behaviour            | Implemented (status, pause, lost-reply check); no offline queue by decision 84          | `src/lib/connection.ts`, `src/components/offline.tsx` | `connection.test.ts`, `submission-status.test.ts`, `e2e/offline.spec.ts` |
| Notifications delivery                | Implemented on the development mailbox only (outbox, decisions 88–91)                   | `src/server/services/outbox.ts`                       | `outbox.test.ts`                                                         |
| Household data export                 | Proposed                                                                                | Assessment §15 (P1)                                   | None                                                                     |
| Appointments, availability, logistics | Proposed                                                                                | Assessment §3, §6                                     | None                                                                     |
| Partner services (all nine)           | Assessed; blocked                                                                       | Assessment §3 "Partner services"                      | None                                                                     |

## Enterprise leave (prompt §6)

| Requirement                                                                | Where         | Status                               | Test evidence | Remaining decision or dependency                   |
| -------------------------------------------------------------------------- | ------------- | ------------------------------------ | ------------- | -------------------------------------------------- |
| Roles, eligibility source, multiple employers and recipients, leave events | Assessment §5 | Assessed (proposed)                  | None          | Product scope for context B (conflict 3)           |
| Five separate statuses; no inference of eligibility or approval            | Assessment §5 | Assessed                             | None          | Same                                               |
| Requests for information, deadlines, denial, appeal, return to work        | Assessment §5 | Assessed                             | None          | Same                                               |
| Benefit ending mid-case; service continuity                                | Assessment §5 | Proposed (30 days, unvalidated)      | None          | Same; the number needs validation                  |
| Minimized employer reporting; small-group re-identification                | Assessment §5 | Proposed (cell size 10, unvalidated) | None          | Same; a re-identification review before any report |
| Pricing and sponsorship boundaries; employee-approved sharing              | Assessment §5 | Assessed (brief)                     | None          | Commercial decision (conflict 7)                   |
| Disabled when not approved                                                 | Not in code   | Deferred (absent)                    | —             | —                                                  |

## Enterprise caregiving (prompt §7)

| Requirement                                                                                    | Where                                                     | Status                        | Test evidence                                  | Remaining decision or dependency                           |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| Many recipients per caregiver and many caregivers per recipient                                | Assessment §6                                             | Assessed                      | None                                           | PC-03 (one household per family account) limits this today |
| Shared and private responsibilities                                                            | Decisions 44, 48b; `src/domain/task-scope.ts`             | Implemented (hospice context) | `task-decisions.test.ts`                       | —                                                          |
| Availability, backup, respite, recurring tasks, missed commitments                             | Assessment §6                                             | Assessed                      | None                                           | Context B scope; no recurrence model                       |
| Reassignment and declined work                                                                 | Decisions 59–61, 83                                       | Implemented (staff only)      | `handoff.test.ts`, `request-lifecycle.test.ts` | Family-side reassignment not specified                     |
| Appointments, transport, equipment, logistics                                                  | Assessment §6                                             | Assessed                      | None                                           | P2                                                         |
| Caregiver-capacity concerns to human follow-up                                                 | Support requests (existing)                               | Implemented (generic route)   | `request-lifecycle.test.ts`                    | No dedicated category                                      |
| Information, coordination, human assistance and clinical response kept separate; no monitoring | Product context; decision 72 wording; `ui-claims.test.ts` | Implemented (guarded)         | `ui-claims.test.ts`                            | —                                                          |

## Care-team and domain model (prompt §8)

| Requirement                                                      | Where                                                          | Status                                             | Test evidence                                                | Remaining decision or dependency                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 17 separate entities with cardinality and lifecycle              | Assessment §7 entity table                                     | Assessed (mapped to tables)                        | —                                                            | Deletion dependencies aren't specified per entity (needs D-05)                        |
| Membership shape (context, role, authority, dates, provenance …) | Assessment §7; `memberships` in `src/server/db/schema.ts`      | Partial                                            | `roster.test.ts`, `helpers-access.test.ts`                   | Effective dates and provenance exist for invitations; no historical-visibility policy |
| Eight membership states                                          | Assessment §7                                                  | Proposed                                           | —                                                            | Today: active and ended, plus invitation states                                       |
| Participation categories, never permission bundles               | Assessment §7; decisions 74–78 (listed contacts grant nothing) | Partial                                            | `contacts.test.ts`                                           | Outside clinicians, doulas, sponsors, legal: proposed rows only                       |
| Wrong-account acceptance, expiry, removal, temporary cover       | `acceptInvitation`; decisions 42, 59                           | Implemented                                        | `auth.test.ts`, `coverage.test.ts`, `helpers-access.test.ts` | —                                                                                     |
| Organization changes, multiple simultaneous roles, disputes      | Assessment §7, §11                                             | Assessed                                           | None                                                         | PC-03                                                                                 |
| New membership doesn't expose prior sensitive history            | Assessment §7                                                  | Proposed                                           | None                                                         | Selected-participant messaging brief                                                  |
| Actor/resource/action permission matrix                          | Assessment §7; `src/domain/permissions.ts`                     | Implemented (today's rows); proposed rows assessed | `permissions-lifecycle.test.ts`                              | Proposed rows need product-scope decisions                                            |
| Cross-context information-flow map                               | Assessment §7 "Cross-context information flow"                 | Assessed                                           | —                                                            | Only hospice ↔ household flows exist in code                                          |

## Planning, documents and estate (prompt §9–10)

| Requirement                                                             | Where                                       | Status                   | Test evidence                                        | Remaining decision or dependency              |
| ----------------------------------------------------------------------- | ------------------------------------------- | ------------------------ | ---------------------------------------------------- | --------------------------------------------- |
| Existing-document inventory, original location, controlled sharing      | Vault (metadata only, decision 43); packets | Implemented (metadata)   | `vault-audience.test.ts`, `e2e/family-vault.spec.ts` | —                                             |
| Guided partner creation, wills, POAs, execution, funding follow-through | Not in code                                 | Blocked                  | None                                                 | Product scope (conflict 2); partner selection |
| Estate support (intake, probate pathway, institutions, closure)         | Not in code                                 | Blocked                  | None                                                 | Same                                          |
| Service levels and completion definitions                               | Assessment §10                              | Assessed (template only) | None                                                 | No service is defined against it              |
| No legal originals stored                                               | Decision 43                                 | Implemented              | `vault-audience.test.ts`                             | —                                             |

## Human support, bereavement and safety (prompt §11)

| Requirement                                                  | Where                                      | Status                          | Test evidence                       | Remaining decision or dependency                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------ | ------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Six human services kept separate                             | Assessment §13                             | Assessed                        | —                                   | Only the hospice's care team exists                                                                                     |
| Per-service owner, hours, backup, response, complaints, cost | Assessment §13 (list of required fields)   | Assessed (unfilled)             | None                                | D-11 (support model); hospice agreement                                                                                 |
| Bereavement preferences, opt-out, cadence                    | Decisions 10, 36                           | Implemented                     | `bereavement-followup.test.ts`, e2e | Anniversaries beyond the schedule: not specified                                                                        |
| Crisis-resource routing without monitoring                   | Verified 24-hour line (decision 72)        | Implemented (hospice line only) | `contact-line.test.ts`              | No public crisis-line content decision                                                                                  |
| Coercion, pressured sharing, conflicting claims              | Authority conflict hold                    | Partial                         | `consent-authority.test.ts`         | No private-concern route: [safeguarding brief](decision-register/outstanding-briefs-2026-10-29.md#5-safeguarding-route) |
| Private concerns not exposed to their subject                | Not in code                                | Proposed                        | None                                | Safeguarding brief                                                                                                      |
| Shared-device exposure                                       | Decision 53 ("Remember me" off by default) | Partial                         | `remember-me.test.ts`               | PC-05, D-08                                                                                                             |

## Partner architecture, contract and synchronization (prompt §12–15)

| Requirement                                                         | Where                                                           | Status                                                 | Test evidence       | Remaining decision or dependency                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------- |
| Gateway → adapter architecture; no partner secrets in the browser   | Assessment §9                                                   | Assessed                                               | None                | Track B blocked: decision 18 forbids a stub returning sample data (assessment conflict 1) |
| Coverage matrix, default disabled                                   | Not written                                                     | Not started                                            | None                | Partner selection                                                                         |
| Authentication, live mode, create/fetch, cache, sessions, pricing … | Assessment §9                                                   | Assessed (proposals)                                   | None                | Track B approval                                                                          |
| Idempotency                                                         | `src/server/services/send-once.ts` (messages and requests only) | Implemented for messages; partner idempotency proposed | `send-once.test.ts` | Track B                                                                                   |
| Matter, document and handoff states; field ownership                | Assessment §8                                                   | Assessed                                               | None                | Track B                                                                                   |
| Webhooks, reconciliation, rate-limit numbers                        | Assessment §9                                                   | Proposed (unvalidated)                                 | None                | Track B; PB-07 for rate limits generally                                                  |

## Accessibility (prompt §16)

| Requirement                                                     | Where                                                                              | Status                                      | Test evidence                                                                      | Remaining decision or dependency                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Target WCAG 2.2 AA                                              | Decision 73; [D-12](decision-register/D-12-accessibility-commitment.md)            | Decided (commitment only)                   | —                                                                                  | No conformance claim                                                          |
| Automated checks and keyboard testing                           | `e2e/accessibility.spec.ts`, `e2e/keyboard-focus.spec.ts`                          | Implemented                                 | Both specs in the browser suite                                                    | Automated checks don't establish accessibility                                |
| Screen-reader, zoom/reflow, cognitive load, assisted completion | [manual-accessibility-review-protocol.md](manual-accessibility-review-protocol.md) | Specified; one partial session (2026-10-12) | [2026-10-12 session](accessibility-sessions/2026-10-12-manual-safari-voiceover.md) | PB-16: two internal reviewers, 5–8 sessions, a specialist review, all not run |
| Low-connectivity behaviour                                      | Increment 9                                                                        | Implemented                                 | `e2e/offline.spec.ts`                                                              | Not tested on real networks or devices                                        |
| Phone/print alternatives; language support                      | Assessment §3                                                                      | Proposed                                    | None                                                                               | PC-01 (English only)                                                          |

## Reliability, recovery and operations (prompt §17)

| Requirement                                         | Where                                                                                                                        | Status                                                       | Test evidence                                 | Remaining decision or dependency                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------- |
| Identity recovery without bypass; staff offboarding | Decisions 9, 27; `team.ts`                                                                                                   | Implemented (local identity)                                 | `auth.test.ts`, `team-admin.test.ts`          | D-03 (staff MFA), D-08                                                      |
| Bounded retries, dead-letter handling               | Outbox (decisions 89–90)                                                                                                     | Implemented (email only; no jitter)                          | `outbox.test.ts`                              | No jitter; development mailbox only                                         |
| Persistent concurrency controls                     | Conditional updates; audit lock                                                                                              | Implemented on PGlite                                        | `concurrency.test.ts`, `audit-chain.test.ts`  | Unproven under real concurrency until a real Postgres (PB-09, increment 10) |
| Backup and restoration; recovery objectives         | [architecture/backup-recovery.md](architecture/backup-recovery.md); [runbooks/backup-restore.md](runbooks/backup-restore.md) | Assessed (plan only)                                         | None                                          | Hosting (PB-02, PB-03)                                                      |
| Category-specific retention                         | `src/domain/record-classes.ts`; `src/server/services/retention.ts`                                                           | Partial: classes proposed; holds and guard built; no periods | `retention.test.ts`, `record-classes.test.ts` | D-05 and counsel                                                            |
| Dependency and security scanning                    | `scripts/check-audit.ts`                                                                                                     | Implemented (local)                                          | CI "Dependency advisories" stage              | Hosted CI not run (PB-01)                                                   |
| Exit and continuity                                 | Not written                                                                                                                  | Not started                                                  | None                                          | Pilot agreement                                                             |

## Failure-scenario register (prompt §18)

Summarized in [product-assessment-2026-10-27.md §11](product-assessment-2026-10-27.md); changes
since then:

| Scenario                                       | Status then                       | Status now                                                                                        | Evidence                                           |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Revocation during queued work                  | partial ("no queued sends exist") | partial: queued email is now rechecked at send time (decision 88); other queued work not covered  | `outbox.test.ts`                                   |
| SMS failure, email bounce, opt-out             | partial                           | partial: retries and "Email not delivered" on the development mailbox; no bounce handling, no SMS | `outbox.test.ts`                                   |
| Remote write succeeds, response lost           | implemented                       | implemented, plus the reconnect check (increment 9)                                               | `submission-status.test.ts`, `e2e/offline.spec.ts` |
| Restore that duplicates work or revives access | specified                         | specified                                                                                         | None                                               |

The prompt's full per-scenario columns (starting state, actor, trigger, partial completion, outage,
cancellation, user message, owner, audit evidence) aren't filled for any scenario. §7 of the
closure plan specifies six of them in full.

## Measurement and commercial assumptions (prompt §23)

| Requirement                                             | Where                                         | Status                   | Test evidence | Remaining decision or dependency                                         |
| ------------------------------------------------------- | --------------------------------------------- | ------------------------ | ------------- | ------------------------------------------------------------------------ |
| Baseline, denominator, source and owner for 11 measures | Assessment §12                                | Proposed                 | None          | No baselines exist; owners are roles, not named people                   |
| No sensitive content in analytics                       | No analytics in code                          | Implemented (by absence) | —             | —                                                                        |
| Payer and access terms preserved                        | Product context (hospice pays, families free) | Assessed                 | —             | Pilot terms brief; separately paid services need a decision (conflict 7) |

## Release gates (prompt §24) and delivery tracks (§21)

| Requirement                      | Status                   | Remaining                                                                                             |
| -------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Track A deliverables (11)        | Assessed: all 11 written | Parity-matrix columns incomplete; no coverage matrix                                                  |
| Track B (bounded synthetic core) | **Blocked; not started** | Decision 18 amendment, product scope, a freeze lift. Requested by the prompt; not implemented         |
| Real-data gates (18 items)       | None passed              | See [stage1-closure-2026-10-29.md §8](stage1-closure-2026-10-29.md#8-dependency-ordered-closure-plan) |
| Synthetic handoff package (§19)  | Not on this computer     | Not inspected, imported or run; its "14 tests passed" is unverified                                   |
