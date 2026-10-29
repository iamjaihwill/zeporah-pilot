# Data flow (draft, 2026-10-29)

**Status: a draft for PB-04, not reviewed.** It describes the code at `main` (after `021d10e`) and,
separately, the planned hosted shape ([deployment.md](deployment.md)). Nothing is deployed and all
data is synthetic. Companions: [trust-boundaries.md](trust-boundaries.md) and
[threat-model.md](threat-model.md).

## Today (local development and the demo)

```text
 Family browser ─┐                                   ┌─ Development mailbox page (/dev/mail)
 Staff browser ──┼── HTTP, localhost ──► One process ├─ PGlite database (.data/pglite, plaintext files)
 Packet recipient┘   (no TLS locally)    TanStack     └─ Server output (structured error lines)
                                         Start + Vite
```

One process serves pages, static files and server functions. There is no outside service: every
integration adapter refuses calls (`tests/unit/integrations.test.ts`), and email goes only to the
`dev_mailbox` table where development sign-in is on.

## Who sends what

| Flow                        | From → to                | Carries                                                                               | Path                                                                            |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Sign-in                     | Browser → server         | Email and password (password sign-in) or a persona choice (development gate only)     | `auth.signInWithPassword`; session cookie `zp_session` back                     |
| Every request after sign-in | Browser → server         | The session cookie; the request's own input                                           | `src/start.ts` middleware, then a server function in `src/functions/*`          |
| Household reads             | Server → family browser  | The household's own tasks, thread, vault metadata, consents, contacts, notifications  | `familyScope` in `src/server/context.ts`                                        |
| Staff reads                 | Server → staff browser   | Assigned households (care guides), all households (operations, reviewers), queue rows | `staffScope`; every read logged in `staff_access_events` (decision 71)          |
| Family writes               | Family browser → server  | Messages, support requests, task updates, setup choices, consent confirmations        | Service + audit event in one transaction; messages and requests send once       |
| Staff writes                | Staff browser → server   | Updates, notes, tasks, assignments, consents, packets, enrollment, settings           | Same                                                                            |
| Packet release              | Staff → named recipient  | A released packet's manifest (read-only), after the 10-condition policy allows it     | `src/server/services/sharing.ts`; recipient signs in with a one-time setup link |
| Invitations                 | Inviter → invited person | A one-time link, shown once to the inviter, passed on by hand                         | `invitations`, `staff_invitations` (token stored as SHA-256)                    |
| Email (development only)    | Server → `dev_mailbox`   | Fixed wording and a link; no names, health details or message text                    | `src/server/services/outbox.ts`, `src/server/mail.ts`                           |
| Error reports               | Server → server output   | A reference, error type and message, short stack; query parameters dropped            | `src/server/observability.ts`                                                   |
| Reset (development only)    | Browser → server         | A snapshot choice                                                                     | Development gate only                                                           |

## Data stores

All in one database, one schema, every row carrying `tenant_id`. Record classes are proposed per
table in `src/domain/record-classes.ts` (pending D-05). The sensitive groups:

| Group                       | Tables (examples)                                                                        | Notes                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Identity and sessions       | `users`, `sessions`                                                                      | scrypt password hashes; session tokens stored as SHA-256      |
| Household coordination      | `households`, `memberships`, `tasks`, `messages`, `notifications`                        | Synthetic; would hold PHI in a pilot                          |
| Staff-only                  | `staff_notes`, `escalations`, `exception_claims`                                         | Never returned to a family payload (integration tests)        |
| Consent and authority       | `consents`, confirmations, `authority_evidence`, reviews                                 | Versioned; a reviewer activates one version only              |
| Sharing                     | `packets`, `packet_manifest_items`, `packet_recipient_access`, `packet_release_receipts` | Recipient access rechecked on every read                      |
| Audit                       | `audit_events` (hash-chained, append-only), `staff_access_events`                        | Append-only by trigger; the chain is checked on System status |
| Outbox and development mail | `outbox`, `dev_mailbox`                                                                  | Addresses kept after sending; links cleared once settled      |
| Holds                       | `retention_holds`                                                                        | Can't be deleted; released once with an authorization         |

## Planned hosted shape (not built)

From [deployment.md](deployment.md): browsers → managed load balancer (TLS, headers, request-size
and rate limits) → two or more stateless app instances in private subnets → managed Postgres
(encrypted, private only) and BAA-covered logs; secrets from a secrets manager; a staff identity
provider (D-03); an email provider only if D-06 says so. Each new hop is a new trust boundary in
[trust-boundaries.md](trust-boundaries.md).
