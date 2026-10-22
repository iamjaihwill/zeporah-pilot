/**
 * The integration registry. Every adapter is "not connected": calling it throws
 * IntegrationNotConnected, and no code path in the app calls one today. There is deliberately no
 * stub that returns sample data.
 */
import type { Adapters, IntegrationKey } from "./contracts";

export class IntegrationNotConnected extends Error {
  constructor(public key: IntegrationKey) {
    super(`The ${INTEGRATIONS[key].label} integration isn't connected.`);
    this.name = "IntegrationNotConnected";
  }
}

export const INTEGRATIONS: Record<IntegrationKey, { label: string; purpose: string }> = {
  ehr: { label: "EHR / hospice system", purpose: "Census and status changes (inbound, proposals only)" },
  identity: { label: "Identity provider", purpose: "Staff sign-in and deprovisioning" },
  messageDelivery: { label: "Out-of-app messages", purpose: "Email, SMS or push notices with fixed wording" },
  partnerDelivery: { label: "Partner delivery", purpose: "Delivering released packets to named recipients" },
};

/** A proxy whose every method refuses. */
function notConnected<K extends IntegrationKey>(key: K): Adapters[K] {
  return new Proxy({} as Adapters[K], {
    get: (_t, prop) =>
      typeof prop === "string" && prop !== "then"
        ? () => Promise.reject(new IntegrationNotConnected(key))
        : undefined,
  });
}

export const adapters: Adapters = {
  ehr: notConnected("ehr"),
  identity: notConnected("identity"),
  messageDelivery: notConnected("messageDelivery"),
  partnerDelivery: notConnected("partnerDelivery"),
};

/** For System status: every integration and its state (all "not connected"). */
export function integrationStatus() {
  return (Object.keys(INTEGRATIONS) as IntegrationKey[]).map((key) => ({
    key,
    label: INTEGRATIONS[key].label,
    purpose: INTEGRATIONS[key].purpose,
    connected: false as const,
  }));
}
