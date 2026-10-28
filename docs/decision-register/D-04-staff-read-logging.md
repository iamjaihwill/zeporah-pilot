# D-04 · Staff read-access logging: standard and visibility

**Status:** written 2026-10-27, awaiting the founder's decision. Blocks PB-12 (W5). Related: D-09
(minimum necessary for operations and reviewers), D-05 (retention), SB-04 (external anchoring).

## Decision to make

Which staff reads of household information Zeporah records, how finely, where the records live, who
can review them, and how long they're kept.

## Why it matters now

Today Zeporah records every change but no staff read ([Code] no read events; production-readiness
inventory, "Read access"). A pilot with real PHI needs to answer "who looked at this household's
information, and when", for privacy review, complaint investigation and incident response. The
answer shapes a table, a hook in the request path and a review screen, so it's cheaper to decide
before real data than to retrofit. [Pending review] Counsel should confirm what the hospice's own
policies and the BAA expect.

## What staff can read today

From the 40 staff `GET` server functions in `src/functions/staff.ts` and `staff-shell.ts`:

| Kind                        | Examples                                                                                                                                                                                                                          | Names a household? |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **One household's record**  | `getHouseholdOverview` (record, messages, tasks, vault list, setup, activation), `getHouseholdAccessMap`, `getPacket`, `getAuthority`, `getConsents`, `getConsentHistory`, `getQueueDetail`                                       | Yes, one           |
| **Lists across households** | `getStaffHome`, `getQueue`, `searchHouseholds`, `staffSearch`, `getPackets`, `getEscalations`, `getReviewQueue`, `getSharingRegister`, `getBereavementWorkload`, `getCoverageBoard`, `getResolvedExceptions`, `getPreparedDrafts` | Many, as rows      |
| **Aggregates**              | `getOperationsReport`, `getTrendsReport`, `getReportSet`, `getSystemStatus`                                                                                                                                                       | No (counts)        |
| **Configuration and team**  | settings, invitations, roster, guide, policy scenarios                                                                                                                                                                            | No                 |

Already recorded: outside recipients' packet reads (`packet_access_log`, decision 45), audit exports
(decision 28), and every change (audit chain). Pages re-run their loaders on every visit
(`defaultStaleTime: 0` in `src/router.tsx`), so a naive "one event per request" would record the
same view many times a minute.

## Options

| Option                                       | What is recorded                                                                                                                                                                                                                                                                                                                         | For                                                                                                     | Against                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **A. Record opens, coalesced (recommended)** | One event when a staff member opens one household's record or a part of it (overview, access map, a packet, authority, consents, consent history, queue detail), at most once per person, household and view per 15 minutes (proposed, unvalidated). List views record one event with the view's name and row count, not each household. | Answers "who opened this household" precisely; volume stays proportional to real work; lists stay cheap | A household that only appeared as a row in a list isn't individually recorded              |
| B. Record everything                         | Every read, including each household that appears in a list or search result                                                                                                                                                                                                                                                             | Most complete                                                                                           | Very high volume (every page re-runs its loader); hard to review; mostly noise             |
| C. Sensitive reads only                      | Protected vault items, consents and authority, packets, and households outside the person's assignment                                                                                                                                                                                                                                   | Smallest volume                                                                                         | "Who looked at this household" has gaps; deciding what's sensitive is itself a policy call |

## Where the records live

| Option                                                 | For                                                                                                                                                                     | Against                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **1. A separate append-only access log (recommended)** | Like `packet_access_log`: the database refuses changes, it's reviewable on its own, and reads don't lengthen or slow the audit chain (one lock per tenant, increment 2) | A second record to keep and verify                                                  |
| 2. The audit chain                                     | One place for everything                                                                                                                                                | Every page view takes the tenant's audit lock and grows the chain; review is harder |

## Who can review

| Option                                                                                                            | For                                                                            | Against                                                              |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **Privileged reviewers and administrators (recommended)**, on Audit review, filtered by household or staff member | Matches decision 39 (administrators see the audit trail) and the reviewer role | Operations can't self-review their own team without asking           |
| Also operations                                                                                                   | Faster day-to-day review                                                       | Operations reviewing reads that are mostly their own team's          |
| Also the household                                                                                                | Transparency                                                                   | No product promise exists; risks exposing staff names; needs counsel |

**Recommendation:** staff-only (reviewers and administrators), never shown to households in the
pilot. A household request for an access history goes to the hospice's privacy process.

## What each record holds

Staff member, role at the time, household, which view, when, and whether the household was outside
their assignment (operations and reviewers see every household today, PC-04, so this flag is how D-09
can be reviewed). **Never** message text, note text, document details, search terms typed, or what was
on screen.

## Retention

The `security_audit` record class (increment 5, a proposal). Kept at least as long as the audit
chain until D-05 sets a period; covered by retention holds like any other class.

## Impact

- **Privacy:** answers who opened what, for complaints and incidents; the out-of-assignment flag
  gives D-09 real evidence.
- **Security:** a log that can't be edited, separate from the chain; SB-04 would anchor both.
- **Product:** no visible change for staff except the review screen; no banner on every page.
- **Performance:** one small insert per coalesced open; no audit lock.
- **Schedule:** about one increment: migration, a hook in the service layer for the seven
  single-household reads, list summaries, a review filter, tests.

## Default if no decision is made

PB-12 stays open, and Stage 1 can't pass: staff reads stay unrecorded.

## Exactly what the choice unlocks

- Migration for the access log and its append-only rule.
- Read recording in the seven single-household reads and the list views, with coalescing.
- Audit review: filter by household or staff member, including the out-of-assignment flag.
- Tests that every listed read writes one event, coalescing holds, nothing sensitive is stored, and
  only reviewers and administrators can see the log.
- PB-12's evidence, for the privacy and security officer to approve.
