import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import { staffScope } from "@/server/context";
import {
  acceptHandoff,
  cancelAbsence,
  coverageBoard,
  declineHandoff,
  endExpiredCover,
  myHandoffs,
  offerCover,
  offerTransfer,
  recordAbsence,
} from "@/server/services/coverage";
import { coordinationQueue } from "@/server/services/staff";
import * as s from "@/server/db/schema";

/** Planned absence, cover and handoffs (decision 58 workstream 3; decisions 59–61; stories C-1 to C-7). */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  t = await freshDb();
});
afterEach(async () => {
  await t.close();
});

const H = 3_600_000;
const sees = async (who: string, householdId: string) =>
  staffScope(t.db, await t.as(who), householdId, "staff.household.view").then(
    () => true,
    () => false,
  );
async function mayaAway(fromHours = 1, toHours = 5) {
  const { id } = await recordAbsence(t.db, await t.as("st-dana"), {
    actorId: "st-maya",
    startsAt: new Date(Date.now() + fromHours * H),
    endsAt: new Date(Date.now() + toHours * H),
    reason: "Annual leave (synthetic)",
  });
  return id;
}

describe("cover", () => {
  it("gives access only inside the window, after acceptance, and ends by itself (decision 59)", async () => {
    const absenceId = await mayaAway();
    const dana = await t.as("st-dana");
    const { id } = await offerCover(t.db, dana, {
      absenceId,
      householdId: "hh-okafor",
      toActorId: "st-sofia",
      note: "Respite stay on Tuesday (synthetic).",
    });
    // Offered, not accepted: Sofia sees the household's name and the note only.
    expect(await sees("st-sofia", "hh-okafor")).toBe(false);
    const mine = await myHandoffs(t.db, await t.as("st-sofia"));
    expect(mine).toEqual([
      expect.objectContaining({ id, household: "The Okafor household", kind: "cover", from: "Maya Chen" }),
    ]);
    await acceptHandoff(t.db, await t.as("st-sofia"), id);
    // Accepted, but the absence hasn't started: still nothing.
    expect(await sees("st-sofia", "hh-okafor")).toBe(false);
    const [m] = await t.db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.actorId, "st-sofia"), eq(s.memberships.householdId, "hh-okafor")));
    expect(m).toMatchObject({ coverForActorId: "st-maya", status: "active" });
    // The window starts: access.
    await t.db
      .update(s.memberships)
      .set({ startsAt: new Date(Date.now() - 1000) })
      .where(eq(s.memberships.id, m!.id));
    expect(await sees("st-sofia", "hh-okafor")).toBe(true);
    // The window ends: no access, and the end is recorded by the system on the next look.
    await t.db
      .update(s.memberships)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.memberships.id, m!.id));
    expect(await sees("st-sofia", "hh-okafor")).toBe(false);
    expect(await endExpiredCover(t.db, "t-willow")).toBe(1);
    const [ended] = await t.db.select().from(s.memberships).where(eq(s.memberships.id, m!.id));
    expect(ended?.status).toBe("ended");
    const [ev] = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "coverage.ended"));
    expect(ev).toMatchObject({ actorId: null, subjectId: m!.id });
    expect(ev?.context).toMatchObject({ source: "system" });
    const actions = (await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.subjectId, id))).map(
      (e) => e.action,
    );
    expect(actions).toEqual(expect.arrayContaining(["handoff.offered", "handoff.accepted"]));
  });

  it("a decline needs a reason and goes to operations as a stalled handoff (decision 61)", async () => {
    const absenceId = await mayaAway();
    const { id } = await offerCover(t.db, await t.as("st-dana"), {
      absenceId,
      householdId: "hh-bennett",
      toActorId: "st-tom",
      note: "",
    });
    await expect(
      declineHandoff(t.db, await t.as("st-tom"), { handoffId: id, reason: " " }),
    ).rejects.toMatchObject({
      code: "INVALID",
    });
    await declineHandoff(t.db, await t.as("st-tom"), { handoffId: id, reason: "Full caseload this week." });
    const rows = await coordinationQueue(t.db, await t.as("st-dana"));
    expect(rows.find((r) => r.id === `handoff:handoff:${id}`)).toMatchObject({ category: "stalled_handoff" });
    const board = await coverageBoard(t.db, await t.as("st-dana"));
    expect(board.absences[0]!.households.find((h) => h.householdId === "hh-bennett")?.cover).toMatchObject({
      state: "declined",
      declineReason: "Full caseload this week.",
    });
  });

  it("refuses the wrong people and the wrong households", async () => {
    await expect(
      recordAbsence(t.db, await t.as("st-maya"), {
        actorId: "st-maya",
        startsAt: new Date(Date.now() + H),
        endsAt: new Date(Date.now() + 2 * H),
        reason: "Leave (synthetic)",
      }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await expect(
      recordAbsence(t.db, await t.as("st-dana"), {
        actorId: "st-maya",
        startsAt: new Date(Date.now() + 2 * H),
        endsAt: new Date(Date.now() + H),
        reason: "Leave (synthetic)",
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    const absenceId = await mayaAway();
    const dana = await t.as("st-dana");
    // Not one of Maya's households; and not Maya herself.
    await expect(
      offerCover(t.db, dana, { absenceId, householdId: "hh-patel", toActorId: "st-sofia", note: "" }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await expect(
      offerCover(t.db, dana, { absenceId, householdId: "hh-okafor", toActorId: "st-maya", note: "" }),
    ).rejects.toMatchObject({ code: "INVALID" });
    const { id } = await offerCover(t.db, dana, {
      absenceId,
      householdId: "hh-okafor",
      toActorId: "st-sofia",
      note: "",
    });
    // Only the person it was offered to can accept it.
    await expect(acceptHandoff(t.db, await t.as("st-tom"), id)).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });

  it("cancelling the absence withdraws open offers", async () => {
    const absenceId = await mayaAway();
    const dana = await t.as("st-dana");
    const { id } = await offerCover(t.db, dana, {
      absenceId,
      householdId: "hh-okafor",
      toActorId: "st-sofia",
      note: "",
    });
    await cancelAbsence(t.db, dana, absenceId);
    const [h] = await t.db.select().from(s.handoffs).where(eq(s.handoffs.id, id));
    expect(h?.state).toBe("withdrawn");
    expect(await myHandoffs(t.db, await t.as("st-sofia"))).toEqual([]);
  });
});

describe("transfer (story C-7)", () => {
  it("moves the household only when the receiving guide accepts, with open work handed over", async () => {
    const dana = await t.as("st-dana");
    const { id } = await offerTransfer(t.db, dana, {
      householdId: "hh-rivera",
      fromActorId: "st-maya",
      toActorId: "st-sofia",
      note: "Sofia knows the family (synthetic).",
    });
    expect(await sees("st-maya", "hh-rivera")).toBe(true);
    expect(await sees("st-sofia", "hh-rivera")).toBe(false);
    await acceptHandoff(t.db, await t.as("st-sofia"), id);
    expect(await sees("st-sofia", "hh-rivera")).toBe(true);
    expect(await sees("st-maya", "hh-rivera")).toBe(false);
    const actions = (
      await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.householdId, "hh-rivera"))
    ).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["handoff.accepted", "assignment.ended", "assignment.created"]),
    );
    // Someone already assigned can't be offered the same household.
    await expect(
      offerTransfer(t.db, dana, {
        householdId: "hh-hart",
        fromActorId: "st-maya",
        toActorId: "st-sofia",
        note: "",
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("cover edge cases (quality pass)", () => {
  it("cancelling one absence ends only the cover granted for it, and records the end", async () => {
    const dana = await t.as("st-dana");
    // Maya has two absences; Sofia covers Okafor during the first (now), Hart during the second.
    const first = await mayaAway(-1, 5);
    const second = await mayaAway(24, 30);
    const a = await offerCover(t.db, dana, {
      absenceId: first,
      householdId: "hh-okafor",
      toActorId: "st-sofia",
      note: "",
    });
    const b = await offerCover(t.db, dana, {
      absenceId: second,
      householdId: "hh-okafor",
      toActorId: "st-tom",
      note: "",
    });
    await acceptHandoff(t.db, await t.as("st-sofia"), a.id);
    await acceptHandoff(t.db, await t.as("st-tom"), b.id);
    await cancelAbsence(t.db, dana, second);
    // Sofia's cover for the first absence is untouched.
    expect(await sees("st-sofia", "hh-okafor")).toBe(true);
    const tom = await t.db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.actorId, "st-tom"), eq(s.memberships.householdId, "hh-okafor")));
    expect(tom.map((m) => m.status)).toEqual(["ended"]);
    const ended = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "coverage.ended"));
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ subjectId: tom[0]!.id, actorId: "st-dana", householdId: "hh-okafor" });
  });

  it("an offer can't be accepted once its cover window has ended, or after it was withdrawn", async () => {
    const dana = await t.as("st-dana");
    const absenceId = await mayaAway(1, 5);
    const { id } = await offerCover(t.db, dana, {
      absenceId,
      householdId: "hh-okafor",
      toActorId: "st-sofia",
      note: "",
    });
    await expect(
      acceptHandoff(t.db, await t.as("st-sofia"), id, new Date(Date.now() + 6 * H)),
    ).rejects.toMatchObject({ code: "INVALID" });
    // Withdrawn (here, by offering it to someone else instead): accepting the old offer is refused.
    await offerCover(t.db, dana, { absenceId, householdId: "hh-okafor", toActorId: "st-tom", note: "" });
    await expect(acceptHandoff(t.db, await t.as("st-sofia"), id)).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    expect(await sees("st-sofia", "hh-okafor")).toBe(false);
  });
});
