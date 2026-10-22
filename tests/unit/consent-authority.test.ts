import { describe, expect, it } from "vitest";
import { canSelfConfirm, consentStage } from "@/domain/consent";
import { compareHolders, effectiveAuthorityState } from "@/domain/authority-identity";

const NOW = new Date("2026-10-11T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("canSelfConfirm", () => {
  it("lets the patient confirm while living, never by inferring capacity from anything else", () => {
    expect(
      canSelfConfirm({ roles: ["patient"], lifecycle: "active_hospice", activeAuthorityTypes: [] }),
    ).toBe(true);
    expect(canSelfConfirm({ roles: ["patient"], lifecycle: "bereavement", activeAuthorityTypes: [] })).toBe(
      false,
    );
    expect(canSelfConfirm({ roles: ["patient"], lifecycle: "closed", activeAuthorityTypes: [] })).toBe(false);
  });

  it("never lets household membership alone confirm for someone else", () => {
    for (const role of ["coordinator", "proxy", "family_member"] as const)
      expect(
        canSelfConfirm({ roles: [role], lifecycle: "active_hospice", activeAuthorityTypes: [] }),
        role,
      ).toBe(false);
  });

  it("lets a proxy confirm only with an active authority workflow that applies at this stage", () => {
    expect(
      canSelfConfirm({
        roles: ["proxy"],
        lifecycle: "active_hospice",
        activeAuthorityTypes: ["healthcare_agent"],
      }),
    ).toBe(true);
    // A healthcare-agent workflow ends at death, so it can't confirm in bereavement.
    expect(
      canSelfConfirm({
        roles: ["coordinator"],
        lifecycle: "bereavement",
        activeAuthorityTypes: ["healthcare_agent"],
      }),
    ).toBe(false);
    expect(
      canSelfConfirm({
        roles: ["coordinator"],
        lifecycle: "bereavement",
        activeAuthorityTypes: ["personal_representative"],
      }),
    ).toBe(true);
  });
});

describe("consentStage", () => {
  const c = (patch: Partial<Parameters<typeof consentStage>[0]> = {}) =>
    consentStage({
      state: "active",
      version: 2,
      activatedVersion: 2,
      confirmedVersion: 2,
      startsAt: day(-1),
      expiresAt: day(10),
      grantorCanConfirm: true,
      now: NOW,
      ...patch,
    });

  it("is active only when the current version is both confirmed and activated", () => {
    expect(c()).toBe("active");
    expect(c({ startsAt: day(1) })).toBe("scheduled");
    expect(c({ confirmedVersion: 1 })).toBe("awaiting_confirmation");
    expect(c({ activatedVersion: 1, state: "draft" })).toBe("awaiting_activation");
  });

  it("routes to human review when the named grantor can't confirm, instead of auto-confirming", () => {
    expect(
      c({ state: "draft", confirmedVersion: null, activatedVersion: null, grantorCanConfirm: false }),
    ).toBe("needs_review");
  });

  it("treats withdrawal and expiry as final", () => {
    expect(c({ state: "revoked" })).toBe("revoked");
    expect(c({ expiresAt: NOW })).toBe("expired");
    expect(c({ state: "expired" })).toBe("expired");
  });
});

describe("authority holder identity", () => {
  it("compares linked people, never spellings", () => {
    expect(compareHolders({ holderActorId: "p1" }, { holderActorId: "p1" })).toBe("same");
    expect(compareHolders({ holderActorId: "p1" }, { holderActorId: "p2" })).toBe("different");
    expect(compareHolders({ holderActorId: null }, { holderActorId: "p1" })).toBe("unknown");
  });

  const ev = (
    id: string,
    state: string,
    holderActorId: string | null,
    authorityType = "healthcare_agent",
  ) => ({
    id,
    state,
    holderActorId,
    authorityType,
  });

  it("treats a spelling variation linked to the same person as the same holder", () => {
    // "Ada Okafor" and "Ada N. Okafor" both linked to p-ada: a clearer copy, not a conflict.
    const a = ev("e1", "workflow_active", "p-ada");
    const b = ev("e2", "review_pending", "p-ada");
    expect(effectiveAuthorityState(a, [a, b])).toBe("workflow_active");
  });

  it("lets a different-person conflict win", () => {
    const a = ev("e1", "workflow_active", "p-ada");
    const b = ev("e2", "conflict", "p-chidi");
    expect(effectiveAuthorityState(a, [a, b])).toBe("conflict");
  });

  it("fails closed when a record isn't linked to a person, or a rival can't be compared", () => {
    const unlinked = ev("e1", "workflow_active", null);
    expect(effectiveAuthorityState(unlinked, [unlinked])).toBe("identity_unresolved");
    const a = ev("e1", "workflow_active", "p-ada");
    const b = ev("e2", "review_pending", null);
    expect(effectiveAuthorityState(a, [a, b])).toBe("identity_unresolved");
  });

  it("ignores records of other types and records that are no longer live", () => {
    const a = ev("e1", "workflow_active", "p-ada");
    expect(effectiveAuthorityState(a, [a, ev("e2", "review_pending", null, "guardian")])).toBe(
      "workflow_active",
    );
    expect(effectiveAuthorityState(a, [a, ev("e3", "withdrawn", null)])).toBe("workflow_active");
  });
});
