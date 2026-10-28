# Evidence: staff read-access logging (PB-12, decision 71), 2026-10-27

**Status: verified in synthetic testing. Not closed.** PB-12 closes when the privacy and security
officer approves this evidence and the audit review procedure exists.

## What was built

- **The log:** `staff_access_events` (migration `0028_access_log`), append-only: the database refuses
  update, delete and truncate (its own trigger), and a check keeps record entries tied to a household
  and list entries without one. Record class `security_audit`.
- **Recording** (`src/server/services/access-log.ts`), at the server functions that answer requests,
  so internal service calls aren't mistaken for a person opening something:
  - **8 record reads**, one entry per person, household and view per 15 minutes: household record,
    who can see what, packet, authority evidence, consents, consent history, exception detail,
    prepared drafts.
  - **18 list views**, one entry with the row count when the result is a list: my work, queue,
    households, search, packets, escalations, review queue, sharing register, bereavement
    follow-up, team and coverage, resolved exceptions, new packet, coverage tasks, handoffs,
    roster, staff member, audit review, and the access log itself.
  - **Exempt (15):** settings, counts and reports, the app shell and staff-name lookups. A test
    fails if a new staff read is neither logged nor on that list.
  - Each entry: who, their roles, household, view, time, and whether the household was outside their
    assignment or cover. No content.
  - **If an entry can't be written, the read is refused** ("This couldn't be recorded, so it isn't
    shown").
- **Review:** "Who opened records" (`/staff/access-log`), linked from Audit review, for privileged
  reviewers and administrators (`access_log.view`); filters by household, staff member and "not
  assigned or covering". Never shown to households.

This goes beyond D-04's inventory: writing the coverage test found five more reads that list
households (new packet, coverage tasks, handoffs, roster, staff member), plus audit review and the
access log itself; all are logged as list views.

## Tests

`tests/integration/access-log.test.ts`: 12 of 12.

| Case                                                                                                                 | Result |
| -------------------------------------------------------------------------------------------------------------------- | ------ |
| Who, household, view, roles and the assignment flag are recorded (Maya assigned: no flag; Dana, operations: flagged) | Passed |
| Coalescing: the same view twice is one entry; another view or household is another                                   | Passed |
| Family members and outside recipients write nothing                                                                  | Passed |
| Only a successful read is recorded; the result is unchanged; a refused read records nothing                          | Passed |
| The read is refused when the entry can't be written (table moved away)                                               | Passed |
| List views record the row count and no households                                                                    | Passed |
| The log can't be updated, deleted or truncated; malformed entries are refused                                        | Passed |
| Only reviewers and administrators can review it; entries hold no content fields; Cedar sees none of Willow's         | Passed |
| Every staff read is logged or a listed exemption                                                                     | Passed |

Unit and integration suites: 570 of 570. End-to-end suites: not run (the test browser isn't
installed on this computer).

**In the browser** (development server, synthetic data): Dana opened the Bennett household twice;
as Priya, "Who opened records" showed one entry, "Dana Brooks · Household record · The Bennett
household · Not assigned or covering", along with list views (My work, Handoffs) and Priya's own
Audit review visit.

## Limits

- **Coverage is by request path:** reads made outside these server functions (for example, server
  rendering calling a service directly) aren't recorded. Today every page loads through them.
- **Coalescing is approximate:** two reads at the same instant may both be recorded; never fewer.
- **Read-only mode still records reads**, deliberately: during an incident, knowing who looked
  matters most.
- **Not anchored outside the database** (SB-04), and not part of the hash chain, by decision 71.
- **Fail-closed has a cost:** if the log can't be written, staff can't open records until it can.
- **No review procedure yet** (who reviews, how often, what triggers a look): needed before PB-12 can
  close.
