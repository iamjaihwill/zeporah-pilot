import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as sharing from "@/server/services/sharing";
import * as s from "@/server/db/schema";
import { CONSENT_CONFIRMATION_METHOD, CONSENT_CONFIRMATION_STATEMENT } from "@/domain/consent";
import { REVOCATION_NOTE } from "@/domain/claims";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const day = (n: number) => new Date(Date.now() + n * 86_400_000);
const RESPITE = {
  purpose: "Coordinate a short respite stay",
  recipientName: "Brightwater Respite House (synthetic)",
};
const terms = (patch: Partial<Parameters<typeof sharing.recordConsent>[2]> = {}) => ({
  householdId: "hh-okafor",
  grantedByActorId: "fm-grace",
  ...RESPITE,
  scope: ["contact_details", "visit_schedule"] as ("contact_details" | "visit_schedule" | "vault_status")[],
  startsAt: day(-1),
  expiresAt: day(20),
  revocationPath: "Withdraw any time in Zeporah under Sharing.",
  ...patch,
});

/** Record a consent and a packet that relies on it, as the household's care guide. */
async function consentAndPacket(patch: Partial<ReturnType<typeof terms>> = {}, recorder = "st-maya") {
  const who = await t.as(recorder);
  const { id: consentId } = await sharing.recordConsent(t.db, who, terms(patch));
  const maya = await t.as("st-maya");
  const pk = await sharing.createPacket(t.db, maya, {
    householdId: "hh-okafor",
    ...RESPITE,
    consentId,
    authorityEvidenceId: "ev-okafor-ada",
    expiresAt: day(5),
    categories: ["contact_details"],
  });
  return { consentId, packetId: pk.id };
}
const stageOf = async (actorId: string, consentId: string) =>
  (await family.listHouseholdConsents(t.db, await t.as(actorId))).find((c) => c.id === consentId)!;
const release = async (packetId: string) => sharing.requestRelease(t.db, await t.as("st-dana"), packetId);

