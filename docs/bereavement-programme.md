# Bereavement follow-up programme

Zeporah supports families for **13 months** after a death. When a household's bereavement transition is confirmed (two people, as before), a follow-up plan of planned **check-ins** is created. Check-ins are human contacts the care team makes outside Zeporah; Zeporah never contacts anyone itself.

## The plan (founder-approved default; decision 10)

Defined in [src/domain/bereavement.ts](../src/domain/bereavement.ts). Every household currently gets the same plan. A hospice's own bereavement programme should eventually configure it.

| Step                       | Due (after confirmation) | Family sees                   |
| -------------------------- | ------------------------ | ----------------------------- |
| First check-in             | 14 days                  | In the first few weeks        |
| One-month check-in         | 30 days                  | Around one month              |
| Three-month check-in       | 91 days                  | Around three months           |
| Six-month check-in         | 182 days                 | Around six months             |
| Nine-month check-in        | 273 days                 | Around nine months            |
| First-anniversary check-in | 365 days                 | Around the first anniversary  |
| Closing conversation       | 395 days                 | Near the end of the 13 months |

Support ends 13 months after confirmation. The household doesn't close automatically. Operations closes it from the household's **Lifecycle** tab (**Close household…**, with a staff-only reason; also possible earlier, with a warning). A closed household is read-only under the existing closed-state rules, and its open check-ins leave the workload. The family isn't sent anything (founder decision: whether and how to tell them).

## Staff

- **Bereavement follow-up** (`/staff/bereavement`) lists open check-ins in the bereavement households you can see, under the usual rule (care guides: assigned households; operations and reviewers: the whole hospice).
  - They're grouped as **Due earlier — still open**, **Due this week**, **Due this month** and **Later**. The wording is never "overdue".
  - Each shows the assigned care guide, and a side panel counts what's due within a month per guide.
- On the household **Overview**, the **Bereavement follow-up** card lists every step. Anyone whose role manages care-team tasks can **Record** a check-in:
  - **Outcome:** talked with the family, left a message, they'd rather not be contacted, or not needed.
  - **Note:** optional and staff-only.
  - **Rules:** each step is recorded once; only while the household is in bereavement support; audited as `bereavement.check_in_recorded`. The note isn't copied into the audit summary.
- If any check-in records **"They'd rather not be contacted"**, the household's remaining check-ins are flagged everywhere ("Asked not to be contacted"). Nothing is cancelled automatically (founder decision below).

## Family

**Continuing support** shows "What to expect from your care team": each step in plain words, with **Done** or **Planned**, and the date support ends. Families never see outcomes or notes.

## Database

`bereavement_contacts`: one row per transition and step (unique). CHECK constraints keep `step`, `status` and `outcome` to known values, and require that a done check-in records its outcome, when, and by whom.

## Founder decisions (approved 2026-10-12; see the [decision log](founder-decision-log.md))

| Decision                               | Approved                                   | Alternatives considered                         |
| -------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Steps and timing                       | The table above                            | Hospice-configured plans per organization       |
| After "They'd rather not be contacted" | Flag the remaining steps; a person decides | Automatically mark remaining steps "not needed" |
| A family opt-out on their own page     | Not built (they tell their care team)      | A family-side "please don't contact me" control |
| Closing the household at 13 months     | Manual                                     | A prompt to operations when support ends        |
