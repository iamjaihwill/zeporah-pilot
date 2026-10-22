# Manual accessibility observation log — 2026-10-12, Safari + VoiceOver

Recorded from the reviewer's own observations while following [manual-accessibility-review-protocol.md](../manual-accessibility-review-protocol.md), using the structure of [manual-accessibility-observation-log-template.md](../manual-accessibility-observation-log-template.md). Synthetic data only.

> **Incomplete — partial manual review completed.**

No accessibility conformance, certification, or whole-prototype accessibility claim is supported by this partial review.

# Session Details

- Date/time: 2026-10-12 (time not recorded)
- Reviewer: Jay
- Browser/version: Safari (exact version not recorded)
- macOS version: not recorded
- VoiceOver on/off: on, for the VoiceOver checks below (tested with Safari)
- Keyboard navigation enabled (macOS): yes
- Safari Tab-navigation setting enabled ("Press Tab to highlight each item on a webpage"): yes
- Zoom or viewport method: not tested (no zoom or reflow checks performed)
- Synthetic seed reset completed: yes (reset before testing)
- Test environment URL: `http://localhost:3000`
- Any deviations from protocol: partial session only — the reviewer ended the session before completing the full protocol (see [Not tested](#not-tested)).

# Results Summary

- Blockers: none observed in the completed sample
- High findings: none observed in the completed sample
- Medium findings: none observed in the completed sample
- Low findings: none observed in the completed sample
- Observations: none recorded
- Screens not tested: see [Not tested](#not-tested)
- Overall result: **Incomplete — partial manual review completed.**

"None observed" applies only to the checks listed under [Completed checks](#completed-checks). It says nothing about the untested areas.

# Completed checks

## Keyboard only

| #   | Screen/workflow          | What was done and observed                                                                                                | Result                          |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| K1  | Start page               | Tab reached the "Sign in as Priya Raman" control; Return signed in as Priya.                                              | Passed in this completed sample |
| K2  | Staff coordination queue | Tab reached Coordination queue; the queue opened; Tab reached the queue filters and queue items.                          | Passed in this completed sample |
| K3  | Queue filter             | The "Consent correction" filter was activated; the filtered item remained reachable by keyboard.                          | Passed in this completed sample |
| K4  | Queue detail             | A queue detail page opened; keyboard navigation and visible focus continued to work.                                      | Passed in this completed sample |
| K5  | Staff dialog             | A dialog opened; keyboard focus stayed within the dialog; Escape closed it; focus returned to the control that opened it. | Passed in this completed sample |

## Safari + VoiceOver

| #   | Screen/workflow          | What was done and observed                                                                                    | Result                          |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| V1  | Start page               | VoiceOver announced "Sign in as Priya Raman, button."; the dashboard heading was reachable.                   | Passed in this completed sample |
| V2  | Staff coordination queue | The queue heading was discoverable; a named filter was discoverable.                                          | Passed in this completed sample |
| V3  | Queue item               | The queue link named both the item and the household; detail-page headings worked.                            | Passed in this completed sample |
| V4  | Staff dialog             | The dialog was announced; controls stayed within the dialog; Escape closed it; focus returned to the trigger. | Passed in this completed sample |

Not recorded for this sample: which queue item, which queue detail page, and which staff dialog were used.

# Not tested

These areas were **not tested** in this session and must not be treated as passed:

- Family consent and correction workflows
- Family Sharing and restricted-grantor paths
- Status notes
- 200% browser zoom
- Narrow-viewport reflow
- 400% browser zoom
- Grayscale / non-color priority recognition
- Duplicate-withdrawal error handling
- Bereavement transition and continuing-support workflows
- The remaining protocol test matrix and checklists
- iPhone VoiceOver spot check

**Reason stopped:** the reviewer ended the session before completing the full protocol.

**Follow-up:** resume from the Family Sharing / correction-dialog section during a future manual-review session.

# Findings

None recorded. No issues were observed in the completed sample.

# Sign-Off

- [x] Review used synthetic data only
- [x] No real personal or health information was entered
- [x] Findings reflect actual human observation (as reported by the reviewer)
- [x] No automated result was represented as manual testing
- [x] No WCAG or accessibility-conformance claim is made from this review alone

Reviewer name and date: Jay — 2026-10-12
