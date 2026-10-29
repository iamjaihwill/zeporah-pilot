# Stage 1 closure plan (2026-10-29)

**Status: Stage 1 is not passed.** This is a documentation reconciliation and a local verification
record for one revision. It authorizes nothing: no freeze lift, deployment, outside service, real
email, PHI, partner integration or policy decision. Nothing here claims readiness or compliance.

**Revision:** `main` = `453a2fb1a413fe0e61f245933abdd1e1da1f47fc` (`origin/main` identical when
checked, 2026-10-29).

Companions: [master-prompt-traceability-2026-10-29.md](master-prompt-traceability-2026-10-29.md),
[register-reconciliation-2026-10-29.md](register-reconciliation-2026-10-29.md) and
[decision-register/outstanding-briefs-2026-10-29.md](decision-register/outstanding-briefs-2026-10-29.md).

## 1. Executive status

This corrects the 2026-10-28 summary, which said everything requested had been built. That was
wrong: some requested work is blocked or held, and an assessment isn't an implementation.

**Approved, unblocked implementation completed (2026-10-26 to 2026-10-28).** All synthetic, all on
the embedded database, all with automated tests:

- **Demo:** demo launcher; app and care addresses; the Rehanna Wells persona.
- **Brief increments 1–9:** cross-site refusal; serialized audit chain with findings; send-once
  messages and requests; security headers; retention holds and removal guard; enrollment
  (decisions 66–70); listed contacts (74–78); request lifecycle (79–83); offline status (84–87).
- **Decisions 71, 72 and 88–91:** staff read-access log; verified 24-hour line; the outbox, on the
  development mailbox only.
- **Fixes and tests:** fixture timing, the `getAddresses` error, five out-of-date specs, date masking
  in the screenshot test, the "Couldn't reach Zeporah" page, five new browser specs.
- **Dependencies:** zod 4.6.6, seroval 1.6.11.

**Assessment completed (no code).** The Track A product-wide assessment
([product-assessment-2026-10-27.md](product-assessment-2026-10-27.md)), the brief reconciliation
([brief-reconciliation-2026-10-27.md](brief-reconciliation-2026-10-27.md)), decision briefs D-04,
D-12, D-15 and D-16, and decision 73 (accessibility commitment: a commitment, not a validation).

**Requested implementation still outstanding.**

| Work                                                       | Requested by                 | Why it isn't done                                                                                     |
| ---------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Track B (bounded synthetic partner core)                   | Master prompt §21            | Blocked: decision 18 forbids a stub returning sample data; product scope for contexts B and C; freeze |
| Increment 10 (Postgres driver, pooling, secrets, failover) | Brief reconciliation §6      | Needs hosting (D-02 build-out, PB-02)                                                                 |
| Decision 63 (attribution of automatic content)             | Founder decision, 2026-10-22 | Approved; waiting for its own freeze lift                                                             |
| Household data export                                      | Assessment roadmap (P1)      | Not started; no decision                                                                              |
| Send-once for consent actions                              | Proposed PB-19               | Increment 3 covered messages and support requests only                                                |
| Full parity matrix columns; partner coverage matrix        | Master prompt §4, §12        | Not written                                                                                           |
| Per-scenario failure-register columns                      | Master prompt §18            | Only summarized; six specified in §7 below                                                            |

**Decisions pending.** D-03, D-05 to D-11 (D-10 may be answered by decision 70), D-13, D-14; the
D-01 and D-02 build-outs; R-01 to R-04, R-06 to R-10; product questions on pilot terms and state,
selected-participant messaging, pediatric inclusion, safeguarding and death before activation;
accepting proposed PB-18 to PB-22; amending decision 18 for Track B. Briefs:
[outstanding-briefs-2026-10-29.md](decision-register/outstanding-briefs-2026-10-29.md).

**External or human evidence pending.** Hosting with a signed BAA; counsel review (HIPAA program,
retention, BAA posture, Section 504); a hospice partner (incident roles, support model, a real
24-hour line, training); manual accessibility validation (two internal reviewers, 5–8 sessions, a
specialist review); a hosted CI pipeline and branch protection; restore drills; a threat-model
review; a penetration test (Stage 2).

**Stage 1 remains blocked** (§9).

