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

## Addresses

The planned public addresses. **Status: planned, like staging and pilot; none is live.** The
pilot code supports the app and care split (`src/domain/addresses.ts`); the website is a separate
project (`zeporah-website`).

| Address                         | Purpose                                       | Served by                                      |
| ------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| `zeporah.co` / `www.zeporah.co` | Public website; one redirects to the other    | The website, not this app                      |
| `app.zeporah.co`                | Patient and family application                | This app (`ZEPORAH_APP_URL`)                   |
| `care.zeporah.co`               | Hospice team experience                       | This app, the same server (`ZEPORAH_CARE_URL`) |
| Restricted staging/demo address | Internal testing and synthetic demonstrations | This app; see "Staging and demo" below         |

**One server, two addresses.** The family app and the staff workspace already live in one app, so
`care.zeporah.co` needs no separate deployment: the same server answers on both addresses. Sign-in
cookies are tied to the address that set them, so a family session never travels to the care
address, or the other way round.

**Which page opens where:**

- App address: `/family`, `/helper`, `/create-account`, `/forgot-password`, `/reset`. Its root
  (`/`) is the family sign-in.
- Care address: `/staff`, `/staff-sign-in`, `/recipient` (outside recipients are professionals a
  hospice shares with). Its root redirects to `/staff-sign-in`.
- Either address: `/invite`, `/info`, assets and server functions.

A page opened on the wrong address is redirected (307) to the other one, keeping its query: by the
server for full page loads (`src/start.ts`) and in the browser for in-app navigation
(`src/routes/__root.tsx`). Requests that arrive on any other host name are left alone.

**Links sent outside Zeporah** name the right address (`publicUrl`): email links on the address
their page opens on (password resets and notices are family-only, so the app address; recipient
alerts the care address), household invitations on the app address, care-team invitations on the
care address.

**Configuration.** Set `ZEPORAH_APP_URL` and `ZEPORAH_CARE_URL` together, as origins only (for
example `https://app.zeporah.co`), https except on `localhost`. With neither set (local, test and
demo) nothing redirects and links stay paths. One without the other, a path, or the same address
twice stops the server at start-up (`assertEnvironment`). Behind the load balancer the original
host must arrive as `Host` or `X-Forwarded-Host`.

**Not in this app:** `www.zeporah.co` ↔ `zeporah.co` is a DNS and hosting redirect for the website,
and TLS certificates for each address belong to the edge ([deployment.md](deployment.md)).

### Staging and demo

The plan lists one restricted staging/demo address, but the rules above keep the two apart:
staging runs as a production build with the development gate **off**, while demo needs it **on**
(persona sign-in, the `/demo` launcher, the mail sink), and the gate is never on in a production
build. **Open decision:** either two restricted addresses (for example `staging.zeporah.co` and
`demo.zeporah.co`), or a deliberate change to how a hosted demo is allowed to run. Until then, a
staging address leaves `ZEPORAH_APP_URL` and `ZEPORAH_CARE_URL` unset or uses its own pair (for
example `app.staging.zeporah.co` and `care.staging.zeporah.co`), never the live ones.
