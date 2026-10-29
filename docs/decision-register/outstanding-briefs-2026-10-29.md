# Outstanding decision briefs (2026-10-29)

**Status: briefs for the founder. Nothing here is decided, approved or built.** Each recommendation
is a proposal; under the register's rule, nothing a brief covers is built until the founder records
a decision in [founder-decision-log.md](../founder-decision-log.md). Briefs 1, 2, 4, 5 and 6 have
no register ID; the founder assigns one if they're entered. Revision: `main` =
`453a2fb1a413fe0e61f245933abdd1e1da1f47fc`.

## 1. Pilot terms and state

- **Problem.** [product-context.md](../product-context.md) says: one U.S. state, one
  Medicare-certified hospice, one executive sponsor, 10–25 households, a 90-day paid design-partner
  pilot, the hospice is the customer, families are free. No later record confirms these, and no
  state is chosen (the seed's `stateCode: "GA"` is synthetic). State law affects consent wording,
  authority documents, breach notice timing and retention.
- **Options.** A: confirm the product-context terms as they stand and name the state. B: confirm
  them, leaving the state open until a hospice is selected. C: change any term (payer, household
  charge, cap, length).
- **Recommendation.** B now, then name the state when the hospice is chosen. The cap (decision 70:
  25 by default) already matches.
- **Trade-offs.** Naming the state early lets counsel start state-specific review; naming it late
  avoids reviewing the wrong state.
- **Dependencies.** Hospice selection; counsel (PB-14).
- **Exact approval requested.** "The Stage 1 pilot terms in product-context.md stand unchanged; the
  state is chosen with the hospice."
- **Consequence of deferral.** Counsel can't scope state-specific review; commercial terms stay an
  assumption.

## 2. Selected-participant messaging

- **Problem.** Decision 5 gives each household one thread. The brief asked for threads with
  selected participants, history visibility rules and membership versions. Nothing found in the family
  message reads limits a new member to messages after they joined (not checked by any test); the
  master prompt says new membership mustn't expose earlier sensitive
  history by default.
- **Options.** A: keep one thread; add a rule that a member added after activation sees history only
  from the day they joined. B: A plus private threads between the patient (or coordinator) and the
  care team. C: arbitrary selected-participant threads.
- **Recommendation.** A for Stage 1. It closes the history exposure without a new thread model.
- **Trade-offs.** A doesn't give the patient a private channel to the care team (they still have
  support requests and the 24-hour line). B and C add membership-version logic, notification rules
  and audit visibility classes to every thread.
- **Dependencies.** Decision 5 (to be amended); the safeguarding brief (§5) if a private channel is
  how a concern is raised.
- **Exact approval requested.** "Amend decision 5: a household member added after activation sees
  thread history from the date they joined; earlier messages stay hidden from them."
- **Consequence of deferral.** Every new member, including a late-added relative, sees the full
  history.

## 3. Retention periods (D-05)

- **Problem.** PB-11 needs an approved retention and deletion policy. Today: twelve proposed record
  classes in `src/domain/record-classes.ts` (seven marked for counsel or clinical review), holds and
  a removal guard; disposal is always refused; no periods. The brief proposed three periods: draft
  expiry 30 days of inactivity; reconciled transient submission artifacts 7 days; notification
  diagnostics and view receipts 90 days. The outbox also keeps addresses after sending.
- **Options.** A: adopt the three proposed periods for those classes only, everything else "kept
  for the pilot, pending counsel". B: wait for counsel to set every class. C: set periods for all
  classes now.
- **Recommendation.** B. Ask counsel to review the twelve classes and the three proposals together.
  Build nothing that deletes until then.
- **Trade-offs.** A gives early test material for a disposal job but risks deleting something
  later judged part of a designated record set. C front-runs legal advice.
- **Dependencies.** Counsel; PB-14; backups (PB-03) because deletion must cover backups.
- **Exact approval requested.** "Send the record classes and the three proposed periods to counsel;
  no disposal is designed or built until counsel answers."
- **Consequence of deferral.** PB-11 stays open; Stage 1 can't pass.

## 4. Pediatric inclusion

- **Problem.** No decision says whether a patient may be a minor. Pediatric hospice changes who
  holds authority (parents or guardians), what the patient sees, consent wording and safeguarding
  duties.
- **Options.** A: adults only in Stage 1, enforced at enrollment (a staff attestation that the
  patient is 18 or over; no date of birth stored). B: pediatric allowed, with a separate authority
  and consent design. C: no rule.
- **Recommendation.** A.
- **Trade-offs.** A excludes pediatric hospices from the pilot. B is a large design with legal
  review. C leaves staff to improvise.
- **Dependencies.** Pilot terms (§1); counsel.
- **Exact approval requested.** "Stage 1 enrolls adult patients only; enrollment asks staff to
  confirm the patient is 18 or over; no date of birth is collected."
- **Consequence of deferral.** A hospice could enroll a minor into flows designed for adults.

## 5. Safeguarding route

- **Problem.** There's no way to raise a private concern (coercion, pressured sharing, abuse)
  without it reaching the household thread or the household's own record. The master prompt says the
  subject of a concern mustn't be notified in a way that exposes the reporter, and that disputes
  needing judgement go to human review.
- **Options.** A: no in-app route; the family page points to the hospice's 24-hour line and the
  care team for anything private. B: a "private concern" request visible only to a named
  safeguarding reviewer role at the hospice, never in the household's view or audit visible to the
  family. C: B plus automatic holds on sharing.
- **Recommendation.** A for Stage 1, with the wording reviewed by the hospice; B as the next design
  once the hospice names who reviews concerns and their backup.
