import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as team from "@/server/services/team";
import * as assignments from "@/server/services/assignments";
import * as settings from "@/server/services/settings";
import * as auth from "@/server/services/auth";
import * as staff from "@/server/services/staff";
import * as shell from "@/server/services/staff-shell";
import { staffScope } from "@/server/context";
import * as s from "@/server/db/schema";

/** Founder decisions 38–39: team management and the operations/administrator split. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const lena = () => t.as("st-lena");
const dana = () => t.as("st-dana");

describe("roles and reactivation are for administrators", () => {
  it("operations can no longer change a role; an administrator can, with an audit entry", async () => {
    await expect(
      team.changeStaffRole(t.db, await dana(), {
        actorId: "st-tom",
        role: "privileged_reviewer",
        reason: "x",
      }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await team.changeStaffRole(t.db, await lena(), {
      actorId: "st-tom",
      role: "privileged_reviewer",
      reason: "Moved teams (synthetic).",
    });
    const tom = await t.as("st-tom");
    expect(tom.staffRoles).toEqual(["privileged_reviewer"]);
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "staff.role_changed"));
    expect(ev?.actorId).toBe("st-lena");
  });

  it("nobody changes their own role, and the last administrator can't be removed", async () => {
    await expect(
      team.changeStaffRole(t.db, await lena(), { actorId: "st-lena", role: "hospice_ops", reason: "x" }),
    ).rejects.toMatchObject({ code: "INVALID" });
    // A second administrator could change Lena; with only one, her role can't go.
    await team.changeStaffRole(t.db, await lena(), {
      actorId: "st-priya",
      role: "hospice_admin",
      reason: "Cover (synthetic).",
    });
    await team.changeStaffRole(t.db, await t.as("st-priya"), {
      actorId: "st-lena",
      role: "hospice_ops",
      reason: "x",
    });
    await expect(
      team.changeStaffRole(t.db, await dana(), { actorId: "st-priya", role: "care_guide", reason: "x" }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await expect(
      team.changeStaffRole(t.db, await lena(), { actorId: "st-priya", role: "care_guide", reason: "x" }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" }); // Lena is operations now
  });

  it("operations can't deactivate an administrator", async () => {
    await expect(
      team.deactivateStaff(t.db, await dana(), { actorId: "st-lena", reason: "x" }),
    ).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
  });

  it("reactivation restores sign-in and the chosen role, not assignments", async () => {
    const before = (await t.as("st-maya")).assignedHouseholdIds.length;
    expect(before).toBeGreaterThan(0);
    await team.deactivateStaff(t.db, await dana(), { actorId: "st-maya", reason: "Left (synthetic)." });
    await expect(t.as("st-maya")).rejects.toThrow();
    await expect(
      team.reactivateStaff(t.db, await dana(), { actorId: "st-maya", role: "care_guide", reason: "x" }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await expect(
      team.reactivateStaff(t.db, await lena(), { actorId: "st-maya", role: "care_guide", reason: " " }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await team.reactivateStaff(t.db, await lena(), {
      actorId: "st-maya",
      role: "care_guide",
      reason: "Returned (synthetic).",
    });
    const maya = await t.as("st-maya");
    expect(maya.staffRoles).toEqual(["care_guide"]);
    expect(maya.assignedHouseholdIds).toEqual([]);
    const [ev] = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "staff.reactivated"));
    expect(ev?.context).toMatchObject({ role: "care_guide", reason: "Returned (synthetic)." });
    await expect(
      team.reactivateStaff(t.db, await lena(), { actorId: "st-maya", role: "care_guide", reason: "x" }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("inviting into a role other than care guide needs an administrator", async () => {
    await expect(
      auth.createStaffInvitation(t.db, await dana(), {
        name: "A",
        email: "a@example.invalid",
        role: "hospice_ops",
      }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await auth.createStaffInvitation(t.db, await dana(), {
      name: "B",
      email: "b@example.invalid",
      role: "care_guide",
    });
    await auth.createStaffInvitation(t.db, await lena(), {
      name: "C",
      email: "c@example.invalid",
      role: "hospice_admin",
    });
  });
});

describe("inactive staff stay on the record but get no new work", () => {
  it("can't be assigned a household after deactivation", async () => {
    await team.deactivateStaff(t.db, await dana(), { actorId: "st-tom", reason: "Left (synthetic)." });
    await expect(
      assignments.assignCareGuide(t.db, await dana(), { householdId: "hh-nguyen", actorId: "st-tom" }),
    ).rejects.toMatchObject({ code: "INVALID" });
    const m = await team.staffMember(t.db, await dana(), "st-tom");
    expect(m.deactivatedAt).not.toBeNull();
    // Their coverage history is still there, with the ending reason.
    expect(m.ownership.assignments.length).toBeGreaterThanOrEqual(3);
    expect(m.ownership.assignments.every((a) => a.endedAt)).toBe(true);
    expect(m.timeline.some((e) => e.action === "staff.deactivated")).toBe(true);
  });

  it("an assignment ends only with a reason", async () => {
    const [row] = await t.db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.actorId, "st-tom"), eq(s.memberships.householdId, "hh-patel")));
    await expect(
      assignments.endAssignment(t.db, await dana(), { membershipId: row!.id, reason: "  " }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("administrators manage people and settings, not households", () => {
  it("see coverage, but no household records, queue or search results", async () => {
    const r = await assignments.roster(t.db, await lena());
    expect(r.guides.length).toBeGreaterThan(0);
    await expect(staffScope(t.db, await lena(), "hh-okafor", "staff.household.view")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    expect(await staff.coordinationQueue(t.db, await lena())).toEqual([]);
    expect(await shell.staffSearch(t.db, await lena(), "Okafor")).toEqual([]);
  });

  it("can assign coverage without opening the household", async () => {
    await assignments.assignCareGuide(t.db, await lena(), { householdId: "hh-nguyen", actorId: "st-tom" });
    expect((await t.as("st-tom")).assignedHouseholdIds).toContain("hh-nguyen");
  });

  it("only administrators change the 24-hour line; operations still own the reply wording", async () => {
    await expect(
      settings.setHospiceDetails(t.db, await dana(), { afterHoursLine: "555-0111", emailSenderName: "" }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    const seen = await settings.getHospiceDetailsWithDefaults(t.db, await dana());
    expect(seen.canEdit).toBe(false);
    await settings.setHospiceDetails(t.db, await lena(), {
      afterHoursLine: "555-0111 (synthetic)",
      emailSenderName: "",
    });
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "settings.hospice_details_changed"));
    expect(ev?.context).toMatchObject({ after: { afterHoursLine: "555-0111 (synthetic)" } });
  });

  it("Cedar Valley's operations lead can't touch Willow Creek staff", async () => {
    await expect(
      team.staffMember(t.db, await t.as("cst-jordan", "t-cedar"), "st-maya"),
    ).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });
});
