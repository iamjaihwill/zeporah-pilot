import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import { coordinationQueue } from "@/server/services/staff";
import {
  assignException,
  bulkAssignExceptions,
  dismissException,
  markWaiting,
  reachedByPhone,
  releaseException,
  resolvedExceptions,
  takeException,
} from "@/server/services/exceptions";
import { RESPITE_ACCESS_KEY } from "@/fixtures/demo-week";
import * as s from "@/server/db/schema";

/** The exception model (decision 58; spec 1.3, 1.4 and 3.3; plan stories E-1 to E-8). */
let t: Awaited<ReturnType<typeof freshDb>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const rows = async (who: string) => coordinationQueue(t!.db, await t!.as(who));
const okafor = async (who: string) => (await rows(who)).filter((r) => r.householdId === "hh-okafor");

describe("rules on the mid-week demo snapshot", () => {
  it("raises Okafor's exceptions for its care guide, each with a reason and a source", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const mine = await okafor("st-maya");
    const by = (c: string) => mine.filter((r) => r.category === c);
    // Oakwood asked (a simulated partner request) and version 2 isn't active yet.
    expect(by("missing_consent")[0]).toMatchObject({
      source: "partner",
      dismissable: false,
      owner: "Maya Chen",
    });
    // The respite packet's access ends on Day 5; Brightwater hasn't opened it after 48 hours.
    expect(mine.map((r) => r.id)).toContain(RESPITE_ACCESS_KEY);
    expect(by("partner_waiting").map((r) => r.id)).toContain("recipient_unopened:packet:pk-okafor-respite");
    // "Respite stay: next steps" has waited more than 24 hours for acknowledgement.
    const update = mine.find((r) => r.subjectId === "up-okafor-2")!;
    expect(update).toMatchObject({ category: "unread_update", priority: "normal" });
    expect(update.priorityReason).toMatch(/more than 24 hours/);
    for (const r of mine) {
      expect(r.why.length, r.id).toBeGreaterThan(10);
      expect(r.category, r.id).toBeTruthy();
    }
    // Care guides don't get team coverage or coordination risk.
    expect(mine.some((r) => r.category === "coverage_gap" || r.category === "risk")).toBe(false);
  });

  it("gives operations coverage gaps and a transparent coordination risk", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const all = await rows("st-dana");
    const gaps = all.filter((r) => r.category === "coverage_gap").map((r) => r.householdId);
    // Maya is away on Days 5–6: her households without another guide, plus the unassigned Nguyen.
    expect(gaps).toEqual(expect.arrayContaining(["hh-okafor", "hh-bennett", "hh-rivera", "hh-nguyen"]));
    expect(gaps).not.toContain("hh-hart");
    const risk = all.find((r) => r.id === "risk:household:hh-okafor")!;
    expect(risk.why).toMatch(/open exceptions/);
    expect(risk.why).toMatch(/not a score/);
    expect(risk.dismissable).toBe(true);
  });
});

describe("rules on the end-of-week snapshot", () => {
  it("shows Bennett's stalled handoff to operations, and keeps the dismissed respite access gone", async () => {
    t = await freshDb(new Date(), "demo_endweek");
    const all = await rows("st-dana");
    expect(all.find((r) => r.id === "handoff:handoff:ho-demo-bennett")).toMatchObject({
      category: "stalled_handoff",
      dismissable: false,
    });
    expect(all.find((r) => r.id === RESPITE_ACCESS_KEY)).toBeUndefined();
    // Maya is back: Okafor's cover gap is gone.
    expect(all.find((r) => r.id === "coverage:household:hh-okafor")).toBeUndefined();
  });
});

