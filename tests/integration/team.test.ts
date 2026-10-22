import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as team from "@/server/services/team";
import * as assignments from "@/server/services/assignments";
import * as auth from "@/server/services/auth";
import * as staff from "@/server/services/staff";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";
import { actorForToken, createSession } from "@/server/session";
import { loadContext } from "@/server/context";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => {
  vi.unstubAllEnvs();
  return t.close();
});

const REASON = "Left the hospice (synthetic).";
const PASSWORD = "synthetic-pass-phrase-1";
const events = (action: string) => t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, action));
const activeAssignments = (actorId: string) =>
  t.db
    .select()
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.actorId, actorId),
        eq(s.memberships.roleCode, "care_guide"),
        eq(s.memberships.status, "active"),
      ),
    )
    .then((r) => r.filter((m) => m.householdId));

describe("who can manage staff", () => {
  it("only hospice operations, and only staff of their own hospice", async () => {
    for (const who of ["st-maya", "st-priya", "fm-daniel"]) {
      const ctx = await t.as(who);
      await expect(team.staffMember(t.db, ctx, "st-tom")).rejects.toMatchObject({ code: "NOT_PERMITTED" });
      await expect(
        team.deactivateStaff(t.db, ctx, { actorId: "st-tom", reason: REASON }),
      ).rejects.toMatchObject({
        code: "NOT_PERMITTED",
      });
    }
    const dana = await t.as("st-dana");
    const msg = (id: string) => team.staffMember(t.db, dana, id).catch((e: Error) => e.message);
    expect(await msg("cst-sam")).toBe(await msg("nobody"));
    expect(await msg("fm-daniel")).toBe(await msg("nobody"));
  });

  it("shows the impact before anything changes", async () => {
    const m = await team.staffMember(t.db, await t.as("st-dana"), "st-maya");
    expect(m.role?.code).toBe("care_guide");
    expect(m.impact.assignments.map((a) => a.householdId).sort()).toEqual([
      "hh-bennett",
      "hh-hart",
      "hh-okafor",
      "hh-rivera",
    ]);
    expect(m.impact.escalations.map((e) => e.householdId)).toEqual(["hh-hart"]);
    expect(m.impact.tasks.length).toBeGreaterThan(0);
    expect(m).toMatchObject({ isSelf: false, isLastOps: false });
    expect((await team.staffMember(t.db, await t.as("st-dana"), "st-dana")).isLastOps).toBe(true);
  });

  it("refuses changing yourself and removing the last operations lead", async () => {
    const dana = await t.as("st-dana");
    const lena = await t.as("st-lena");
    await expect(
      team.changeStaffRole(t.db, lena, { actorId: "st-lena", role: "care_guide", reason: REASON }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await expect(
      team.deactivateStaff(t.db, dana, { actorId: "st-dana", reason: REASON }),
    ).rejects.toMatchObject({
      code: "INVALID",
    });
    // Tomás becomes operations; Dana's role then changes underneath her open page (a stale context).
    await team.changeStaffRole(t.db, lena, { actorId: "st-tom", role: "hospice_ops", reason: REASON });
    await team.changeStaffRole(t.db, lena, {
      actorId: "st-dana",
      role: "care_guide",
      reason: REASON,
    });
    await expect(team.deactivateStaff(t.db, dana, { actorId: "st-tom", reason: REASON })).rejects.toThrow();
    // Tomás is now the only operations lead.
    expect((await team.staffMember(t.db, await t.as("st-tom"), "st-tom")).isLastOps).toBe(true);
  });
});

describe("changing a role", () => {
  it("leaving the care-guide role ends every assignment and releases escalations there", async () => {
    await team.changeStaffRole(t.db, await t.as("st-lena"), {
      actorId: "st-maya",
      role: "privileged_reviewer",
      reason: "Moved to the review team (synthetic).",
    });
    const maya = await t.as("st-maya");
    expect(maya.staffRoles).toEqual(["privileged_reviewer"]);
    expect(await activeAssignments("st-maya")).toEqual([]);
    const [hart] = await t.db.select().from(s.escalations).where(eq(s.escalations.householdId, "hh-hart"));
    expect(hart).toMatchObject({ ownerActorId: null, status: "open" });
    expect(
      (await events("assignment.ended")).filter(
        (e) => (e.context as { assignee?: string }).assignee === "st-maya",
      ),
    ).toHaveLength(4);
    expect(await events("staff.role_changed")).toHaveLength(1);
    // As a reviewer she now sees the whole hospice, by role.
    await expect(staff.householdOverview(t.db, maya, "hh-nguyen")).resolves.toBeTruthy();
    // The roster no longer lists her as a care guide.
    const r = await assignments.roster(t.db, await t.as("st-dana"));
    expect(r.guides.map((g) => g.name)).toEqual(["Sofia Reyes", "Tomás Alvarez"]);
    expect(r.organizationWide.map((p) => p.name)).toContain("Maya Chen");
  });

  it("refuses the same role and unknown roles", async () => {
    const dana = await t.as("st-lena");
    await expect(
      team.changeStaffRole(t.db, dana, { actorId: "st-maya", role: "care_guide", reason: REASON }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await expect(
      team.changeStaffRole(t.db, dana, {
        actorId: "st-maya",
        role: "coordinator" as "care_guide",
        reason: REASON,
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await expect(
      team.changeStaffRole(t.db, dana, { actorId: "st-maya", role: "hospice_ops", reason: " " }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("deactivating", () => {
  it("ends everything in one step and leaves no broken ownership", async () => {
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "1");
    vi.stubEnv("NODE_ENV", "development");
    const token = await createSession(t.db, {
      tenantId: "t-willow",
      actorId: "st-maya",
      userId: null,
      method: "development_persona",
    });
    const before = await team.staffMember(t.db, await t.as("st-dana"), "st-maya");
    await team.deactivateStaff(t.db, await t.as("st-dana"), { actorId: "st-maya", reason: REASON });

    const [actor] = await t.db.select().from(s.actors).where(eq(s.actors.id, "st-maya"));
    expect(actor!.deactivatedAt).toBeInstanceOf(Date);
    expect(await activeAssignments("st-maya")).toEqual([]);
    const org = await t.db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.actorId, "st-maya"), eq(s.memberships.organizationId, "org-willow")));
    expect(org.every((m) => m.status === "ended" && m.endReason?.includes(REASON))).toBe(true);
    // No open escalation or open staff task is left pointing at her.
    const owned = await t.db.select().from(s.escalations).where(eq(s.escalations.ownerActorId, "st-maya"));
    expect(owned.filter((e) => e.status !== "resolved")).toEqual([]);
    const tasks = await t.db
      .select()
      .from(s.tasks)
      .where(
        and(
          eq(s.tasks.assigneeActorId, "st-maya"),
          eq(s.tasks.status, "open"),
          eq(s.tasks.audience, "staff"),
        ),
      );
    expect(tasks).toEqual([]);
    expect((await events("task.unassigned")).length).toBe(before.impact.tasks.length);
    // Sessions are gone and any leftover token is refused; her context can't be built.
    expect(await t.db.select().from(s.sessions).where(eq(s.sessions.actorId, "st-maya"))).toEqual([]);
    expect(await actorForToken(t.db, token)).toBeNull();
    await expect(loadContext(t.db, "st-maya", "t-willow")).rejects.toMatchObject({
      code: "NOT_AUTHENTICATED",
    });
    // Her past work stays attributed to her.
    const notes = await t.db.select().from(s.staffNotes).where(eq(s.staffNotes.authorActorId, "st-maya"));
    expect(notes.length).toBeGreaterThan(0);
    // The roster lists her as former staff; she can't be assigned.
    const r = await assignments.roster(t.db, await t.as("st-dana"));
    expect(r.former.map((p) => p.name)).toEqual(["Maya Chen"]);
    expect(r.guides.map((g) => g.name)).toEqual(["Sofia Reyes", "Tomás Alvarez"]);
    await expect(
      assignments.assignCareGuide(t.db, await t.as("st-dana"), {
        householdId: "hh-nguyen",
        actorId: "st-maya",
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(await events("staff.deactivated")).toHaveLength(1);
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
    // Twice is refused calmly.
    await expect(
      team.deactivateStaff(t.db, await t.as("st-dana"), { actorId: "st-maya", reason: REASON }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("blocks password sign-in with the usual generic message", async () => {
    const inv = await auth.createStaffInvitation(t.db, await t.as("st-dana"), {
      name: "Noor Haddad",
      email: "noor@example.invalid",
      role: "care_guide",
    });
    const noor = await auth.acceptInvitation(t.db, {
      token: inv.acceptPath.replace("/invite/", ""),
      displayName: "Noor Haddad",
      password: PASSWORD,
    });
    const passwordSession = await createSession(t.db, { ...noor, method: "password" });
    await team.deactivateStaff(t.db, await t.as("st-dana"), { actorId: noor.actorId, reason: REASON });
    await expect(
      auth.signInWithPassword(t.db, { email: "noor@example.invalid", password: PASSWORD }),
    ).rejects.toThrow(auth.SIGN_IN_FAILED);
    expect(await actorForToken(t.db, passwordSession)).toBeNull();
  });

  it("the database refuses deactivating a family member", async () => {
    await expect(
      t.db.update(s.actors).set({ deactivatedAt: new Date() }).where(eq(s.actors.id, "fm-daniel")),
    ).rejects.toThrow();
  });
});
