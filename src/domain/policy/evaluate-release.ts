import { can } from "../permissions";
import { authorityAppliesIn } from "../lifecycle";
import {
  CARE_PERIOD_ONLY,
  type AuthorityState,
  type AuthorityType,
  type ConsentState,
  type LifecycleState,
  type PacketState,
  type RoleCode,
  type ShareCategory,
} from "../model";
import { REASONS, type Decision, type ReasonCode } from "./reason-codes";

export type ReleaseInput = {
  now: Date;
  actor: { id: string | null; tenantId: string | null; authenticated: boolean; roles: readonly RoleCode[] };
  packet: {
    id: string;
    tenantId: string;
    householdId: string;
    state: PacketState;
    purpose: string;
    recipientName: string;
    manifest: readonly ShareCategory[];
    expiresAt: Date;
  };
  household: { tenantId: string; lifecycle: LifecycleState };
  /** `identity_unresolved`: an authority record of this type isn't linked to a verified person. */
  authority: {
    tenantId: string;
    householdId: string;
    state: AuthorityState | "identity_unresolved";
    type: AuthorityType;
  } | null;
  consent: {
    tenantId: string;
    householdId: string;
    state: ConsentState;
    purpose: string;
    recipientName: string;
    scope: readonly ShareCategory[];
    startsAt: Date;
    expiresAt: Date;
    /** The household confirmed the current version AND a reviewer activated that same version. */
    confirmed: boolean;
    /** Someone asked for this consent to be corrected and a person hasn't resolved it yet. */
    correctionPending: boolean;
  } | null;
};

export type ReleaseDecision = {
  decision: Decision;
  reasonCode: ReasonCode;
  /** Safe to show to the person who asked. */
  explanation: string;
  /** For the audit log only. Never contains packet contents. */
  auditContext: {
    checks: { check: string; passed: boolean }[];
    packetId: string;
    actorId: string | null;
    evaluatedAt: string;
    detail?: Record<string, string | string[]>;
  };
};

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Decides whether a packet may be released. Pure: no I/O, no clock reads (pass `now`).
 *
 * Checks run in a fixed order and stop at the first failure, so a given situation always yields
 * the same reason code. The order follows the required gates:
 *   1 tenant · 2 authenticated actor · 3 role permission · (household open, packet releasable) ·
 *   4 purpose · 5 recipient · 6 non-empty scope (+ lifecycle narrowing) · 7 authority ·
 *   8 consent · 9 future expiry.
 * Gate 10 — the immutable audit event — is enforced by the caller, which writes the audit event in
 * the same transaction as the release and turns any failure into AUDIT_UNAVAILABLE (deny).
 *
 * There is no permissive fallback: every path that is not a full pass returns hold or deny.
 */
