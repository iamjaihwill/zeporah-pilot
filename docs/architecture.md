# Architecture

## Shape

One TypeScript application, run locally:

```text
Browser (React 19, TanStack Router)
   │  typed server-function calls (src/functions/*)        ← the API contract
   ▼
TanStack Start server (same process, Vite dev server)
   │  1. session cookie → actor            (src/server/session.ts)
   │  2. actor → context: tenant, roles     (src/server/context.ts)
   │  3. service checks scope + permission  (src/server/services/*)
   │  4. pure rules decide                  (src/domain/*)
   │  5. writes + audit in one transaction  (src/server/audit.ts)
   ▼
PGlite — embedded Postgres in .data/pglite (Drizzle ORM, SQL migrations)
```

There is no separate API server, no cloud database and no external service. The browser never queries the database; every read and write goes through a server function that rebuilds the actor's context from the database.

## Stack and why

| Choice                                                   | Why                                                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, React 19, TanStack Start/Router, Tailwind v4 | Carried over from the earlier Zeporah prototype, so the team's existing knowledge and UI patterns still apply. Start gives typed server functions, which act as the route/API contract.     |
| PGlite + Drizzle                                         | A real Postgres (constraints, triggers, transactions, composite foreign keys) with zero setup and no service to run. Moving to hosted Postgres later is a connection change, not a rewrite. |
| Bun                                                      | Fast installs and test runs; the only tool a developer needs.                                                                                                                               |
| Vitest, Playwright, axe-core                             | Unit and integration tests against a fresh in-memory database; browser flows with automated accessibility checks.                                                                           |
| No UI kit dependency                                     | A small set of local components (`src/components/ui.tsx`) built on native elements (`<dialog>`, `<details>`, form controls) keeps keyboard and screen-reader behavior predictable.          |
| System fonts                                             | No font CDN request. The design system's serif/sans pairing is approximated with local font stacks.                                                                                         |

## Layers and rules

- **`src/domain/`** is pure: no database, no clock (time is passed in), no I/O. The policy evaluator, permissions and lifecycle rules live here and are unit-tested exhaustively.
- **`src/server/services/`** are plain async functions `(db, ctx, input)`. They are what the integration tests call directly, and what the server functions wrap. Every service:
  - starts with a scope guard (`familyScope`, `staffScope`, `requireStaffPermission`), which checks tenant, assignment and permission;
  - filters every query by `ctx.tenantId`;
  - writes its changes, notifications and audit event in one transaction.
- **`src/functions/`** are thin: validate input with zod, resolve the session, call a service, return plain data. Errors from services are `AccessError`s with a stable code and a safe message.
- **Routes** load data through server functions in route loaders and call `router.invalidate()` after any change, so every visible counter — unread notifications, vault counts, task counts, activity — is re-read from the server. This is how “update everywhere” works without client-side duplicated state.

## Family vs staff separation

- Family and staff routes live under `/family/*` and `/staff/*` with separate layouts; each layout's loader refuses the other kind of actor.
- Internal staff notes are in their own table and are read only by staff services; integration tests assert that no family-facing payload contains note text.
- Family-visible updates and messages are visually and structurally distinct from internal notes in the staff workspace (“Visible to the household” vs “Care team only” labels and colors).

## Development-only pieces

- **Persona sign-in** (`/`): pick a synthetic actor. Only behind the development gate (`ZEPORAH_DEV_SIGN_IN=1`, not production); real accounts sign in with email and password ([authentication-and-access.md](authentication-and-access.md)).
- **Reset synthetic data**: a dev-only server function closes the shared database, deletes the local data directory, migrates and reseeds. Same gate.
- Both are listed as gates to replace in [production-readiness-gates.md](production-readiness-gates.md).

## Data flow for the critical linked state

| Action                               | Writes                                                                                                             | Who sees the change                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Finish an onboarding step            | `onboarding_steps`, preferences/invitations, audit (`family`)                                                      | Dashboard setup card and gated actions; on the last step the lifecycle moves to active, the care guide is notified |
| Review a vault item                  | `vault_items`, audit (`family` or `protected`), notifications to others who can see the item and to the care guide | Dashboard vault counts and activity; notification badges everywhere                                                |
| Send a message (family)              | `messages`, audit, notifications to the care guide and other thread readers                                        | Thread, dashboard activity, staff queue, badges                                                                    |
| Post a family-visible update (staff) | `family_updates`, audit, notifications to the household                                                            | Thread, dashboard “updates”, acknowledgement queue                                                                 |
| Mark notifications read              | `notifications.read_at`                                                                                            | Every badge (shared count, re-read on navigation)                                                                  |
| Request release                      | audit (always), packet state, receipt or escalation                                                                | Packet page, policy board, queue, household sharing view                                                           |
| Withdraw consent                     | consent state, held packets, audit (`sharing`), notifications                                                      | Family sharing page, staff household and packets                                                                   |
| Confirm bereavement                  | lifecycle, memberships, authority, consents, packets, care record, tasks, audit, notifications                     | Everything the household and staff see                                                                             |

## Times and time zones

Timestamps are stored in UTC. Screens render them in one named display zone, `PILOT_DISPLAY.timeZone` ([src/domain/display-config.ts](../src/domain/display-config.ts)), so the server and the browser produce identical text and React never has to rebuild a page after it loads. This synthetic pilot is a single Georgia hospice, so the configured default is `America/New_York`, shown as “ET”. That is a pilot setting, not a universal rule: supporting hospices in more than one state needs a per-tenant display zone — and, for families, a per-person zone — before any multi-state use.

Every time on screen is absolute. Auditable events use the full form with year and zone (`stamp()` / `<Stamp full />`); everyday coordination uses the shorter “Oct 8, 4:25 PM”. Relative wording (“3 hours ago”) is not used, because it changes after the page loads and can't serve as a record.
