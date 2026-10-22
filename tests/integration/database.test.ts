import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { freshDb } from "./helpers";
import { appendAudit, verifyAuditChain } from "@/server/audit";
import { auditEvents, memberships, packets } from "@/server/db/schema";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => void (t = await freshDb()));
afterAll(() => t.close());

describe("database guarantees", () => {
  it("seeds a valid audit chain for each tenant", async () => {
    expect(await verifyAuditChain(t.db, "t-willow")).toMatchObject({ ok: true });
    expect(await verifyAuditChain(t.db, "t-cedar")).toMatchObject({ ok: true });
  });

  it("refuses to update or delete audit events, even directly in SQL", async () => {
    await expect(t.db.update(auditEvents).set({ summary: "changed" })).rejects.toThrow();
    await expect(t.db.delete(auditEvents)).rejects.toThrow();
    await expect(t.db.execute(sql`truncate audit_events`)).rejects.toThrow();
  });

  it("keeps the chain verifiable as new events are appended", async () => {
    await appendAudit(t.db, {
      tenantId: "t-willow",
      action: "test.event",
      subjectType: "test",
      summary: "A test event.",
      visibility: "staff",
      context: { b: 2, a: [1, { z: 1, y: 2 }] },
    });
    expect(await verifyAuditChain(t.db, "t-willow")).toMatchObject({ ok: true });
  });

  it("detects tampering if a stored hash no longer matches", async () => {
    // Simulate tampering by bypassing the trigger (only possible for a database superuser).
    await t.db.execute(sql`alter table audit_events disable trigger audit_events_no_update`);
    const [row] = await t.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "onboarding.completed"))
      .limit(1);
    await t.db.update(auditEvents).set({ summary: "rewritten" }).where(eq(auditEvents.id, row!.id));
    await t.db.execute(sql`alter table audit_events enable trigger audit_events_no_update`);
    expect(await verifyAuditChain(t.db, "t-willow")).toMatchObject({ ok: false, brokenAt: row!.id });
  });

  it("refuses rows that point into another tenant", async () => {
    // A Cedar membership pointing at a Willow household.
    await expect(
      t.db.insert(memberships).values({
        tenantId: "t-cedar",
        actorId: "cfm-ben",
        householdId: "hh-okafor",
        roleCode: "coordinator",
      }),
    ).rejects.toThrow();
    // A Willow packet citing a Cedar household.
    await expect(
      t.db.insert(packets).values({
        tenantId: "t-willow",
        householdId: "chh-moss",
        expiresAt: new Date(),
        createdByActorId: "st-maya",
      }),
    ).rejects.toThrow();
  });

  it("refuses invalid workflow states", async () => {
    await expect(
      t.db.update(packets).set({ state: "approved" }).where(eq(packets.id, "pk-okafor-respite")),
    ).rejects.toThrow();
  });
});
