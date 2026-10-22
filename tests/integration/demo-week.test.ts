import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import { verifyAuditChain } from "@/server/audit";
import { staffVisibleHouseholds } from "@/server/context";
import { recipientPackets } from "@/server/services/recipient";
import { RESPITE_ACCESS_KEY } from "@/fixtures/demo-week";
import * as s from "@/server/db/schema";

/** The Okafor demo week (decision 58, plan story F-5): two snapshots on top of the standard seed. */
let t: Awaited<ReturnType<typeof freshDb>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function events(action: string) {
  return t!.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, action));
}

describe("standard seed", () => {
  it("has no demo-week records", async () => {
    t = await freshDb();
    expect(await t.db.select().from(s.handoffs)).toHaveLength(0);
    expect(await t.db.select().from(s.partnerEvents)).toHaveLength(0);
    expect(await t.db.select().from(s.staffAbsences)).toHaveLength(0);
    const [r] = await t.db
      .select()
      .from(s.careCoordinationRecords)
      .where(eq(s.careCoordinationRecords.householdId, "hh-okafor"));
    expect(r?.ehrReference).toBe("000-SYN-4411");
  });
});

describe("mid-week snapshot (Day 4, 9 AM)", () => {
  it("has Days 1–3: the reply, the release, the absence, two simulated partner events, the task", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const [p] = await t.db.select().from(s.packets).where(eq(s.packets.id, "pk-okafor-respite"));
    expect(p?.state).toBe("released");
    expect(p!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const pe = await t.db.select().from(s.partnerEvents);
    expect(pe).toHaveLength(2);
    expect(pe.every((x) => x.simulated && x.source === "staff_entered")).toBe(true);
    expect((await events("partner_event.logged"))[0]?.context).toMatchObject({ source: "partner_simulated" });
    expect((await events("message.sent")).some((e) => e.context["prepared"] === true)).toBe(true);
    expect(await t.db.select().from(s.handoffs)).toHaveLength(0);
    const [task] = await t.db.select().from(s.tasks).where(eq(s.tasks.id, "tk-demo-transport"));
    expect(task?.status).toBe("open");
    // Oakwood version 2 still waits for Ada: the live demo confirms it.
    const [oak] = await t.db.select().from(s.consents).where(eq(s.consents.id, "cs-okafor-equipment"));
    expect(oak?.activatedVersion).not.toBe(2);
    // Rosa can read both released packets; nothing is opened yet.
    const rosa = await recipientPackets(t.db, await t.as("rc-rosa"));
    expect(JSON.stringify(rosa)).toContain("Coordinate a short respite stay");
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });
});

describe("end-of-week snapshot (Day 7, 9 AM)", () => {
  it("has the cover, which ended by itself, and Sofia no longer sees the household", async () => {
    t = await freshDb(new Date(), "demo_endweek");
    const [cover] = await t.db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.actorId, "st-sofia"), eq(s.memberships.householdId, "hh-okafor")));
    expect(cover).toMatchObject({ status: "ended", coverForActorId: "st-maya" });
    expect(cover!.expiresAt!.getTime()).toBeLessThan(Date.now());
    const sofia = await staffVisibleHouseholds(t.db, await t.as("st-sofia"));
    expect(sofia.map((h) => h.id)).not.toContain("hh-okafor");
    const ho = await t.db.select().from(s.handoffs);
    expect(ho.map((h) => `${h.householdId}:${h.state}`).sort()).toEqual([
      "hh-bennett:offered",
      "hh-okafor:accepted",
      "hh-rivera:withdrawn",
    ]);
    expect((await events("coverage.ended"))[0]?.context).toMatchObject({ source: "system" });
  });

  it("has Oakwood activated by a different person, the access ending dismissed with a reason, and an intact chain", async () => {
    t = await freshDb(new Date(), "demo_endweek");
    const [oak] = await t.db.select().from(s.consents).where(eq(s.consents.id, "cs-okafor-equipment"));
    expect(oak).toMatchObject({ state: "active", activatedVersion: 2, activatedByActorId: "st-priya" });
    expect(oak!.recordedByActorId).not.toBe("st-priya");
    expect(
      (await events("consent.activated")).find((e) => e.subjectId === "cs-okafor-equipment")?.context,
    ).toMatchObject({
      approval: { approvedBy: "st-priya" },
      actorRoles: ["privileged_reviewer"],
    });
    const [claim] = await t.db
      .select()
      .from(s.exceptionClaims)
      .where(eq(s.exceptionClaims.key, RESPITE_ACCESS_KEY));
    expect(claim?.dismissedReason).toMatch(/^Let it end/);
    const [task] = await t.db.select().from(s.tasks).where(eq(s.tasks.id, "tk-demo-transport"));
    expect(task).toMatchObject({ status: "done", completedByActorId: "st-sofia" });
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });
});
