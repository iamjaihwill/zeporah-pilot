/**
 * Integration contracts: the shape of each future connection, written down before any exists.
 *
 * None of these is connected. There is no simulated or sample implementation — every adapter is
 * "not connected" and refuses calls (./registry.ts) — so nothing here can be mistaken for a real
 * integration. Connecting one is a production gate: vendor review, a BAA where PHI is involved,
 * security review, data-flow update, and explicit founder approval (docs/integration-readiness.md).
 *
 * Shared rules for every adapter:
 *  - minimum necessary: carry only the fields listed here; never free text from messages or notes;
 *  - tenant-bound: every call names the tenant and organization it acts for;
 *  - audited: the calling service writes an audit event for every exchange, success or failure;
 *  - no automatic decisions: inbound data proposes, a person confirms (e.g. a death notice proposes
 *    a bereavement transition; it never confirms one).
 */

export type IntegrationKey = "ehr" | "identity" | "messageDelivery" | "partnerDelivery";

/** EHR / hospice system of record (e.g. census and admission/discharge events). Inbound only. */
export interface EhrAdapter {
  /** Households the hospice has enrolled, by its own identifiers. Demographics minimal: names and enrollment date. */
  fetchCensus(input: { tenantId: string; organizationId: string }): Promise<
    {
      externalId: string;
      patientName: string;
      enrolledAt: Date;
      status: "admitted" | "discharged" | "deceased";
    }[]
  >;
  /** A single patient's status change, to *propose* a lifecycle change for a person to confirm. */
  fetchStatusChange(input: {
    tenantId: string;
    externalId: string;
  }): Promise<{ status: "admitted" | "discharged" | "deceased"; at: Date } | null>;
}

/** External identity provider (OIDC/SAML). Replaces local passwords for staff when connected. */
export interface IdentityProviderAdapter {
  /** Start a sign-in; returns where to send the browser. */
  beginSignIn(input: { tenantId: string; returnTo: string }): Promise<{ redirectUrl: string }>;
  /** Finish a sign-in from the provider's callback; returns a verified subject and email. */
  completeSignIn(input: {
    tenantId: string;
    callbackUrl: string;
  }): Promise<{ subject: string; email: string }>;
  /** Deprovisioning signal: a person left the organization (maps to staff deactivation). */
  isActive(input: { tenantId: string; subject: string }): Promise<boolean>;
}

/** Out-of-app message delivery (email/SMS/push). Content must follow the notification rules. */
export interface MessageDeliveryAdapter {
  /** Deliver a fixed-wording notice (never names, health details or message text) with an in-app link. */
  send(input: {
    tenantId: string;
    channel: "email" | "sms" | "push";
    to: string;
    title: string;
    link: string;
  }): Promise<{ providerMessageId: string }>;
}

/** Delivery of a released packet to its named recipient (e.g. a partner portal or secure fax). */
export interface PartnerDeliveryAdapter {
  /** Deliver exactly the released manifest; the release check has already passed. */
  deliver(input: {
    tenantId: string;
    packetId: string;
    recipientName: string;
    purpose: string;
    categories: string[];
    expiresAt: Date;
  }): Promise<{ deliveryId: string }>;
  /** Ask the recipient to stop using a revoked packet (a request; nothing can be recalled). */
  requestStop(input: { tenantId: string; packetId: string; deliveryId: string }): Promise<void>;
}

export type Adapters = {
  ehr: EhrAdapter;
  identity: IdentityProviderAdapter;
  messageDelivery: MessageDeliveryAdapter;
  partnerDelivery: PartnerDeliveryAdapter;
};