describe("actions", () => {
  it("take, wait and release, each audited", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    // Maya already owns it by default (the household's care guide); Dana takes it over.
    const dana = await t.as("st-dana");
    await takeException(t.db, dana, RESPITE_ACCESS_KEY);
    await markWaiting(t.db, dana, { key: RESPITE_ACCESS_KEY, on: "partner", note: "Left a voicemail" });
    let row = (await okafor("st-dana")).find((r) => r.id === RESPITE_ACCESS_KEY)!;
    expect(row).toMatchObject({
      mine: true,
      owner: "Dana Brooks",
      waitingOn: "partner",
      state: "Waiting on a partner: Left a voicemail",
    });
    await releaseException(t.db, dana, RESPITE_ACCESS_KEY);
    // Back to its default owner, the household's care guide, and no longer waiting.
    row = (await okafor("st-dana")).find((r) => r.id === RESPITE_ACCESS_KEY)!;
    expect(row).toMatchObject({ waitingOn: null, state: "Ends soon", owner: "Maya Chen", mine: false });
    const actions = (
      await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.subjectId, RESPITE_ACCESS_KEY))
    ).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["exception.taken", "exception.waiting", "exception.owner_released"]),
    );
  });

  it("dismisses only with a reason, and never consent work", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const maya = await t.as("st-maya");
    await expect(
      dismissException(t.db, maya, { key: RESPITE_ACCESS_KEY, reason: " " }),
    ).rejects.toMatchObject({
      code: "INVALID",
    });
    await dismissException(t.db, maya, {
      key: RESPITE_ACCESS_KEY,
      reason: "Let it end: the stay is booked.",
    });
    expect((await okafor("st-maya")).find((r) => r.id === RESPITE_ACCESS_KEY)).toBeUndefined();
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(
        and(eq(s.auditEvents.action, "exception.dismissed"), eq(s.auditEvents.subjectId, RESPITE_ACCESS_KEY)),
      );
    expect(ev?.context).toMatchObject({
      reason: "Let it end: the stay is booked.",
      actorRoles: ["care_guide"],
    });
    const missing = (await okafor("st-maya")).find((r) => r.category === "missing_consent")!;
    await expect(
      dismissException(t.db, maya, { key: missing.id, reason: "Not needed." }),
    ).rejects.toMatchObject({
      code: "INVALID",
    });
    expect((await resolvedExceptions(t.db, maya)).some((r) => r.how === "Dismissed")).toBe(true);
  });

  it("only operations assign, only to someone who works on the household, and bulk needs a reason", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    await expect(
      assignException(t.db, await t.as("st-maya"), { key: RESPITE_ACCESS_KEY, toActorId: "st-dana" }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    const dana = await t.as("st-dana");
    await expect(
      assignException(t.db, dana, { key: RESPITE_ACCESS_KEY, toActorId: "st-tom" }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await assignException(t.db, dana, { key: RESPITE_ACCESS_KEY, toActorId: "st-priya" });
    expect((await okafor("st-dana")).find((r) => r.id === RESPITE_ACCESS_KEY)?.owner).toBe("Priya Raman");
    await expect(
      bulkAssignExceptions(t.db, dana, { keys: [RESPITE_ACCESS_KEY], toActorId: "st-maya", reason: "" }),
    ).rejects.toMatchObject({ code: "INVALID" });
    const r = await bulkAssignExceptions(t.db, dana, {
      keys: [RESPITE_ACCESS_KEY],
      toActorId: "st-maya",
      reason: "Back from leave (synthetic).",
    });
    expect(r).toEqual([{ key: RESPITE_ACCESS_KEY, ok: true }]);
  });

  it("escalations and tasks keep their own owners", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const task = (await okafor("st-maya")).find((r) => r.kind === "task")!;
    await expect(takeException(t.db, await t.as("st-maya"), task.id)).rejects.toMatchObject({
      code: "INVALID",
    });
  });

  it("records reaching someone by phone, which counts for that person only", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const maya = await t.as("st-maya");
    await reachedByPhone(t.db, maya, { updateId: "up-okafor-2", personActorId: "fm-daniel" });
    // The others still haven't seen it, so the update stays, without Daniel.
    const row = (await okafor("st-maya")).find((r) => r.subjectId === "up-okafor-2");
    expect(row?.state).toBe("Waiting on Ada, Chidi, Grace");
    for (const p of ["fm-ada", "fm-chidi", "fm-grace"])
      await reachedByPhone(t.db, maya, { updateId: "up-okafor-2", personActorId: p });
    expect((await okafor("st-maya")).find((r) => r.subjectId === "up-okafor-2")).toBeUndefined();
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "update.reached_by_phone"))
      .orderBy(s.auditEvents.seq);
    expect(ev?.summary).toMatch(/reaching Daniel Okafor by phone/);
    await expect(
      reachedByPhone(t.db, await t.as("st-maya"), { updateId: "up-okafor-2", personActorId: "st-dana" }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("refuses rows the person can't see", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    await expect(takeException(t.db, await t.as("st-tom"), RESPITE_ACCESS_KEY)).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });
});

describe("dismissal (quality pass)", () => {
  it("covers the occurrence it was made on; the row comes back when it happens again", async () => {
    t = await freshDb();
    const dana = await t.as("st-dana");
    const row = (await coordinationQueue(t.db, dana)).find((r) => r.kind === "packet")!;
    await dismissException(t.db, dana, { key: row.id, reason: "Handled by phone (synthetic)." });
    expect((await rows("st-dana")).some((r) => r.id === row.id)).toBe(false);
    // The packet changes again later (for example, a release check holds it): it's back.
    await t.db
      .update(s.packets)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(s.packets.id, row.subjectId!));
    expect((await rows("st-dana")).some((r) => r.id === row.id)).toBe(true);
  });
});
