import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as sharing from "@/server/services/sharing";
import { listNotifications, markRead, unreadCount } from "@/server/services/notifications";
import { verifyAuditChain } from "@/server/audit";
import * as s from "@/server/db/schema";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

describe("onboarding → dashboard", () => {
  it("progressively updates household state and unlocks messaging", async () => {
    const marisol = await t.as("fm-marisol");
    let home = await family.familyHome(t.db, marisol);
    expect(home.onboarding.complete).toBe(false);
    expect(home.onboarding.next).toBe("preferences");
    expect(home.messagingOn).toBe(false);
    expect(home.vault).toBeNull();
    await expect(family.sendFamilyMessage(t.db, marisol, "Hello")).rejects.toThrow(/communication settings/);

    await family.savePreferences(t.db, marisol, {
      language: "es",
      textSize: "larger",
      contactMethod: "phone",
    });
    await family.inviteContact(t.db, marisol, {
      name: "Luis Rivera",
      contact: "luis@example.invalid",
      role: "family_member",
      relationship: "Brother",
    });
    await family.finishContactsStep(t.db, marisol);
    home = await family.familyHome(t.db, marisol);
    expect(home.onboarding.next).toBe("communication");

    await family.saveCommunication(t.db, marisol, {
      notificationCadence: "daily_summary",
      quietHoursStart: "21:00",
      quietHoursEnd: "08:00",
    });
    home = await family.familyHome(t.db, marisol);
    expect(home.messagingOn).toBe(true);
    await family.sendFamilyMessage(t.db, marisol, "Thank you, Maya.");

    const vault = await family.listVault(t.db, marisol);
    await family.reviewVaultItem(t.db, marisol, {
      id: vault.items[0]!.id,
      status: "reviewed",
      keptWhere: "Hall table",
    });
    await family.finishVaultStep(t.db, marisol);
    home = await family.familyHome(t.db, marisol);
    expect(home.onboarding.complete).toBe(true);
    expect(home.household.lifecycle).toBe("active_hospice");
    expect(home.vault).toMatchObject({ reviewed: 1, needsReview: 2 }); // coordinator sees the 3 standard items only
    expect(home.activity.map((a) => a.summary)).toContain("Household setup was completed.");

    const maya = await t.as("st-maya");
    expect((await listNotifications(t.db, maya)).map((n) => n.title)).toContain("A household finished setup");
  });
});

