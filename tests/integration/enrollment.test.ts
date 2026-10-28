import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as enrollment from "@/server/services/enrollment";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as auth from "@/server/services/auth";
import * as orgSettings from "@/server/services/org-settings";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";
import { newSubmissionId } from "@/domain/submission";

/** Enrollment and activation (founder decisions 66–70), with synthetic people only. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const enroll = async (who = "st-dana", patientName = "June Okonkwo", careGuideActorId = "st-maya") =>
  enrollment.enrollHousehold(t.db, await t.as(who), { patientName, careGuideActorId });
const tokenOf = (acceptPath: string) => acceptPath.replace("/invite/", "");
const invite = async (
  householdId: string,
  over: Partial<Parameters<typeof enrollment.inviteFirstMember>[2]> = {},
) =>
  enrollment.inviteFirstMember(t.db, await t.as("st-maya"), {
    householdId,
    role: "patient",
    name: "June Okonkwo",
    email: "june.okonkwo@example.invalid",
    identityConfirmation: "In person at the admission visit (synthetic).",
    ...over,
  });
const accept = async (acceptPath: string, displayName: string) =>
  auth.acceptInvitation(t.db, {
    token: tokenOf(acceptPath),
    displayName,
    password: "a long synthetic password",
  });

describe("enrolling (decision 66)", () => {
  it("creates a working household: thread, care record, starter vault, care guide, audit", async () => {
    const h = await enroll();
    const [row] = await t.db.select().from(s.households).where(eq(s.households.id, h.householdId));
    expect(row).toMatchObject({
      displayName: "The Okonkwo household",
      patientName: "June Okonkwo",
      lifecycleState: "enrolled",
      enrolledByActorId: "st-dana",
      activationOwnerActorId: "st-maya",
    });
    const where = (table: typeof s.vaultItems | typeof s.messageThreads | typeof s.careCoordinationRecords) =>
      t.db.select().from(table).where(eq(table.householdId, h.householdId));
    expect(await where(s.messageThreads)).toHaveLength(1);
    expect(await where(s.careCoordinationRecords)).toHaveLength(1);
    expect(await where(s.vaultItems)).toHaveLength(6);
    expect((await t.as("st-maya")).assignedHouseholdIds).toContain(h.householdId);
    const events = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.subjectId, h.householdId));
    expect(events.map((e) => e.action)).toContain("household.enrolled");
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });

  it("is for operations and administrators only", async () => {
    await expect(enroll("st-lena")).resolves.toMatchObject({ displayName: "The Okonkwo household" });
    for (const who of ["st-maya", "st-priya", "fm-daniel"])
      await expect(enroll(who)).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });

  it("refuses a care guide from outside the hospice, and an empty name", async () => {
    await expect(enroll("st-dana", "June Okonkwo", "cst-sam")).rejects.toMatchObject({ code: "INVALID" });
    await expect(enroll("st-dana", "   ")).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("the pilot cap (decision 70)", () => {
  it("counts only households not closed or bereaved, and refuses at the cap", async () => {
    const view = await enrollment.enrollmentView(t.db, await t.as("st-dana"));
    expect(view.cap).toBe(25);
    // Rivera, Wells, Okafor, Bennett, Patel, Nguyen, Hart; not Lindqvist (bereavement).
    expect(view.inPilot).toBe(7);
    await orgSettings.updateSettingsGroup(t.db, await t.as("st-lena"), {
      group: "enrollment",
      value: { cap: 8 },
    });
    await enroll();
    await expect(enroll("st-dana", "Second Person")).rejects.toMatchObject({
      code: "CONFLICT",
      message: enrollment.CAP_REACHED(8),
    });
  });

  it("can be changed by administrators only, and the change is audited", async () => {
    await expect(
      orgSettings.updateSettingsGroup(t.db, await t.as("st-dana"), {
        group: "enrollment",
        value: { cap: 30 },
      }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await orgSettings.updateSettingsGroup(t.db, await t.as("st-lena"), {
      group: "enrollment",
      value: { cap: 30 },
    });
    expect((await enrollment.enrollmentView(t.db, await t.as("st-dana"))).cap).toBe(30);
    const changed = await t.db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.tenantId, "t-willow"), eq(s.auditEvents.actorId, "st-lena")));
    expect(changed.some((e) => JSON.stringify(e.context).includes("enrollment"))).toBe(true);
  });
});

describe("the first invitation (decisions 67 and 68)", () => {
  it("lets the care guide invite the patient once, with how identity was confirmed", async () => {
    const h = await enroll();
    const r = await invite(h.householdId);
    expect(r.acceptPath).toMatch(/^\/invite\//);
    const [inv] = await t.db.select().from(s.invitations).where(eq(s.invitations.householdId, h.householdId));
    expect(inv).toMatchObject({
      roleCode: "patient",
      identityConfirmation: expect.stringContaining("admission"),
    });
    await expect(invite(h.householdId, { email: "other@example.invalid" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("refuses without an identity note, for other roles, outside the guide's households, and for administrators", async () => {
    const h = await enroll();
    await expect(invite(h.householdId, { identityConfirmation: " " })).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(invite(h.householdId, { role: "proxy" as never })).rejects.toMatchObject({
      code: "INVALID",
    });
    const other = await enroll("st-dana", "Someone Else", "st-tom");
    await expect(invite(other.householdId)).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    await expect(
      enrollment.inviteFirstMember(t.db, await t.as("st-lena"), {
        householdId: h.householdId,
        role: "patient",
        name: "June",
        email: "june@example.invalid",
        identityConfirmation: "Seen in person",
      }),
    ).rejects.toThrow();
  });

  it("refuses a patient invitation with no identity note in the database itself", async () => {
    const h = await enroll();
    await expect(
      t.db.insert(s.invitations).values({
        tenantId: "t-willow",
        householdId: h.householdId,
        invitedByActorId: "st-maya",
        inviteeName: "X",
        inviteeContact: "x@example.invalid",
        inviteeEmail: "x@example.invalid",
        roleCode: "patient",
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toThrow();
  });
});

describe("setup (decision 69)", () => {
  it("lets a patient with no coordinator set up, until a coordinator joins", async () => {
    const h = await enroll();
    const patient = await accept((await invite(h.householdId)).acceptPath, "June Okonkwo");
    const june = await t.as(patient.actorId);
    expect((await family.getOnboarding(t.db, june)).canComplete).toBe(true);
    await family.finishContactsStep(t.db, june);
    const coordinator = await accept(
      (
        await invite(h.householdId, {
          role: "coordinator",
          name: "Ray Okonkwo",
          email: "ray.okonkwo@example.invalid",
        })
      ).acceptPath,
      "Ray Okonkwo",
    );
    expect((await family.getOnboarding(t.db, await t.as(coordinator.actorId))).canComplete).toBe(true);
    expect((await family.getOnboarding(t.db, await t.as(patient.actorId))).canComplete).toBe(false);
    await expect(family.finishContactsStep(t.db, await t.as(patient.actorId))).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
  });

  it("applies to the seeded households as decided", async () => {
    // Rehanna is alone in the Wells household; Ravi's household has a coordinator.
    expect((await family.getOnboarding(t.db, await t.as("fm-rehanna"))).canComplete).toBe(true);
    expect((await family.getOnboarding(t.db, await t.as("fm-ravi"))).canComplete).toBe(false);
  });
});

describe("activation (tracked, not a gate)", () => {
  it("ticks each step from the records it leaves", async () => {
    const h = await enroll();
    const done = async () =>
      Object.fromEntries(
        (await staff.householdOverview(t.db, await t.as("st-maya"), h.householdId)).activation.items.map(
          (i) => [i.key, i.done],
        ),
      );
    expect(await done()).toEqual({
      account: false,
      contact: true,
      setup: false,
      first_action: false,
      followed_up: false,
    });
    const june = await t.as((await accept((await invite(h.householdId)).acceptPath, "June Okonkwo")).actorId);
    await family.saveCommunication(t.db, june, {
      notificationCadence: "as_it_happens",
      quietHoursStart: "21:00",
      quietHoursEnd: "08:00",
    });
    await family.sendFamilyMessage(t.db, june, "Hello, this is June.", newSubmissionId());
    expect(await done()).toMatchObject({
      account: true,
      setup: true,
      first_action: true,
      followed_up: false,
    });
    await staff.sendStaffMessage(t.db, await t.as("st-maya"), {
      householdId: h.householdId,
      body: "Hello June.",
    });
    const overview = await staff.householdOverview(t.db, await t.as("st-maya"), h.householdId);
    expect(overview.activation.activated).toBe(true);
    expect(overview.activation.owner).toBe("Maya Chen");
  });
});
