import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import { auditExport, auditReview } from "@/server/services/audit-review";
import { recordEndedRecipientAccess } from "@/server/services/recipient";
import { activateConsent } from "@/server/services/sharing";
import { staffShell } from "@/server/services/staff-shell";
import { coordinationQueue } from "@/server/services/staff";
import { confirmConsent } from "@/server/services/family";
import * as s from "@/server/db/schema";

/** Audit readiness (decision 58, workstream 6; plan stories A-1 and A-2). */
let t: Awaited<ReturnType<typeof freshDb>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe("Audit review: source, prepared and approvals", () => {
  it("filters to simulated partner events, prepared content and two-person approvals", async () => {
    t = await freshDb(new Date(), "demo_endweek");
    const dana = await t.as("st-dana");
    const partner = await auditReview(t.db, dana, {
      householdId: "hh-okafor",
      days: 30,
      source: "partner_simulated",
    });
    expect(partner.events.length).toBe(2);
    expect(partner.events.every((e) => e.action === "partner_event.logged")).toBe(true);
    const prepared = await auditReview(t.db, dana, {
      householdId: "hh-okafor",
      days: 30,
      source: "prepared",
    });
    // The Day 1 prepared reply and Dana's Day 4 prepared cover note, newest first.
    expect(prepared.events.map((e) => e.action)).toEqual(["handoff.offered", "message.sent"]);
    const approvals = await auditReview(t.db, dana, {
      householdId: "hh-okafor",
      days: 30,
      source: "approval",
    });
    expect(approvals.events.find((e) => e.action === "consent.activated")?.approval).toEqual({
      requestedBy: "Maya Chen",
      approvedBy: "Priya Raman",
    });
    const system = await auditReview(t.db, dana, { householdId: "hh-okafor", days: 30, source: "system" });
    expect(system.events.map((e) => e.action)).toEqual(
      expect.arrayContaining(["coverage.ended", "packet.recipient_access_ended"]),
    );
    // The export uses the same filter, and records it.
    const csv = await auditExport(t.db, dana, {
      householdId: "hh-okafor",
      days: 30,
      source: "partner_simulated",
    });
    expect(csv.rows).toBe(2);
    const [ev] = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "audit.exported"));
    expect(ev?.context).toMatchObject({ sourceFilter: "partner_simulated", source: "staff" });
  });

  it("records who recorded and who activated a consent", async () => {
    t = await freshDb();
    // Ada confirms Oakwood version 2; it then waits for a reviewer who didn't record it.
    await confirmConsent(t.db, await t.as("fm-ada"), { consentId: "cs-okafor-equipment", version: 2 });
    const priya = await t.as("st-priya");
    const row = (await coordinationQueue(t.db, priya)).find((r) => r.kind === "consent");
    expect(row, "the seed has a consent waiting for activation").toBeTruthy();
    const [c] = await t.db.select().from(s.consents).where(eq(s.consents.id, row!.subjectId!));
    await activateConsent(t.db, priya, c!.id);
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.action, "consent.activated"), eq(s.auditEvents.subjectId, c!.id)));
    expect(ev?.context).toMatchObject({
      approval: { requestedBy: c!.recordedByActorId, approvedBy: "st-priya" },
    });
  });
});

describe("recipient access that ended", () => {
  it("is recorded once, by the system, on the next workspace load", async () => {
    t = await freshDb();
    await t.db.update(s.packetRecipientAccess).set({ expiresAt: new Date(Date.now() - 60_000) });
    await staffShell(t.db, await t.as("st-dana"));
    expect(await recordEndedRecipientAccess(t.db, "t-willow")).toBe(0);
    const rows = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "packet.recipient_access_ended"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: null, subjectId: "pk-okafor-intake" });
    expect(rows[0]!.context).toMatchObject({ source: "system" });
  });

  it("is recorded once even when two workspace loads run at the same moment", async () => {
    t = await freshDb();
    await t.db.update(s.packetRecipientAccess).set({ expiresAt: new Date(Date.now() - 60_000) });
    const counts = await Promise.all([
      recordEndedRecipientAccess(t.db, "t-willow"),
      recordEndedRecipientAccess(t.db, "t-willow"),
    ]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    const rows = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "packet.recipient_access_ended"));
    expect(rows).toHaveLength(1);
  });
});
