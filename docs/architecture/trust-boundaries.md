# Trust boundaries (draft, 2026-10-29)

**Status: a draft for PB-04, not reviewed.** Where data or control crosses from one level of trust
to another, what's checked at the crossing, and where that check lives. Companions:
[data-flow.md](data-flow.md) and [threat-model.md](threat-model.md).

## Today

| #   | Boundary                                  | Untrusted side                          | What's checked at the crossing                                                                                                                                                 | Where                                                                |
| --- | ----------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| B1  | Browser → server                          | Everything the browser sends            | Cross-site refusal on every change; security headers on every response; zod validation with length caps; the actor rebuilt from the session on every call                      | `src/start.ts`, `src/domain/same-origin.ts`, `src/functions/*`       |
| B2  | Signed out → signed in                    | Credentials, invitation and reset links | Constant-time scrypt check; one generic refusal; lockout after 10 failures; one-time hashed tokens with expiry; the account must match the invitation's email, tenant and kind | `src/server/services/auth.ts`, `src/server/auth/crypto.ts`           |
| B3  | Family ↔ staff                            | Each side's actor kind                  | Separate route trees; each layout's loader refuses the other kind; staff-only tables never read by family services                                                             | `src/routes/family/route.tsx`, `src/routes/staff/route.tsx`          |
| B4  | Household ↔ household, tenant ↔ tenant    | The record IDs in any request           | Scope guards on tenant, household, assignment and role; composite foreign keys with `tenant_id`; one refusal whether or not the record exists                                  | `src/server/context.ts`, `src/server/db/schema.ts`                   |
| B5  | Role ↔ role inside a household or hospice | The actor's roles                       | Default-deny permission matrices; lifecycle narrowing at bereavement and closure                                                                                               | `src/domain/permissions.ts`, `src/domain/lifecycle.ts`               |
| B6  | Hospice → named outside recipient         | The recipient                           | The 10-condition sharing policy; consent version activated by a different reviewer; access rechecked on every read; ends at expiry or revocation                               | `src/server/services/sharing.ts`, `src/server/services/recipient.ts` |
| B7  | App → audit record                        | The app itself (a bug, a bad change)    | Append-only triggers; per-tenant serialized hash chain; unique indexes refuse a fork; the chain check reports findings                                                         | `src/server/audit.ts`, migrations `0001`, `0024`, `0028`             |
| B8  | App → email                               | The recipient's inbox, and the wording  | Fixed wording only; checked again at send time; development mailbox only                                                                                                       | `src/server/services/outbox.ts`, `src/server/mail.ts`                |
| B9  | Development tools → everything            | A misconfigured server                  | Persona sign-in and reset only with `ZEPORAH_DEV_SIGN_IN=1` and not production; persona sessions refused once the gate is off                                                  | `src/server/auth/dev-gate.ts`                                        |
| B10 | App → server output                       | Whoever reads the logs                  | Structured lines with no request data; query parameters dropped                                                                                                                | `src/server/observability.ts`                                        |

## Added by the planned hosted shape (not built)

| #   | Boundary                            | Needed control                                                                                       | Tracker      |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ |
| H1  | Internet → load balancer            | TLS 1.2+, HSTS, request-size limit, network rate limits, static-file headers                         | PB-05, PB-07 |
| H2  | Load balancer → app                 | Trust `X-Forwarded-*` only from the load balancer; the Origin check repeated behind it               | PB-06        |
| H3  | App → managed Postgres              | Private network, TLS, least-privilege credentials, encryption at rest; isolation suite on the engine | PB-09, PB-10 |
| H4  | App → secrets manager               | Secrets read at start, rotated, never in images or the repository                                    | PB-02        |
| H5  | Staff → identity provider           | Mandatory MFA; termination ends access at once                                                       | PB-08, D-03  |
| H6  | App → logs and metrics provider     | BAA-covered; PHI-free by design                                                                      | PB-02, PB-14 |
| H7  | App → email provider (only if D-06) | BAA-covered; idempotent sends (closure plan §7.1)                                                    | D-06         |
| H8  | Demo ↔ pilot ↔ production           | Separate accounts and databases; no data path between them                                           | D-14         |
| H9  | Backups → restored database         | A restore never revives access or resends email (closure plan §7.5)                                  | PB-03        |
| H10 | Code host and CI → release          | Protected `main`, required review and CI, signed and scanned images deployed by digest               | PB-01, D-01  |
