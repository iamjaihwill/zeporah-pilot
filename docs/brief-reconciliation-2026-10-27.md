# Consolidated brief: reconciliation and gap plan (2026-10-27)

**Status: a plan, not a decision.** This reconciles the consolidated implementation brief (pasted
by the founder on 2026-10-27) with the repository at commit `93184a2`. Nothing here changes the
build, closes a readiness item or approves a decision. Labels follow
[production-readiness.md](production-readiness.md): **[Code]**, **[Test]**, **[Doc]**,
**[Assumption]**, **[Policy]**, **[Pending review]**.

## 1. Current verified baseline

- **What it is.** A synthetic pre-pilot on one embedded database (PGlite, single process): a family
  app, a separate staff workspace, controlled sharing (authority evidence, consent, minimum-necessary
  packets), an append-only hash-chained audit log, and in-app notifications. [Code] `README.md`
- **Not approved for real PHI or real users.** All 17 pilot blockers (PB-01 to PB-17) are open or in
  progress; the Stage 1 gate is not passed. [Code] `docs/readiness/tracker.json`, checked by
  `scripts/readiness-check.ts`.
- **Change control.** The demo baseline is frozen (403 files, SHA-256 manifest); a frozen file changes
  only when the founder lifts the freeze. [Code] `docs/demo-baseline.md`,
  `scripts/check-baseline.ts`. **This blocks every code slice below until a lift is approved.**
