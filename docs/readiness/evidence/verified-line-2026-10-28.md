# Evidence: a verified 24-hour line (decision 72), 2026-10-28

**Status: verified in synthetic testing.** Addresses proposed pilot blocker PB-22
([brief-reconciliation-2026-10-27.md](../../brief-reconciliation-2026-10-27.md)); the founder hasn't
added PB-22 to the tracker. Real numbers and the real re-confirmation owner come with the pilot
hospice.

## What was built

| Rule                                                                                                                                                                                    | Where                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| An administrator proposes a line (and an optional backup); families keep the confirmed line until the change is confirmed                                                               | `proposeLine` in `src/server/services/contact-line.ts`; "24-hour line" card in Hospice settings            |
| Someone other than the proposer, in operations or administration, confirms only after ticking that they called it and reached the after-hours service, with a note of what they reached | `confirmLine`; the database refuses a change confirmed by its own proposer (migration `0029_contact_line`) |
| A waiting change can be withdrawn; a newer proposal supersedes it; one waiting change per hospice                                                                                       | `withdrawLine`; unique index                                                                               |
| Re-confirmation of the unchanged line at least every 90 days; System status flags "due", "never confirmed" or "a new line is waiting"                                                   | `reconfirmLine`, `lineStatus`; `src/routes/staff/status.tsx`                                               |
| US phone-number format check, with an optional extension or short note                                                                                                                  | `isWellFormedLine` in `src/domain/contact-line.ts`                                                         |
| A confirmed backup line shows as "if you can't get through: …" wherever the line shows                                                                                                  | `lineForFamilies`, `organizationHotline`                                                                   |
| **One source of truth:** the per-household copy is no longer written or read; the staff record shows the live line                                                                      | `src/components/staff/record.tsx`; enrollment writes no copy                                               |
| Hospice details now saves only the email sender name; the line can't be changed there                                                                                                   | `setHospiceDetails` in `src/server/services/settings.ts`                                                   |
| Proposals, confirmations, withdrawals and re-confirmations are audited; the record of changes can't be deleted                                                                          | `contact_line.*` audit actions; migration `0029`                                                           |

The synthetic seed records each hospice's last confirmation call (Dana Brooks 10 days ago for Willow
Creek; Jordan Ellis 20 days ago for Cedar Valley).

## Tests

`tests/integration/contact-line.test.ts`: 10 of 10.

| Case                                                                                                                                                            | Result |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Format check accepts US numbers with extension or note, refuses short numbers, words and overlong text                                                          | Passed |
| Families keep the confirmed line while a change waits; the proposer can't confirm; another person can, and then families and the staff record show the new line | Passed |
| The database refuses a change confirmed by its proposer                                                                                                         | Passed |
| Operations can't propose; a care guide or reviewer can't confirm                                                                                                | Passed |
| Confirming needs "reached the service" and a note; a malformed or unchanged line is refused                                                                     | Passed |
| A backup line shows as "if you can't get through"                                                                                                               | Passed |
| Withdrawing and superseding leave families on the confirmed line                                                                                                | Passed |
| Current after the seeded call, due after 90 days (on System status too), current again once re-confirmed; a care guide can't re-confirm                         | Passed |
| The change record can't be deleted; one waiting change per hospice                                                                                              | Passed |
| Nothing in the app reads a stored copy of the line                                                                                                              | Passed |

Unit and integration suites: 580 of 580. End-to-end suites: not run (the test browser isn't
installed on this computer).

**In the browser** (development server, synthetic data): as Lena, Hospice settings showed "555-0100
… Last confirmed Oct 18, 2026 by Dana Brooks"; proposing "(555) 555-0142, press 1 for the nurse
line" showed it waiting, with no confirm option for Lena and families still on 555-0100. As Dana,
ticking the call box, adding a note and confirming made it the line families see; Daniel's home page
then read "call 911 or your hospice's 24-hour line: (555) 555-0142, press 1 for the nurse line".

## Limits

- **A person's call is the evidence:** nothing dials automatically (that would need a telephony vendor
  under decision 18).
- **The seeded line "555-0100" doesn't pass the new format check**; it stays as seeded, and any change
  must be well formed.
- **Who re-confirms, and how the 90 days fits the hospice's routine,** is for the pilot hospice to
  agree (D-11, PB-15).
- **The old `after_hours_route` column remains** in the database, unused, so no data is dropped; a
  later migration can remove it.
- **No tap-to-call links** were added, so nothing claims a call connected.
