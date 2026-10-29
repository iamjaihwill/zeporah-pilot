# Monitoring and alerting plan (planned)

**Status: a plan (W7). Today the app writes one structured line per unexpected error to stdout,
with a reference and no request data (`src/server/observability.ts`): approved fields only, never
an error's message (threat T19, correction L1). Nothing collects or alerts
on it.**

## Principles

- **No PHI in telemetry.** No names, message or note text, household names, or URLs with record IDs
  beyond opaque identifiers. The current error line writes no message text at all; every new
  signal is reviewed against this rule before it ships.
- **Only BAA-covered tooling** for anything that could, by mistake, carry PHI (decision 65).
- **Alerts go to a person on call** (W7 on-call rota), with a runbook link in every alert.

## Signals and proposed alerts

| Signal          | Source                                                                       | Alert when (proposal)                             | Severity                             |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------ |
| Availability    | Load-balancer health checks; an external uptime check of the sign-in page    | Down for 2 minutes                                | Page                                 |
| Error rate      | Error lines per minute (by reference count)                                  | More than 5 a minute for 5 minutes                | Page                                 |
| Latency         | Request duration at the load balancer                                        | 95th percentile above 2 seconds for 10 minutes    | Ticket                               |
| Sign-in abuse   | Lockouts and failed sign-ins (already audited as `auth.locked`)              | 20 lockouts in 10 minutes, or a spike per network | Page                                 |
| Audit integrity | A scheduled run of the hash-chain verification (System status uses it today) | Any break                                         | Page, and start the incident runbook |
| Read-only mode  | `ZEPORAH_READ_ONLY` on                                                       | Always (so nobody forgets it's on)                | Ticket                               |
| Database        | Managed metrics: connections, storage, replication, backup success           | Backup failed; storage above 80%                  | Page / ticket                        |
| Certificates    | Expiry                                                                       | 21 days before                                    | Ticket                               |
| Dependencies    | `scripts/check-audit.ts` in CI                                               | An unrecorded or expired advisory                 | Blocks merge                         |

## Open questions

- Which BAA-covered log and metrics services (with decision 65's provider).
- On-call rota and hours (D-11, W7).
- Confirm thresholds after the first weeks of staging traffic.
