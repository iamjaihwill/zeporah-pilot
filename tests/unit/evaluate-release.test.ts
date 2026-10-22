import { describe, expect, it } from "vitest";
import { evaluateRelease, type ReleaseInput } from "@/domain/policy/evaluate-release";
import { REASONS, type ReasonCode } from "@/domain/policy/reason-codes";

const NOW = new Date("2026-10-11T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

/** A packet that passes every check. Each test changes one thing. */
function base(): ReleaseInput {
  return {
    now: NOW,
    actor: { id: "a-ops", tenantId: "t1", authenticated: true, roles: ["hospice_ops"] },
    packet: {
      id: "p1",
      tenantId: "t1",
      householdId: "h1",
      state: "draft",
      purpose: "Coordinate a respite placement",
      recipientName: "Brightwater Respite House",
      manifest: ["contact_details", "visit_schedule"],
      expiresAt: day(7),
    },
    household: { tenantId: "t1", lifecycle: "active_hospice" },
    authority: { tenantId: "t1", householdId: "h1", state: "workflow_active", type: "healthcare_agent" },
    consent: {
      tenantId: "t1",
      householdId: "h1",
      state: "active",
      purpose: "Coordinate a respite placement",
      recipientName: "Brightwater Respite House",
      scope: ["contact_details", "visit_schedule", "vault_status"],
      startsAt: day(-1),
      expiresAt: day(30),
      confirmed: true,
      correctionPending: false,
    },
  };
}

type Patch = (i: ReleaseInput) => void;
const run = (patch: Patch) => {
  const i = base();
  patch(i);
  return evaluateRelease(i);
};

describe("evaluateRelease", () => {
  it("allows a packet that passes every check, and records each check", () => {
    const r = evaluateRelease(base());
    expect(r.decision).toBe("allow");
    expect(r.reasonCode).toBe("RELEASE_ALLOWED");
    expect(r.auditContext.checks.every((c) => c.passed)).toBe(true);
    expect(r.auditContext.checks.map((c) => c.check)).toContain("packet_expiry");
  });

  const cases: [string, ReasonCode, Patch][] = [
    ["actor from another tenant", "TENANT_MISMATCH", (i) => void (i.actor.tenantId = "t2")],
    ["household in another tenant", "TENANT_MISMATCH", (i) => void (i.household.tenantId = "t2")],
    ["authority linked from another tenant", "TENANT_MISMATCH", (i) => void (i.authority!.tenantId = "t2")],
    ["consent linked from another household", "TENANT_MISMATCH", (i) => void (i.consent!.householdId = "h9")],
    ["unauthenticated actor", "NOT_AUTHENTICATED", (i) => void (i.actor.authenticated = false)],
    ["care guide (insufficient role)", "ROLE_NOT_PERMITTED", (i) => void (i.actor.roles = ["care_guide"])],
    [
      "family coordinator (insufficient role)",
      "ROLE_NOT_PERMITTED",
      (i) => void (i.actor.roles = ["coordinator"]),
    ],
    ["external recipient role", "ROLE_NOT_PERMITTED", (i) => void (i.actor.roles = ["external_recipient"])],
    ["closed household", "HOUSEHOLD_CLOSED", (i) => void (i.household.lifecycle = "closed")],
    ["already released packet", "PACKET_NOT_RELEASABLE", (i) => void (i.packet.state = "released")],
    ["revoked packet", "PACKET_NOT_RELEASABLE", (i) => void (i.packet.state = "revoked")],
    ["blank purpose", "PURPOSE_MISSING", (i) => void (i.packet.purpose = "   ")],
    ["blank recipient", "RECIPIENT_MISSING", (i) => void (i.packet.recipientName = "")],
    ["empty manifest", "SCOPE_EMPTY", (i) => void (i.packet.manifest = [])],
    [
      "care-period category after bereavement",
      "LIFECYCLE_SCOPE_NARROWED",
      (i) => {
        i.household.lifecycle = "bereavement";
        i.authority!.type = "personal_representative";
      },
    ],
    ["no authority", "AUTHORITY_MISSING", (i) => void (i.authority = null)],
    ["authority conflict", "AUTHORITY_CONFLICT", (i) => void (i.authority!.state = "conflict")],
    [
      "authority holder identity unresolved",
      "AUTHORITY_IDENTITY_UNRESOLVED",
      (i) => void (i.authority!.state = "identity_unresolved"),
    ],
    [
      "authority review pending",
      "AUTHORITY_REVIEW_PENDING",
      (i) => void (i.authority!.state = "review_pending"),
    ],
    ["authority withdrawn", "AUTHORITY_NOT_ACTIVE", (i) => void (i.authority!.state = "withdrawn")],
    ["authority superseded", "AUTHORITY_NOT_ACTIVE", (i) => void (i.authority!.state = "superseded")],
    [
      "healthcare agent after death",
      "AUTHORITY_ENDED_BY_LIFECYCLE",
      (i) => {
        i.household.lifecycle = "bereavement";
        i.packet.manifest = ["contact_details"];
      },
    ],
    ["no consent", "CONSENT_MISSING", (i) => void (i.consent = null)],
    ["revoked consent", "CONSENT_REVOKED", (i) => void (i.consent!.state = "revoked")],
    ["consent marked expired", "CONSENT_EXPIRED", (i) => void (i.consent!.state = "expired")],
    ["consent past its expiry date", "CONSENT_EXPIRED", (i) => void (i.consent!.expiresAt = day(-1))],
    ["consent expiring exactly now", "CONSENT_EXPIRED", (i) => void (i.consent!.expiresAt = NOW)],
    ["draft consent", "CONSENT_NOT_ACTIVE", (i) => void (i.consent!.state = "draft")],
    [
      "active consent without a confirmation of its current version",
      "CONSENT_NOT_CONFIRMED",
      (i) => void (i.consent!.confirmed = false),
    ],
    [
      "an open correction request on an otherwise active consent",
      "CONSENT_CORRECTION_PENDING",
      (i) => void (i.consent!.correctionPending = true),
    ],
    [
      "draft consent without confirmation",
      "CONSENT_NOT_CONFIRMED",
      (i) => {
        i.consent!.state = "draft";
        i.consent!.confirmed = false;
      },
    ],
    ["consent not yet started", "CONSENT_NOT_STARTED", (i) => void (i.consent!.startsAt = day(2))],
    [
      "different recipient",
      "CONSENT_RECIPIENT_MISMATCH",
      (i) => void (i.packet.recipientName = "Another Agency"),
    ],
    ["different purpose", "CONSENT_PURPOSE_MISMATCH", (i) => void (i.packet.purpose = "Marketing")],
    [
      "category outside consent",
      "CONSENT_SCOPE_MISMATCH",
      (i) => void (i.packet.manifest = ["contact_details", "authority_status"]),
    ],
    ["packet expired", "PACKET_EXPIRED", (i) => void (i.packet.expiresAt = day(-1))],
    ["packet expiring exactly now", "PACKET_EXPIRED", (i) => void (i.packet.expiresAt = NOW)],
  ];

  it.each(cases)("%s → %s", (_name, code, patch) => {
    const r = run(patch);
    expect(r.reasonCode).toBe(code);
    expect(r.decision).toBe(REASONS[code].decision);
    expect(r.decision).not.toBe("allow");
    expect(r.explanation).toBe(REASONS[code].explain);
    expect(r.auditContext.checks.at(-1)?.passed).toBe(false);
  });

  it("checks tenant before anything else, so a wrong-tenant request reveals nothing about the packet", () => {
    const r = run((i) => {
      i.actor.tenantId = "t2";
      i.actor.authenticated = false;
      i.consent = null;
      i.packet.manifest = [];
    });
    expect(r.reasonCode).toBe("TENANT_MISMATCH");
    expect(r.auditContext.checks).toEqual([{ check: "tenant", passed: false }]);
  });

  it("treats a role check as necessary but not sufficient", () => {
    const r = run((i) => void (i.consent!.state = "revoked"));
    expect(r.auditContext.checks.find((c) => c.check === "role")?.passed).toBe(true);
    expect(r.decision).toBe("hold");
  });

  it("matches purpose and recipient ignoring case and spacing only", () => {
    expect(run((i) => void (i.packet.recipientName = "  brightwater   respite house ")).decision).toBe(
      "allow",
    );
  });

  it("allows bereavement-safe sharing under a personal representative", () => {
    const r = run((i) => {
      i.household.lifecycle = "bereavement";
      i.authority!.type = "personal_representative";
      i.packet.manifest = ["bereavement_contact"];
      i.consent!.scope = ["bereavement_contact"];
    });
    expect(r.decision).toBe("allow");
  });

  it("every reason code has a decision and a non-empty explanation", () => {
    for (const [code, r] of Object.entries(REASONS)) {
      expect(["allow", "hold", "deny"], code).toContain(r.decision);
      expect(r.explain.length, code).toBeGreaterThan(20);
    }
    expect(Object.values(REASONS).filter((r) => r.decision === "allow")).toHaveLength(1);
  });
});