## 2. Verification at the final revision

Run on 2026-10-29, 06:22–06:43, at `453a2fb`, on this computer, synthetic data only. Every CI stage
in `scripts/ci.sh` ran separately so that a failure wouldn't stop the rest. Each browser suite
starts its own isolated server and database.

| Stage                       | Command                                                       | Result (current, 2026-10-29)                                                          |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Type check                  | `bunx tsc --noEmit`                                           | Passed                                                                                |
| Formatting                  | `bun scripts/check-format.ts`                                 | Passed (11 recorded frozen-baseline exceptions)                                       |
| Documentation links         | `bun scripts/check-doc-links.ts`                              | Passed, 64 files                                                                      |
| Readiness tracker           | `bun scripts/readiness-check.ts`                              | Consistent: 26 items; 17 of 17 pilot blockers not closed; **Stage 1 gate not passed** |
| Frozen baseline             | `bun scripts/check-baseline.ts`                               | All 403 files match (see §5 for what that shows)                                      |
| Migrations                  | `bunx drizzle-kit check`                                      | Passed                                                                                |
| Dependency advisories       | `bun scripts/check-audit.ts`                                  | Passed: 8 known advisories, each recorded with an owner and expiry; none unrecorded   |
| Unit and integration        | `bunx vitest run`                                             | 622 of 622 passed (80 files)                                                          |
| Browser suite               | `bunx playwright test`                                        | 201 passed, 2 skipped, 0 failed (13.0 min)                                            |
| Read-only mode              | `bunx playwright test --config playwright.readonly.config.ts` | 2 passed                                                                              |
| Upgrade and downgrade       | `bunx playwright test --config playwright.upgrade.config.ts`  | 10 passed (19 downgrade steps)                                                        |
| Verify and screenshots      | `bunx playwright test --config playwright.verify.config.ts`   | 22 passed, 12 skipped, 0 failed, including the six family pixel baselines             |
| Tracked files after the run | `git status`                                                  | No changes from the run (the known `review-screenshots/after` rewrite was restored)   |

**Failures:** none. Nothing frozen was modified.

**Skipped tests and why.**

- **Browser suite, 2:** `e2e/staff-workspace.spec.ts:87` skips itself when the seed has no consent
  waiting ("No consent waiting in the seed"), which is the case with today's seed. So the consent
  part of that test didn't run. `e2e/family-contacts.spec.ts:54` skips on the phone project, since
  the staff household record is a desktop and tablet page.
- **Verify, 12:** the screenshot-capture specs (`shots`, `enterprise-shots`, `marketing-shots`,
  `staff-shots`) run only when asked for through an environment variable. They capture images and
  compare nothing, so the 22 enterprise run-through screenshots weren't retaken or checked (§5).

**Not covered by this run.** The documents added today weren't on disk when the link and format
stages ran; both checks were re-run after writing them and passed (68 files). No hosted CI ran. No
test ran against a real Postgres, a real network, a real email provider or assistive technology.
The demo rehearsal wasn't repeated.

**Earlier results, reported only.** Browser suite 201 passed, 2 skipped on 2026-10-28 before the
seroval update; 18 server-exercising specs after it; verify 22 passed on 2026-10-28; the 2026-10-22
freeze results (493 unit, 187 browser). These are historical; the table above is the current
evidence.

## 3. Master-prompt traceability

In [master-prompt-traceability-2026-10-29.md](master-prompt-traceability-2026-10-29.md). Every
requirement section of the prompt (§1–24) is mapped. **Implemented** is used only where code and an
executed test exist. Enterprise leave and caregiving, the full care-team model's proposed rows, the
cross-context flows, human-service ownership, legal and estate completion definitions, the failure
register, the measurement plan and commercial assumptions are **assessed**, not implemented.
Accessibility is implemented for automated checks only; manual validation hasn't run.

## 4. Register reconciliation

In [register-reconciliation-2026-10-29.md](register-reconciliation-2026-10-29.md): D-01 to D-16, R-01
to R-19, PB-01 to PB-17 and the proposed PB-18 to PB-22, each with title, state, owner and approver,
dependencies, required decision, remaining work, evidence, exit criterion, whether it can progress
without hosting, and next action. §1 there explains what "approved in principle" covers for D-01
and D-02, and records two findings:

- **The code host disagrees with the decision record.** Decision 64 names GitLab
  (`gitlab.com/twgi-group/zephora`); the working remote is GitHub (`iamjaihwill/zeporah-pilot`); CI
  templates are GitLab-format.
- **No branch protection is in effect for these pushes, and no hosted CI has run.** Every commit from 2026-10-26 to 2026-10-28
  was pushed directly to `main` after local checks only.

## 5. Freeze coverage

**Frozen baseline scope.** 403 files listed in
[demo-baseline-2026-10-22.sha256](demo-baseline-2026-10-22.sha256): the application code as of
2026-10-22 (migrations through `0023`, seed fixtures), the tests, configuration, the founder
decision log and product register, the presentation documents and 22 enterprise run-through
screenshots. Git tag `demo-baseline-2026-10-22` marks it.

**Approved lifts**, each with the founder's explicit approval, recorded in
[demo-baseline.md](demo-baseline.md):

| Date       | Scope                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-22 | Decision 62 (re-frozen the same day); decision-record updates for 63, 64, 65 (no product change)                              |
| 2026-10-26 | Demo launcher and address awareness (12 frozen files)                                                                         |
| 2026-10-26 | zod 4.6.6 and sharing-list caps                                                                                               |
| 2026-10-27 | Rehanna Wells persona                                                                                                         |
| 2026-10-27 | Brief increments 1, 2, 3, 4, 5 and 6 (one lift each)                                                                          |
| 2026-10-27 | D-04 build (decision 71)                                                                                                      |
| 2026-10-28 | D-15 build (decision 72); decision 73 (record only)                                                                           |
| 2026-10-28 | Increments 7, 8 and 9                                                                                                         |
| 2026-10-28 | `src/fixtures/demo-week.ts` timing; the `getAddresses` fix and five specs; date masking and the "Couldn't reach Zeporah" page |
| 2026-10-28 | D-16 build (decisions 88–91); seroval 1.6.11                                                                                  |

**Frozen files changed since the tag:** 83 of the 403, all under the lifts above. **None of the 22
enterprise screenshots has been retaken**, so they show the 2026-10-22 screens; no test compares
them with today's.

**New files outside the baseline:** 455 tracked files (858 tracked, 403 frozen). Of those, 296 are
review screenshots and 63 are documents. The code, test and configuration files are:

- **Request path for every page:** `src/start.ts` (headers, same-origin check, address redirect),
  `src/domain/security-headers.ts`, `src/domain/same-origin.ts`, `src/domain/addresses.ts`.
- **Mounted in both workspace shells:** `src/lib/connection.ts`, `src/components/offline.tsx`.
- **Services the frozen code now calls:** `access-log.ts` (every staff read), `send-once.ts`,
  `retention.ts`, `outbox.ts` (every email), `enrollment.ts`, `contacts.ts`, `contact-line.ts`,
  `requests.ts`.
- **Database:** migrations `0024` to `0032`, applied to the demo database on every reset.
- **Routes and components:** `src/routes/demo.tsx`, `src/routes/staff/access-log.tsx`,
  `src/components/contacts.tsx`, `src/components/staff/contact-line.tsx`,
  `src/components/staff/enrollment.tsx`.
- **Tests and tooling:** 15 test files, 9 downgrade fixtures, 5 new browser specs, the read-only and
  upgrade specs, `playwright.readonly.config.ts`, `scripts/*`, `.gitlab-ci.yml`.

**Shared dependencies and configuration affecting the demo.** `package.json` and `bun.lock` are
frozen and were changed under two lifts (zod, seroval). `vite.config.ts` (frozen) was changed under
increment 4. The new files above run on every demo request even though the manifest doesn't list
them.

**What the hash check shows, and what it doesn't.** "All 403 files match" means each frozen file
equals its **last approved refresh**, not its 2026-10-22 content, and says nothing about files
outside the manifest. It doesn't show that the demo behaves as it did. Behavioural evidence is
only: the browser suites and the family pixel baselines (§2), and each increment's evidence note.
The 2026-10-22 rehearsal (about 15:15, 11 beats) hasn't been re-run since these changes.

## 6. Decision briefs

