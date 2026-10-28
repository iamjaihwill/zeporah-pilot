import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { freshDb } from "./helpers";
import { appendAudit, auditChainFindings, CHAIN_LIMITS, verifyAuditChain } from "@/server/audit";
import { auditEvents } from "@/server/db/schema";

/**
 * The audit chain under faults (brief reconciliation increment 2): simultaneous appends, a fork
 * attempt, and each kind of tampering a privileged database user could do. Faults that need the
 * append-only trigger or the fork indexes out of the way say so; only a superuser can do that.
 */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const W = "t-willow";
const event = (n: number) => ({
  tenantId: W,
  action: "test.event",
  subjectType: "test",
  subjectId: `s-${n}`,
  summary: "A test event.",
  visibility: "staff" as const,
});
const chain = () =>
  t.db.select().from(auditEvents).where(eq(auditEvents.tenantId, W)).orderBy(auditEvents.seq);
const asSuperuser = async (f: () => Promise<unknown>) => {
  await t.db.execute(sql`alter table audit_events disable trigger audit_events_no_update`);
  try {
    await f();
  } finally {
    await t.db.execute(sql`alter table audit_events enable trigger audit_events_no_update`);
  }
};
const kinds = async () => (await auditChainFindings(t.db, W)).findings.map((f) => f.kind);

describe("appending", () => {
  it("keeps one unbroken chain when many events are appended at once", async () => {
    const before = (await chain()).length;
    await Promise.all(Array.from({ length: 40 }, (_, i) => appendAudit(t.db, event(i))));
    const r = await auditChainFindings(t.db, W);
    expect(r.events).toBe(before + 40);
    expect(r.findings).toEqual([]);
    expect(r.head?.eventId).toBe((await chain()).at(-1)!.id);
  });

  it("appends inside the caller's transaction and rolls back with it", async () => {
    const before = (await chain()).length;
    await t.db
      .transaction(async (tx) => {
        await appendAudit(tx, event(1));
        throw new Error("the action failed");
      })
      .catch(() => null);
    expect((await chain()).length).toBe(before);
    expect(await kinds()).toEqual([]);
  });

  it("refuses a fork in the database itself, even written directly", async () => {
    const [last] = await t.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, W))
      .orderBy(desc(auditEvents.seq))
      .limit(1);
    const copy = { ...event(1), prevHash: last!.prevHash, hash: "f".repeat(64) };
    await expect(t.db.insert(auditEvents).values(copy)).rejects.toThrow();
    await expect(t.db.insert(auditEvents).values({ ...copy, prevHash: null })).rejects.toThrow();
  });
});

describe("verification findings", () => {
  it("names a changed event", async () => {
    const [row] = await chain();
    await asSuperuser(() =>
      t.db.update(auditEvents).set({ summary: "rewritten" }).where(eq(auditEvents.id, row!.id)),
    );
    const r = await auditChainFindings(t.db, W);
    expect(r.findings).toEqual([{ kind: "hash_mismatch", eventId: row!.id, seq: row!.seq }]);
    expect(await verifyAuditChain(t.db, W)).toEqual({ ok: false, brokenAt: row!.id });
  });

  it("names the event after a removed one", async () => {
    const rows = await chain();
    await asSuperuser(() => t.db.delete(auditEvents).where(eq(auditEvents.id, rows[3]!.id)));
    expect((await auditChainFindings(t.db, W)).findings).toEqual([
      { kind: "broken_link", eventId: rows[4]!.id, seq: rows[4]!.seq },
    ]);
  });

  it("names a missing start", async () => {
    const [first, second] = await chain();
    await asSuperuser(() => t.db.delete(auditEvents).where(eq(auditEvents.id, first!.id)));
    expect((await auditChainFindings(t.db, W)).findings).toEqual([
      { kind: "missing_start", eventId: second!.id, seq: second!.seq },
    ]);
  });

  it("names a fork written by someone who removed the database's guard", async () => {
    await t.db.execute(sql`drop index audit_events_one_successor`);
    const rows = await chain();
    const [extra] = await t.db
      .insert(auditEvents)
      .values({ ...event(1), prevHash: rows[0]!.hash, hash: "f".repeat(64) })
      .returning();
    const found = (await auditChainFindings(t.db, W)).findings;
    expect(found).toContainEqual({ kind: "fork", eventIds: [rows[1]!.id, extra!.id], after: rows[0]!.hash });
    expect(found.map((f) => f.kind)).toEqual(
      expect.arrayContaining(["broken_link", "hash_mismatch", "fork"]),
    );
  });

  it("can't see events removed from the end, and says so", async () => {
    const rows = await chain();
    await asSuperuser(() => t.db.delete(auditEvents).where(eq(auditEvents.id, rows.at(-1)!.id)));
    const r = await auditChainFindings(t.db, W);
    // The known limit: without a checkpoint kept elsewhere, a shorter chain still checks clean.
    expect(r.findings).toEqual([]);
    expect(r.limits).toBe(CHAIN_LIMITS);
    expect(r.limits[0]).toMatch(/removed from the end/);
  });

  it("checks each tenant's chain on its own", async () => {
    const [row] = await chain();
    await asSuperuser(() =>
      t.db.update(auditEvents).set({ summary: "x" }).where(eq(auditEvents.id, row!.id)),
    );
    expect((await auditChainFindings(t.db, "t-cedar")).findings).toEqual([]);
    expect(
      (
        await t.db
          .select()
          .from(auditEvents)
          .where(and(eq(auditEvents.tenantId, "t-cedar")))
      ).length,
    ).toBeGreaterThan(0);
  });
});
