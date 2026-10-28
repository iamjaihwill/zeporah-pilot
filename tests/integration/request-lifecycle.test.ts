import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as requests from "@/server/services/requests";
import * as staff from "@/server/services/staff";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";

/** The request lifecycle (founder decisions 79–83), with synthetic people only. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const soon = () => new Date(Date.now() + 4 * HOUR);

/** Daniel (Okafor coordinator) asks for a person; returns the request's ID. */
async function ask(who = "fm-daniel", category = "Paperwork") {
  const { id } = await family.requestHumanSupport(t.db, await t.as(who), {
    category,
    message: "Synthetic request.",
    contactTime: "",
  });
  return id;
}
const mine = async (who: string, id: string) =>
  (await family.getSupport(t.db, await t.as(who))).requests.find((r) => r.id === id);
const row = async (id: string) =>
  (await t.db.select().from(s.escalations).where(eq(s.escalations.id, id)))[0]!;
const queueRow = async (who: string, id: string, kind = "escalation") =>
  (await staff.coordinationQueue(t.db, await t.as(who))).find((r) => r.kind === kind && r.subjectId === id);
const take = async (id: string, who = "st-maya") =>
  staff.updateEscalation(t.db, await t.as(who), { id, action: "take", nextUpdateBy: soon() });
const notesFor = async (actorId: string, kind: string) =>
  (
    await t.db
      .select()
      .from(s.notifications)
      .where(and(eq(s.notifications.recipientActorId, actorId), eq(s.notifications.kind, kind)))
  ).length;

