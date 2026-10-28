# Production-readiness decision register

Briefs for choices that only the founder, or an outside stakeholder through the founder, can make.
Nothing a brief covers is built until the founder records a decision in
[founder-decision-log.md](../founder-decision-log.md). Product-policy items stay in
[enterprise-decision-register.md](../enterprise-decision-register.md); this register covers
production readiness.

| ID   | Decision                                                               | Needed for                 | Brief                                                            | Status                      |
| ---- | ---------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------- | --------------------------- |
| D-01 | Source control, code hosting and CI (and permission to initialize git) | W1 · PB-01, PB-17          | [D-01-source-control.md](D-01-source-control.md)                 | Approved in principle → #64 |
| D-02 | Hosting provider, region and BAA posture                               | W3, W7 · PB-02, 03, 10, 14 | [D-02-hosting-and-baa.md](D-02-hosting-and-baa.md)               | Approved in principle → #65 |
| D-03 | Staff identity provider and mandatory MFA                              | W4 · PB-08                 | When W4 starts                                                   | Not yet written             |
| D-04 | Staff read-access logging: standard and visibility                     | W5 · PB-12                 | [D-04-staff-read-logging.md](D-04-staff-read-logging.md)         | Decided → #71               |
| D-05 | Retention and deletion (R-10)                                          | W5 · PB-11                 | When W5 starts                                                   | Not yet written             |
| D-06 | Whether the Stage 1 pilot includes email                               | W9 · PC-02                 | When W9 is considered                                            | Not yet written             |
| D-07 | Incident and breach roles in the hospice agreement                     | W6, W7 · PB-13, 14         | When W7 starts                                                   | Not yet written             |
| D-08 | Family account recovery and session length (decisions 9, 53)           | W4 · PC-05                 | When W4 starts                                                   | Not yet written             |
| D-09 | Minimum necessary for operations and reviewers                         | W4 · PC-04                 | When W4 starts                                                   | Not yet written             |
| D-10 | Pilot-cap enforcement behaviour (decision 16)                          | W8 · PB-15                 | When W8 starts                                                   | Not yet written             |
| D-11 | Support model and service expectations                                 | W8 · PB-15                 | When W8 starts                                                   | Not yet written             |
| D-12 | Accessibility commitment and validation threshold                      | W10 · PB-16                | When W10 starts                                                  | Not yet written             |
| D-13 | Release governance and production-change approval                      | W1 · PB-01                 | With D-01's build-out                                            | Not yet written             |
| D-14 | Permanent separation of demo, pilot and production                     | W3 · PB-02                 | With D-02's build-out                                            | Not yet written             |
| D-15 | A verified 24-hour clinical line                                       | PB-22 (proposed)           | [D-15-verified-clinical-line.md](D-15-verified-clinical-line.md) | Decided → #72               |