describe("vault ↔ dashboard", () => {
  it("updates counters, activity and notifications, and hides protected items without authority", async () => {
    const daniel = await t.as("fm-daniel");
    const ada = await t.as("fm-ada");
    const chidi = await t.as("fm-chidi");
    const dv = await family.listVault(t.db, daniel);
    const av = await family.listVault(t.db, ada);
    expect(dv.items.every((i) => i.sensitivity === "standard")).toBe(true);
    expect(av.items.some((i) => i.sensitivity === "protected")).toBe(true);
    // Decision 43: a family member opens the vault but sees only items visible to the household (none yet).
    expect((await family.listVault(t.db, chidi)).items).toEqual([]);
    const prot = av.items.find((i) => i.sensitivity === "protected")!;
    await expect(family.getVaultItem(t.db, daniel, prot.id)).rejects.toThrow(/isn't available/);

    const before = await family.familyHome(t.db, daniel);
    const adaUnread = await unreadCount(t.db, ada);
    const target = dv.items.find((i) => i.status === "needs_review")!;
    await family.reviewVaultItem(t.db, daniel, { id: target.id, status: "reviewed" });
    const after = await family.familyHome(t.db, daniel);
    expect(after.vault!.needsReview).toBe(before.vault!.needsReview - 1);
    expect(after.vault!.reviewed).toBe(before.vault!.reviewed + 1);
    expect(after.activity[0]!.summary).toContain(target.title);
    expect(await unreadCount(t.db, ada)).toBe(adaUnread + 1);

    // A protected review shows on Ada's timeline but never on Daniel's.
    await family.reviewVaultItem(t.db, ada, { id: prot.id, status: "reviewed" });
    expect((await family.familyHome(t.db, ada)).activity[0]!.summary).toContain(prot.title);
    expect((await family.familyHome(t.db, daniel)).activity.some((a) => a.summary.includes(prot.title))).toBe(
      false,
    );
  });
});

describe("messages → notifications → dashboard", () => {
  it("keeps a shared unread state and separates internal notes", async () => {
    const daniel = await t.as("fm-daniel");
    const maya = await t.as("st-maya");
    const mayaBefore = await unreadCount(t.db, maya);
    await family.sendFamilyMessage(t.db, daniel, "Can the aide come at 9 instead?");
    expect(await unreadCount(t.db, maya)).toBe(mayaBefore + 1);
    expect(
      (await staff.coordinationQueue(t.db, maya)).some(
        (q) => q.kind === "message" && q.householdId === "hh-okafor",
      ),
    ).toBe(true);

    await staff.addStaffNote(t.db, maya, {
      householdId: "hh-okafor",
      body: "INTERNAL-ONLY: check aide roster",
    });
    await staff.sendStaffMessage(t.db, maya, { householdId: "hh-okafor", body: "Yes, 9 works." });
    const thread = await family.getThread(t.db, daniel);
    expect(thread.entries.at(-1)).toMatchObject({ type: "message", side: "staff", body: "Yes, 9 works." });
    const everything = JSON.stringify([
      thread,
      await family.familyHome(t.db, daniel),
      await listNotifications(t.db, daniel),
    ]);
    expect(everything).not.toContain("INTERNAL-ONLY");
    expect((await family.familyHome(t.db, daniel)).activity[0]!.summary).toMatch(/care guide replied/);

    const unread = await unreadCount(t.db, daniel);
    expect(unread).toBeGreaterThan(0);
    await markRead(t.db, daniel, "all");
    expect(await unreadCount(t.db, daniel)).toBe(0);
    expect((await family.familyHome(t.db, daniel)).unread).toBe(0);

    // Chidi (family member) can read updates but not the care-guide thread.
    const chidi = await t.as("fm-chidi");
    expect((await family.getThread(t.db, chidi)).canView).toBe(false);
    await expect(family.sendFamilyMessage(t.db, chidi, "hi")).rejects.toThrow();
  });

  it("records acknowledgements once and clears them from the queue", async () => {
    const maya = await t.as("st-maya");
    const ackItem = async () =>
      (await staff.coordinationQueue(t.db, maya)).find(
        (q) => q.kind === "acknowledgement" && q.householdId === "hh-okafor",
      );
    const before = await ackItem();
    expect(before?.state).toMatch(/Ada/);
    expect(before?.state).not.toMatch(/Daniel/); // already acknowledged in the seed

    const ada = await t.as("fm-ada");
    await family.acknowledgeUpdate(t.db, ada, "up-okafor-1");
    await family.acknowledgeUpdate(t.db, ada, "up-okafor-1");
    const acks = await t.db
      .select()
      .from(s.acknowledgements)
      .where(and(eq(s.acknowledgements.subjectId, "up-okafor-1"), eq(s.acknowledgements.actorId, "fm-ada")));
    expect(acks).toHaveLength(1);
    // Ada leaves the queue item; the others are still listed until they acknowledge.
    expect((await ackItem())?.state).not.toMatch(/Ada/);

    for (const id of ["fm-grace", "fm-chidi"])
      await family.acknowledgeUpdate(t.db, await t.as(id), "up-okafor-1");
    expect(await ackItem()).toBeUndefined();
  });
});

describe("packet release", () => {
  it("releases the normal scenario with a receipt and an audit event", async () => {
    const dana = await t.as("st-dana");
    const r = await sharing.requestRelease(t.db, dana, "pk-okafor-respite");
    expect(r).toMatchObject({ decision: "allow", reasonCode: "RELEASE_ALLOWED" });
    const [p] = await t.db.select().from(s.packets).where(eq(s.packets.id, "pk-okafor-respite"));
    expect(p!.state).toBe("released");
    const receipts = await t.db
      .select()
      .from(s.packetReleaseReceipts)
      .where(eq(s.packetReleaseReceipts.packetId, "pk-okafor-respite"));
    expect(receipts).toHaveLength(1);
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.id, receipts[0]!.auditEventId));
    expect(ev).toMatchObject({ action: "packet.released", decision: "allow" });
    // A released packet can't be released twice.
    expect(await sharing.requestRelease(t.db, dana, "pk-okafor-respite")).toMatchObject({
      reasonCode: "PACKET_NOT_RELEASABLE",
    });
    expect(await verifyAuditChain(t.db, "t-willow")).toMatchObject({ ok: true });
  });

  it("denies an insufficient role without changing the packet, and audits the attempt", async () => {
    const maya = await t.as("st-maya");
    const r = await sharing.requestRelease(t.db, maya, "pk-okafor-respite");
    expect(r).toMatchObject({ decision: "deny", reasonCode: "ROLE_NOT_PERMITTED" });
    const [p] = await t.db.select().from(s.packets).where(eq(s.packets.id, "pk-okafor-respite"));
    expect(p!.state).toBe("draft");
    const evs = await t.db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.subjectId, "pk-okafor-respite"),
          eq(s.auditEvents.reasonCode, "ROLE_NOT_PERMITTED"),
        ),
      );
    expect(evs).toHaveLength(1);
  });

  it("holds release after the household withdraws consent", async () => {
    const grace = await t.as("fm-grace");
    await family.withdrawConsent(t.db, grace, "cs-okafor-respite");
    const dana = await t.as("st-dana");
    expect(await sharing.requestRelease(t.db, dana, "pk-okafor-respite")).toMatchObject({
      decision: "hold",
      reasonCode: "CONSENT_REVOKED",
    });
    expect(
      (await family.listHouseholdConsents(t.db, grace)).find((c) => c.id === "cs-okafor-respite")!.stage,
    ).toBe("revoked");
    // Daniel didn't give that consent and isn't the patient: he can only ask the care team.
    const daniel = await t.as("fm-daniel");
    await expect(family.withdrawConsent(t.db, daniel, "cs-okafor-respite")).rejects.toThrow();
  });

  it("holds every synthetic workflow scenario with its stable reason", async () => {
    const dana = await t.as("st-dana");
    const cases: [string, string][] = [
      ["pk-bennett-equipment", "AUTHORITY_CONFLICT"],
      ["pk-patel-chaplain", "AUTHORITY_REVIEW_PENDING"],
      ["pk-nguyen-meals", "CONSENT_REVOKED"],
      ["pk-nguyen-transport", "SCOPE_EMPTY"],
      ["pk-hart-pharmacy", "PACKET_EXPIRED"],
      ["pk-hart-benefits", "CONSENT_EXPIRED"],
    ];
    for (const [id, code] of cases)
      expect(await sharing.requestRelease(t.db, dana, id), id).toMatchObject({
        decision: "hold",
        reasonCode: code,
      });
    const escalated = await t.db.select().from(s.escalations).where(eq(s.escalations.sourceType, "packet"));
    expect(escalated.map((e) => e.sourceId).sort()).toEqual([
      "pk-bennett-equipment",
      "pk-nguyen-meals",
      "pk-patel-chaplain",
    ]);
  });

  it("denies another hospice's staff as out of scope, revealing nothing", async () => {
    const jordan = await t.as("cst-jordan");
    expect(await sharing.requestRelease(t.db, jordan, "pk-okafor-respite")).toMatchObject({
      decision: "deny",
      reasonCode: "OUT_OF_SCOPE",
    });
    expect(await sharing.requestRelease(t.db, jordan, "does-not-exist")).toMatchObject({
      decision: "deny",
      reasonCode: "OUT_OF_SCOPE",
    });
    await expect(sharing.getPacket(t.db, jordan, "pk-okafor-respite")).rejects.toThrow(/isn't available/);
    await expect(staff.householdOverview(t.db, jordan, "hh-okafor")).rejects.toThrow(/isn't available/);
    const denied = await t.db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.tenantId, "t-cedar"), eq(s.auditEvents.action, "access.denied")));
    expect(denied.length).toBeGreaterThanOrEqual(3);
    const [p] = await t.db.select().from(s.packets).where(eq(s.packets.id, "pk-okafor-respite"));
    expect(p!.state).toBe("draft");
  });

  it("keeps care guides to their assigned households", async () => {
    const maya = await t.as("st-maya");
    await expect(staff.householdOverview(t.db, maya, "hh-patel")).rejects.toThrow(/isn't available/);
    expect((await sharing.listPackets(t.db, maya)).some((p) => p.householdId === "hh-patel")).toBe(false);
  });

  it("releases nothing if the audit event can't be written", async () => {
    const dana = await t.as("st-dana");
    const failing = { appendAudit: async () => Promise.reject(new Error("disk full")) } as never;
    expect(await sharing.requestRelease(t.db, dana, "pk-okafor-respite", failing)).toMatchObject({
      decision: "deny",
      reasonCode: "AUDIT_UNAVAILABLE",
    });
    const [p] = await t.db.select().from(s.packets).where(eq(s.packets.id, "pk-okafor-respite"));
    expect(p!.state).toBe("draft");
    expect(
      await t.db
        .select()
        .from(s.packetReleaseReceipts)
        .where(eq(s.packetReleaseReceipts.packetId, "pk-okafor-respite")),
    ).toHaveLength(0);
  });
});

