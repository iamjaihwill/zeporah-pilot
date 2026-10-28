import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as assignments from "@/server/services/assignments";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as requests from "@/server/services/requests";
import * as team from "@/server/services/team";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const REASON = "Caseload change (synthetic).";
const events = (action: string) => t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, action));
async function assignment(actorId: string, householdId: string) {
  const [m] = await t.db
    .select()
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.actorId, actorId),
        eq(s.memberships.householdId, householdId),
        eq(s.memberships.roleCode, "care_guide"),
        eq(s.memberships.status, "active"),
      ),
    );
  return m!;
}
const openStaffTasks = (householdId: string) =>
  t.db
    .select()
    .from(s.tasks)
    .where(
      and(eq(s.tasks.householdId, householdId), eq(s.tasks.audience, "staff"), eq(s.tasks.status, "open")),
    );
const hartEscalation = async () =>
  (await t.db.select().from(s.escalations).where(eq(s.escalations.householdId, "hh-hart")))[0]!;

describe("ending an assignment never leaves hidden ownership", () => {
  it("unassigns the guide's open care-team tasks in that household only", async () => {
    const okafor = (await openStaffTasks("hh-okafor")).filter((x) => x.assigneeActorId === "st-maya");
    expect(okafor.length).toBeGreaterThan(0);
    const elsewhere = (
      await t.db.select().from(s.tasks).where(eq(s.tasks.assigneeActorId, "st-maya"))
    ).filter((x) => x.householdId !== "hh-okafor" && x.status === "open");
    await assignments.endAssignment(t.db, await t.as("st-dana"), {
      membershipId: (await assignment("st-maya", "hh-okafor")).id,
      reason: REASON,
    });
    expect((await openStaffTasks("hh-okafor")).filter((x) => x.assigneeActorId === "st-maya")).toEqual([]);
    expect((await events("task.unassigned")).map((e) => e.subjectId).sort()).toEqual(
      okafor.map((x) => x.id).sort(),
    );
    for (const x of elsewhere) {
      const [still] = await t.db.select().from(s.tasks).where(eq(s.tasks.id, x.id));
      expect(still!.assigneeActorId).toBe("st-maya");
    }
    // The queue never shows Maya as the owner of Okafor work any more.
    const rows = (await staff.coordinationQueue(t.db, await t.as("st-dana"))).filter(
      (r) => r.kind === "task" && r.householdId === "hh-okafor",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.owner === "Maya Chen")).toBe(false);
  });
});

describe("reassignment hand-over", () => {
  it("moves open escalations and tasks to the new guide only when asked, and tells them", async () => {
    const before = await hartEscalation();
    expect(before.ownerActorId).toBe("st-maya");
    const tasks = (await openStaffTasks("hh-hart")).filter((x) => x.assigneeActorId === "st-maya");
    await assignments.reassignCareGuide(t.db, await t.as("st-dana"), {
      membershipId: (await assignment("st-maya", "hh-hart")).id,
      toActorId: "st-tom",
      reason: REASON,
      handOver: true,
    });
    const after = await hartEscalation();
    expect(after).toMatchObject({ ownerActorId: "st-tom", status: before.status });
    for (const x of tasks) {
      const [moved] = await t.db.select().from(s.tasks).where(eq(s.tasks.id, x.id));
      expect(moved!.assigneeActorId).toBe("st-tom");
    }
    expect(await events("escalation.owner_released")).toEqual([]);
    expect((await events("escalation.owner_transferred")).map((e) => e.subjectId)).toEqual([before.id]);
    expect((await events("task.reassigned")).length).toBe(tasks.length);
    const notes = await t.db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.recipientActorId, "st-tom"));
    expect(notes.some((n) => n.kind === "handoff" && n.householdId === "hh-hart")).toBe(true);
    // The queue shows the new owner, and Tomás can act on it.
    const row = (await staff.coordinationQueue(t.db, await t.as("st-dana"))).find(
      (r) => r.kind === "escalation" && r.householdId === "hh-hart",
    );
    expect(row?.owner).toBe("Tomás Alvarez");
    await staff.updateEscalation(t.db, await t.as("st-tom"), {
      id: before.id,
      action: "resolve",
      resolution: "Talked it through (synthetic).",
    });
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });

  it("releases instead when not asked", async () => {
    await assignments.reassignCareGuide(t.db, await t.as("st-dana"), {
      membershipId: (await assignment("st-maya", "hh-hart")).id,
      toActorId: "st-tom",
      reason: REASON,
    });
    expect(await hartEscalation()).toMatchObject({ ownerActorId: null, status: "open" });
    expect(await events("escalation.owner_transferred")).toEqual([]);
  });
});

