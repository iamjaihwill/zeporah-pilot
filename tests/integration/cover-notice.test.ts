import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { freshDb } from "./helpers";
import { staffScope } from "@/server/context";
import {
  acceptHandoff,
  cancelAbsence,
  offerCover,
  postCoverNotices,
  recordAbsence,
} from "@/server/services/coverage";
import { familyHome, getThread } from "@/server/services/family";
import * as s from "@/server/db/schema";

/** Decision 62 (register R-05, option C): the household is told when cover becomes active. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  t = await freshDb();
});
afterEach(async () => {
  await t.close();
});

const H = 3_600_000;
const NOTICE = /^Sofia Reyes is your care guide until [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d\d [AP]M$/;

/** Maya is away from `fromHours` to `toHours` from now; Sofia accepts cover for Okafor. */
async function sofiaCovers(fromHours: number, toHours = fromHours + 4) {
  const dana = await t.as("st-dana");
  const { id: absenceId } = await recordAbsence(t.db, dana, {
    actorId: "st-maya",
    startsAt: new Date(Date.now() + fromHours * H),
    endsAt: new Date(Date.now() + toHours * H),
    reason: "Annual leave (synthetic)",
  });
  const { id } = await offerCover(t.db, dana, {
    absenceId,
    householdId: "hh-okafor",
    toActorId: "st-sofia",
    note: "",
  });
  await acceptHandoff(t.db, await t.as("st-sofia"), id);
  return absenceId;
}
/** Move the accepted cover's start into the past: the window has opened. */
const coverStarts = () =>
  t.db
    .update(s.memberships)
    .set({ startsAt: new Date(Date.now() - 60_000) })
    .where(and(eq(s.memberships.actorId, "st-sofia"), isNotNull(s.memberships.coverForActorId)));
const notices = async (who: string) =>
  (await familyHome(t.db, await t.as(who))).updates.filter((u) => NOTICE.test(u.title));

describe("cover notice for the household (decision 62)", () => {
  it("says nothing before cover starts, and Sofia can't open the household yet", async () => {
    await sofiaCovers(2);
    expect(await postCoverNotices(t.db, "t-willow")).toBe(0);
    expect(await notices("fm-daniel")).toHaveLength(0);
    const home = await familyHome(t.db, await t.as("fm-daniel"));
    expect(home.careGuide).toBe("Maya Chen");
    expect(home.careGuideUntil).toBeNull();
    await expect(
      staffScope(t.db, await t.as("st-sofia"), "hh-okafor", "staff.household.view"),
    ).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });

  it("posts one update when cover starts, to the coordinator, active proxies and the patient only", async () => {
    await sofiaCovers(2);
    await coverStarts();
    // The first load after the start posts it (no timer); later loads don't post it again.
    expect(await notices("fm-daniel")).toHaveLength(1);
    expect(await postCoverNotices(t.db, "t-willow")).toBe(0);
    for (const who of ["fm-daniel", "fm-ada", "fm-grace"]) expect(await notices(who), who).toHaveLength(1);
    // Chidi (a family member, not the coordinator, a proxy or the patient) isn't in the audience.
    expect(await notices("fm-chidi")).toHaveLength(0);
    const thread = await getThread(t.db, await t.as("fm-chidi"));
    expect(JSON.stringify(thread)).not.toContain("is your care guide until");

    const [u] = await t.db
      .select()
      .from(s.familyUpdates)
      .where(eq(s.familyUpdates.systemKind, "cover_started"));
    expect(u).toMatchObject({ authorActorId: null, requiresAck: false });
    expect(u!.audienceActorIds).toEqual(["fm-ada", "fm-daniel", "fm-grace"]);
    expect(u!.body).toBe(
      "Maya Chen is away until then. Messages reach your care team as usual, and your hospice's 24-hour line is unchanged.",
    );
    // No staffing reason reaches the family.
    expect(`${u!.title} ${u!.body}`).not.toMatch(/leave|synthetic/i);

    const events = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "update.cover_notice_posted"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: null,
      householdId: "hh-okafor",
      subjectId: u!.id,
      visibility: "staff",
    });
    expect(events[0]!.context).toMatchObject({
      source: "system",
      audience: ["fm-ada", "fm-daniel", "fm-grace"],
    });
  });

  it("names the covering guide on Home only during the window, then reverts", async () => {
    await sofiaCovers(2);
    await coverStarts();
    const during = await familyHome(t.db, await t.as("fm-daniel"));
    expect(during.careGuide).toBe("Sofia Reyes");
    expect(during.careGuideUntil).toBeInstanceOf(Date);
    // Sofia can open the household now that the window has opened.
    expect(
      await staffScope(t.db, await t.as("st-sofia"), "hh-okafor", "staff.household.view").then(
        () => true,
        () => false,
      ),
    ).toBe(true);
    // The window ends: Home names Maya again.
    await t.db
      .update(s.memberships)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(and(eq(s.memberships.actorId, "st-sofia"), isNotNull(s.memberships.coverForActorId)));
    const after = await familyHome(t.db, await t.as("fm-daniel"));
    expect(after.careGuide).toBe("Maya Chen");
    expect(after.careGuideUntil).toBeNull();
  });

  it("posts nothing if the cover was cancelled before it started", async () => {
    const absenceId = await sofiaCovers(2);
    await cancelAbsence(t.db, await t.as("st-dana"), absenceId);
    await coverStarts();
    expect(await postCoverNotices(t.db, "t-willow")).toBe(0);
    expect(await notices("fm-daniel")).toHaveLength(0);
    expect((await familyHome(t.db, await t.as("fm-daniel"))).careGuide).toBe("Maya Chen");
  });
});

describe("the demo week (decision 62)", () => {
  it("end of week: the household was told on Day 5, and Home names Maya again", async () => {
    await t.close();
    t = await freshDb(new Date(), "demo_endweek");
    expect(await notices("fm-daniel")).toHaveLength(1);
    expect(await notices("fm-chidi")).toHaveLength(0);
    expect((await familyHome(t.db, await t.as("fm-daniel"))).careGuide).toBe("Maya Chen");
    // Nothing new is posted: that cover has ended.
    expect(await postCoverNotices(t.db, "t-willow")).toBe(0);
  });

  it("mid-week: cover is arranged but hasn't started, so the household hasn't been told", async () => {
    await t.close();
    t = await freshDb(new Date(), "demo_midweek");
    expect(await notices("fm-daniel")).toHaveLength(0);
  });
});
