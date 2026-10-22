# D-02 · Hosting provider, region and BAA posture

**Status:** approved in principle by the founder on 2026-10-22 (decision 65). Blocks W3 and W7 (PB-02, PB-03, PB-10) and part
of W6 (PB-14).

## Decision to make

Which hosting platform and managed Postgres the staging and pilot environments run on, in which US
region, under what business associate arrangements.

## Why it matters now

The pilot can't run on the embedded PGlite database (single process, plaintext files, no managed
backups). Encryption, backups, monitoring, secrets, the header policy and the real-engine tenant
tests all depend on where Zeporah runs. The hosting provider would be a subcontractor handling PHI.

## BAA posture (to confirm with counsel)

- The hospice is the covered entity. Zeporah would act as its **business associate**, under a BAA
  with the hospice.
- Every vendor that stores or can access PHI for Zeporah (hosting, database, backups, logs,
  identity provider, email if chosen) needs a **subcontractor BAA** with Zeporah before any PHI.
- Vendor claims about HIPAA support are claims until the signed BAA and the vendor's
  shared-responsibility terms are reviewed. [Pending review]

## Options

| Option                                                      | What it is                                                                                                                                                                                                | For                                                                            | Against                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **A. Major cloud provider with a signed BAA (recommended)** | Managed Postgres with encryption, point-in-time recovery and automated backups; a managed container service; a secrets manager; logs and alerting, all in one US region and covered by the provider's BAA | Mature controls, one BAA, clear shared-responsibility model, scales to Stage 3 | More to configure well; needs infrastructure as code and care to stay within BAA-eligible services |
| B. A healthcare-focused hosting platform                    | A platform that packages compliant defaults and signs a BAA                                                                                                                                               | Faster to a reviewed setup; fewer moving parts                                 | Less control; costs; check its database, backup and logging coverage under the BAA                 |
| C. Self-managed servers                                     | Virtual machines running Postgres and the app                                                                                                                                                             | Lowest unit cost                                                               | Patching, encryption, backups and monitoring all on the team; the hardest to evidence              |

## Recommendation

**Option A**, limited to services named in the provider's BAA, in one US region chosen with the
hospice's state in mind. Infrastructure as code in the repository (after D-01). Staging and pilot
in separate accounts or projects; the synthetic demo stays where it is, permanently separate
(D-14).

## Impact

- **Security:** encryption at rest and in transit by default; managed keys; network isolation;
  the basis for PB-05, PB-07 and PB-09.
- **Privacy:** PHI stays within BAA-covered services; no PHI in non-covered tools.
- **Operations:** someone owns the account, billing, access and alerts (W7).
- **Product:** a move from PGlite to managed Postgres. Drizzle uses the same Postgres dialect, but
  the driver changes and every suite must pass on the real engine, including concurrency
  (the advisory lock and unique-index guards were only proven on PGlite).
- **Schedule:** the critical path for Stage 1; vendor review and BAA signature can take weeks.

## Default if no decision is made

No staging or pilot environment exists; PB-02, PB-03, PB-09 and PB-10 stay blocked, and W7 can't
start.

## Exactly what the choice unlocks

- An architecture and environment matrix (`architecture/deployment.md`, `architecture/environments.md`).
- The Postgres driver switch and a real-engine CI job.
- Staging with synthetic data only; the pilot environment after the BAAs are signed.
- Backup configuration and the first restore drill (PB-03).
