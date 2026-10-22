# Integration readiness

Zeporah has **no live integrations**, and none are simulated. The app has the internal boundaries a future integration would plug into, and nothing else.

- **Contracts:** [src/server/integrations/contracts.ts](../src/server/integrations/contracts.ts) defines the shape of each future connection.
- **Registry:** [src/server/integrations/registry.ts](../src/server/integrations/registry.ts) makes every adapter **not connected**. Calling one throws `IntegrationNotConnected`.
- **No sample data:** no stub returns sample data, so nothing can be mistaken for a real integration.
- **Status page:** **System status** lists every integration as "Not connected".
- **Development mail sink (decisions 23 and 27):**
  - Family email nudges and password-reset links go through [mail.ts](../src/server/mail.ts). It writes each email to the local `dev_mailbox` table, readable at `/dev/mail`, and delivers nothing.
  - It's on only where development sign-in is on. It isn't an integration, and the `MessageDeliveryAdapter` stays not connected.
  - Real email needs that adapter to pass the gates below. Until then the email options aren't offered outside development.
- **Guard tests** (`tests/unit/integrations.test.ts`) check two things:
  - no service, route or function calls an adapter;
  - nothing in `src/` opens an outbound connection (URL `fetch`, `http`/`https`/`net`/`tls` modules, third-party HTTP clients, or browser network APIs).

## Integration points

| Contract                                       | Would plug in at                                                                                                                                                                                                                                                               | What it may carry (minimum necessary)                                              | Rules                                                                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EhrAdapter` (census, status changes; inbound) | Household enrollment (seed-only today); bereavement **proposal**                                                                                                                                                                                                               | External id, patient name, enrollment date, admitted/discharged/deceased with time | **Proposes only.** A death notice may propose a bereavement transition; the existing two-person confirmation still applies. No clinical data.                                                   |
| `IdentityProviderAdapter` (OIDC/SAML)          | Staff sign-in (`/`), staff deactivation                                                                                                                                                                                                                                        | Verified subject and email; active/inactive                                        | Would replace local staff passwords. Deprovisioning maps to **Deactivate** (sessions end, access released).                                                                                     |
| `MessageDeliveryAdapter` (email/SMS/push)      | The `MailChannel` in [mail.ts](../src/server/mail.ts), used by [email-notices.ts](../src/server/services/email-notices.ts) (cadence and quiet hours already applied) and [password-reset.ts](../src/server/services/password-reset.ts). Email only for the pilot (decision 23) | Recipient address, channel, a **fixed-wording** title, an in-app link              | Same content rule as in-app notifications ([notifications-and-messaging.md](notifications-and-messaging.md)): no names, health details or message text.                                         |
| `PartnerDeliveryAdapter` (packet delivery)     | Packet release and revocation ([sharing.ts](../src/server/services/sharing.ts))                                                                                                                                                                                                | Exactly the released manifest: recipient, purpose, categories, expiry              | Only after the release check passes. Revocation can only **request** that the recipient stop; nothing is recalled. Release and revocation wording would change only after the delivery is real. |

## Rules for every adapter

- **Tenant-bound:** every call names the tenant and organization.
- **Audited:** the calling service records every exchange, success or failure.
- **No automatic decisions:** inbound data proposes; a person confirms.

## Before connecting any of them (production gates)

1. Vendor review, and a BAA where PHI is involved.
2. A security review and an updated data-flow diagram.
3. Secrets management, which doesn't exist yet. No keys may live in the repository.
4. Retry, timeout and failure handling designed with the operations runbook.
5. Explicit founder approval. Until then, no external service is called.
