import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as assignments from "@/server/services/assignments";
import * as staff from "@/server/services/staff";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const REASON = "Caseload change (synthetic).";
async function active(actorId: string, householdId: string) {
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
  return m;
}

describe("roster", () => {
  it("is for hospice operations only", async () => {
    for (const who of ["st-maya", "st-priya", "fm-daniel"])
      await expect(assignments.roster(t.db, await t.as(who))).rejects.toMatchObject({
        code: "NOT_PERMITTED",
      });
  });

  it("shows each care guide's households and counts, uncovered households and organization-wide staff", async () => {
    const r = await assignments.roster(t.db, await t.as("st-dana"));
    expect(r.guides.map((g) => [g.name, g.count])).toEqual([
      ["Maya Chen", 4],
      ["Sofia Reyes", 1],
      ["Tomás Alvarez", 2],
    ]);
    expect(r.guides[2]!.households.map((h) => h.id)).toEqual(["hh-lindqvist", "hh-patel"]);
    expect(r.uncovered.map((h) => h.id)).toEqual(["hh-nguyen"]);
    expect(r.organizationWide.map((p) => p.name).sort()).toEqual(["Dana Brooks", "Lena Hoffman", "Priya Raman"]);
    expect(r.ineligible).toEqual([]);
    // Nothing from another hospice.
    expect(JSON.stringify(r)).not.toMatch(/Moss|Cedar|cst-/);
  });

  it("leaves closed households out of the uncovered list", async () => {
    await t.db.update(s.households).set({ lifecycleState: "closed" }).where(eq(s.households.id, "hh-nguyen"));
    expect((await assignments.roster(t.db, await t.as("st-dana"))).uncovered).toEqual([]);
  });

  it("flags assignments held by someone who is no longer an active care guide", async () => {
    // Tomás's organization role ends (staff lifecycle is a later increment; done directly here).
    await t.db
      .update(s.memberships)
      .set({ status: "ended", endedAt: new Date(), endReason: "Left the hospice (synthetic)." })
      .where(and(eq(s.memberships.actorId, "st-tom"), eq(s.memberships.organizationId, "org-willow")));
    const r = await assignments.roster(t.db, await t.as("st-dana"));
    expect(r.guides.map((g) => g.name)).toEqual(["Maya Chen", "Sofia Reyes"]);
    expect(r.ineligible.map((a) => [a.guideName, a.household.id]).sort()).toEqual([
      ["Tomás Alvarez", "hh-lindqvist"],
      ["Tomás Alvarez", "hh-patel"],
    ]);
    // Their households count as uncovered, and they can't be the target of a new assignment.
    expect(r.uncovered.map((h) => h.id).sort()).toEqual(["hh-lindqvist", "hh-nguyen", "hh-patel"]);
    await expect(
      assignments.assignCareGuide(t.db, await t.as("st-dana"), {
        householdId: "hh-nguyen",
        actorId: "st-tom",
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    // Ending a stale assignment still works.
    const stale = r.ineligible.find((a) => a.household.id === "hh-patel")!;
    await assignments.endAssignment(t.db, await t.as("st-dana"), {
      membershipId: stale.membershipId,
      reason: REASON,
    });
    expect(await active("st-tom", "hh-patel")).toBeUndefined();
  });
});

describe("reassignment", () => {
  it("moves a household in one step, audited both ways", async () => {
    const from = (await active("st-maya", "hh-hart"))!;
    await assignments.reassignCareGuide(t.db, await t.as("st-dana"), {
      membershipId: from.id,
      toActorId: "st-tom",
      reason: REASON,
    });
    expect(await active("st-maya", "hh-hart")).toBeUndefined();
    expect(await active("st-tom", "hh-hart")).toBeTruthy();
    await expect(staff.householdOverview(t.db, await t.as("st-maya"), "hh-hart")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    await expect(staff.householdOverview(t.db, await t.as("st-tom"), "hh-hart")).resolves.toBeTruthy();
    const ev = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.householdId, "hh-hart"));
    expect(ev.filter((e) => e.action === "assignment.ended" && e.subjectId === from.id)).toHaveLength(1);
    expect(
      ev.filter((e) => e.action === "assignment.created" && e.actorId === "st-dana").length,
    ).toBeGreaterThan(1);
    expect(ev.filter((e) => e.action === "escalation.owner_released")).toHaveLength(1);
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });

  it("changes nothing when the new guide is already assigned, ineligible, or the same person", async () => {
    const dana = await t.as("st-dana");
    const from = (await active("st-maya", "hh-hart"))!;
    await assignments.assignCareGuide(t.db, dana, { householdId: "hh-hart", actorId: "st-tom" });
    await expect(
      assignments.reassignCareGuide(t.db, dana, {
        membershipId: from.id,
        toActorId: "st-tom",
        reason: REASON,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Rolled back: Maya is still assigned.
    expect(await active("st-maya", "hh-hart")).toBeTruthy();
    for (const toActorId of ["st-maya", "st-priya", "cst-sam", "fm-june"])
      await expect(
        assignments.reassignCareGuide(t.db, dana, { membershipId: from.id, toActorId, reason: REASON }),
      ).rejects.toMatchObject({ code: "INVALID" });
    await expect(
      assignments.reassignCareGuide(t.db, dana, { membershipId: from.id, toActorId: "st-tom", reason: " " }),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(await active("st-maya", "hh-hart")).toBeTruthy();
  });

  it("is for hospice operations only", async () => {
    const from = (await active("st-maya", "hh-hart"))!;
    for (const who of ["st-maya", "st-priya"])
      await expect(
        assignments.reassignCareGuide(t.db, await t.as(who), {
          membershipId: from.id,
          toActorId: "st-tom",
          reason: REASON,
        }),
      ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });
});
