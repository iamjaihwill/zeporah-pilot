# Deployment architecture (planned)

**Status: a plan, approved in principle (decision 65). Nothing is deployed.** A major cloud
provider, Stage 1 limited to services covered by that provider's BAA, one US region. Vendor-neutral
until the provider is chosen; the open questions at the end must be answered before it's final.

## Shape

```
 Family phones and browsers          Hospice staff (desktop, tablet)
            │  HTTPS only (TLS 1.2+, HSTS)          │
            ▼                                       ▼
 ┌───────────────────────── Edge: managed load balancer / TLS termination ─────────────────────────┐
 │  Security headers (PB-05), request-size limits, network rate limits (PB-07)                     │
 └──────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                │ private network
                     ┌──────────────────────────▼──────────────────────────┐
                     │  Zeporah app: one container image per tagged release │
                     │  2+ instances, stateless; NODE_ENV=production;       │
                     │  ZEPORAH_ENVIRONMENT named; development gate off     │
                     └───────┬──────────────────────┬──────────────────────┘
                             │ TLS, private only     │ logs (no PHI) and metrics
                 ┌───────────▼───────────┐   ┌───────▼─────────────────────────┐
                 │ Managed Postgres       │   │ Managed logs, metrics, alerts    │
                 │ encrypted at rest      │   │ (BAA-covered; PHI-free by design) │
                 │ PITR, automated backups│   └──────────────────────────────────┘
                 └───────────────────────┘
   Secrets manager → app at start (database credentials, session and future identity-provider keys)
   Identity provider for staff MFA (W4, decision D-03) · Email provider only if D-06 says so (W9)
```

## Decisions inside the plan

| Topic           | Plan                                                                                                                                                      | Why                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Compute         | Managed containers, two or more instances in one region across zones                                                                                      | No servers to patch; survives one instance or zone failing                                        |
| Database        | Managed Postgres, encryption at rest with provider-managed keys (customer-managed keys considered), TLS required, private network only                    | Replaces single-process PGlite (PB-02, PB-10)                                                     |
| Database driver | Drizzle's Postgres driver in place of PGlite; the same schema and migrations                                                                              | The dialect is unchanged; every suite must pass on the real engine before staging is used (PB-09) |
| Migrations      | Applied by a one-off release step before new instances start; reviewed in the pull request; a downgrade fixture or a written forward-fix plan for each    | Never applied by hand on the pilot database                                                       |
| Secrets         | The provider's secrets manager; read at start; rotation path documented; nothing in images, repository or environment files                               | PB-02, decision 64                                                                                |
| Network         | App and database in private subnets; only the load balancer is public; administration through the provider's audited access, never a public database port | Smallest attack surface                                                                           |
| Session store   | Postgres (as today); rate-limit counters in Postgres or a BAA-covered cache                                                                               | Shared across instances (PB-07)                                                                   |
| Images          | Built in CI from a tag; scanned; deployed by digest                                                                                                       | Reproducible and traceable releases                                                               |
| Accounts        | Staging and pilot in separate accounts or projects; demo stays local and synthetic (D-14)                                                                 | No path from synthetic to real data                                                               |

## What changes in the code (later, under a freeze lift)

- The database client (`src/server/db/client.ts`) gains a Postgres driver path; PGlite stays for
  local, test and demo.
- Concurrency guards proven only on PGlite (advisory lock, unique-index once-only inserts, guarded
  state updates) are re-tested on Postgres.
- A health endpoint for the load balancer (no data, no PHI).

None of this is started; it needs the freeze lifted for W3.

## Open questions before the hosting choice is final

| #   | Question                                                                                                                                                    | Who answers                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | Which provider, and which of its services are listed in its BAA (compute, database, backups, logs, secrets, load balancer)?                                 | Founder, with the vendor; counsel reviews the BAA |
| 2   | Which US region, given the pilot hospice's state and any state data-location expectations?                                                                  | Founder, hospice sponsor; counsel                 |
| 3   | Is Zeporah the hospice's business associate, and does the hospice's own policy require anything extra (for example, customer-managed keys or audit access)? | Counsel, hospice privacy officer                  |
| 4   | Do logs and metrics stay inside BAA-covered services, and is PHI kept out of them by design (the app logs no request data today)?                           | Engineering, privacy and security officer         |
| 5   | Who owns the cloud account, billing and break-glass access?                                                                                                 | Founder (with D-13)                               |
| 6   | Are the provider's support staff able to reach data, and under what terms?                                                                                  | Vendor, counsel                                   |
