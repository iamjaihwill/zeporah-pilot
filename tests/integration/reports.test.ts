import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as reports from "@/server/services/reports";
import * as bereavement from "@/server/services/bereavement";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as s from "@/server/db/schema";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

describe("operations report", () => {
  it("is for hospice operations only", async () => {
    for (const who of ["st-maya", "st-priya", "fm-daniel"])
      await expect(reports.operationsReport(t.db, await t.as(who))).rejects.toMatchObject({
        code: "NOT_PERMITTED",
      });
  });

  it("counts this hospice's workflow without listing households or people", async () => {
    await staff.householdOverview(t.db, await t.as("st-maya"), "hh-nguyen").catch(() => null);
    const r = await reports.operationsReport(t.db, await t.as("st-dana"));
    const stage = new Map(r.households.byStage.map((x) => [x.stage, x.n]));
    expect(stage.get("Bereavement support")).toBe(1);
    // Rivera and Wells.
    expect(stage.get("Getting started")).toBe(2);
    expect(r.households.uncovered).toBe(1);
    expect(r.caseload).toEqual([
      { name: "Maya Chen", n: 4 },
      { name: "Sofia Reyes", n: 2 },
      { name: "Tomás Alvarez", n: 2 },
    ]);
    expect(r.corrections).toBeGreaterThan(0);
    expect(r.bereavement.dueWithinMonth).toBe(2);
    expect(r.access.refusedLast30Days).toBeGreaterThan(0);
    // Counts only: no household, patient or family names.
    expect(JSON.stringify(r)).not.toMatch(/The \w+ household|Okafor|Lindqvist|Ingrid|Grace|Moss/);
  });
});

describe("closing a household", () => {
  const close = async (
    who: string,
    householdId = "hh-lindqvist",
    reason = "Support completed (synthetic).",
  ) => reports.closeHousehold(t.db, await t.as(who), { householdId, reason });

  it("operations closes a bereavement household; it becomes read-only and leaves the workload", async () => {
    await close("st-dana");
    const [h] = await t.db.select().from(s.households).where(eq(s.households.id, "hh-lindqvist"));
    expect(h!.lifecycleState).toBe("closed");
    const [ev] = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "lifecycle.closed"));
    expect(ev).toMatchObject({ householdId: "hh-lindqvist", visibility: "staff" });
    expect((await bereavement.bereavementWorkload(t.db, await t.as("st-tom"))).open).toEqual([]);
    // The family can still read, but not send.
    await expect(family.getBereavement(t.db, await t.as("fm-ingrid"))).resolves.toBeTruthy();
    await expect(
      family.sendFamilyMessage(t.db, await t.as("fm-ingrid"), "Hello (synthetic)"),
    ).rejects.toThrow();
    // Twice is refused.
    await expect(close("st-dana")).rejects.toMatchObject({ code: "INVALID" });
  });

  it("is refused for other stages, without a reason, and for roles that can't confirm transitions", async () => {
    await expect(close("st-dana", "hh-okafor")).rejects.toMatchObject({ code: "INVALID" });
    await expect(close("st-dana", "hh-lindqvist", " ")).rejects.toMatchObject({ code: "INVALID" });
    for (const who of ["st-tom", "st-priya", "fm-ingrid"])
      await expect(close(who)).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await expect(close("st-dana", "chh-moss")).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });
});