describe("consent: record → household confirmation → separate activation", () => {
  it("walks the three stages, auditing the confirmation, and only then allows release", async () => {
    const { consentId, packetId } = await consentAndPacket();
    expect((await stageOf("fm-grace", consentId)).stage).toBe("awaiting_confirmation");
    expect(await release(packetId)).toMatchObject({ decision: "hold", reasonCode: "CONSENT_NOT_CONFIRMED" });

    // Only the named grantor can confirm, and only the version they saw.
    await expect(
      family.confirmConsent(t.db, await t.as("fm-daniel"), { consentId, version: 1 }),
    ).rejects.toThrow(/Only the person named/);
    const grace = await t.as("fm-grace");
    await expect(family.confirmConsent(t.db, grace, { consentId, version: 2 })).rejects.toThrow(/changed/);
    await family.confirmConsent(t.db, grace, { consentId, version: 1 });
    await expect(family.confirmConsent(t.db, grace, { consentId, version: 1 })).rejects.toThrow();
    expect((await stageOf("fm-grace", consentId)).stage).toBe("awaiting_activation");
    expect(await release(packetId)).toMatchObject({ decision: "hold", reasonCode: "CONSENT_NOT_ACTIVE" });

    const [conf] = await t.db
      .select()
      .from(s.consentConfirmations)
      .where(eq(s.consentConfirmations.consentId, consentId));
    expect(conf).toMatchObject({
      actorId: "fm-grace",
      consentVersion: 1,
      method: CONSENT_CONFIRMATION_METHOD,
      statement: CONSENT_CONFIRMATION_STATEMENT,
    });
    expect(conf!.confirmedAt).toBeInstanceOf(Date);
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.subjectId, consentId), eq(s.auditEvents.action, "consent.confirmed")));
    expect(ev).toMatchObject({ actorId: "fm-grace" });
    expect(ev!.context).toMatchObject({
      consentVersion: 1,
      method: CONSENT_CONFIRMATION_METHOD,
      statement: CONSENT_CONFIRMATION_STATEMENT,
    });

    // A care guide can't activate; a reviewer who didn't record it can.
    await expect(sharing.activateConsent(t.db, await t.as("st-maya"), consentId)).rejects.toThrow();
    await sharing.activateConsent(t.db, await t.as("st-priya"), consentId);
    expect((await stageOf("fm-grace", consentId)).stage).toBe("active");
    const activated = await t.db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.subjectId, consentId), eq(s.auditEvents.action, "consent.activated")));
    expect(activated).toHaveLength(1);
    expect(await release(packetId)).toMatchObject({ decision: "allow" });
  });

  it("won't let the person who recorded a consent activate it", async () => {
    const { consentId } = await consentAndPacket({}, "st-priya");
    await family.confirmConsent(t.db, await t.as("fm-grace"), { consentId, version: 1 });
    const priya = await t.as("st-priya");
    await expect(sharing.activateConsent(t.db, priya, consentId)).rejects.toThrow(/different reviewer/);
    const row = (await sharing.listConsents(t.db, priya, "hh-okafor")).consents.find(
      (c) => c.id === consentId,
    )!;
    expect(row.activateBlockedReason).toMatch(/different reviewer/);
    const queue = await sharing.reviewQueue(t.db, priya);
    expect(queue.consents.find((c) => c.id === consentId)).toMatchObject({
      recordedByMe: true,
      canActivate: false,
    });
  });

  it("invalidates confirmation and activation on any material change", async () => {
    const { consentId, packetId } = await consentAndPacket();
    await family.confirmConsent(t.db, await t.as("fm-grace"), { consentId, version: 1 });
    await sharing.activateConsent(t.db, await t.as("st-priya"), consentId);
    expect(await release(packetId)).toMatchObject({ decision: "allow" });

    const maya = await t.as("st-maya");
    const base = terms();
    const changes: [string, Partial<typeof base>][] = [
      ["scope", { scope: ["contact_details", "visit_schedule", "vault_status"] }],
      ["start", { startsAt: day(-2) }],
      ["expiry", { expiresAt: day(25) }],
      ["revocation terms", { revocationPath: "Tell your care guide." }],
    ];
    let version = 1;
    let current = base;
    for (const [what, patch] of changes) {
      current = { ...current, ...patch };
      await sharing.amendConsent(t.db, maya, { consentId, ...current });
      version++;
      const c = await stageOf("fm-grace", consentId);
      expect(c.version, what).toBe(version);
      expect(c.stage, what).toBe("awaiting_confirmation");
      expect(c.confirmation, what).toBeNull();
      const [row] = await t.db.select().from(s.consents).where(eq(s.consents.id, consentId));
      expect(row!.activatedVersion, what).toBeNull();
      // The earlier confirmation is kept for history, but doesn't count for the new version.
      expect(
        await t.db
          .select()
          .from(s.consentConfirmations)
          .where(eq(s.consentConfirmations.consentId, consentId)),
      ).toHaveLength(version - 1);
      await family.confirmConsent(t.db, await t.as("fm-grace"), { consentId, version });
      await sharing.activateConsent(t.db, await t.as("st-priya"), consentId);
    }
    // Purpose and recipient changes also count; the packet no longer matches, so it's held either way.
    await sharing.amendConsent(t.db, maya, { consentId, ...current, purpose: "A different purpose" });
    expect((await stageOf("fm-grace", consentId)).stage).toBe("awaiting_confirmation");
    expect(await release(packetId)).toMatchObject({ decision: "hold" });
    await expect(
      sharing.amendConsent(t.db, maya, { consentId, ...current, purpose: "A different purpose" }),
    ).rejects.toThrow(/Nothing changed/);
  });

  it("lets a proxy confirm only with an active authority workflow; otherwise it's held for human review", async () => {
    const withAuthority = await consentAndPacket({ grantedByActorId: "fm-ada" });
    expect((await stageOf("fm-ada", withAuthority.consentId)).stage).toBe("awaiting_confirmation");
    await family.confirmConsent(t.db, await t.as("fm-ada"), {
      consentId: withAuthority.consentId,
      version: 1,
    });
    expect((await stageOf("fm-ada", withAuthority.consentId)).stage).toBe("awaiting_activation");

    for (const grantor of ["fm-chidi", "fm-daniel"]) {
      const { consentId, packetId } = await consentAndPacket({ grantedByActorId: grantor });
      // Chidi can't even open Sharing; Daniel can, but may not confirm. Read the stage from the staff view.
      const row = (await sharing.listConsents(t.db, await t.as("st-maya"), "hh-okafor")).consents.find(
        (c) => c.id === consentId,
      )!;
      expect(row.stage, grantor).toBe("needs_review");
      expect(row.activateBlockedReason, grantor).toMatch(/can't confirm in the app/);
      await expect(
        family.confirmConsent(t.db, await t.as(grantor), { consentId, version: 1 }),
        grantor,
      ).rejects.toThrow();
      const esc = await t.db
        .select()
        .from(s.escalations)
        .where(and(eq(s.escalations.sourceId, consentId), eq(s.escalations.kind, "consent_review")));
      expect(esc, grantor).toHaveLength(1);
      await expect(sharing.activateConsent(t.db, await t.as("st-priya"), consentId)).rejects.toThrow();
      expect(await release(packetId)).toMatchObject({
        decision: "hold",
        reasonCode: "CONSENT_NOT_CONFIRMED",
      });
    }
  });

  it("follows the lifecycle: a personal representative can confirm during bereavement", async () => {
    const tom = await t.as("st-tom");
    const { id } = await sharing.recordConsent(t.db, tom, {
      householdId: "hh-lindqvist",
      grantedByActorId: "fm-ingrid",
      purpose: "Share a memorial-service contact",
      recipientName: "Willow Creek Bereavement Circle (synthetic)",
      scope: ["bereavement_contact"],
      startsAt: day(-1),
      expiresAt: day(30),
      revocationPath: "Withdraw any time in Zeporah under Sharing.",
    });
    expect((await stageOf("fm-ingrid", id)).stage).toBe("awaiting_confirmation");
    await family.confirmConsent(t.db, await t.as("fm-ingrid"), { consentId: id, version: 1 });
    expect((await stageOf("fm-ingrid", id)).stage).toBe("awaiting_activation");
  });

  it("refuses a grantor who isn't a current household member", async () => {
    await expect(
      sharing.recordConsent(t.db, await t.as("st-maya"), terms({ grantedByActorId: "fm-claire" })),
    ).rejects.toThrow(/current member/);
  });

  it("withdraws on the household's request with the exact revocation wording, holding dependent packets", async () => {
    const priya = await t.as("st-priya");
    await expect(
      sharing.revokeConsentOnRequest(t.db, priya, { consentId: "cs-okafor-respite", reason: "" }),
    ).rejects.toThrow(/who asked/);
    await sharing.revokeConsentOnRequest(t.db, priya, {
      consentId: "cs-okafor-respite",
      reason: "Grace asked by phone (synthetic).",
    });
    expect(await release("pk-okafor-respite")).toMatchObject({
      decision: "hold",
      reasonCode: "CONSENT_REVOKED",
    });
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(
        and(eq(s.auditEvents.subjectId, "cs-okafor-respite"), eq(s.auditEvents.action, "consent.revoked")),
      );
    expect(ev!.summary).toContain(REVOCATION_NOTE);
  });
});

