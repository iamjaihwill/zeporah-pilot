# Zeporah — hospice coordination pilot (synthetic prototype)

> **Development environment only. All data is synthetic.** This is not production software, it is not HIPAA compliant, and it must not be used with real patient or family information. Zeporah is not monitored for emergencies and does not give clinical, legal or emergency advice. Authority status in Zeporah is a workflow state, not a legal determination.

Zeporah helps hospice teams and families coordinate approved next steps, tasks, and updates in one clear place. This repository is the pilot rebuild: a family/household app, a hospice staff workspace, and a controlled-sharing workflow (authority evidence, consent, minimum-necessary packets) on one local database with a fully synthetic dataset.

Product context and boundaries: [docs/product-context.md](docs/product-context.md). Approved founder decisions: [docs/founder-decision-log.md](docs/founder-decision-log.md). What remains before any pilot: [docs/pre-pilot-plan.md](docs/pre-pilot-plan.md).

## Run it locally

Requirements: [Bun](https://bun.sh) 1.4+. Nothing else — the database (PGlite, an embedded Postgres) runs inside the app process and stores its files in `.data/`.

```bash
bun install
bun run db:reset   # create .data/pglite and load the synthetic dataset
bun run dev        # http://localhost:3000
```

`bun run dev` turns on the development gate (`ZEPORAH_DEV_SIGN_IN=1`), so the start page offers **synthetic persona** sign-in (no passwords) for seeing each role, alongside real email-and-password sign-in. New accounts are created only through invitation links (see [docs/authentication-and-access.md](docs/authentication-and-access.md)). Use **Reset synthetic data** on the start page (or stop the server and run `bun run db:reset`) to return to the known starting state.

### Two ways to run it

| How                                                                                                                    | Development gate | What you see                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev`, or the preview configuration `zeporah-pilot-dev-personas` in [.claude/launch.json](.claude/launch.json) | On               | Persona sign-in and **Reset synthetic data**, plus email-and-password sign-in. Use this for the founder walkthrough and the manual accessibility review. |
| `bun --bun vite dev --port 3000`, or the preview configuration `zeporah-pilot`                                         | Off              | Email-and-password sign-in and invitation links only — the closest local view of a production sign-in. No personas and no reset.                         |

Both use the same local database (`.data/pglite`). The end-to-end tests start their own server with the gate on, on port 3100, with a separate database (see [playwright.config.ts](playwright.config.ts)). Nothing outside this repository is needed to run the app; editor or preview launch files elsewhere on your machine are not part of the baseline.

## Tests

```bash
bun run typecheck
bun run test              # unit + integration (Vitest, fresh in-memory database per test)
bunx playwright install chromium   # once, downloads the test browser
bun run test:e2e          # end-to-end flows in a real browser, with accessibility checks
bun run test:e2e:readonly # read-only incident mode, on its own server (ZEPORAH_READ_ONLY=1)
bun run test:e2e:verify   # persona sweep: every nav page × 5 widths, axe, keyboard order, review screenshots (own server)
bun run test:e2e:upgrade  # a database at an older schema version upgrades in place; every persona loads every page
```

## The development-data boundary

- Every person, hospice, household, phone number and record is invented ([src/fixtures/synthetic.ts](src/fixtures/synthetic.ts)) and labelled “(synthetic)” where it could be mistaken for real.
- No external services are called: no identity provider, email, SMS, push, EHR/FHIR, analytics, fonts CDN, cloud database or payment system. Notifications are in-app only.
- The vault stores document **metadata and review status only** — never files, clinical charts or legal originals.
- Packet “release” produces a receipt and an audit event. Nothing is transmitted anywhere.
- `.data/` is git-ignored and disposable.

## Where things are

| Path                                      | What it is                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/domain/`                             | Pure rules: roles and permissions, lifecycle, the packet-release policy evaluator and reason codes. No I/O. |
| `src/server/db/`                          | Schema (Drizzle), migrations, PGlite client, seed.                                                          |
| `src/server/context.ts`                   | Who is asking: actor, tenant, roles — and the scope guards every call goes through.                         |
| `src/server/audit.ts`                     | The only way to write an audit event (append-only, hash-chained).                                           |
| `src/server/services/`                    | Family, staff, sharing and notification operations.                                                         |
| `src/functions/`                          | The typed contract between screens and server (TanStack Start server functions).                            |
| `src/routes/`                             | Screens: `/family/*`, `/staff/*`, and the start page.                                                       |
| `tests/unit`, `tests/integration`, `e2e/` | Policy unit tests, service-level state-transition tests, browser flows.                                     |
| `docs/`                                   | Architecture, domain model, authorization and packet policy, API contract, accessibility, production gates. |

## Documentation

- [Architecture](docs/architecture.md)
- [Domain model](docs/domain-model.md)
- [Authorization and packet policy](docs/authorization-and-packet-policy.md)
- [API contract](docs/api-contract.md)
- [Synthetic data and scenarios](docs/synthetic-data.md)
- [Accessibility baseline](docs/accessibility.md)
- [Production-readiness gates (not met)](docs/production-readiness-gates.md)
