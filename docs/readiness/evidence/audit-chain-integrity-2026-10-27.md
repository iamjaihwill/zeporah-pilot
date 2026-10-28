# Evidence: audit chain serialization and findings (increment 2), 2026-10-27

**Status:** the fork guard and findings are **verified in synthetic testing**. Serialized appends
are **implemented; evidence pending**: the embedded database can't run two appends at once, so the
lock is only proven on a real Postgres server (PB-02, PB-09). This addresses proposed item PB-18 in
[brief-reconciliation-2026-10-27.md](../../brief-reconciliation-2026-10-27.md); the founder hasn't
added PB-18 to the tracker yet.

## What was built

| Change                                                                                                                                                   | Where                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Each append takes a transaction-scoped advisory lock for its tenant before reading the previous event, held until the caller's transaction ends          | `appendAudit` in `src/server/audit.ts`                                                              |
| The database refuses two events that follow the same event, and a second start of a chain                                                                | Migration `0024_audit_chain_link` (two unique indexes); undo in `tests/fixtures/downgrade-0024.sql` |
| Verification reports every finding (`hash_mismatch`, `broken_link`, `fork`, `missing_start`) with the head event and the limits a clean result still has | `auditChainFindings` in `src/server/audit.ts`; `verifyAuditChain` kept as the short form            |
| System status shows "No findings (N events)" or the number of findings, with the main limit as a hint, instead of "Verified"                             | `src/server/services/system.ts`, `src/routes/staff/status.tsx`                                      |

## Tests

All run on 2026-10-27 against the embedded database with synthetic data.

| Fault exercised                                        | Required behaviour                        | Result                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 40 appends started at once                             | One unbroken chain, 40 more events        | Passed. **Not a concurrency proof:** with the lock removed the test still passes, because PGlite runs one query at a time |
| An append inside a transaction that then fails         | No event left behind                      | Passed                                                                                                                    |
| A forked event inserted directly in SQL                | Refused by the database                   | Passed (both the duplicate successor and a second genesis)                                                                |
| An event changed with the append-only trigger disabled | `hash_mismatch` naming that event         | Passed                                                                                                                    |
| An event removed from the middle                       | `broken_link` naming the next event       | Passed                                                                                                                    |
| The first event removed                                | `missing_start`                           | Passed                                                                                                                    |
| A fork written after dropping the database's guard     | `fork` naming both followers              | Passed                                                                                                                    |
| The last event removed                                 | **Not detectable;** the limit is reported | Passed as a documented limitation: no findings, limit stated                                                              |
| Tampering in one tenant                                | The other tenant's chain still clean      | Passed                                                                                                                    |

`tests/integration/audit-chain.test.ts`: 9 of 9. The upgrade suite (`schema-upgrade.test.ts`) now
steps back 11 migrations to the same 0013 database: passed. Unit and integration suites: 514 of 514.
End-to-end suites: not run (the test browser isn't installed on this computer).

The System status page was checked in the browser as Dana: "No findings (60 events)" with the hint.

## Limits that remain

- **Tail truncation and full rewrites** aren't detectable until signed checkpoints are kept outside
  the database (SB-04).
- **Completeness:** a clean chain shows recorded events weren't changed, not that every action was
  recorded.
- **Encoding:** the canonical form is still the hand-written sorted-key JSON, not RFC 8785, with no
  domain separator or version. Changing it would need a versioned chain, so it's left for later.
- **Lock cost:** audit writes for one tenant wait for each other's transactions, so transactions
  that write audit events must stay short.
- **Existing forks:** migration 0024 fails on a database that already holds a fork, which makes the
  problem visible rather than silent; no such database exists outside development.
