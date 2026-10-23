# Local CI run, 2026-10-22

`sh scripts/ci.sh` on the initial commit (`936cb77`, tag `demo-baseline-2026-10-22`) plus the
rollback-drill evidence file, on the development Mac. Same checks, same order, as
`.github/workflows/ci.yml`. **This isn't the hosted CI run PB-01 requires**: no code host is
named yet, so the workflow itself hasn't run.

| Step                           | Result                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Type-check                     | Passes                                                                                  |
| Formatting                     | Clean apart from 15 frozen-baseline exceptions (`docs/readiness/format-exceptions.txt`) |
| Documentation links            | 44 files, no broken relative links                                                      |
| Readiness tracker              | Consistent: 26 items, 17 of 17 pilot blockers open; Stage 1 gate not passed             |
| Frozen baseline                | All 403 files match                                                                     |
| Migrations                     | `drizzle-kit check`: no problems                                                        |
| Dependency advisories          | 8 known advisories, all recorded with an owner and expiry (2026-11-21)                  |
| Unit and integration           | 65 files, 493 of 493 passed                                                             |
| End-to-end                     | 187 passed, 1 skipped                                                                   |
| Read-only mode                 | 2 passed                                                                                |
| Upgrade and downgrade          | 10 passed                                                                               |
| Verify (macOS pixel baselines) | 22 passed, 12 skipped (screenshot runs, on request)                                     |

Overall: exit code 0, "All checks passed." Synthetic data only; every server and database was
isolated; the development database was not touched.
