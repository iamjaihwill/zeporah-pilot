import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as ht from "@/server/services/household-tasks";
import * as st from "@/server/services/staff-tasks";
import * as family from "@/server/services/family";
import * as s from "@/server/db/schema";

/** Founder decisions 40 (care guides bulk-assign tasks) and 44 (coordinators manage household tasks). */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const base: ht.TaskInput = {
  title: "Arrange a ride to the pharmacy pickup",
  detail: "",
  assigneeActorId: null,
  dueAt: null,
  sensitive: false,
  visibility: "household",
  sharedWith: [],
};

describe("coordinators manage household tasks (decision 44)", () => {
  it("the coordinator adds, edits and closes a task; each is audited", async () => {
    const daniel = await t.as("fm-daniel");
    const { id } = await ht.createHouseholdTask(t.db, daniel, { ...base, assigneeActorId: "fm-chidi" });
    expect((await family.listFamilyTasks(t.db, await t.as("fm-chidi"))).some((x) => x.id === id)).toBe(true);
    await ht.editHouseholdTask(t.db, daniel, {
      ...base,
      id,
      assigneeActorId: "fm-ada",
      dueAt: "2026-11-01T17:00:00Z",
    });
    await ht.closeHouseholdTask(t.db, daniel, { id, reason: "A neighbour is doing it (synthetic)." });
    const actions = (await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.subjectId, id))).map(
      (e) => e.action,
    );
    expect(actions).toEqual(["task.created", "task.updated", "task.closed"]);
    const [row] = await t.db.select().from(s.tasks).where(eq(s.tasks.id, id));
    expect(row).toMatchObject({ status: "closed", assigneeActorId: "fm-ada" });
  });

  it("can assign to the household's care guide, not to staff elsewhere", async () => {
    const daniel = await t.as("fm-daniel");
    await ht.createHouseholdTask(t.db, daniel, { ...base, assigneeActorId: "st-maya" });
    await expect(
      ht.createHouseholdTask(t.db, daniel, { ...base, assigneeActorId: "st-tom" }),
    ).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(
      ht.createHouseholdTask(t.db, daniel, { ...base, assigneeActorId: "cfm-ben" }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("the patient can too (decision 48b); other family members can't", async () => {
    const { id } = await ht.createHouseholdTask(t.db, await t.as("fm-grace"), base);
    // A limited task they add stays visible to them.
    const own = await ht.createHouseholdTask(t.db, await t.as("fm-grace"), {
      ...base,
      title: "Choose music for the evenings",
      sensitive: true,
      visibility: "limited",
    });
    const mine = await family.listFamilyTasks(t.db, await t.as("fm-grace"));
    expect(mine.some((x) => x.id === id && x.canEdit)).toBe(true);
    expect(mine.some((x) => x.id === own.id)).toBe(true);
    for (const who of ["fm-ada", "fm-chidi"])
      await expect(ht.createHouseholdTask(t.db, await t.as(who), base)).rejects.toMatchObject({
        code: "NOT_PERMITTED",
      });
  });

  it("refuses medical orders and legal steps", async () => {
    const daniel = await t.as("fm-daniel");
    for (const title of [
      "Give 5 mg morphine at night",
      "Get the power of attorney signed",
      "Administer the evening dose",
    ])
      await expect(ht.createHouseholdTask(t.db, daniel, { ...base, title })).rejects.toMatchObject({
        code: "INVALID",
      });
  });

  it("can't change the care team's tasks", async () => {
    await expect(
      ht.editHouseholdTask(t.db, await t.as("fm-daniel"), { ...base, id: "tk-1" }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });

  it("a limited task is seen by the assignee, coordinators and the people named — not the patient unless named", async () => {
    const daniel = await t.as("fm-daniel");
    const { id } = await ht.createHouseholdTask(t.db, daniel, {
      ...base,
      title: "Sort out the spare room for the respite stay",
      sensitive: true,
      visibility: "limited",
      assigneeActorId: "fm-chidi",
      sharedWith: ["fm-ada"],
    });
    const sees = async (who: string) =>
      (await family.listFamilyTasks(t.db, await t.as(who))).some((x) => x.id === id);
    expect(await sees("fm-daniel")).toBe(true);
    expect(await sees("fm-chidi")).toBe(true);
    expect(await sees("fm-ada")).toBe(true);
    expect(await sees("fm-grace")).toBe(false);
    // Its title never appears in a family-visible audit summary.
    const [ev] = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.subjectId, id));
    expect(ev!.summary).not.toContain("spare room");
  });

  it("household tasks are shared with the patient (decision 46)", async () => {
    const { id } = await ht.createHouseholdTask(t.db, await t.as("fm-daniel"), base);
    expect((await family.listFamilyTasks(t.db, await t.as("fm-grace"))).some((x) => x.id === id)).toBe(true);
  });
});

describe("care guides bulk-assign tasks in their coverage (decision 40)", () => {
  it("previews, then needs a reason and confirmation, then audits", async () => {
    const maya = await t.as("st-maya");
    const ids = ["tk-hart-a", "tk-hart-b"];
    const p = await st.previewBulkTaskAssign(t.db, maya, { taskIds: ids, toActorId: "st-sofia" });
    expect(p.changing).toBe(2);
    expect(p.overdue).toBe(1);
    expect(p.dueSoon).toBe(1);
    // Nothing changed by the preview.
    const [a] = await t.db.select().from(s.tasks).where(eq(s.tasks.id, "tk-hart-a"));
    expect(a!.assigneeActorId).toBe("st-maya");
    await expect(
      st.bulkAssignTasks(t.db, maya, {
        taskIds: ids,
        toActorId: "st-sofia",
        reason: "Leave (synthetic).",
        confirmed: false,
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await expect(
      st.bulkAssignTasks(t.db, maya, { taskIds: ids, toActorId: "st-sofia", reason: " ", confirmed: true }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await st.bulkAssignTasks(t.db, maya, {
      taskIds: ids,
      toActorId: "st-sofia",
      reason: "Leave (synthetic).",
      confirmed: true,
    });
    for (const id of ids) {
      const [row] = await t.db.select().from(s.tasks).where(eq(s.tasks.id, id));
      expect(row!.assigneeActorId).toBe("st-sofia");
    }
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "task.bulk_reassigned"));
    expect(ev?.context).toMatchObject({ reason: "Leave (synthetic).", overdue: 1, dueSoon: 1 });
  });

  it("only to a care guide who covers that household", async () => {
    await expect(
      st.previewBulkTaskAssign(t.db, await t.as("st-maya"), { taskIds: ["tk-hart-a"], toActorId: "st-tom" }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("only tasks in the caller's own coverage", async () => {
    // Patel is Tomás's; Maya can't touch its tasks, even by id.
    const [patel] = await t.db
      .insert(s.tasks)
      .values({
        tenantId: "t-willow",
        householdId: "hh-patel",
        title: "Synthetic",
        audience: "staff",
        ownerActorId: "st-tom",
        assigneeActorId: "st-tom",
        source: "care_team",
      })
      .returning();
    await expect(
      st.previewBulkTaskAssign(t.db, await t.as("st-maya"), { taskIds: [patel!.id], toActorId: "st-maya" }),
    ).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });

  it("not household tasks, and not for operations or other hospices", async () => {
    await expect(
      st.previewBulkTaskAssign(t.db, await t.as("st-maya"), { taskIds: ["tk-1"], toActorId: "st-maya" }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await expect(st.myCoverageTasks(t.db, await t.as("st-dana"))).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
    const jordan = await t.as("cst-jordan", "t-cedar");
    await expect(
      st.previewBulkTaskAssign(t.db, jordan, { taskIds: ["tk-hart-a"], toActorId: "st-sofia" }),
    ).rejects.toThrow();
  });
});