In [outstanding-briefs-2026-10-29.md](decision-register/outstanding-briefs-2026-10-29.md): pilot terms
and state; selected-participant messaging; retention periods (D-05); pediatric inclusion;
safeguarding; death before activation; and short briefs for D-01's build-out, D-03, D-06 to D-11,
D-13 and D-14. Each has the problem, options, a recommendation, trade-offs, dependencies, the exact
approval requested and the consequence of deferral. **None is approved.**

## 7. Known failure gaps

Real email stays disabled throughout: the only channel is the development mailbox, and only where
development sign-in is on.

### 7.1 Ambiguous email acceptance and duplicate sends

- **Today.** Each outbox row is claimed and sent inside one transaction. If the channel throws, the
  transaction rolls back and the row is retried. A provider that accepted the email but whose reply
  was lost would look like a failure, and the retry would send it again.
- **Expected.** Every send carries a stable key (the outbox row's ID) that the provider uses to
  deduplicate. A timeout is recorded as "delivery uncertain", distinct from a refusal, and is
  retried only within the provider's deduplication window; past it, it goes to operations as
  uncertain, not resent.
- **Evidence required.** An integration test with a channel that accepts and then times out,
  showing one delivery and the uncertain state; the chosen provider's documented idempotency
  behaviour; a test against the provider's sandbox. Blocked on D-06 and a BAA-covered sender.

### 7.2 Operational visibility of events without a household

- **Today.** "Email not delivered" is listed only through household-scoped queue rows. A failed
  email with no household is audited (`email.undelivered`, staff-only) but not listed. Every current
  email kind has a household, per the outbox evidence; this wasn't re-verified for staff accounts
  in this review.
- **Expected.** Failures with no household appear in an operations-only list at the hospice level,
  with the same no-content rule.
- **Evidence required.** A test that creates a household-less failed email and finds it listed for
  operations and hidden from care guides. Possible locally; needs a freeze lift for
  `src/server/services/staff.ts`.

### 7.3 Revocation during queued work

- **Today.** Queued email is rechecked at send time (account, address, access, settings; decision
  88; `outbox.test.ts`). Packet access is rechecked on every read. Not covered by any test found: an
  offer to a staff member who is deactivated before accepting; a claim held by a deactivated staff
  member; a household invitation accepted after the inviter's own access ended.
- **Expected.** Every action that waits on a person re-checks that person's current access when it
  executes; an offer or claim held by someone deactivated is released to operations as an
  exception.
- **Evidence required.** One integration test per waiting action. The tests can be written locally;
  any fix needs a freeze lift.

### 7.4 Lifecycle transitions before activation

- **Today.** `enrolled → bereavement` is allowed. The transition ends the patient's membership and
  active consents; this review didn't find it withdrawing pending invitations or stopping the
  activation checklist.
- **Expected.** As proposed in [brief 6](decision-register/outstanding-briefs-2026-10-29.md#6-death-before-activation),
  not approved.
- **Evidence required.** Integration tests: transition before activation; a pending patient
  invitation is refused afterwards; the checklist stops; bereavement support is still available to
  the coordinator.

### 7.5 Recovery and backup restoration

- **Today.** No backups exist. The demo database is a local PGlite folder.
  [backup-recovery.md](architecture/backup-recovery.md) and
  [runbooks/backup-restore.md](runbooks/backup-restore.md) are plans.
- **Expected.** A restore never revives access: sessions issued before the backup point are
  invalid, and revocations made after it are re-applied. A restore never resends: outbox rows
  marked sent after the backup point would come back as pending, so the outbox stays paused after a
  restore until reconciled. Recovery objectives are agreed with the hospice.
- **Evidence required.** A local restore rehearsal on synthetic data (copy the database folder,
  make changes, restore, check sessions, revocations and the outbox), then the hosted drill PB-03
  requires. The rehearsal is possible now; the drill needs hosting.

### 7.6 Unavailable coverage or safeguarding reviewer

- **Today.** An unaccepted cover offer, handoff or request offer becomes a stalled exception for
  operations (decisions 59–61, 83; `handoff.test.ts`, `request-lifecycle.test.ts`). Nothing covers
  operations itself being unavailable. No safeguarding reviewer role exists.
- **Expected.** Families always see the verified 24-hour line, with no promise of monitoring. A
  stalled exception with no operations response within a set time goes to an administrator. No
  safeguarding queue exists unless a named reviewer and a backup are staffed (brief 5).
- **Evidence required.** A test of the escalation to an administrator; the hospice's named reviewer
  and backup; an escalation drill (PB-15).

## 8. Dependency-ordered closure plan

**A. Possible locally now** (synthetic data, no outside service; items marked † also need a freeze
lift):

1. Cross-site refusal test across every POST server function; header test per route type (PB-06,
   PB-05). New spec files only.
2. Threat-model draft (PB-04), with data-flow and trust-boundary documents.
3. Local restore rehearsal (§7.5).
4. Audit review procedure for the read log (PB-12).
5. Tests that expose §7.2–7.4, then fixes †.
6. Decision 63 build †. Send-once for consent actions †.
7. Correct the readiness documents after the founder confirms the code host (PB-17).

**B. Awaiting founder decisions:** the briefs in §6; D-01 code host; accepting PB-18 to PB-22;
decision 18 and product scope for Track B.

**C. Awaiting hosting** (after D-02's build-out): increment 10; PB-02, PB-03, PB-07 (alerting),
PB-09 (real engine), PB-10; staging checks for PB-05 and PB-06; SB-02 to SB-04.

**D. Awaiting external agreements:** BAAs and the HIPAA program (PB-14); the hospice agreement,
incident roles and support model (PB-13, PB-15, D-07, D-11); a BAA-covered email sender (D-06);
any partner (Track B, contexts B and C).

**E. Awaiting human validation:** manual accessibility (PB-16); training and an escalation drill
(PB-15); a tabletop (PB-13); a threat-model review session (PB-04); a confirmation call on the real
24-hour line (PB-22); hosted rollback and restore drills (PB-01, PB-03); a penetration test (SB-01,
Stage 2).

**Recommended next bounded increment: A1, the security-evidence specs.** One browser spec that
sends a cross-site request to every state-changing server function and expects 403 with no change,
and one that checks the header policy on each route type (family page, staff page, server
function, static file, error page). It closes the "automated test across every POST" and "tests on
every route type" gaps that PB-06 and PB-05 record, touches no frozen file, needs no decision and
no hosting, and produces evidence the privacy and security officer can review. It doesn't close
either item: both still need staging checks and approval.

**Built later the same day** (after this record's revision): both specs, with two low findings and
no application change; see [security-evidence-2026-10-29.md](readiness/evidence/security-evidence-2026-10-29.md).
PB-05 and PB-06 stay in progress.

## 9. Final statement

**Independently verified today, at `453a2fb`:** every local CI stage and test suite in §2, run
from this revision; the frozen-file hashes; the file counts in §5 (from `git ls-files` and the
manifest); the git remote, and that direct pushes to `main` succeeded (the repository's protection settings weren't inspected); the master prompt's text
(from the session record, since it isn't in the repository); the register and tracker contents as
quoted.

**Reported historically, not re-verified:** each increment's evidence note (2026-10-27 and
2026-10-28), including its manual browser checks; the 2026-10-22 rehearsal and rollback drill; the
2026-10-12 accessibility session; the competitor review of 2026-10-27; the outbox's statement that
every email kind has a household.

**Unimplemented:** Track B; increment 10; decision 63; household export; send-once for consent
actions; the fixes §7 describes; everything for contexts B and C; every hosted, agreed or
human-validated control in §8 C–E.

**Unapproved:** every recommendation in the outstanding briefs; PB-18 to PB-22 as tracker items;
the D-01 code-host question; the D-02 provider; any freeze lift beyond those recorded; any change
to decision 18 or the product scope.

**Why Stage 1 remains blocked.** A gap closes only with non-document evidence and every approver's
signed approval (tracker rule). No pilot blocker has an approval recorded, and 12 of 17 haven't
started. The blockers that matter most need things this computer can't provide: a BAA-covered host
(PB-02, PB-03, PB-10), staff MFA (PB-08), counsel and agreements (PB-11, PB-13, PB-14), a staffed
support model (PB-15), and manual accessibility validation (PB-16). Passing synthetic tests isn't
evidence for any of them.
