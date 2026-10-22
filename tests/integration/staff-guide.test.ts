import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import { guideState, updateGuide } from "@/server/services/staff-guide";
import * as s from "@/server/db/schema";

/** The care-team first-time guide (2026-10-21). */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  t = await freshDb();
});
afterEach(async () => {
  await t.close();
});

describe("first-time guide", () => {
  it("isn't offered to people who've been here a while, but the tour still is from Help", async () => {
    const g = await guideState(t.db, await t.as("st-maya"));
    expect(g).toMatchObject({
      newcomer: false,
      showWelcome: false,
      showChecklist: false,
      role: "care_guide",
    });
  });

  it("is offered to someone new, ticks off from their own audit entries, and can be hidden", async () => {
    // Make Maya new: her role started yesterday.
    await t.db
      .update(s.memberships)
      .set({ createdAt: new Date(Date.now() - 86_400_000) })
      .where(eq(s.memberships.actorId, "st-maya"));
    const maya = await t.as("st-maya");
    let g = await guideState(t.db, maya);
    expect(g).toMatchObject({ newcomer: true, showWelcome: true, showChecklist: true });
    // The seed has Maya taking ownership of an escalation, so that item is already done.
    expect(g.checklist.find((c) => c.key === "own")?.done).toBe(true);
    expect(g.checklist.find((c) => c.key === "tour")?.done).toBe(false);
    // "Not now": the welcome card goes; the checklist (with the tour on it) stays.
    await updateGuide(t.db, maya, { dismissWelcome: true });
    g = await guideState(t.db, maya);
    expect(g).toMatchObject({ showWelcome: false, showChecklist: true, tourDone: false });
    await updateGuide(t.db, maya, { tourDone: true });
    g = await guideState(t.db, maya);
    expect(g).toMatchObject({ showWelcome: false, showChecklist: true, tourDone: true });
    expect(g.checklist.find((c) => c.key === "tour")?.done).toBe(true);
    await updateGuide(t.db, maya, { hideChecklist: true });
    expect((await guideState(t.db, maya)).showChecklist).toBe(false);
  });

  it("gives each role its own steps", async () => {
    expect((await guideState(t.db, await t.as("st-dana"))).role).toBe("hospice_ops");
    expect((await guideState(t.db, await t.as("st-priya"))).role).toBe("privileged_reviewer");
    expect((await guideState(t.db, await t.as("st-lena"))).role).toBe("hospice_admin");
  });

  it("is for the care team only", async () => {
    await expect(guideState(t.db, await t.as("fm-daniel"))).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });
});
