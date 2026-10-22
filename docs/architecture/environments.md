# Environment matrix

Every environment is named on purpose (`ZEPORAH_ENVIRONMENT`), and data never moves from a real
environment into a synthetic one. **Status: local, test and demo exist; staging, pilot and
production are planned (decision 65) and don't exist yet.**

| Environment | Purpose                                | Data                                  | Database                               | Development gate                | Who has access                                                          | Exists             |
| ----------- | -------------------------------------- | ------------------------------------- | -------------------------------------- | ------------------------------- | ----------------------------------------------------------------------- | ------------------ |
| Local       | Development                            | Synthetic only                        | PGlite (`.data/pglite`)                | On (`bun run dev`)              | The developer                                                           | Yes                |
| Test        | Automated suites                       | Synthetic only, reset per test        | PGlite, one isolated folder per suite  | On, test servers only           | CI                                                                      | Yes                |
| Demo        | Founder and partner demos              | Synthetic only, forever (D-14)        | PGlite (`.data/review-pglite`)         | On                              | Presenters                                                              | Yes                |
| Staging     | Release checks on the target platform  | Synthetic only                        | Managed Postgres, encrypted            | **Off** (`NODE_ENV=production`) | Engineering                                                             | Planned            |
| Pilot       | Stage 1, one hospice, 10–25 households | Real PHI, only after the Stage 1 gate | Managed Postgres, encrypted, backed up | **Off**                         | Named staff and families; engineering by break-glass only (if approved) | Planned            |
| Production  | Stage 2 and later                      | Real PHI                              | As pilot, highly available             | **Off**                         | As pilot                                                                | Not before Stage 2 |

## Rules

- **The development gate is off wherever `NODE_ENV=production`** (`src/server/auth/dev-gate.ts`),
  and the server refuses to start in production without `ZEPORAH_ENVIRONMENT`
  (`src/server/environment.ts`). Staging and pilot run as production builds.
- **No copying down.** Pilot data is never copied to staging, demo, test or local. Bugs are
  reproduced with synthetic data.
- **Separate everything.** Staging and pilot sit in separate cloud accounts or projects, with
  separate databases, secrets, keys and access lists.
- **Promotion:** local → CI → staging → pilot, one tagged release at a time
  ([release-governance.md](../release-governance.md)). Demo is never a step in promotion.
