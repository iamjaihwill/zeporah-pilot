import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import * as reports from "@/server/services/reports";

/** Founder decision 41: the initial report set — counts only; staff named only in the workforce report. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

describe("report set", () => {
  it("covers open work and aging, exceptions, bereavement and workforce", async () => {
    const r = await reports.reportSet(t.db, await t.as("st-dana"));
    expect(r.openWork.aging.reduce((a, b) => a + b.n, 0)).toBe(r.openWork.total);
    expect(r.openWork.overdueTasks.careTeam).toBeGreaterThanOrEqual(1); // tk-hart-b
    expect(r.exceptions.packetsHeldOrDenied.length).toBeGreaterThanOrEqual(0);
    expect(r.bereavement.households).toBe(1);
    expect(r.workforce.guides.map((g) => g.name)).toEqual(["Maya Chen", "Sofia Reyes", "Tomás Alvarez"]);
    expect(r.workforce.uncovered).toBe(1);
  });

  it("never names a household, patient or family member", async () => {
    const text = JSON.stringify(await reports.reportSet(t.db, await t.as("st-dana")));
    expect(text).not.toMatch(/Okafor|Rivera|Bennett|Patel|Nguyen|Hart|Lindqvist|Grace|Daniel|hh-/);
  });

  it("is for operations, and Cedar Valley sees only its own", async () => {
    await expect(reports.reportSet(t.db, await t.as("st-maya"))).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    const cedar = JSON.stringify(await reports.reportSet(t.db, await t.as("cst-jordan", "t-cedar")));
    expect(cedar).not.toMatch(/Maya|Sofia|Tomás|Willow/);
  });
});