- **Tests run on 2026-10-27 at `93184a2`:** type-check, formatting, documentation links, readiness
  tracker, frozen baseline (403 of 403 match), migrations, dependency advisories (8, all recorded),
  and 500 of 500 unit and integration tests: **passed**. The end-to-end, read-only, upgrade and
  verify suites were **not run** (the test browser isn't installed on this computer); their last
  recorded pass is the 2026-10-22 freeze (187 end-to-end with 1 skipped, 22 verify, 10 upgrade). [Doc]
  _Run on 2026-10-28 after the test browser was installed: end-to-end 187 passed with 1 skipped
  (after fixes), read-only 2, upgrade 10, verify 21 with one date-only screenshot difference
  ([evidence](readiness/evidence/end-to-end-run-2026-10-28.md))._
- **Decisions on record:** founder decisions 1–65
  ([founder-decision-log.md](founder-decision-log.md)); product register R-01 to R-19
  ([enterprise-decision-register.md](enterprise-decision-register.md)); readiness decisions D-01 to
  D-14, of which only D-01 and D-02 are decided in principle
  ([decision-register/README.md](decision-register/README.md)).

## 2. Requirement-to-implementation coverage

Status vocabulary: **Implemented and verified** (code plus a passing test), **Evidence incomplete**,
**Partial**, **Documented only**, **Not found**, **External**, **Blocked by a decision**.

| Brief §               | Requirement                                                     | Status                                       | Evidence                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2                     | Patient/family and separate staff experiences                   | Implemented and verified                     | [Code] `src/routes/family`, `src/routes/staff`, separate sign-in pages; [Test] integration and end-to-end suites (end-to-end last run 2026-10-22)                                                                                                                                                    |
| 2, 4                  | Lifecycle phases                                                | Partial                                      | [Code] household `lifecycle_state` ∈ enrolled, active_hospice, bereavement, closed (migration `0001`); no "prepare / happening now / next few days" operational views                                                                                                                                |
| 5                     | Whole-person care network (doulas, clinicians, providers)       | Implemented (Stage 1 scope: listed contacts) | [Code] decisions 74–78, `src/server/services/contacts.ts`; [Test] `tests/integration/contacts.test.ts`. Scoped supporter accounts are out of Stage 1                                                                                                                                                 |
| 5                     | Relationship ≠ participation ≠ permission ≠ authority           | Partial                                      | [Code] authority is separate (`authority_evidence`, reviews); invitation `relationship` is free text; a membership role grants permissions directly, so relationship and permission aren't separate                                                                                                  |
| 5                     | External providers accept work before owning it                 | Partial                                      | [Code] staff handoffs need acceptance (`handoffs`, decisions 59–61); packet recipients read only; no external work acceptance                                                                                                                                                                        |
| 6                     | Server-side enforcement across API, search, exports, feeds      | Implemented and verified (on tested paths)   | [Code] `src/server/rpc.ts` (`run`), `src/server/context.ts`, `src/domain/permissions.ts`; [Test] second-hospice and role suites. No realtime subscriptions exist; the one background job (the email nudge, `email-notices.ts`) sends only a generic nudge to family accounts with active memberships |
| 6                     | Multiple roles evaluated, not unioned                           | Blocked by a decision                        | [Doc] PC-03: one role per staff member, one household per family account, so unions don't arise yet                                                                                                                                                                                                  |
| 6                     | Staff proposal → grantor confirmation → reviewer activation     | Implemented and verified                     | [Code] `CONSENT_STAGES` in `src/domain/status.ts`, `consent_confirmations`; [Test] consent suites                                                                                                                                                                                                    |
| 6                     | "Who can see what?"                                             | Implemented and verified                     | [Code] `src/server/services/access-map.ts` (computed from the enforced rules); expiry and revocation route shown on consents (decision 22)                                                                                                                                                           |
| 6                     | Revocation rechecks releases; no recall promise                 | Evidence incomplete                          | [Code] `CONSENT_REVOKED` hold; [Doc] release wording (decision 48c). Queued notifications aren't rechecked against revocation (none are queued outside the email nudge)                                                                                                                              |
| 6                     | Patient-private participation                                   | Partial                                      | [Code] patient private notes (`private_notes`, decision 46); no patient-private participant or restricted report route                                                                                                                                                                               |
| 6                     | Restricted safeguarding reports                                 | Not found                                    | —                                                                                                                                                                                                                                                                                                    |
| 6                     | Adult/pediatric scope                                           | Not found                                    | No decision or code; needs a founder decision                                                                                                                                                                                                                                                        |
| 7                     | Admission-to-first-use (offer, minimal case, activation owner…) | Implemented and verified (synthetic)         | [Code] `src/server/services/enrollment.ts`, migration `0027`, decisions 66–70; [Test] `tests/integration/enrollment.test.ts`. Activation is a tracked checklist                                                                                                                                      |
| 7                     | Declined/deferred enrollment, no smartphone, assisted use       | Partial                                      | [Code] family-side opt-out and closure (decisions 12–14); no assisted-use mode                                                                                                                                                                                                                       |
| 8                     | Request lifecycle with owner, acknowledgement, next update      | Implemented (aligned, decisions 79–83)       | [Code] decisions 79–83, `src/server/services/requests.ts`, `src/domain/request-lifecycle.ts`; [Test] `tests/integration/request-lifecycle.test.ts`. Tasks, escalations and exceptions keep their models                                                                                              |
| 8                     | Staff queue, aging, coverage, handover, reassignment            | Implemented and verified                     | [Code] `coordinationQueue`, `exceptions.ts`, `coverage.ts`, `assignments.ts`; [Test] assignment, coverage, roster, queue suites                                                                                                                                                                      |
| 9                     | Step by step / full view / listen modes                         | Not found                                    | No mode switch or audio                                                                                                                                                                                                                                                                              |
| 9                     | Accessibility                                                   | Evidence incomplete                          | [Test] axe and keyboard checks in end-to-end and verify suites (last run 2026-10-22); manual assistive-technology review not done (PB-16)                                                                                                                                                            |
| 10                    | Saving / saved / save failed; drafts                            | Not found                                    | No server-backed drafts; no save-state indicator. `localStorage` holds only the staff sidebar state (no sensitive data) [Code] `src/components/staff/shell.tsx`                                                                                                                                      |
| 11                    | One thread per household (service thread)                       | Implemented                                  | [Code] `message_threads`, `messages` (plain text, 4,000 characters); staff notes separate                                                                                                                                                                                                            |
| 11                    | Selected-participant threads, membership version, history scope | Not found                                    | —                                                                                                                                                                                                                                                                                                    |
| 11                    | Idempotent submission; "Sent" only after durable acceptance     | Implemented and verified (three paths)       | [Code] `createOnce` in `src/server/services/send-once.ts`, migration `0025`; [Test] `tests/integration/send-once.test.ts`; other writes don't take an ID yet                                                                                                                                         |
| 12                    | "Viewed" vs acknowledged vs accepted                            | Partial                                      | [Code] `thread_visits.seenAt` (unread state), `acknowledgements` on updates; vocabulary not reconciled with "Viewed"                                                                                                                                                                                 |
| 13                    | Persistent "Get help" with verified clinical route              | Implemented and verified (synthetic)         | [Code] decision 72: a two-person confirmed line with re-confirmation, a backup line and one source of truth (`src/server/services/contact-line.ts`); [Test] `tests/integration/contact-line.test.ts`                                                                                                 |
| 13                    | Post-call outcome capture                                       | Not found                                    | —                                                                                                                                                                                                                                                                                                    |
| 14                    | Offline tolerance and uncertain-submission reconciliation       | Implemented (decisions 84–87)                | [Code] `src/lib/connection.ts`, `src/components/offline.tsx`, `submissionStatus`; [Test] `tests/unit/connection.test.ts`, `tests/integration/submission-status.test.ts`                                                                                                                              |
| 14                    | Fallback channels and bounded retries                           | Implemented (decisions 88–91)                | [Code] `src/server/services/outbox.ts` (outbox, send-time checks, 5 attempts, "Email not delivered"); [Test] `tests/integration/outbox.test.ts`. Development mailbox only until D-06                                                                                                                 |
| 15                    | Separate conflict routes and restricted intake                  | Partial                                      | [Code] authority conflict hold and escalation (Bennett scenario); one escalation model for every kind                                                                                                                                                                                                |
| 16                    | Record-class retention schedule                                 | Partial (proposal)                           | [Code] proposed classes for every table in `src/domain/record-classes.ts`, several marked for review; no periods (D-05, counsel)                                                                                                                                                                     |
| 17                    | Legal holds, release, de-preservation                           | Partial                                      | [Code] `retention_holds` (migration `0026`), `assertMayRemove` in `src/server/services/retention.ts`; [Test] `tests/integration/retention.test.ts`. No screen or server function to place holds (who may is undecided); no vendor or backup coverage                                                 |
| 18                    | Consequential writes audited with context                       | Implemented and verified                     | [Code] `appendAudit` in `src/server/audit.ts` (actor roles, source, reason, before/after, approval); [Test] audit suites                                                                                                                                                                             |
| 18                    | Staff reads audited                                             | Implemented and verified (synthetic)         | [Code] decision 71, `src/server/services/access-log.ts`; [Test] `tests/integration/access-log.test.ts`                                                                                                                                                                                               |
| 18                    | Correlation/causation IDs, occurrence vs ingestion time         | Not found                                    | One `createdAt` per event; no correlation ID                                                                                                                                                                                                                                                         |
| 19                    | Hash chain                                                      | Implemented and verified                     | [Code] per-tenant SHA-256 chain, append-only trigger (migration `0001`), `verifyAuditChain`; [Test] tamper tests                                                                                                                                                                                     |
| 19                    | Canonical encoding (RFC 8785 or equivalent)                     | Partial                                      | [Code] a hand-written sorted-key JSON (`canonical`) without domain separator or version; not RFC 8785                                                                                                                                                                                                |
| 19                    | Serialized append per stream                                    | Implemented; evidence pending                | [Code] advisory lock in `appendAudit`, fork refused by migration `0024`; [Test] fork refused (2026-10-27); the lock itself needs a real Postgres server to prove                                                                                                                                     |
| 19                    | Signed checkpoints, external anchoring                          | Not found                                    | SB-04 (scale blocker)                                                                                                                                                                                                                                                                                |
| 20                    | Bounded verification findings                                   | Implemented and verified                     | [Code] `auditChainFindings` (hash mismatch, broken link, fork, missing start, with limits); [Test] `tests/integration/audit-chain.test.ts`. Tail rollback still undetectable (SB-04)                                                                                                                 |
| 21                    | Fault-injection suite                                           | Partial                                      | [Test] tamper and read-only-mode tests; none of the outbox, crash, replay or failover faults                                                                                                                                                                                                         |
| 22                    | Failover and split brain                                        | External                                     | No hosting yet (PB-02); [Doc] `docs/architecture/backup-recovery.md` planning only                                                                                                                                                                                                                   |
| 23                    | Pooling and draining                                            | Not found / External                         | [Code] one in-process PGlite client (`src/server/db/client.ts`); the Postgres driver change is planned in `docs/architecture/deployment.md`                                                                                                                                                          |
| 24                    | Secrets lifecycle                                               | External                                     | [Doc] no secrets exist; secrets manager planned (D-02)                                                                                                                                                                                                                                               |
| 25                    | BAA, vendor register, clause-to-control map                     | Documented only / Pending review             | [Doc] D-02 brief; PB-14                                                                                                                                                                                                                                                                              |
| 26                    | 83-item catalog with stable IDs                                 | Not found in this repository                 | No artifact with these IDs in `zeporah-pilot` or the `Foundational/` folder's Markdown; the founder should point to the source                                                                                                                                                                       |
| PB-06 (§24 hardening) | CSRF defence beyond SameSite                                    | Not found                                    | [Code] no Origin or token check                                                                                                                                                                                                                                                                      |
| PB-05 (§24 hardening) | Security headers                                                | Implemented and verified (synthetic)         | [Code] `src/domain/security-headers.ts`, `src/start.ts`; [Test] unit tests and 21 pages with 0 policy violations; inline scripts still allowed; staging scan pending                                                                                                                                 |

## 3. Conflicting or missing decisions

1. **Positioning.** _Decided 2026-10-28 for Stage 1: decisions 74–78 (hospice-configured, with listed contacts)._ The brief says "person-centered, hospice-first, not hospice-exclusive" with a
   whole-person care network. [product-context.md](product-context.md) (2026-10-11) defines a
   "hospice-configured household coordination workspace" and names "a broad consumer marketplace"
   as out of scope. Needs a founder decision on whether independent supporters are in Stage 1.
2. **Pilot commercial terms.** Product context says a 90-day _paid_ design-partner pilot with one
   _Medicare-certified_ hospice; the brief says "bounded pilot" without those terms. Not a conflict,
   but confirm they still hold. The pilot state is unset in both (`stateCode: "GA"` in the seed is
   synthetic).
3. **Patient invitations and activation.** _Decided 2026-10-27: decisions 66–68, 70._ The brief's admission flow invites participants,
   including patients; migration `0018` allows household invitations only for family member,
   proxy and helper, and no code creates households. Needs a decision on who creates a household and
   how the first patient or coordinator account is issued.
4. **Patient setup.** _Decided 2026-10-27: decision 69._ Only coordinators can complete onboarding (`onboarding.complete`,
   `src/domain/permissions.ts`); a household whose only member is the patient (the Wells demo
   household) can never unlock messaging or the vault.
5. **Request model.** _Decided 2026-10-28: decisions 79–83 (align, don't merge)._ The brief asks for one request lifecycle; the repository has three
   (tasks, escalations, exception claims). Decision 58's spec chose separate models; unifying them is
   a major redesign, so it needs approval.
6. **Messaging scope.** Selected-participant threads, history visibility and membership versions
   extend decision 5 (one household thread); needs a decision.
7. **Retention numbers.** The brief's 30-day, 7-day and 90-day periods are proposals; PB-11 already
   requires D-05 and counsel. No deletion should be built until then.
8. **Pediatric scope, safeguarding route, death-before-activation:** no decision exists.
9. **Readiness decisions D-03 to D-14** are unwritten; several brief sections (§13 verified clinical
   route, §16, §18 reads, §24) depend on D-03, D-04, D-05, D-07 and D-11.

## 4. P0 launch gaps (before live PHI)

The existing pilot blockers already cover most of the brief's P0 items, and this plan doesn't
duplicate them: PB-02 to PB-16. The brief adds these, proposed as new tracker items for the founder
to accept:

| Proposed | Gap                                                                                   | Why P0                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PB-18    | Audit append isn't serialized per tenant on a multi-connection database               | A forked chain makes the integrity claim false                                                                                                                                          |
| PB-19    | No idempotent submission for messages, support requests and consent actions           | Retries on a poor connection create duplicate requests                                                                                                                                  |
| PB-20    | No enrollment and activation path (households exist only in the seed)                 | The pilot can't start without one                                                                                                                                                       |
| PB-21    | No retention guard that every destructive path must consult, before deletion is built | Prevents a later deletion feature from bypassing holds                                                                                                                                  |
| PB-22    | Verified clinical contact route (the 24-hour line is free text entered by staff)      | A wrong number on "Get help" is a safety failure Brief: [D-15](decision-register/D-15-verified-clinical-line.md); also found a stale per-household copy of the line on the staff record |

## 5. Proposed schema, API and UI changes (not approved)

- **Schema:** `messages.client_submission_id` with a unique index per thread; a `retention_holds`
  table and a single `canDispose()` guard (no deletion path yet); audit `correlation_id`;
  enrollment `activation_owner_actor_id` and activation states on `households`; a care-network
  `relationships` table kept separate from `memberships` (contact only by default).
- **API:** submission ID on every create endpoint, returning the existing record on replay; an
  Origin check on every POST; a verifier that returns findings rather than ok/broken.
- **UI:** "Sending… / Sent / Not sent, try again" states tied to the server's confirmation; a
  connection-status banner; later, enrollment screens for staff.

## 6. Dependency-ordered increments

| #   | Increment                                                                      | Brief       | Needs                                        | Size   |
| --- | ------------------------------------------------------------------------------ | ----------- | -------------------------------------------- | ------ |
| 1   | Same-origin check on every state-changing request (PB-06)                      | §24         | Freeze lift                                  | Small  |
| 2   | Serialized, per-tenant audit append and findings-based verification            | §19–20      | Freeze lift; migration                       | Small  |
| 3   | Idempotent submission and honest send states for messages and support requests | §11–12, §14 | Freeze lift; migration                       | Medium |
| 4   | Security headers baseline (PB-05)                                              | §24         | Freeze lift; header values depend on hosting | Small  |
| 5   | Retention guard and hold model, with no deletion path                          | §16–17      | D-05 for periods; freeze lift                | Medium |
| 6   | Enrollment and activation (staff creates a minimal case, invites first person) | §7          | Decision on patient invitations and setup    | Large  |
| 7   | Care-network relationships (contact only by default)                           | §5          | Decision on hospice-exclusive scope          | Large  |
| 8   | Request lifecycle unification or alignment                                     | §8          | Decision (redesign of decision 58's models)  | Large  |
| 9   | Offline status and uncertain-submission reconciliation                         | §14         | Increment 3                                  | Medium |
| 10  | Postgres driver, pooling, draining, secrets, failover                          | §22–24      | D-02 build-out, hosting (PB-02)              | Large  |

## 7. First safe slice

**Increment 1: same-origin check on state-changing requests (PB-06).** Every POST server function
already goes through `run` in `src/server/rpc.ts`; the request middleware in `src/start.ts` can
refuse a POST whose `Origin` (or, when absent, `Sec-Fetch-Site`) isn't this server or one of the
configured addresses (`ZEPORAH_APP_URL`, `ZEPORAH_CARE_URL`). It is small, reversible (one
middleware), needs no schema change, no external configuration and no policy decision, and it
closes the code half of an existing pilot blocker. Tests: unit tests for the decision function, an
integration test that a cross-origin POST is refused, and the existing suites unchanged.

**Done 2026-10-27** with the founder's freeze lift: verified in synthetic testing, PB-06 in progress ([evidence](readiness/evidence/csrf-origin-check-2026-10-27.md)). It ended up needing no frozen file: the check lives in `src/start.ts`, not `src/server/rpc.ts`.

**Increment 2 done 2026-10-27** with the founder's freeze lift: findings and the fork guard verified in synthetic testing; serialized appends implemented, evidence pending a real Postgres server ([evidence](readiness/evidence/audit-chain-integrity-2026-10-27.md)).

**Increment 3 done 2026-10-27** with the founder's freeze lift: family and staff messages and family support requests send once, and the composers say a send is unconfirmed rather than "nothing was changed" when no reply comes back; verified in synthetic testing ([evidence](readiness/evidence/send-once-2026-10-27.md)).

**Increment 4 done 2026-10-27** with the founder's freeze lift: the security-header baseline is on every response; verified in synthetic testing, PB-05 in progress ([evidence](readiness/evidence/security-headers-2026-10-27.md)).

**Increment 5 done 2026-10-27** with the founder's freeze lift: proposed record classes, retention holds and a removal guard that every record-removing path consults; no deletion path and no retention periods; verified in synthetic testing ([evidence](readiness/evidence/retention-guard-2026-10-27.md)).

**Increment 6 done 2026-10-27** after the founder decided 66–70 and lifted the freeze: enrollment, staff invitations for the patient and one coordinator, patient setup without a coordinator, the enforced pilot cap and a tracked activation checklist; verified in synthetic testing ([evidence](readiness/evidence/enrollment-2026-10-27.md)).

**PB-22 addressed 2026-10-28** after the founder decided 72 and lifted the freeze: the 24-hour line is confirmed by a second person's call, re-confirmed every 90 days, and read from one source; verified in synthetic testing ([evidence](readiness/evidence/verified-line-2026-10-28.md)).

**Increment 7 done 2026-10-28** after the founder decided 74–78 and lifted the freeze: listed contacts, patient-private contacts and invitations from a contact; verified in synthetic testing ([evidence](readiness/evidence/listed-contacts-2026-10-28.md)).

**Increment 8 done 2026-10-28** after the founder decided 79–83 and lifted the freeze: family requests share lifecycle words (Received, With <first name>, Waiting on you, Waiting on someone else, Resolved, Withdrawn), withdraw and reopen, a next-update time with an Update overdue exception, and offers that need accepting; verified in synthetic testing ([evidence](readiness/evidence/request-lifecycle-2026-10-28.md)).

**Increment 9 done 2026-10-28** after the founder decided 84–87 and lifted the freeze: an offline banner with the load time and the 24-hour line in both workspaces, changes paused while offline, and sends that couldn't be confirmed settled by their submission ID without resending; verified in synthetic testing ([evidence](readiness/evidence/offline-status-2026-10-28.md)). Fallback channels and an outbox (the rest of §14) remain open.

**The rest of §14 done 2026-10-28** after the founder decided 88–91 (D-16) and lifted the freeze: one outbox, saved with the change each email reports and sent separately; checks at send time; at most 5 attempts over about 10.5 hours; "Email not delivered" for operations; no automatic switching. Development mailbox only ([evidence](readiness/evidence/outbox-2026-10-28.md)).