describe("what the family sees (decision 80)", () => {
  it("names the owner by first name and the kind of party it waits on, never more", async () => {
    const id = await ask();
    expect(await mine("fm-daniel", id)).toMatchObject({ state: "received", label: "Received" });
    await take(id);
    expect(await mine("fm-daniel", id)).toMatchObject({ state: "with_owner", label: "With Maya" });
    expect((await mine("fm-daniel", id))?.nextUpdateBy).toBeInstanceOf(Date);
    const maya = await t.as("st-maya");
    await requests.setRequestProgress(t.db, maya, { id, waitingOn: "family", nextUpdateBy: soon() });
    expect(await mine("fm-daniel", id)).toMatchObject({ label: "Waiting on you" });
    await requests.setRequestProgress(t.db, maya, {
      id,
      waitingOn: "other",
      waitingOnLabel: "the pharmacy",
      nextUpdateBy: soon(),
    });
    expect(await mine("fm-daniel", id)).toMatchObject({
      state: "waiting_on_other",
      label: "Waiting on someone else: the pharmacy",
    });
    expect((await queueRow("st-maya", id))?.state).toBe("Waiting on someone else: the pharmacy");
    await staff.updateEscalation(t.db, maya, { id, action: "resolve", resolution: "Sorted (synthetic)." });
    expect(await mine("fm-daniel", id)).toMatchObject({ state: "resolved", nextUpdateBy: null });
    expect(await row(id)).toMatchObject({ closedReason: "resolved", waitingOn: null });
  });

  it("is changed only by the owner", async () => {
    const id = await ask();
    await take(id);
    await expect(
      requests.setRequestProgress(t.db, await t.as("st-dana"), {
        id,
        waitingOn: "family",
        nextUpdateBy: soon(),
      }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await expect(
      requests.setRequestProgress(t.db, await t.as("fm-daniel"), { id, waitingOn: null }),
    ).rejects.toThrow();
  });
});

describe("withdraw and reopen (decision 81)", () => {
  it("lets the sender withdraw an open request and tells the owner", async () => {
    const id = await ask();
    await take(id);
    const before = await notesFor("st-maya", "support");
    await expect(requests.withdrawRequest(t.db, await t.as("fm-grace"), { id })).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
    await requests.withdrawRequest(t.db, await t.as("fm-daniel"), { id });
    expect(await row(id)).toMatchObject({ status: "resolved", closedReason: "withdrawn" });
    expect(await mine("fm-daniel", id)).toMatchObject({
      label: "Withdrawn",
      canWithdraw: false,
      canReopen: false,
    });
    expect(await notesFor("st-maya", "support")).toBe(before + 1);
    expect(await queueRow("st-maya", id)).toBeUndefined();
    await expect(requests.withdrawRequest(t.db, await t.as("fm-daniel"), { id })).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(
      requests.reopenRequest(t.db, await t.as("fm-daniel"), { id, reason: "Still need it" }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("reopens within 7 days, with a reason, back to the same owner", async () => {
    const id = await ask();
    await take(id);
    await staff.updateEscalation(t.db, await t.as("st-maya"), { id, action: "resolve", resolution: "Done." });
    const daniel = await t.as("fm-daniel");
    expect((await mine("fm-daniel", id))?.canReopen).toBe(true);
    await expect(requests.reopenRequest(t.db, daniel, { id, reason: "  " })).rejects.toMatchObject({
      code: "INVALID",
    });
    await requests.reopenRequest(t.db, daniel, { id, reason: "The form came back (synthetic)." });
    expect(await row(id)).toMatchObject({
      status: "acknowledged",
      ownerActorId: "st-maya",
      reopenReason: "The form came back (synthetic).",
      resolvedAt: null,
    });
    expect(await mine("fm-daniel", id)).toMatchObject({ label: "With Maya" });
    expect((await queueRow("st-maya", id))?.mine).toBe(true);
  });

  it("refuses after 7 days: send a new request instead", async () => {
    const id = await ask();
    await take(id);
    await staff.updateEscalation(t.db, await t.as("st-maya"), { id, action: "resolve", resolution: "Done." });
    await t.db
      .update(s.escalations)
      .set({ resolvedAt: new Date(Date.now() - 8 * DAY) })
      .where(eq(s.escalations.id, id));
    expect((await mine("fm-daniel", id))?.canReopen).toBe(false);
    await expect(
      requests.reopenRequest(t.db, await t.as("fm-daniel"), { id, reason: "Again" }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("next update by (decision 82)", () => {
  it("is required to mark it waiting, in the future and within two weeks", async () => {
    const id = await ask();
    await take(id);
    const maya = await t.as("st-maya");
    await expect(requests.setRequestProgress(t.db, maya, { id, waitingOn: "family" })).rejects.toMatchObject({
      code: "INVALID",
    });
    for (const at of [new Date(Date.now() - HOUR), new Date(Date.now() + 15 * DAY)])
      await expect(
        requests.setRequestProgress(t.db, maya, { id, waitingOn: "family", nextUpdateBy: at }),
      ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("raises Update overdue for the owner and operations once it passes", async () => {
    const id = await ask();
    await take(id);
    expect((await queueRow("st-maya", id))?.state).not.toBe("Update overdue");
    await t.db
      .update(s.escalations)
      .set({ nextUpdateBy: new Date(Date.now() - HOUR) })
      .where(eq(s.escalations.id, id));
    for (const who of ["st-maya", "st-dana"])
      expect(await queueRow(who, id)).toMatchObject({
        state: "Update overdue",
        priority: "high",
        priorityReason: "Update overdue",
      });
    // Setting a new time clears it.
    await requests.setRequestProgress(t.db, await t.as("st-maya"), {
      id,
      waitingOn: null,
      nextUpdateBy: soon(),
    });
    expect((await queueRow("st-maya", id))?.state).not.toBe("Update overdue");
  });
});

describe("offers (decision 83)", () => {
  async function offerTarget(id: string) {
    const e = await row(id);
    const c = (await staff.escalationOwnerCandidates(t.db, await t.as("st-dana"))).find(
      (x) => x.actorId !== e.ownerActorId && x.actorId !== "st-dana" && x.sees(e.householdId),
    );
    return c!.actorId;
  }

  it("keeps the owner until the offered person accepts", async () => {
    const id = await ask();
    await take(id);
    const to = await offerTarget(id);
    await staff.giveEscalation(t.db, await t.as("st-dana"), { id, actorId: to });
    expect(await row(id)).toMatchObject({ ownerActorId: "st-maya", offeredToActorId: to });
    expect(await mine("fm-daniel", id)).toMatchObject({ label: "With Maya" });
    expect((await queueRow("st-maya", id))?.state).toMatch(/^Offered to .+, not accepted yet$/);
    await expect(requests.acceptEscalationOffer(t.db, await t.as("st-maya"), { id })).rejects.toMatchObject({
      code: "INVALID",
    });
    await requests.acceptEscalationOffer(t.db, await t.as(to), { id });
    expect(await row(id)).toMatchObject({ ownerActorId: to, status: "acknowledged", offeredToActorId: null });
    expect(await notesFor("st-maya", "handoff")).toBeGreaterThan(0);
  });

  it("is declined with a reason, and the owner keeps it", async () => {
    const id = await ask();
    await take(id);
    const to = await offerTarget(id);
    await staff.giveEscalation(t.db, await t.as("st-dana"), { id, actorId: to });
    await expect(
      requests.declineEscalationOffer(t.db, await t.as(to), { id, reason: "" }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await requests.declineEscalationOffer(t.db, await t.as(to), { id, reason: "Full caseload (synthetic)." });
    expect(await row(id)).toMatchObject({ ownerActorId: "st-maya", offeredToActorId: null });
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "escalation.offer_declined"));
    expect(ev).toMatchObject({ visibility: "staff", subjectId: id });
  });

  it("becomes a stalled exception for operations when it isn't accepted in time", async () => {
    const id = await ask();
    await take(id);
    const to = await offerTarget(id);
    await staff.giveEscalation(t.db, await t.as("st-dana"), { id, actorId: to });
    expect(await queueRow("st-dana", id, "handoff")).toBeUndefined();
    await t.db
      .update(s.escalations)
      .set({ offeredAt: new Date(Date.now() - 25 * HOUR) })
      .where(eq(s.escalations.id, id));
    expect(await queueRow("st-dana", id, "handoff")).toMatchObject({
      category: "stalled_handoff",
      state: "Not accepted yet",
      dismissable: false,
    });
    // Care guides don't get team-coverage rows.
    expect(await queueRow("st-maya", id, "handoff")).toBeUndefined();
  });

  it("is settled when someone takes the request", async () => {
    const id = await ask();
    const to = await offerTarget(id);
    await staff.giveEscalation(t.db, await t.as("st-dana"), { id, actorId: to });
    expect(await row(id)).toMatchObject({ status: "open", ownerActorId: null, offeredToActorId: to });
    await take(id);
    expect(await row(id)).toMatchObject({ ownerActorId: "st-maya", offeredToActorId: null });
  });
});

describe("the record", () => {
  it("keeps family steps in the household's activity and staff steps out of it", async () => {
    const id = await ask();
    await take(id);
    await requests.setRequestProgress(t.db, await t.as("st-maya"), {
      id,
      waitingOn: "family",
      nextUpdateBy: soon(),
    });
    await requests.withdrawRequest(t.db, await t.as("fm-daniel"), { id });
    const vis = async (action: string) =>
      (await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, action)))[0]?.visibility;
    expect(await vis("request.withdrawn")).toBe("family");
    expect(await vis("request.waiting")).toBe("staff");
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });
});
