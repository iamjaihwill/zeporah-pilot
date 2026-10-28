import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as notifications from "@/server/services/notifications";
import * as assignments from "@/server/services/assignments";
import * as staff from "@/server/services/staff";
import * as s from "@/server/db/schema";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const note = (recipientActorId: string, householdId: string | null, title: string) => ({
  tenantId: "t-willow",
  recipientActorId,
  householdId,
  kind: "test",
  title,
  link: "/family",
});
const titles = async (actorId: string) =>
  (await notifications.listNotifications(t.db, await t.as(actorId))).map((n) => n.title);

describe("notification visibility follows current access", () => {
  it("family members see only their current household's notifications", async () => {
    await t.db.delete(s.notifications);
    await t.db
      .insert(s.notifications)
      .values([
        note("fm-daniel", "hh-okafor", "Okafor (synthetic)"),
        note("fm-daniel", null, "General (synthetic)"),
        note("fm-daniel", "hh-rivera", "Not his household (synthetic)"),
      ]);
    expect((await titles("fm-daniel")).sort()).toEqual(["General (synthetic)", "Okafor (synthetic)"]);
    expect(await notifications.unreadCount(t.db, await t.as("fm-daniel"))).toBe(2);
    // If his membership ends, that household's notifications drop out too.
    await t.db
      .update(s.memberships)
      .set({ status: "ended", endedAt: new Date(), endReason: "Left the household (synthetic)." })
      .where(and(eq(s.memberships.actorId, "fm-daniel"), eq(s.memberships.householdId, "hh-okafor")));
    expect(await titles("fm-daniel")).toEqual(["General (synthetic)"]);
    expect(await notifications.unreadCount(t.db, await t.as("fm-daniel"))).toBe(1);
  });

  it("nobody ever sees someone else's notifications", async () => {
    await t.db.insert(s.notifications).values(note("fm-daniel", "hh-okafor", "Daniel only (synthetic)"));
    for (const who of ["fm-ada", "fm-grace", "st-maya", "st-dana"])
      expect(await titles(who)).not.toContain("Daniel only (synthetic)");
    // Marking "all" read touches only the caller's own.
    await notifications.markRead(t.db, await t.as("fm-ada"), "all");
    const [d] = await t.db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.title, "Daniel only (synthetic)"));
    expect(d!.readAt).toBeNull();
  });

  it("handoff notifications carry no names or household details", async () => {
    const [m] = await t.db
      .select()
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.actorId, "st-maya"),
          eq(s.memberships.householdId, "hh-hart"),
          eq(s.memberships.status, "active"),
        ),
      );
    await assignments.reassignCareGuide(t.db, await t.as("st-dana"), {
      membershipId: m!.id,
      toActorId: "st-tom",
      reason: "Caseload change (synthetic).",
      handOver: true,
    });
    const [esc] = await t.db.select().from(s.escalations).where(eq(s.escalations.householdId, "hh-bennett"));
    await staff.giveEscalation(t.db, await t.as("st-dana"), { id: esc!.id, actorId: "st-maya" });
    const handoffs = await t.db.select().from(s.notifications).where(eq(s.notifications.kind, "handoff"));
    expect(handoffs.map((n) => n.title).sort()).toEqual([
      "An escalation was offered to you",
      "Open work for a household was handed to you",
    ]);
    expect(handoffs.every((n) => !/Hart|Bennett|June|Maya|Tom/.test(n.title))).toBe(true);
  });
});