describe("authority holder identity", () => {
  it("treats a spelling variation linked to the same person as a clearer copy, not a conflict", async () => {
    const r = await sharing.submitEvidence(t.db, await t.as("st-maya"), {
      householdId: "hh-okafor",
      holderName: "Ada N. Okafor",
      holderActorId: "fm-ada",
      authorityType: "healthcare_agent",
      documentLabel: "Second copy with middle initial (synthetic)",
    });
    expect(r.conflict).toBe(false);
    expect(await release("pk-okafor-respite")).toMatchObject({ decision: "allow" });
  });

  it("treats a record naming a different linked person as a conflict", async () => {
    const r = await sharing.submitEvidence(t.db, await t.as("st-maya"), {
      householdId: "hh-okafor",
      holderName: "Ada Okafor", // same spelling, different person
      holderActorId: "fm-chidi",
      authorityType: "healthcare_agent",
      documentLabel: "A record linked to Chidi (synthetic)",
    });
    expect(r.conflict).toBe(true);
    expect(await release("pk-okafor-respite")).toMatchObject({
      decision: "hold",
      reasonCode: "AUTHORITY_CONFLICT",
    });
  });

  it("fails closed on an unlinked holder until a reviewer links it with a basis, keeping link history", async () => {
    const maya = await t.as("st-maya");
    const priya = await t.as("st-priya");
    const r = await sharing.submitEvidence(t.db, maya, {
      householdId: "hh-okafor",
      holderName: "A. Okafor",
      holderActorId: null,
      authorityType: "healthcare_agent",
      documentLabel: "Copy with initials only (synthetic)",
    });
    const unknownId = r.evidenceId;

    // Release and protected access are held; an identity review is open; the rival can't be activated.
    expect(await release("pk-okafor-respite")).toMatchObject({
      decision: "hold",
      reasonCode: "AUTHORITY_IDENTITY_UNRESOLVED",
    });
    expect(
      (await family.listVault(t.db, await t.as("fm-ada"))).items.some((i) => i.sensitivity === "protected"),
    ).toBe(false);
    const open = () =>
      t.db
        .select()
        .from(s.escalations)
        .where(and(eq(s.escalations.kind, "identity_review"), eq(s.escalations.householdId, "hh-okafor")));
    expect((await open()).filter((e) => e.status !== "resolved")).toHaveLength(1);
    await expect(
      sharing.reviewEvidence(t.db, priya, {
        evidenceId: unknownId,
        outcome: "workflow_active",
        rationale: "ok",
      }),
    ).rejects.toThrow();
    const listed = (await sharing.listAuthority(t.db, priya, "hh-okafor")).evidence;
    expect(listed.find((e) => e.id === "ev-okafor-ada")!.effectiveState).toBe("identity_unresolved");

    // A documented basis needs a note; a care guide can't link.
    await expect(
      sharing.linkEvidenceHolder(t.db, priya, {
        evidenceId: unknownId,
        actorId: "fm-ada",
        basis: "reviewer_documented",
        note: " ",
      }),
    ).rejects.toThrow(/documented basis/);
    await expect(
      sharing.linkEvidenceHolder(t.db, maya, {
        evidenceId: unknownId,
        actorId: "fm-ada",
        basis: "household_confirmation",
        note: "",
      }),
    ).rejects.toThrow();
    await sharing.linkEvidenceHolder(t.db, priya, {
      evidenceId: unknownId,
      actorId: "fm-ada",
      basis: "household_confirmation",
      note: "Ada confirmed the initials copy is hers (synthetic).",
    });
    expect((await open()).every((e) => e.status === "resolved")).toBe(true);
    expect(await release("pk-okafor-respite")).toMatchObject({ decision: "allow" });

    // Re-linking keeps the earlier link, marked superseded, and a different person now conflicts.
    await sharing.linkEvidenceHolder(t.db, priya, {
      evidenceId: unknownId,
      actorId: "fm-chidi",
      basis: "reviewer_documented",
      note: "Signature matches Chidi on review (synthetic).",
    });
    const links = (await sharing.listAuthority(t.db, priya, "hh-okafor")).evidence.find(
      (e) => e.id === unknownId,
    )!.links;
    expect(links).toHaveLength(2);
    expect(links.filter((l) => l.superseded).map((l) => l.person)).toEqual(["Ada Okafor"]);
    expect(links.find((l) => !l.superseded)).toMatchObject({
      person: "Chidi Okafor",
      basis: "reviewer_documented",
    });
    const after = (await sharing.listAuthority(t.db, priya, "hh-okafor")).evidence;
    expect(after.find((e) => e.id === "ev-okafor-ada")!.effectiveState).toBe("conflict");
    const audit = await t.db
      .select()
      .from(s.auditEvents)
      .where(
        and(eq(s.auditEvents.subjectId, unknownId), eq(s.auditEvents.action, "authority.identity_linked")),
      )
      .orderBy(desc(s.auditEvents.seq));
    expect(audit).toHaveLength(2);
    expect(audit[0]!.summary).toMatch(/not a legal determination/);
  });
});

