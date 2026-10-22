# Zeporah Enterprise: deferred decision register

Status: **open, 2026-10-21.** These are the policy and permission questions held back from the
first enterprise release (decision 58). Under the standing rule, none of them is implemented as
code until the founder records a decision in
[founder-decision-log.md](founder-decision-log.md).

The **"Until decided"** column says what the build does meanwhile; it is always the more
restrictive option.

**Owner** is the person who records the decision. Where a decision needs outside advice, it's
named, but the founder still records it.

## Deferred by the founder on 2026-10-21

| ID   | Decision                                                                              | Owner                                                                                            | Risk of proceeding without it                                                                                                  | Smallest choice that unblocks future work                                                                                                | Until decided                                                                            |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| R-01 | Connect a live AI or external model                                                   | Founder, after an integration and security review (vendor, data boundary, retention, agreements) | Household data leaves the system with no agreed boundary; the demo implies a capability that doesn't exist                     | Allow one vendor for **synthetic data only** in the review environment, with no prompt or output retained by the vendor, and drafts only | Deterministic summaries and labelled synthetic drafts only                               |
| R-02 | Whether families see "prepared with Copilot" on messages they receive                 | Founder                                                                                          | Families may feel misled either way; it sets expectations for every future AI feature                                          | Decide one line: show it, or don't, on family-facing messages only                                                                       | Shown on the staff side and in the audit; families see the message from the staff member |
| R-03 | Automatic matching of inbound partner events to households                            | Founder                                                                                          | A wrong match discloses one household's information to another, which is a privacy breach                                      | Allow **suggested** matches only, which a person must confirm                                                                            | Staff enter events against a household themselves                                        |
| R-04 | Live system integrations or data feeds (EHR, hospital notifications, email-to-record) | Founder, after an integration review (see `integration-readiness.md`)                            | Real data enters a pilot built for synthetic data; production gates aren't met                                                 | Pick one feed type to design against, still simulated                                                                                    | Staff-entered events labelled simulated                                                  |
| R-05 | Telling families about temporary cover. **Decided → #62**                             | Founder                                                                                          | Families may contact an absent guide, or receive an unexplained message from someone new; or they may be told more than needed | One fixed sentence on the family Home ("{Name} is your care guide until {date} while {name} is away") with no reason given               | Families aren't told; the 24-hour line is unchanged                                      |
| R-06 | Two-administrator approval for role grants and irreversible organization changes      | Founder                                                                                          | One administrator can grant broad authority alone; but a hospice with one administrator would be locked out                    | Require a second administrator **only when the hospice has two or more**; otherwise require a reason and a 24-hour delay                 | Today's rule: one administrator, a reason, no self-elevation (decision 39)               |
| R-07 | A leadership role: what it sees and whether it exports                                | Founder                                                                                          | Aggregate views leak household detail in small hospices, where counts identify people                                          | Leadership sees Reports counts only, with small numbers (under 5) shown as "fewer than 5", and no export                                 | No leadership role                                                                       |
| R-08 | Sharing with a funeral home after a death                                             | Founder, with hospice compliance or legal advice                                                 | Sharing after death without the right person's agreement; or a family left without coordination at a hard moment               | Who confirms (the surviving contact?) and what may be shared (contact details and timing only)                                           | Not built; coordination happens by phone outside Zeporah                                 |
| R-09 | Authority and consent rules at the transition to bereavement                          | Founder, with legal advice                                                                       | The app implies a legal determination of whose authority continues                                                             | The workflow wording only: "Review active sharing at transition", with no automatic ending                                               | No new rules; existing transition behaviour                                              |
| R-10 | Retention policy changes                                                              | Founder, with compliance advice                                                                  | Records kept too short or too long; deletion can't be undone                                                                   | None needed for the demo; the retention review keeps counting only                                                                       | Unchanged: counts only, never deletes                                                    |
| R-11 | Any change to the four decision-1 confirmation messages                               | Founder                                                                                          | Changes what families agree to                                                                                                 | Not open. Listed so no story touches the wording by accident.                                                                            | Locked                                                                                   |

## Raised while specifying Record v2, Exceptions and Coverage

| ID   | Decision                                                            | Owner   | Risk of proceeding without it                                                                             | Smallest choice that unblocks future work                                                                                         | Until decided                                                                              |
| ---- | ------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| R-12 | What a covering care guide may open during cover. **Decided → #59** | Founder | Cover with too little access can't do the job; with too much, it is broader authority by default          | "The same as an assigned care guide, for the cover window only, ending automatically, and shown as Temporary in Who can see what" | Absence, offer and acceptance are built; access still comes only from permanent assignment |
| R-13 | Who may log a partner event. **Decided → #60**                      | Founder | Low; logging writes to the staff timeline only                                                            | Care guides (assigned or covering) and operations                                                                                 | Operations only                                                                            |
| R-14 | Whether a care guide may decline a handoff. **Decided → #61**       | Founder | Without declining, unwanted handoffs sit until they stall; with it, declines could hide workload problems | Yes, with a required reason, which goes to operations as a Stalled-handoff exception                                              | Accept only; a handoff not accepted stalls after the threshold                             |

## Raised by the family direction (2026-10-22)

| ID   | Decision                                                                                      | Owner   | Risk of proceeding without it                                                                                           | Smallest choice that unblocks future work                                                                                    | Until decided                         |
| ---- | --------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| R-19 | How Zeporah attributes family-visible content it posts or assembles itself. **Decided → #63** | Founder | Families can't tell what a person wrote from what Zeporah produced; the family view and the care team's record disagree | One attribution pattern for all automatic content: "Automatic notice" / "Put together automatically", sent for the care team | "Your care team" shown for the notice |

Other candidates raised in the family build memo (R-16 to R-18, R-20, R-21) aren't entered until
the founder asks for them.

## How a decision moves into the build

1. The founder records the answer in `founder-decision-log.md` with a number, the date and
   "Amends" where relevant.
2. This register marks the row **Decided → #nn**.
3. The plan's affected stories change from "Founder decision required" to "Approved—build".
4. The implementing change cites the decision number in its code comment and in its test name.

## R-05: decided (2026-10-22)

The founder chose option C: the household is told when cover becomes active, not when it's
accepted. See decision 62 in [founder-decision-log.md](founder-decision-log.md).

## R-19: decided (2026-10-22)

The founder chose option C: anything Zeporah posts or assembles for families says it's automatic,
sent for the care team, and never appears under a person's name or as "Your care team". It amends
decision 62's attribution only. See decision 63 in [founder-decision-log.md](founder-decision-log.md).
