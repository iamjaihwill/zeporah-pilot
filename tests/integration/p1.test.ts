import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as sharing from "@/server/services/sharing";
import * as settings from "@/server/services/settings";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";
import { NO_OWNER } from "@/domain/queue";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const day = (n: number) => new Date(Date.now() + n * 86_400_000);
const START = day(-1);
const END = day(20);
async function recordFor(grantedByActorId: string, recipientName = "Lakeside Companion Care (synthetic)") {
  const { id } = await sharing.recordConsent(t.db, await t.as("st-maya"), {
    householdId: "hh-okafor",
    grantedByActorId,
    purpose: "Arrange companion visits",
    recipientName,
    scope: ["contact_details"],
    startsAt: START,
    expiresAt: END,
    revocationPath: "Withdraw any time in Zeporah.",
  });
  return id;
}
const notificationsFor = (actorId: string) =>
  t.db.select().from(s.notifications).where(eq(s.notifications.recipientActorId, actorId));

describe("named grantor visibility", () => {
  it("shows a held consent to the named family member, and only that consent", async () => {
    const id = await recordFor("fm-chidi");
    const chidi = await t.as("fm-chidi");
    // Chidi has no Sharing page…
    await expect(family.listHouseholdConsents(t.db, chidi)).rejects.toThrow();
    // …but sees the one consent that names him, with why it's held and what he can do.
    const mine = await family.consentsForMe(t.db, chidi);
    expect(mine.map((c) => c.id).sort()).toEqual([id, "cs-okafor-library"].sort());
    expect(mine.find((c) => c.id === id)).toMatchObject({
      stage: "needs_review",
      heldReason: expect.stringMatching(/active authority workflow/),
      canConfirm: false,
      canRequestCorrection: true,
      // Being named doesn't grant withdrawal; that still needs Sharing access under the existing policy.
      canWithdraw: false,
    });
    await expect(family.withdrawConsent(t.db, chidi, id)).rejects.toThrow();
    expect((await family.familyHome(t.db, chidi)).namedConsents).toMatchObject({ open: 2, waitingForMe: 0 });
    // The notification deep-links to that consent, and the link is checked on every load.
    expect((await notificationsFor("fm-chidi")).some((n) => n.link === `/family/consents/${id}`)).toBe(true);
    await expect(family.getConsentForMe(t.db, chidi, "cs-okafor-respite")).rejects.toThrow(/isn't for you/);
    await expect(family.getConsentForMe(t.db, await t.as("fm-daniel"), id)).rejects.toThrow(/isn't for you/);
    await expect(family.getConsentForMe(t.db, await t.as("cfm-ben", "t-cedar"), id)).rejects.toThrow();
  });

  it("lets an eligible named family member confirm without giving them the Sharing page", async () => {
    // Before this change, a family member with an active authority workflow was eligible to confirm
    // but had no screen to do it on: a silent dead end.
    const maya = await t.as("st-maya");
    const r = await sharing.submitEvidence(t.db, maya, {
      householdId: "hh-okafor",
      holderName: "Chidi Okafor",
      holderActorId: "fm-chidi",
      authorityType: "guardian",
      documentLabel: "Guardianship order (synthetic)",
    });
    await sharing.reviewEvidence(t.db, await t.as("st-priya"), {
      evidenceId: r.evidenceId,
      outcome: "workflow_active",
      rationale: "Reviewed (synthetic).",
    });
    const id = await recordFor("fm-chidi");
    const chidi = await t.as("fm-chidi");
    expect((await family.getConsentForMe(t.db, chidi, id)).canConfirm).toBe(true);
    await family.confirmConsent(t.db, chidi, { consentId: id, version: 1 });
    expect((await family.getConsentForMe(t.db, chidi, id)).stage).toBe("awaiting_activation");
    await expect(family.listHouseholdConsents(t.db, chidi)).rejects.toThrow();
  });

  it("tells staff who can confirm in the app, and why not, without blocking the recording", async () => {
    const opts = (await sharing.listConsents(t.db, await t.as("st-maya"), "hh-okafor")).grantorOptions;
    expect(opts.find((o) => o.actorId === "fm-grace")).toMatchObject({ canConfirm: true, reason: null });
    expect(opts.find((o) => o.actorId === "fm-ada")).toMatchObject({ canConfirm: true });
    expect(opts.find((o) => o.actorId === "fm-chidi")).toMatchObject({
      canConfirm: false,
      reason: expect.stringMatching(/Being in the household isn't enough/),
    });
    await recordFor("fm-chidi"); // still allowed
  });
});

describe("consent correction requests", () => {
  it("holds sharing, keeps the version and stage, and keeps the person's words with the care team", async () => {
    const grace = await t.as("fm-grace");
    await family.requestConsentCorrection(t.db, grace, {
      consentId: "cs-okafor-respite",
      version: 1,
      categories: ["scope", "recipient"],
      detail: "Wrong pharmacy branch on Elm Street (synthetic)",
    });
    const c = (await family.listHouseholdConsents(t.db, grace)).find((x) => x.id === "cs-okafor-respite")!;
    expect(c).toMatchObject({
      stage: "active",
      version: 1,
      canRequestCorrection: false,
      canCancelCorrection: true,
    });
    expect(c.correction).toMatchObject({ mine: true, categories: ["What's included", "Who receives it"] });
    expect(await sharing.requestRelease(t.db, await t.as("st-dana"), "pk-okafor-respite")).toMatchObject({
      decision: "hold",
      reasonCode: "CONSENT_CORRECTION_PENDING",
    });
    // The words: staff consent view only. Not in audit, escalation, queue or notifications.
    const staffRow = (await sharing.listConsents(t.db, await t.as("st-maya"), "hh-okafor")).consents.find(
      (x) => x.id === "cs-okafor-respite",
    )!;
    expect(staffRow.correction?.detail).toMatch(/Elm Street/);
    expect(staffRow.activateBlockedReason).toMatch(/correction was requested/);
    const everywhere = JSON.stringify([
      await t.db.select().from(s.auditEvents),
      await t.db.select().from(s.escalations),
      await t.db.select().from(s.notifications),
      await staff.coordinationQueue(t.db, await t.as("st-maya")),
    ]);
    expect(everywhere).not.toMatch(/Elm Street/);
    // Withdrawal wording is never used for a correction.
    const ev = (await t.db.select().from(s.auditEvents)).filter(
      (e) => e.action === "consent.correction_requested",
    );
    expect(ev[0]!.summary).not.toMatch(/withdraw/i);
  });

  it("lets only the named grantor place a correction request; others are routed to Support and hold nothing", async () => {
    const grace = await t.as("fm-grace");
    const daniel = await t.as("fm-daniel");
    const input = { consentId: "cs-okafor-respite", version: 1, categories: [] as never[], detail: "" };
    // Daniel can see the consent on Sharing but isn't its named grantor.
    const seen = (await family.listHouseholdConsents(t.db, daniel)).find(
      (x) => x.id === "cs-okafor-respite",
    )!;
    expect(seen).toMatchObject({ canRequestCorrection: false, canRaiseConcern: true });
    await expect(family.requestConsentCorrection(t.db, daniel, input)).rejects.toThrow(
      /Only the person named/,
    );
    expect(
      await t.db
        .select()
        .from(s.consentCorrectionRequests)
        .where(eq(s.consentCorrectionRequests.consentId, "cs-okafor-respite")),
    ).toHaveLength(0);
    expect(await sharing.requestRelease(t.db, await t.as("st-dana"), "pk-okafor-respite")).toMatchObject({
      decision: "allow",
    });
  });

  it("allows one open request per consent", async () => {
    const id = await recordFor("fm-grace");
    const grace = await t.as("fm-grace");
    const input = { consentId: id, version: 1, categories: [] as never[], detail: "" };
    await family.requestConsentCorrection(t.db, grace, input);
    await expect(family.requestConsentCorrection(t.db, grace, input)).rejects.toThrow(/already open/);
    // Others see that sharing is held, but not what was asked.
    const daniel = await t.as("fm-daniel");
    expect(
      (await family.listHouseholdConsents(t.db, daniel)).find((x) => x.id === id)?.correction,
    ).toMatchObject({
      mine: false,
      categories: [],
    });
  });

  it("refuses a stale version and people outside the consent", async () => {
    const grace = await t.as("fm-grace");
    const input = { consentId: "cs-okafor-respite", version: 1, categories: [] as never[], detail: "" };
    await expect(family.requestConsentCorrection(t.db, grace, { ...input, version: 2 })).rejects.toThrow();
    await t.db
      .update(s.consentCorrectionRequests)
      .set({ status: "cancelled" })
      .where(eq(s.consentCorrectionRequests.consentId, "cs-okafor-respite"));
    await expect(family.requestConsentCorrection(t.db, await t.as("fm-chidi"), input)).rejects.toThrow(
      /isn't available/,
    );
  });

  it("blocks confirmation and activation until it's cancelled", async () => {
    const id = await recordFor("fm-grace");
    const grace = await t.as("fm-grace");
    await family.requestConsentCorrection(t.db, grace, {
      consentId: id,
      version: 1,
      categories: ["dates"],
      detail: "",
    });
    await expect(family.confirmConsent(t.db, grace, { consentId: id, version: 1 })).rejects.toThrow(
      /correction/,
    );
    await family.cancelConsentCorrection(t.db, grace, id);
    await expect(family.cancelConsentCorrection(t.db, grace, id)).rejects.toThrow(/no open correction/);
    await family.confirmConsent(t.db, grace, { consentId: id, version: 1 });
    await family.requestConsentCorrection(t.db, grace, {
      consentId: id,
      version: 1,
      categories: [],
      detail: "",
    });
    await expect(sharing.activateConsent(t.db, await t.as("st-priya"), id)).rejects.toThrow(/correction/);
  });

  it("is resolved by dismissal with a required reason kept with the care team", async () => {
    const grace = await t.as("fm-grace");
    await family.requestConsentCorrection(t.db, grace, {
      consentId: "cs-okafor-respite",
      version: 1,
      categories: [],
      detail: "",
    });
    const [req] = await t.db
      .select()
      .from(s.consentCorrectionRequests)
      .where(eq(s.consentCorrectionRequests.consentId, "cs-okafor-respite"));
    const maya = await t.as("st-maya");
    await expect(
      sharing.dismissConsentCorrection(t.db, maya, { requestId: req!.id, explanation: "  " }),
    ).rejects.toThrow(/Give the reason/);
    await expect(
      sharing.dismissConsentCorrection(t.db, await t.as("st-dana"), { requestId: req!.id, explanation: "x" }),
    ).rejects.toThrow();
    // Not from the generic escalation screen: it must be resolved against the consent.
    await expect(
      staff.updateEscalation(t.db, maya, { id: req!.escalationId!, action: "resolve", resolution: "done" }),
    ).rejects.toThrow(/from the household's consent/);
    await sharing.dismissConsentCorrection(t.db, maya, {
      requestId: req!.id,
      explanation: "The listed pharmacy is correct.",
    });
    const c = (await family.listHouseholdConsents(t.db, grace)).find((x) => x.id === "cs-okafor-respite")!;
    expect(c.correction).toBeNull();
    // The household sees that it was reviewed with no change — never the staff reason.
    expect(c.lastDismissal?.at).toBeInstanceOf(Date);
    expect(JSON.stringify(await family.listHouseholdConsents(t.db, grace))).not.toMatch(/listed pharmacy/);
    expect(JSON.stringify(await t.db.select().from(s.auditEvents))).not.toMatch(/listed pharmacy/);
    const [stored] = await t.db
      .select()
      .from(s.consentCorrectionRequests)
      .where(eq(s.consentCorrectionRequests.id, req!.id));
    expect(stored!.resolutionNote).toBe("The listed pharmacy is correct.");
    expect(await sharing.requestRelease(t.db, await t.as("st-dana"), "pk-okafor-respite")).toMatchObject({
      decision: "allow",
    });
    const [esc] = await t.db.select().from(s.escalations).where(eq(s.escalations.id, req!.escalationId!));
    expect(esc!.status).toBe("resolved");
  });

  it("closes itself when the consent is amended, withdrawn, or ends at bereavement", async () => {
    const maya = await t.as("st-maya");
    const grace = await t.as("fm-grace");
    const ask = (consentId: string) =>
      family.requestConsentCorrection(t.db, grace, { consentId, version: 1, categories: [], detail: "" });
    const outcome = async (consentId: string) =>
      (
        await t.db
          .select()
          .from(s.consentCorrectionRequests)
          .where(eq(s.consentCorrectionRequests.consentId, consentId))
      ).map((r) => [r.status, r.outcome]);

    const a = await recordFor("fm-grace", "Recipient A (synthetic)");
    await ask(a);
    await sharing.amendConsent(t.db, maya, {
      consentId: a,
      purpose: "Arrange companion visits",
      recipientName: "Recipient A, corrected (synthetic)",
      scope: ["contact_details"],
      startsAt: START,
      expiresAt: END,
      revocationPath: "Withdraw any time in Zeporah.",
    });
    expect(await outcome(a)).toEqual([["resolved", "amended"]]);
    expect((await family.getConsentForMe(t.db, grace, a)).changedInThisVersion).toEqual(["recipient"]);

    const b = await recordFor("fm-grace", "Recipient B (synthetic)");
    await ask(b);
    await family.withdrawConsent(t.db, grace, b);
    expect(await outcome(b)).toEqual([["resolved", "withdrawn"]]);

    await ask("cs-okafor-respite");
    await staff.proposeBereavement(t.db, maya, {
      householdId: "hh-okafor",
      survivingContactActorId: "fm-daniel",
      note: "",
    });
    const [tr] = await t.db
      .select()
      .from(s.bereavementTransitions)
      .where(eq(s.bereavementTransitions.state, "proposed"));
    await staff.confirmBereavement(t.db, await t.as("st-dana"), tr!.id);
    expect(await outcome("cs-okafor-respite")).toEqual([["resolved", "closed"]]);
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });
});

describe("seeded demo correction", () => {
  it("comes from the consent's named grantor", async () => {
    const [r] = await t.db
      .select({ by: s.consentCorrectionRequests.requestedByActorId, grantor: s.consents.grantedByActorId })
      .from(s.consentCorrectionRequests)
      .innerJoin(s.consents, eq(s.consents.id, s.consentCorrectionRequests.consentId))
      .where(eq(s.consentCorrectionRequests.id, "cr-patel-chaplain"));
    expect(r).toEqual({ by: "fm-ravi", grantor: "fm-ravi" });
  });
});

describe("hospice routine-message wording", () => {
  it("shows nothing until operations sets wording, then shows exactly that, versioned and audited", async () => {
    // Cedar Valley has never set wording: its families see no expectation at all.
    const ben = await t.as("cfm-ben", "t-cedar");
    expect((await family.getThread(t.db, ben)).expectation).toBeNull();
    expect((await family.getSupport(t.db, ben)).expectation).toBeNull();
    // Willow Creek's seeded wording is version 2.
    const daniel = await t.as("fm-daniel");
    expect((await family.getThread(t.db, daniel)).expectation?.version).toBe(2);

    const dana = await t.as("st-dana");
    await expect(
      settings.setMessageExpectation(t.db, await t.as("st-maya"), {
        enabled: true,
        expectation: "x",
        handlingHours: "",
        fallback: "",
        replyTime: "within 1 business day",
      }),
    ).rejects.toThrow();
    await expect(
      settings.setMessageExpectation(t.db, dana, {
        enabled: true,
        expectation: " ",
        handlingHours: "",
        fallback: "",
        replyTime: "within 1 business day",
      }),
    ).rejects.toThrow(/Write what families should expect/);
    await settings.setMessageExpectation(t.db, dana, {
      enabled: true,
      expectation: "Your care guide reads routine messages during office hours (synthetic wording).",
      handlingHours: "Weekdays, office hours (synthetic)",
      fallback: "",
      replyTime: "within 2 business days",
    });
    expect((await family.getThread(t.db, daniel)).expectation).toMatchObject({
      version: 3,
      expectation: expect.stringMatching(/office hours/),
    });
    expect(
      (await staff.householdOverview(t.db, await t.as("st-maya"), "hh-okafor")).expectation?.version,
    ).toBe(3);
    // Another hospice is unaffected.
    expect((await family.getThread(t.db, await t.as("cfm-ben", "t-cedar"))).expectation).toBeNull();

    await settings.setMessageExpectation(t.db, dana, {
      enabled: false,
      expectation: "",
      handlingHours: "",
      fallback: "",
      replyTime: "",
    });
    expect((await family.getThread(t.db, daniel)).expectation).toBeNull();
    const h = await settings.getMessageSettings(t.db, dana);
    expect(h.history.map((x) => [x.version, x.enabled])).toEqual([
      [4, false],
      [3, true],
      [2, true],
      [1, true],
    ]);
    // Willow Creek's events only (Cedar Valley's seeded history is separate).
    const audit = (await t.db.select().from(s.auditEvents)).filter(
      (e) => e.tenantId === "t-willow" && e.action.startsWith("settings.message_expectation"),
    );
    expect(audit.map((e) => e.action)).toEqual([
      "settings.message_expectation_set",
      "settings.message_expectation_set",
      "settings.message_expectation_set",
      "settings.message_expectation_off",
    ]);
  });
});

describe("queue rows", () => {
  it("derive last action from the audit log, say when owner or action is unknown, and never carry private text", async () => {
    const daniel = await t.as("fm-daniel");
    await family.sendFamilyMessage(t.db, daniel, "PRIVATE-MESSAGE-TEXT (synthetic)");
    await family.requestHumanSupport(t.db, daniel, {
      category: "Respite",
      message: "PRIVATE-SUPPORT-TEXT",
      contactTime: "",
    });
    await family.requestConsentCorrection(t.db, await t.as("fm-grace"), {
      consentId: "cs-okafor-respite",
      version: 1,
      categories: ["dates"],
      detail: "PRIVATE-CORRECTION-TEXT",
    });
    const q = await staff.coordinationQueue(t.db, await t.as("st-priya"));
    expect(JSON.stringify(q)).not.toMatch(/PRIVATE-/);
    const msg = q.find((r) => r.kind === "message" && r.householdId === "hh-okafor")!;
    expect(msg.lastAction).toMatchObject({ actor: "Daniel Okafor", did: "sent a message" });
    expect(msg.owner).toBe("Maya Chen");
    const corr = q.find((r) => r.kind === "correction" && r.householdId === "hh-okafor")!;
    expect(corr).toMatchObject({
      priority: "high",
      owner: null,
      lastAction: { actor: "Grace Okafor", did: "asked for a correction" },
    });
    const support = q.find(
      (r) => r.kind === "escalation" && r.summary === "Family asked for a person to follow up",
    )!;
    expect(support).toMatchObject({
      state: "Open — no one has taken it",
      next: "Take ownership",
      priority: "high",
    });
    // Correction escalations aren't listed twice.
    expect(q.filter((r) => r.kind === "escalation" && /correction/i.test(r.summary))).toHaveLength(0);
    expect(NO_OWNER).toBe("No owner assigned");
  });
});

describe("database rules for the new tables", () => {
  it("refuse a second open correction, an unexplained dismissal, and enabled wording that's empty", async () => {
    const base = {
      tenantId: "t-willow",
      householdId: "hh-okafor",
      consentId: "cs-okafor-respite",
      consentVersion: 1,
      requestedByActorId: "fm-grace",
    };
    await t.db.insert(s.consentCorrectionRequests).values(base);
    await expect(t.db.insert(s.consentCorrectionRequests).values(base)).rejects.toThrow();
    await expect(
      t.db
        .insert(s.consentCorrectionRequests)
        .values({ ...base, status: "resolved", outcome: "dismissed", resolutionNote: " " }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(s.consentCorrectionRequests).values({ ...base, status: "resolved" }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(s.consentCorrectionRequests).values({ ...base, status: "maybe" as "open" }),
    ).rejects.toThrow();
    const exp = {
      tenantId: "t-willow",
      organizationId: "org-willow",
      changedByActorId: "st-dana",
      effectiveFrom: new Date(),
    };
    await expect(
      t.db.insert(s.messageExpectations).values({ ...exp, version: 50, enabled: true, expectation: "  " }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(s.messageExpectations).values({ ...exp, version: 0, enabled: false }),
    ).rejects.toThrow();
    await t.db.insert(s.messageExpectations).values({ ...exp, version: 51, enabled: false });
    await expect(
      t.db.insert(s.messageExpectations).values({ ...exp, version: 51, enabled: false }),
    ).rejects.toThrow();
    // Tenant-composite keys: a Cedar row can't point at a Willow consent.
    await expect(
      t.db.insert(s.consentCorrectionRequests).values({ ...base, tenantId: "t-cedar" }),
    ).rejects.toThrow();
    void and;
    void sql;
  });
});