describe("authority conflict review", () => {
  it("won't pick between conflicting records, and clears the hold once a person resolves it", async () => {
    const priya = await t.as("st-priya");
    await expect(
      sharing.reviewEvidence(t.db, priya, {
        evidenceId: "ev-bennett-claire",
        outcome: "workflow_active",
        rationale: "Looks fine",
      }),
    ).rejects.toThrow(/doesn't choose/);
    await sharing.reviewEvidence(t.db, priya, {
      evidenceId: "ev-bennett-owen",
      outcome: "withdrawn",
      rationale: "Family confirmed the later document was never signed.",
    });
    await sharing.reviewEvidence(t.db, priya, {
      evidenceId: "ev-bennett-claire",
      outcome: "workflow_active",
      rationale: "Remaining record reviewed with the family.",
    });
    const esc = await t.db.select().from(s.escalations).where(eq(s.escalations.id, "es-bennett-authority"));
    expect(esc[0]!.status).toBe("resolved");
    const dana = await t.as("st-dana");
    expect(await sharing.requestRelease(t.db, dana, "pk-bennett-equipment")).toMatchObject({
      decision: "allow",
    });
  });

  it("detects a new conflict when a second record names someone else", async () => {
    const maya = await t.as("st-maya");
    const r = await sharing.submitEvidence(t.db, maya, {
      householdId: "hh-okafor",
      holderName: "Chidi Okafor",
      holderActorId: "fm-chidi",
      authorityType: "healthcare_agent",
      documentLabel: "Another designation (synthetic)",
    });
    expect(r.conflict).toBe(true);
    const dana = await t.as("st-dana");
    expect(await sharing.requestRelease(t.db, dana, "pk-okafor-respite")).toMatchObject({
      decision: "hold",
      reasonCode: "AUTHORITY_CONFLICT",
    });
    // Ada's protected access depends on an active workflow, so it closes while the conflict is open.
    const ada = await t.as("fm-ada");
    expect((await family.listVault(t.db, ada)).items.some((i) => i.sensitivity === "protected")).toBe(false);
  });

  it("keeps version lineage when a clearer copy is submitted", async () => {
    const tom = await t.as("st-tom");
    await sharing.submitEvidence(t.db, tom, {
      householdId: "hh-patel",
      evidenceId: "ev-patel-meera",
      holderName: "Meera Patel",
      authorityType: "patient_designated_proxy",
      documentLabel: "Third copy (synthetic)",
    });
    const { evidence } = await sharing.listAuthority(t.db, tom, "hh-patel");
    const v = evidence[0]!.versions;
    expect(v.map((x) => x.versionNo)).toEqual([1, 2, 3]);
    expect(v[2]!.previousVersionId).toBe(v[1]!.id);
    expect(v[2]!.current).toBe(true);
  });
});

describe("bereavement transition", () => {
  it("narrows protected access while practical coordination continues", async () => {
    const maya = await t.as("st-maya");
    const dana = await t.as("st-dana");
    const ada = await t.as("fm-ada");
    expect((await family.listVault(t.db, ada)).items.some((i) => i.sensitivity === "protected")).toBe(true);

    await staff.proposeBereavement(t.db, maya, {
      householdId: "hh-okafor",
      survivingContactActorId: "fm-daniel",
      note: "",
    });
    const [tr] = await t.db
      .select()
      .from(s.bereavementTransitions)
      .where(
        and(
          eq(s.bereavementTransitions.householdId, "hh-okafor"),
          eq(s.bereavementTransitions.state, "proposed"),
        ),
      );
    await expect(staff.confirmBereavement(t.db, maya, tr!.id)).rejects.toThrow(); // care guides can't confirm
    await staff.confirmBereavement(t.db, dana, tr!.id);

    // The patient's own access ends; the healthcare-agent workflow is superseded, so Ada's protected access closes.
    await expect(family.familyHome(t.db, await t.as("fm-grace"))).rejects.toThrow();
    const ada2 = await t.as("fm-ada");
    expect((await family.listVault(t.db, ada2)).items.some((i) => i.sensitivity === "protected")).toBe(false);
    // Care-period consent expired; the open packet is held.
    expect(await sharing.requestRelease(t.db, dana, "pk-okafor-respite")).toMatchObject({ decision: "hold" });
    const [c] = await t.db.select().from(s.consents).where(eq(s.consents.id, "cs-okafor-respite"));
    expect(c!.state).toBe("expired");

    // Practical coordination continues for the household.
    const daniel = await t.as("fm-daniel");
    const home = await family.familyHome(t.db, daniel);
    expect(home.household.lifecycle).toBe("bereavement");
    expect(home.bereavement).toMatchObject({ needsMyConfirmation: true });
    expect(home.myTasks.map((x) => x.title)).toContain("Choose whether you'd like bereavement support");
    await family.sendFamilyMessage(t.db, daniel, "Thank you all.");
    await family.confirmSurvivingContact(t.db, daniel);
    expect((await family.familyHome(t.db, daniel)).bereavement).toMatchObject({ needsMyConfirmation: false });
  });

  it("requires a second person to confirm", async () => {
    const dana = await t.as("st-dana");
    await staff.proposeBereavement(t.db, dana, {
      householdId: "hh-okafor",
      survivingContactActorId: "fm-daniel",
      note: "",
    });
    const [tr] = await t.db
      .select()
      .from(s.bereavementTransitions)
      .where(
        and(
          eq(s.bereavementTransitions.householdId, "hh-okafor"),
          eq(s.bereavementTransitions.state, "proposed"),
        ),
      );
    await expect(staff.confirmBereavement(t.db, dana, tr!.id)).rejects.toThrow(/different person/);
  });
});