export function evaluateRelease(input: ReleaseInput): ReleaseDecision {
  const { now, actor, packet, household, authority, consent } = input;
  const checks: { check: string; passed: boolean }[] = [];
  const done = (reasonCode: ReasonCode, detail?: Record<string, string | string[]>): ReleaseDecision => ({
    decision: REASONS[reasonCode].decision,
    reasonCode,
    explanation: REASONS[reasonCode].explain,
    auditContext: {
      checks,
      packetId: packet.id,
      actorId: actor.id,
      evaluatedAt: now.toISOString(),
      ...(detail ? { detail } : {}),
    },
  });
  const check = (name: string, passed: boolean) => {
    checks.push({ check: name, passed });
    return passed;
  };

  // 1. Tenant: the actor, the household, and every linked record must share one tenant.
  if (
    !check(
      "tenant",
      actor.tenantId !== null && actor.tenantId === packet.tenantId && household.tenantId === packet.tenantId,
    )
  )
    return done("TENANT_MISMATCH");
  // 2. Authenticated actor.
  if (!check("authenticated", actor.authenticated && actor.id !== null)) return done("NOT_AUTHENTICATED");
  // 3. Explicit role permission.
  if (!check("role", can(actor.roles, "packet.release"))) return done("ROLE_NOT_PERMITTED");
  if (!check("household_open", household.lifecycle !== "closed")) return done("HOUSEHOLD_CLOSED");
  if (!check("packet_state", packet.state === "draft" || packet.state === "held"))
    return done("PACKET_NOT_RELEASABLE");
  // 4. Named purpose.
  if (!check("purpose", norm(packet.purpose).length > 0)) return done("PURPOSE_MISSING");
  // 5. Named recipient.
  if (!check("recipient", norm(packet.recipientName).length > 0)) return done("RECIPIENT_MISSING");
  // 6. Non-empty minimum-necessary scope, narrowed by lifecycle.
  if (!check("scope", packet.manifest.length > 0)) return done("SCOPE_EMPTY");
  if (household.lifecycle === "bereavement") {
    const narrowed = packet.manifest.filter((c) => CARE_PERIOD_ONLY.includes(c));
    if (!check("lifecycle_scope", narrowed.length === 0))
      return done("LIFECYCLE_SCOPE_NARROWED", { narrowed });
  }
  // 7. Active authority workflow.
  if (!check("authority_present", authority !== null)) return done("AUTHORITY_MISSING");
  if (
    !check(
      "authority_tenant",
      authority!.tenantId === packet.tenantId && authority!.householdId === packet.householdId,
    )
  )
    return done("TENANT_MISMATCH", { link: "authority" });
  if (!check("authority_state", authority!.state === "workflow_active")) {
    if (authority!.state === "conflict") return done("AUTHORITY_CONFLICT");
    if (authority!.state === "identity_unresolved") return done("AUTHORITY_IDENTITY_UNRESOLVED");
    if (authority!.state === "review_pending") return done("AUTHORITY_REVIEW_PENDING");
    return done("AUTHORITY_NOT_ACTIVE", { state: authority!.state });
  }
  if (!check("authority_lifecycle", authorityAppliesIn(authority!.type, household.lifecycle)))
    return done("AUTHORITY_ENDED_BY_LIFECYCLE", { type: authority!.type });
  // 8. Active, unexpired, non-revoked consent that matches this packet.
  if (!check("consent_present", consent !== null)) return done("CONSENT_MISSING");
  const c = consent!;
  if (!check("consent_tenant", c.tenantId === packet.tenantId && c.householdId === packet.householdId))
    return done("TENANT_MISMATCH", { link: "consent" });
  // An open correction request holds sharing before anything else about the consent is trusted.
  if (!check("consent_correction", !c.correctionPending)) return done("CONSENT_CORRECTION_PENDING");
  const consentLive = c.state === "active" && c.confirmed && c.expiresAt.getTime() > now.getTime();
  if (!check("consent_state", consentLive)) {
    if (c.state === "revoked") return done("CONSENT_REVOKED");
    if (c.state === "expired" || c.expiresAt.getTime() <= now.getTime()) return done("CONSENT_EXPIRED");
    if (!c.confirmed) return done("CONSENT_NOT_CONFIRMED");
    return done("CONSENT_NOT_ACTIVE", { state: c.state });
  }
  if (!check("consent_started", c.startsAt.getTime() <= now.getTime())) return done("CONSENT_NOT_STARTED");
  if (!check("consent_recipient", norm(c.recipientName) === norm(packet.recipientName)))
    return done("CONSENT_RECIPIENT_MISMATCH");
  if (!check("consent_purpose", norm(c.purpose) === norm(packet.purpose)))
    return done("CONSENT_PURPOSE_MISMATCH");
  const outside = packet.manifest.filter((m) => !c.scope.includes(m));
  if (!check("consent_scope", outside.length === 0)) return done("CONSENT_SCOPE_MISMATCH", { outside });
  // 9. Packet expiry in the future.
  if (!check("packet_expiry", packet.expiresAt.getTime() > now.getTime())) return done("PACKET_EXPIRED");

  return done("RELEASE_ALLOWED");
}