describe("giving an escalation to a named owner", () => {
  async function released() {
    await assignments.endAssignment(t.db, await t.as("st-dana"), {
      membershipId: (await assignment("st-maya", "hh-hart")).id,
      reason: REASON,
    });
    return (await hartEscalation()).id;
  }

  it("is for operations, to someone who can see the household", async () => {
    const id = await released();
    for (const who of ["st-maya", "st-tom", "st-priya"])
      await expect(
        staff.giveEscalation(t.db, await t.as(who), { id, actorId: "st-priya" }),
      ).rejects.toMatchObject({
        code: "NOT_PERMITTED",
      });
    const dana = await t.as("st-dana");
    // Tomás isn't assigned to Hart; Cedar's staff and families are never candidates.
    for (const actorId of ["st-tom", "cst-sam", "fm-june", "st-maya"])
      await expect(staff.giveEscalation(t.db, dana, { id, actorId })).rejects.toMatchObject({
        code: "INVALID",
      });
    const list = (await staff.listEscalations(t.db, dana)).find((e) => e.id === id)!;
    expect(list.owners.map((o) => o.name)).toEqual(["Dana Brooks", "Priya Raman", "Sofia Reyes"]);
    expect(
      (await staff.listEscalations(t.db, await t.as("st-tom"))).every((e) => e.owners.length === 0),
    ).toBe(true);
  });

  it("offers it (decision 83): the owner is set only when they accept; resolved ones can't be given", async () => {
    const id = await released();
    const dana = await t.as("st-dana");
    await staff.giveEscalation(t.db, dana, { id, actorId: "st-priya" });
    expect(await hartEscalation()).toMatchObject({
      ownerActorId: null,
      status: "open",
      offeredToActorId: "st-priya",
    });
    expect((await events("escalation.offered")).map((e) => e.subjectId)).toEqual([id]);
    const notes = await t.db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.recipientActorId, "st-priya"));
    expect(notes.some((n) => n.kind === "handoff")).toBe(true);
    await expect(staff.giveEscalation(t.db, dana, { id, actorId: "st-priya" })).rejects.toMatchObject({
      code: "INVALID",
    });
    await requests.acceptEscalationOffer(t.db, await t.as("st-priya"), { id });
    expect(await hartEscalation()).toMatchObject({
      ownerActorId: "st-priya",
      status: "acknowledged",
      offeredToActorId: null,
    });
    await staff.updateEscalation(t.db, await t.as("st-priya"), {
      id,
      action: "resolve",
      resolution: "Done (synthetic).",
    });
    await expect(staff.giveEscalation(t.db, dana, { id, actorId: "st-dana" })).rejects.toMatchObject({
      code: "INVALID",
    });
  });

  it("never offers a deactivated person", async () => {
    const id = await released();
    const dana = await t.as("st-dana");
    await team.changeStaffRole(t.db, await t.as("st-lena"), {
      actorId: "st-tom",
      role: "hospice_ops",
      reason: REASON,
    });
    await team.deactivateStaff(t.db, dana, { actorId: "st-tom", reason: REASON });
    const list = (await staff.listEscalations(t.db, dana)).find((e) => e.id === id)!;
    expect(list.owners.map((o) => o.name)).not.toContain("Tomás Alvarez");
    await expect(staff.giveEscalation(t.db, dana, { id, actorId: "st-tom" })).rejects.toMatchObject({
      code: "INVALID",
    });
  });
});

describe("message threads", () => {
  it("have no personal owner: unanswered messages follow whoever is assigned now", async () => {
    await family.sendFamilyMessage(t.db, await t.as("fm-daniel"), "A synthetic question for the care team.");
    await assignments.reassignCareGuide(t.db, await t.as("st-dana"), {
      membershipId: (await assignment("st-maya", "hh-okafor")).id,
      toActorId: "st-tom",
      reason: REASON,
    });
    const row = (await staff.coordinationQueue(t.db, await t.as("st-tom"))).find(
      (r) => r.kind === "message" && r.householdId === "hh-okafor",
    );
    expect(row?.owner).toBe("Tomás Alvarez");
  });
});
