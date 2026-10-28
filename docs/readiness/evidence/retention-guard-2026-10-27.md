# Evidence: retention holds and the removal guard (increment 5), 2026-10-27

**Status: verified in synthetic testing.** Addresses proposed item PB-21 in
[brief-reconciliation-2026-10-27.md](../../brief-reconciliation-2026-10-27.md). It doesn't close
PB-11: there is still **no approved retention policy and no disposal path**, and no retention period
was set (decision D-05, counsel).

## What was built

| Change                                                                                                                                                                                                                                                                                                                               | Where                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| A proposed record class for every table (configuration, participation, routine coordination, clinical-record candidate, consent and authority evidence, acknowledgement, view receipt, notification, account security, security audit, hold, development only), with the classifications that need counsel or clinical review marked | `src/domain/record-classes.ts`                                                |
| A `retention_holds` table: tenant, optional household, record classes (empty for all), reason, authorization reference, who and when; released once, with its own authorization                                                                                                                                                      | Migration `0026_retention_holds`; undo in `tests/fixtures/downgrade-0026.sql` |
| Database rules: a hold can't be deleted or truncated; the only change allowed is active → released, with every other field unchanged; a reason, an authorization and (to release) a release authorization are required                                                                                                               | Migration `0026` (check constraints and the `retention_holds_guard` trigger)  |
| `mayRemove` / `assertMayRemove`: disposal is always refused (no approved policy); a correction is refused while an active hold covers its class and household; if the check fails, removal is refused                                                                                                                                | `src/server/services/retention.ts`                                            |
| `placeHold` / `releaseHold`, audited; release removes nothing, restores nothing, and reports which other holds still apply                                                                                                                                                                                                           | `src/server/services/retention.ts`                                            |
| The three record-removing paths now consult the guard: undoing an acknowledgement, reopening a done task, replacing a draft packet's contents                                                                                                                                                                                        | `src/server/services/family.ts`, `tasks.ts`, `sharing.ts`                     |

**Exempt from the guard:** ending sign-in sessions (sign-out, password reset, staff deactivation),
because that ends access rather than destroying records, and a hold must never block it. The
development data reset exists only behind the development gate.

**Not built, on purpose:** any screen or server function to place or release holds (who may is an
open decision), any disposal or deletion feature, any retention period.

## Tests

| Fault or case exercised                                             | Required behaviour                                 | Result |
| ------------------------------------------------------------------- | -------------------------------------------------- | ------ |
| Disposal, with and without a hold                                   | Always refused (no policy; or held)                | Passed |
| A correction with no hold                                           | Allowed                                            | Passed |
| The hold store unavailable                                          | Refused (`guard_unavailable`), not allowed         | Passed |
| A hold on another class, or another household                       | Doesn't block                                      | Passed |
| A tenant-wide hold                                                  | Blocks every household; never another tenant       | Passed |
| A table with no record class                                        | Refused                                            | Passed |
| Undoing an acknowledgement under a hold                             | Refused with the plain message; the row is kept    | Passed |
| Reopening a done task under a hold on acknowledgements              | Refused; the task stays done                       | Passed |
| Replacing a draft packet's contents under a hold                    | Refused; the contents are unchanged                | Passed |
| Two overlapping holds, one released                                 | Still held; the other hold is named                | Passed |
| Both released                                                       | The person's own undo works again; nothing removed | Passed |
| Releasing without an authorization; releasing twice                 | Refused                                            | Passed |
| A hold without a reason, an authorization, or with an unknown class | Refused                                            | Passed |
| Placing and releasing                                               | Both audited; the chain still checks clean         | Passed |
| Deleting, truncating, rescoping or reactivating a hold in SQL       | Refused by the database                            | Passed |
| Releasing in SQL without its authorization                          | Refused by the database                            | Passed |
| Every `.delete(` in `src/server`                                    | Guarded within 15 lines, or `sessions`             | Passed |
| Every table has a record class                                      | No table left out, none invented                   | Passed |

`tests/integration/retention.test.ts`: 16 of 16; `tests/unit/record-classes.test.ts`: 2 of 2. The
upgrade suite now steps back 13 migrations to the same 0013 database. End-to-end suites: not run
(the test browser isn't installed on this computer).

## Limits

- **The source scan is a heuristic:** it finds `.delete(table)` calls in `src/server` and looks for
  the guard just above them. Raw SQL deletes or a delete in another folder would slip past it.
- **The record classes are a proposal.** Several need counsel or clinical review (marked `review`),
  including whether messages, staff notes and care-coordination records belong to a designated
  record set.
- **A downgrade past 0026** drops the holds; the undo script is for the upgrade tests only.
- **Backups, vendors and search indexes** aren't covered; nothing exists outside the one database yet.