describe("policy board matches the running app", () => {
  it("labels each constructed row by source, and runtime rows equal what requestRelease returns", async () => {
    const dana = await t.as("st-dana");
    const { packets, constructed } = await sharing.policyScenarios(t.db, dana);
    const cedar = constructed.find((c) => c.label.startsWith("Someone at Cedar"))!;
    expect(cedar.source).toBe("runtime");
    expect(cedar.reasonCode).toBe(
      (await sharing.requestRelease(t.db, await t.as("cst-jordan"), "pk-okafor-respite")).reasonCode,
    );
    expect(cedar.reasonCode).toBe("OUT_OF_SCOPE");
    const evaluator = constructed.find((c) => c.source === "evaluator")!;
    expect(evaluator.reasonCode).toBe("TENANT_MISMATCH");
    expect(evaluator.note).toMatch(/OUT_OF_SCOPE/);
    const guide = constructed.find((c) => c.label.startsWith("A care guide"))!;
    expect(guide.source).toBe("runtime");
    expect(guide.reasonCode).toBe(
      (await sharing.requestRelease(t.db, await t.as("st-maya"), "pk-okafor-respite")).reasonCode,
    );
    // Every packet's preview matches the decision the app actually records.
    for (const p of packets) {
      const actual = await sharing.requestRelease(t.db, dana, p.id);
      expect(actual.reasonCode, p.id).toBe(p.preview.reasonCode);
    }
  });
});

