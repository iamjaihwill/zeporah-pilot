import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import { submissionStatus } from "@/server/services/send-once";

/** Settling sends a device couldn't confirm (founder decision 86), with synthetic people only. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const M = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";
const NEVER = "33333333-3333-4333-8333-333333333333";

describe("submission status", () => {
  it("finds the person's own message and request, and says when they arrived", async () => {
    const daniel = await t.as("fm-daniel");
    await family.sendFamilyMessage(t.db, daniel, "Synthetic message.", M);
    await family.requestHumanSupport(t.db, daniel, {
      category: "Paperwork",
      message: "Synthetic.",
      contactTime: "",
      submissionId: R,
    });
    const r = await submissionStatus(t.db, daniel, [M, R, NEVER]);
    expect(r.map((x) => [x.id, x.arrived])).toEqual([
      [M, true],
      [R, true],
      [NEVER, false],
    ]);
    expect(r[0]!.at).toBeInstanceOf(Date);
    // Only whether and when: never the words.
    expect(Object.keys(r[0]!).sort()).toEqual(["arrived", "at", "id"]);
  });

  it("doesn't find someone else's send, and works for staff", async () => {
    await family.sendFamilyMessage(t.db, await t.as("fm-daniel"), "Synthetic message.", M);
    expect((await submissionStatus(t.db, await t.as("fm-grace"), [M]))[0]!.arrived).toBe(false);
    expect((await submissionStatus(t.db, await t.as("st-maya"), [M]))[0]!.arrived).toBe(false);
    await staff.sendStaffMessage(t.db, await t.as("st-maya"), {
      householdId: "hh-okafor",
      body: "Synthetic reply.",
      submissionId: NEVER,
    });
    expect((await submissionStatus(t.db, await t.as("st-maya"), [NEVER]))[0]!.arrived).toBe(true);
  });

  it("sends nothing and checks at most 20 at once", async () => {
    const ids = Array.from(
      { length: 25 },
      (_, i) => `4444444${String(i).padStart(2, "0")}-4444-4444-8444-444444444444`,
    );
    expect(await submissionStatus(t.db, await t.as("fm-daniel"), ids)).toHaveLength(20);
    expect(await submissionStatus(t.db, await t.as("fm-daniel"), [])).toEqual([]);
  });
});
