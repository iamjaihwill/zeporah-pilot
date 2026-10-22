import { afterEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { coordinationQueue } from "@/server/services/staff";
import { trendsReport } from "@/server/services/reports";
import { confirmConsent } from "@/server/services/family";
import { acceptHandoff, coverageBoard, offerCover } from "@/server/services/coverage";
import { householdAccessMap } from "@/server/services/access-map";
import { resolvedExceptions } from "@/server/services/exceptions";
import { catchMeUp } from "@/server/services/prepared";
import { staffScope } from "@/server/context";

/** The enterprise direction's design refinements (plan Phase 7, stories D-2 and D-6). */
let t: Awaited<ReturnType<typeof freshDb>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const row = async (who: string, id: string) =>
  (await coordinationQueue(t!.db, await t!.as(who))).find((r) => r.id === id);

describe("what an exception rests on (D-2)", () => {
  it("names the consent behind missing consent, released access and draft packets", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    expect((await row("st-maya", "missing_consent:partner_event:pe-demo-oakwood"))?.basis).toEqual({
      text: "Consent for Oakwood Home Medical Supply (synthetic), version 2: waiting for household confirmation. It must be active before anything is shared",
      until: null,
    });
    const access = (await row("st-maya", "access_ending:packet:pk-okafor-respite"))!.basis!;
    expect(access.text).toBe(
      "Shared under: Consent for Brightwater Respite House (synthetic), version 1: active",
    );
    expect(access.until).toBeInstanceOf(Date);
    // A packet that hasn't been released hasn't shared anything yet.
    const drafts = (await coordinationQueue(t.db, await t.as("st-dana"))).filter((r) => r.kind === "packet");
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts)
      expect(d.basis?.text).toMatch(/^(Drafted under: Consent for |No consent is linked)/);
  });

  it("says who recorded a consent waiting for activation, and names authority records without deciding them", async () => {
    t = await freshDb();
    await confirmConsent(t.db, await t.as("fm-ada"), { consentId: "cs-okafor-equipment", version: 2 });
    const activation = (await coordinationQueue(t.db, await t.as("st-priya"))).find(
      (r) => r.kind === "consent" && r.subjectId === "cs-okafor-equipment",
    )!;
    expect(activation.basis?.text).toMatch(
      /^Consent for .+, version 2: confirmed — waiting for a reviewer to activate\. Recorded by .+, so a different reviewer activates it$/,
    );
    const authority = (await coordinationQueue(t.db, await t.as("st-priya"))).find(
      (r) => r.kind === "authority",
    )!;
    expect(authority.basis?.text).toMatch(
      /record\. The app records the workflow; it doesn't decide legal authority$/,
    );
  });

  it("leaves rows that don't rest on a consent or authority record without one", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const rows = await coordinationQueue(t.db, await t.as("st-dana"));
    for (const r of rows.filter((x) =>
      ["task", "coverage_gap", "stalled_handoff", "risk"].includes(x.category),
    ))
      expect(r.basis, r.id).toBeNull();
  });
});

describe("prepared work in Reports (D-6)", () => {
  it("counts what was used, from recorded events only", async () => {
    t = await freshDb(new Date(), "demo_endweek");
    const r = await trendsReport(t.db, await t.as("st-dana"), { days: 7 });
    // The week's prepared reply (Day 1) and prepared handoff note (Day 4); no summaries were opened.
    expect(r.prepared).toEqual({ summaries: 0, replies: 1, handoffNotes: 1, packetContents: 0 });
  });
});

describe("demo-fix pass (rehearsal 2026-10-22)", () => {
  it("S-11: accepted cover that hasn't started is listed, with nothing visible yet", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const dana = await t.as("st-dana");
    const absence = (await coverageBoard(t.db, dana)).absences[0]!;
    const { id } = await offerCover(t.db, dana, {
      absenceId: absence.id,
      householdId: "hh-okafor",
      toActorId: "st-sofia",
      note: "",
    });
    await acceptHandoff(t.db, await t.as("st-sofia"), id);
    const map = await householdAccessMap(t.db, dana, "hh-okafor");
    const sofia = map.rows.find((r) => r.who === "Sofia Reyes")!;
    expect(sofia.basis).toBe("Care guide, covering for Maya Chen, not started yet");
    expect(sofia.from).toBeInstanceOf(Date);
    expect(Object.values(sofia.cells).every((c) => c.text === "Not yet")).toBe(true);
  });

  it("S-12, S-13: Resolved shows the rerouted stalled handoff, and no call that didn't clear its update", async () => {
    t = await freshDb(new Date(), "demo_endweek");
    const list = await resolvedExceptions(t.db, await t.as("st-dana"));
    expect(list.map((x) => x.how)).toContain("Stalled handoff rerouted");
    // Daniel was reached; Ada, Chidi and Grace still haven't acknowledged, so it isn't resolved.
    expect(list.map((x) => x.how)).not.toContain("Reached by phone");
  });

  it("S-7, S-10: the Missing consent chip follows the household's confirmation; absences ahead say 'will be away'", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const chip = async () =>
      (await coordinationQueue(t!.db, await t!.as("st-maya"))).find((r) => r.kind === "missing_consent")!
        .status.value;
    expect(await chip()).toBe("awaiting_confirmation");
    await confirmConsent(t.db, await t.as("fm-ada"), { consentId: "cs-okafor-equipment", version: 2 });
    expect(await chip()).toBe("awaiting_activation");
    const gap = (await coordinationQueue(t.db, await t.as("st-dana"))).find(
      (r) => r.kind === "coverage" && r.householdId === "hh-okafor",
    )!;
    expect(gap.summary).toBe("Maya Chen will be away soon; no cover accepted");
  });

  it("S-4: Catch me up says what kind of news came from outside, in words", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const b = await catchMeUp(t.db, await t.as("st-maya"), "hh-okafor");
    const text = b.lines.map((l) => l.text).join(" ");
    expect(text).toContain("Latest from outside (simulated): a status change from Brightwater Respite House");
    expect(text).not.toMatch(/\) \(“/);
  });

  it("S-15: an administrator is told why, the same for any household", async () => {
    t = await freshDb();
    const lena = await t.as("st-lena");
    for (const h of ["hh-okafor", "hh-does-not-exist"])
      await expect(staffScope(t.db, lena, h, "staff.household.view")).rejects.toMatchObject({
        code: "OUT_OF_SCOPE",
        message: expect.stringMatching(/^Administrators don't open household records/),
      });
  });
});
