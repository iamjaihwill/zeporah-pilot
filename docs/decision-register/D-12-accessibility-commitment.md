# D-12 · Accessibility commitment and validation threshold

**Status:** decided by the founder on 2026-10-28 as written (decision 73). Blocks PB-16 (W10). Related: PC-01
(English only), PB-15 (support and training).

## Decision to make

Which accessibility standard Zeporah commits to, what evidence is enough before real families and
staff use it in Stage 1, and what Zeporah may say about accessibility.

## Why it matters now

Families in hospice include older adults, people with low vision, tremor or hearing loss, and people
under acute stress; staff work fast on tablets. An inaccessible consent screen or "Get help" notice is a
safety and fairness problem, not polish. The evidence takes calendar time (recruiting, sessions,
fixes, re-runs), so the threshold has to be set before the pilot date is.

**Possible obligation on the hospice.** [Pending review] The U.S. Department of Health and Human
Services' 2024 rule under Section 504 of the Rehabilitation Act adopts WCAG 2.1 Level AA for the web
content and mobile apps of recipients of HHS financial assistance, including content provided through
contracts, with compliance dates in 2026 (larger recipients) and 2027 (smaller ones). A
Medicare-certified hospice is likely such a recipient, so Zeporah may be in scope as content the hospice
provides. **Counsel must confirm** whether and how this applies, and the hospice's procurement may ask
for evidence (for example an accessibility conformance report).

## What exists today

- **Built in:** semantic structure, keyboard operation, visible focus, labelled fields, live-region
  announcements, no color-only status, text-size preference, 200% reflow, reduced motion, 44 px targets
  ([accessibility.md](../accessibility.md)). [Code]
- **Automated:** axe-core with WCAG 2.0/2.1/2.2 A and AA rules on the family and staff pages, dialogs
  and phone layouts, plus keyboard paths ([Test] end-to-end suites, last run 2026-10-28, passing on
  the pages they open; they don't yet open listed contacts, enrollment, the access log or offline
  status: [evidence](../readiness/evidence/end-to-end-run-2026-10-28.md)).
- **Manual:** a protocol with severity definitions and exit criteria
  ([manual-accessibility-review-protocol.md](../manual-accessibility-review-protocol.md)), and one
  **partial** Safari and VoiceOver session on 2026-10-12, marked incomplete
  ([log](../accessibility-sessions/2026-10-12-manual-safari-voiceover.md)). Everything built since
  (enrollment, the access log, the 24-hour line card, send states) has had **no** manual review.
- **Not done:** sessions with disabled users or caregivers; any independent review; any conformance
  claim (none is made).

## Option 1: the standard

| Option                              | For                                                                                                                                                                                                         | Against                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **WCAG 2.2 Level AA (recommended)** | Current W3C recommendation; includes 2.1 AA, so it covers the likely Section 504 requirement; adds focus-not-obscured, target size and accessible authentication, which matter for older and stressed users | A little more to test than 2.1                                             |
| WCAG 2.1 Level AA                   | Matches the HHS rule's named standard exactly                                                                                                                                                               | Leaves out criteria that help this population; the app already aims at 2.2 |
| No named standard ("best effort")   | Least work                                                                                                                                                                                                  | Nothing to test against; weak with a hospice's procurement and counsel     |

## Option 2: evidence before Stage 1

| Option                                                         | What it is                                                                                                                                                                                                                                                                                                                                                                                         | For                                                                          | Against                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **A. Internal plus people plus an expert check (recommended)** | (1) The manual protocol completed on every critical workflow by two internal reviewers; (2) 5–8 sessions with people who use assistive technology and with family caregivers, on the critical workflows, with consent and synthetic data; (3) a desk review of those workflows by an independent accessibility specialist. Fix and re-run until no Blocker or High remains on a critical workflow. | Finds what automation and the team can't; proportionate for 10–25 households | Recruiting and paid sessions; some weeks                                |
| B. Internal only                                               | The protocol completed by two internal reviewers                                                                                                                                                                                                                                                                                                                                                   | Fast, no cost                                                                | Misses real users' barriers; weak evidence if the HHS rule applies      |
| C. Full third-party audit                                      | An external audit of the whole product against WCAG 2.2 AA, with a conformance report                                                                                                                                                                                                                                                                                                              | Strongest evidence; supports procurement                                     | Highest cost and lead time; more than Stage 1 needs, better for Stage 2 |

**Critical workflows** (proposed): sign-in and invitation acceptance; household setup; "Get help" and
the emergency notice; messages and support requests; tasks; consent confirmation and correction;
for staff, the exception queue, the household record, enrollment and the first invitation, consent
activation, and the 24-hour line card.

## What Zeporah may say

- **Recommended:** no conformance or compliance claim. After option 2A passes: "Designed to WCAG 2.2
  AA; reviewed with assistive-technology users and an independent specialist on these workflows, on
  <date>", with known gaps listed. Any conformance report only after option 2C.
- Never "accessible", "ADA compliant" or "WCAG compliant" as a blanket claim.

## Impact

- **People:** the families least able to work around barriers are the ones most likely to meet them.
- **Legal and commercial:** if the HHS rule applies, this is the hospice's obligation and likely a
  contract term; evidence helps the hospice and protects Zeporah. [Pending review]
- **Schedule:** option 2A is several weeks of calendar time (recruiting, sessions, fixes, re-run) and
  should start well before the pilot date. It needs a design lead (W10) and a budget for sessions and
  the specialist.
- **Product:** fixes land as normal increments; English-only (PC-01) stays a separate decision.

## Default if no decision is made

PB-16 stays open and Stage 1 can't pass; the 2026-10-12 review stays partial; nothing may be claimed.

## Exactly what the choice unlocks

- The critical-workflow list and the matrix rows added for everything built since 2026-10-12.
- A recruitment and consent plan for sessions (synthetic data only), and a brief for the specialist.
- A remediation tracker tied to PB-16's closure criterion ("no open critical accessibility finding on
  a critical workflow").
- The approved wording for what Zeporah says about accessibility.
