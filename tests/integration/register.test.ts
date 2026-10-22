import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import * as register from "@/server/services/register";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const households = async (who: string) =>
  [...new Set((await register.sharingRegister(t.db, await t.as(who))).map((r) => r.householdId))].sort();

describe("sharing register", () => {
  it("shows exactly the households each person can already see", async () => {
    const all = await households("st-dana");
    expect(all).toContain("hh-nguyen");
    expect(all.some((h) => h.startsWith("chh-"))).toBe(false);
    expect(await households("st-priya")).toEqual(all);
    const maya = await households("st-maya");
    expect(maya.every((h) => ["hh-rivera", "hh-okafor", "hh-bennett", "hh-hart"].includes(h))).toBe(true);
    const tom = await households("st-tom");
    expect(tom.every((h) => ["hh-patel", "hh-lindqvist"].includes(h))).toBe(true);
    await expect(register.sharingRegister(t.db, await t.as("fm-daniel"))).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
  });

  it("flags what needs a person, open corrections and withdrawn consents", async () => {
    const rows = await register.sharingRegister(t.db, await t.as("st-dana"));
    const patel = rows.filter((r) => r.householdId === "hh-patel" && r.correctionOpen);
    expect(patel.length).toBe(1);
    expect(patel[0]!.needsAction).toBe(true);
    const meals = rows.find((r) => r.id === "cs-nguyen-meals")!;
    expect(meals.stage).toBe("revoked");
    expect(meals.needsAction).toBe(false);
    expect(meals.endingSoon).toBe(false);
    const equipment = rows.find((r) => r.id === "cs-okafor-equipment")!;
    expect(equipment.version).toBe(2);
  });
});

describe("consent history", () => {
  it("lists every recorded step, newest first, with versions and changed fields", async () => {
    const h = await register.consentHistory(t.db, await t.as("st-dana"), "cs-okafor-equipment");
    const actions = h.history.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["consent.recorded", "consent.amended"]));
    expect(actions.indexOf("consent.amended")).toBeLessThan(actions.indexOf("consent.recorded"));
    const amended = h.history.find((e) => e.action === "consent.amended")!;
    expect(amended.version).toBe(2);
    expect(amended.changed.length).toBeGreaterThan(0);
    expect(h.confirmations.map((c) => c.version)).toContain(1);
    expect(h.consent.household).toBe("The Okafor household");
  });

  it("refuses a consent outside the person's households like a missing one", async () => {
    const maya = await t.as("st-maya");
    const outside = await register
      .consentHistory(t.db, maya, "cs-nguyen-meals")
      .catch((e: Error) => e.message);
    const missing = await register.consentHistory(t.db, maya, "cs-nope").catch((e: Error) => e.message);
    expect(outside).toMatch(/isn't available/);
    expect(missing).toMatch(/isn't available/);
    await expect(
      register.consentHistory(t.db, await t.as("fm-ada"), "cs-okafor-equipment"),
    ).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
    await expect(
      register.consentHistory(t.db, await t.as("cst-jordan", "t-cedar"), "cs-okafor-equipment"),
    ).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });
});
