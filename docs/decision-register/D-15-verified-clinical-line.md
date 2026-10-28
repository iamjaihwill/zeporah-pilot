# D-15 · A verified 24-hour clinical line

**Status:** decided by the founder on 2026-10-28 as recommended (decision 72). For proposed pilot blocker PB-22
([brief-reconciliation-2026-10-27.md](../brief-reconciliation-2026-10-27.md) §4). Related: decision 19
(emergency notice on sign-in), decision 24 (reply time), decision 39 (administrators own the line).

## Decision to make

How Zeporah knows the hospice's 24-hour line shown to families is the right number and works, who
confirms it, and what families see while a change is being confirmed.

## Why it matters now

"Get help" is the most safety-critical text in Zeporah. A wrong number on it is a safety failure,
not a usability one: a family calling at night needs to reach the hospice's clinical after-hours
service. Today:

- **The line is free text** (up to 80 characters), set by an administrator and audited with before
  and after ([Code] `updateHospiceDetails` in `src/server/services/settings.ts`). Nothing checks its
  format, and nobody records that it was called and reached the right service.
- **It's shown live** on the family pages (home, messages, support, "My care"), the helper page and
  outside recipients' packets, through `organizationHotline`. The signed-out sign-in and create-account
  pages say "call 911 or your hospice's 24-hour line" without a number (decision 19).
- **There's a stale copy.** Each household's care record keeps its own text, "For anything urgent,
  call the hospice 24-hour line: …", written when the household was seeded or enrolled
  ([Code] `careCoordinationRecords.afterHoursRoute`). The staff record shows it under "After hours".
  If the administrator changes the line, those copies keep the old number, and a care guide could
  read it to a family. **This is a defect whatever is decided below.**
- **No backup route** exists for "if you can't get through".
- **No call is claimed:** there are no tap-to-call links, so nothing implies a call connected.

## Options for confirming the line

| Option                                                           | What it is                                                                                                                                                                                                                                                                                                                                                       | For                                                                                                           | Against                                                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **A. Two-person change with a recorded test call (recommended)** | An administrator proposes a new number; a second staff member (operations or another administrator, never the same person) calls it and records "reached the hospice's after-hours service", with the date. Only then does it replace the line families see. The line is re-confirmed every 90 days (proposed, unvalidated) and System status flags it when due. | A wrong number can't reach families by one person's typo; the evidence is a person's call, not a format check | Needs two people; the 90-day interval needs the hospice's agreement                                                     |
| B. One administrator attests                                     | The administrator ticks "I called it and it works" when saving                                                                                                                                                                                                                                                                                                   | Simple                                                                                                        | One person's mistake goes straight to families                                                                          |
| C. Automated check                                               | Zeporah places a test call or text                                                                                                                                                                                                                                                                                                                               | No human effort                                                                                               | Needs a telephony vendor (an integration under decision 18, BAA review); can't tell a clinical service from a voicemail |

## While a change is pending

| Option                                                                                  | For                                                     | Against                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep showing the last confirmed number until the new one is confirmed (recommended)** | Families never lose a working route; nothing goes blank | If the old number is the one that broke, it stays up until someone confirms the new one; System status shows "change waiting for confirmation" |
| Show the new number at once, marked unconfirmed                                         | Faster when the old number is dead                      | Families see a number nobody has tested                                                                                                        |
| Show only "call 911" until confirmed                                                    | Never shows an unconfirmed number                       | Removes the hospice route at exactly the wrong time                                                                                            |

## Also proposed (no decision needed, part of the same build)

- **One source of truth:** stop storing the line in each care record; show the live, confirmed line
  everywhere, including the staff record. Fixes the stale-copy defect.
- **Format check:** a US phone number with an optional extension and an optional short label (for
  example "555-0100, press 1 for the nurse line"); reject anything else.
- **Optional backup route:** a second number, shown as "If you can't get through: …", confirmed the
  same way.
- **No dialer claims:** if tap-to-call links are added later, the page never says a call connected.

## Impact

- **Safety:** a wrong or dead number can't reach families through one mistake; stale copies go.
- **Operations:** a small recurring task (re-confirming); an owner for it at the hospice.
- **Product:** administrators see a two-step change; families see nothing new unless a backup line is
  added.
- **Schedule:** about one increment: a confirmation record (who, when, how), the pending-change rule,
  format checks, the System status flag, removing the copy, tests.

## Default if no decision is made

The line stays unconfirmed free text, and the stale copy defect remains. Proposed PB-22 stays open.

## Exactly what the choice unlocks

- A migration for the confirmed line, its pending change and confirmation evidence.
- The two-person change and re-confirmation reminder in Hospice settings and System status.
- The single source of truth for the line across family, helper, recipient and staff pages.
- Tests: one person can't both propose and confirm; families keep the confirmed line while a change is
  pending; the format check; no stale copies remain.