- **Trade-offs.** A builds nothing that could leak a reporter's identity, but relies on phone
  contact. B needs a staffed reviewer with a backup; an unstaffed queue is worse than none.
- **Dependencies.** D-11 (support model); the hospice's safeguarding policy; §7.6 of the
  [closure plan](../stage1-closure-2026-10-29.md#76-unavailable-coverage-or-safeguarding-reviewer).
- **Exact approval requested.** "Stage 1 has no in-app safeguarding route; private concerns go to
  the hospice by phone. Option B is designed once the hospice names a reviewer and a backup."
- **Consequence of deferral.** No agreed answer for a family member who is being pressured.

## 6. Death before activation

- **Problem.** The lifecycle allows `enrolled → bereavement` (`src/domain/lifecycle.ts`), so a
  patient can die before the household finishes setup. The bereavement transition ends the
  patient's membership and active consents, but this review didn't find it touching **pending
  invitations or the activation checklist**; whether an outstanding invitation can still be accepted
  after the transition isn't verified by any test.
- **Options.** A: at the transition, withdraw pending invitations for the patient and pause the
  activation checklist; the care guide decides whether to invite a surviving coordinator into
  bereavement support. B: close the household instead of entering bereavement when it never
  activated. C: no change.
- **Recommendation.** A.
- **Trade-offs.** A keeps bereavement support available to a family that never set up; B is simpler
  but leaves that family without it.
- **Dependencies.** R-09 (authority at the transition, with legal advice); decision 69 (patient
  setup); a freeze lift for `src/server/services/staff.ts`.
- **Exact approval requested.** "At a bereavement transition, pending invitations for the patient
  are withdrawn and activation stops; the care guide may invite a coordinator into bereavement
  support." Plus a freeze lift to build and test it.
- **Consequence of deferral.** An invitation to a patient who has died may stay open.

## 7. Readiness decisions not yet written

Short briefs; each would become a full brief in this folder when its workstream starts.

| ID             | Problem                                                                                                  | Options                                                                                          | Recommendation                                                                              | Dependencies             | Exact approval requested                                                                              | Consequence of deferral                   |
| -------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| D-01 build-out | Decision 64 names GitLab; the remote is GitHub; direct pushes to `main` succeed and no hosted CI has run | A: GitHub, convert CI. B: GitLab, move the repository                                            | Whichever account the company will own; then protect `main` and require review and CI       | Founder's account choice | "The code host is \_\_\_; protect `main`, require one review and green CI before merge"               | Changes keep landing on `main` unreviewed |
| D-03           | Staff sign in with local passwords and no MFA (PB-08)                                                    | A: a managed identity provider with MFA. B: built-in TOTP                                        | A (the prompt says don't build an identity provider)                                        | D-02                     | "Staff sign in through a managed identity provider with mandatory MFA; provider chosen with D-02"     | PB-08 open; Stage 1 blocked               |
| D-06           | Whether Stage 1 sends any email (PC-02)                                                                  | A: no email; invitations by hand. B: essential email only (decision 47) via a BAA-covered sender | A for the first households; B once a sender has a signed BAA                                | D-02; closure plan §7.1  | "Stage 1 starts with no email; email is reconsidered after a BAA-covered sender exists"               | PC-02 has no compensating control         |
| D-07           | Who detects, decides and notifies in a breach                                                            | Roles split between Zeporah and the hospice per the BAA                                          | The hospice notifies individuals; Zeporah notifies the hospice within a set time            | Hospice partner; counsel | Approve the role split for the hospice agreement                                                      | PB-13 and PB-14 can't close               |
| D-08           | Recovery by re-invitation (decision 9) and 30-day "Remember me" (decision 53) on shared devices          | Keep both; shorten the session; remove "Remember me"                                             | Keep re-invitation; shorten "Remember me" to 7 days                                         | —                        | "Remember me lasts 7 days" (or keep 30)                                                               | PC-05 has no compensating control         |
| D-09           | Operations and reviewers see every household (PC-04)                                                     | Keep, with the read log (decision 71) as the control; or restrict to assigned                    | Keep for a 10–25-household pilot, with a monthly read-log review                            | D-04 procedure (PB-12)   | "Hospice-wide visibility for operations and reviewers stays, controlled by a monthly read-log review" | PC-04 has no compensating control         |
| D-10           | The README says "not yet written"; the tracker says decision 70 answers it                               | Mark decided by decision 70                                                                      | Mark decided                                                                                | —                        | "D-10 is answered by decision 70"                                                                     | The registers disagree                    |
| D-11           | No support model; no human service is staffed by Zeporah                                                 | Hospice-only support; Zeporah product support with hours                                         | Hospice care team first line; Zeporah product support in business hours, stated on the page | Hospice partner          | Approve the split and the stated hours                                                                | PB-15 open                                |
| D-13           | No one is named to approve a release or a production change                                              | Founder alone; founder plus engineering lead                                                     | Two people for production; founder for releases                                             | D-01 build-out           | Name the approvers                                                                                    | PB-01 can't close                         |
| D-14           | Demo, pilot and production separation                                                                    | Separate accounts per environment; separate projects in one account                              | Separate accounts                                                                           | D-02                     | "Each environment has its own account and database; demo data never enters pilot"                     | PB-02 can't close                         |

## 8. Approvals already pending elsewhere

Listed so they aren't mistaken for decided: decision 63's build (needs a freeze lift);
Track B (needs decision 18 amended for a labelled synthetic adapter, a product-scope decision for
contexts B and C, and a freeze lift); increment 10 (needs D-02's build-out); accepting PB-18 to
PB-22 into the tracker.
