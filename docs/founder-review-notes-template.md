# Founder review notes

Copy this file for each review session (for example `founder-review-notes-2026-10-13.md`) and fill it in while following [founder-review-walkthrough.md](founder-review-walkthrough.md). Synthetic data only: refer to people by persona name and to records by what the screen shows.

**Session:** date · reviewer · environment (`zeporah-pilot-dev-personas`, reset before starting: yes/no) · walkthrough steps covered

## Decision-recording rule

**Feedback classified as `policy` or `permission` must not be implemented as a code change until a founder decision is recorded in [founder-decision-log.md](founder-decision-log.md).** The decision entry is written first; the change follows and links back to it.

`copy`, `workflow`, `defect` and `accessibility` items can go to an engineer directly. If one turns out to change who can see or do something, or a rule the founder owns, reclassify it as `permission` or `policy`.

## Classifications

| Classification | Use for                                                                                   | Goes to                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| copy           | Wording, labels, tone                                                                     | Engineer, with the exact replacement text                                                           |
| workflow       | Steps, order, what a screen asks for                                                      | Engineer, after the founder agrees the change                                                       |
| permission     | Who can see or do something                                                               | **Founder decision first**                                                                          |
| policy         | A rule the product enforces or a promise it makes (consent, retention, closure, cadence…) | **Founder decision first**, plus the partner hospice or legal/privacy if needed                     |
| defect         | Something doesn't work as built or documented                                             | Engineer                                                                                            |
| accessibility  | Keyboard, screen reader, zoom, contrast, focus                                            | Engineer; retest under the [manual accessibility protocol](manual-accessibility-review-protocol.md) |

## Severity

| Severity | Meaning                                                                 |
| -------- | ----------------------------------------------------------------------- |
| blocker  | Stops the review, or would mislead someone about data, access or safety |
| high     | Must be resolved before manual accessibility review or partner review   |
| medium   | Resolve before any pilot                                                |
| low      | Polish; schedule later                                                  |

## Observations

| #   | Screen / route | Persona | Observation | Classification | Severity | Proposed decision or follow-up | Owner | Status |
| --- | -------------- | ------- | ----------- | -------------- | -------- | ------------------------------ | ----- | ------ |
| 1   |                |         |             |                |          |                                |       | open   |
| 2   |                |         |             |                |          |                                |       | open   |
| 3   |                |         |             |                |          |                                |       | open   |

**Status values:** open · decision needed · decided (link to the log entry) · in progress · done (verified) · won't do (reason).

## After the session

1. Record `permission` and `policy` decisions in the founder decision log, with the date and reasoning.
2. Hand `copy`, `workflow`, `defect` and `accessibility` items to the engineer, with severity.
3. Resolve every blocker and high item before starting the manual accessibility sessions, so they test final screens.
4. Keep this file; it's the record of what was reviewed.