describe("tenant and surface boundaries", () => {
  it("keeps Willow staff out of Cedar records, revealing nothing", async () => {
    const dana = await t.as("st-dana");
    await expect(sharing.getPacket(t.db, dana, "cpk-moss-transport")).rejects.toThrow(/isn't available/);
    await expect(staff.householdOverview(t.db, dana, "chh-moss")).rejects.toThrow(/isn't available/);
    expect(await sharing.requestRelease(t.db, dana, "cpk-moss-transport")).toMatchObject({
      decision: "deny",
      reasonCode: "OUT_OF_SCOPE",
    });
    expect((await sharing.listPackets(t.db, dana)).some((p) => p.id === "cpk-moss-transport")).toBe(false);
    expect((await staff.searchHouseholds(t.db, dana, "Moss")).length).toBe(0);
  });

  it("refuses every staff service to a household persona", async () => {
    for (const id of ["fm-daniel", "fm-ada", "fm-grace"]) {
      const ctx = await t.as(id);
      await expect(staff.staffHome(t.db, ctx), id).rejects.toThrow();
      await expect(staff.coordinationQueue(t.db, ctx), id).rejects.toThrow(/care team/);
      await expect(staff.householdOverview(t.db, ctx, "hh-okafor"), id).rejects.toThrow();
      await expect(staff.listEscalations(t.db, ctx), id).rejects.toThrow();
      await expect(sharing.listPackets(t.db, ctx), id).rejects.toThrow();
      await expect(sharing.reviewQueue(t.db, ctx), id).rejects.toThrow();
      await expect(sharing.policyScenarios(t.db, ctx), id).rejects.toThrow();
      await expect(sharing.requestRelease(t.db, ctx, "pk-okafor-respite"), id).rejects.toThrow(/care team/);
    }
  });
});
