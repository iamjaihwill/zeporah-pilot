import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as sharing from "@/server/services/sharing";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";
import {
  HELD_MESSAGE,
  holdsCovering,
  mayRemove,
  placeHold,
  releaseHold,
  type RemovalTarget,
} from "@/server/services/retention";
import type { Conn } from "@/server/db/client";

/**
 * Retention holds and the removal guard (brief reconciliation increment 5). Nothing in Zeporah
 * disposes of records; these tests check that holds stop the few corrections that remove rows, that
 * disposal is always refused, and that holds themselves can't be removed or quietly changed.
 */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const W = "t-willow";
const hold = (over: Partial<Parameters<typeof placeHold>[1]> = {}) =>
  placeHold(t.db, {
    tenantId: W,
    householdId: "hh-okafor",
    recordClasses: [],
    reason: "Preservation request (synthetic)",
    authorizationRef: "MATTER-SYN-001",
    placedByActorId: "st-dana",
    ...over,
  });
const ackTarget: RemovalTarget = {
  tenantId: W,
  householdId: "hh-okafor",
  table: "acknowledgements",
  purpose: "correction",
};
const ackedUpdate = async () => {
  const ada = await t.as("fm-ada");
  const update = (await family.getThread(t.db, ada)).entries.find(
    (e) => e.type === "update" && e.requiresAck && !e.ackedByMe,
  )!;
  await family.acknowledgeUpdate(t.db, ada, update.id);
  return { ada, updateId: update.id };
};

describe("the removal guard", () => {
  it("always refuses disposal: there's no approved retention policy", async () => {
    expect(await mayRemove(t.db, { ...ackTarget, purpose: "disposal" })).toEqual({
      allowed: false,
      reason: "no_approved_policy",
      holdIds: [],
    });
    const h = await hold();
    expect(await mayRemove(t.db, { ...ackTarget, purpose: "disposal" })).toEqual({
      allowed: false,
      reason: "held",
      holdIds: [h.id],
    });
  });

  it("allows a correction when nothing is held", async () => {
    expect(await mayRemove(t.db, ackTarget)).toEqual({ allowed: true });
  });

  it("refuses when it can't check, rather than allowing", async () => {
    const broken = {
      select: () => {
        throw new Error("hold store unavailable");
      },
    } as unknown as Conn;
    expect(await mayRemove(broken, ackTarget)).toEqual({
      allowed: false,
      reason: "guard_unavailable",
      holdIds: [],
    });
  });

  it("covers only the classes and households a hold names", async () => {
    await hold({ recordClasses: ["routine_coordination"] });
    expect(await mayRemove(t.db, ackTarget)).toEqual({ allowed: true });
    await hold({ householdId: "hh-bennett", recordClasses: ["acknowledgement"] });
    expect(await mayRemove(t.db, ackTarget)).toEqual({ allowed: true });
    const h = await hold({ recordClasses: ["acknowledgement"] });
    expect(await mayRemove(t.db, ackTarget)).toMatchObject({ allowed: false, holdIds: [h.id] });
  });

  it("applies a tenant-wide hold to every household, and never to another tenant", async () => {
    await hold({ householdId: null });
    expect(await mayRemove(t.db, { ...ackTarget, householdId: "hh-bennett" })).toMatchObject({
      reason: "held",
    });
    expect(await mayRemove(t.db, { ...ackTarget, tenantId: "t-cedar", householdId: "chh-moss" })).toEqual({
      allowed: true,
    });
  });

  it("refuses a table with no record class (it can't tell what would be removed)", async () => {
    expect(await mayRemove(t.db, { ...ackTarget, table: "something_new" })).toMatchObject({
      allowed: false,
      reason: "guard_unavailable",
    });
  });
});

describe("corrections under a hold", () => {
  it("keeps an acknowledgement when its undo is held, and says why", async () => {
    const { ada, updateId } = await ackedUpdate();
    await hold();
    await expect(family.undoAcknowledgeUpdate(t.db, ada, updateId)).rejects.toMatchObject({
      code: "CONFLICT",
      message: HELD_MESSAGE,
    });
    const kept = await t.db
      .select()
      .from(s.acknowledgements)
      .where(and(eq(s.acknowledgements.subjectId, updateId), eq(s.acknowledgements.actorId, "fm-ada")));
    expect(kept).toHaveLength(1);
  });

  it("doesn't reopen a done task while its acknowledgement is held", async () => {
    const daniel = await t.as("fm-daniel");
    await family.completeFamilyTask(t.db, daniel, "tk-2");
    await hold({ recordClasses: ["acknowledgement"] });
    await expect(family.reopenFamilyTask(t.db, daniel, "tk-2")).rejects.toMatchObject({
      message: HELD_MESSAGE,
    });
    const [task] = await t.db.select().from(s.tasks).where(eq(s.tasks.id, "tk-2"));
    expect(task!.status).toBe("done");
  });

  it("doesn't replace a draft packet's contents while they're held", async () => {
    const before = await t.db
      .select()
      .from(s.packetManifestItems)
      .where(eq(s.packetManifestItems.packetId, "pk-okafor-respite"));
    await hold({ recordClasses: ["consent_authority_evidence"] });
    await expect(
      sharing.setManifest(t.db, await t.as("st-dana"), { packetId: "pk-okafor-respite", categories: [] }),
    ).rejects.toMatchObject({ message: HELD_MESSAGE });
    const after = await t.db
      .select()
      .from(s.packetManifestItems)
      .where(eq(s.packetManifestItems.packetId, "pk-okafor-respite"));
    expect(after).toEqual(before);
  });
});

describe("releasing holds", () => {
  it("leaves an overlapping hold in force and removes nothing", async () => {
    const { ada, updateId } = await ackedUpdate();
    const first = await hold();
    const second = await hold({ householdId: null, recordClasses: ["acknowledgement"] });
    const r = await releaseHold(t.db, {
      tenantId: W,
      holdId: first.id,
      releasedByActorId: "st-dana",
      releaseAuthorizationRef: "RELEASE-SYN-001",
    });
    expect(r.stillHeldBy).toEqual([second.id]);
    await expect(family.undoAcknowledgeUpdate(t.db, ada, updateId)).rejects.toMatchObject({
      message: HELD_MESSAGE,
    });
    await releaseHold(t.db, {
      tenantId: W,
      holdId: second.id,
      releasedByActorId: "st-dana",
      releaseAuthorizationRef: "RELEASE-SYN-002",
    });
    // Released: the person's own undo works again. Nothing was removed by the release itself.
    await family.undoAcknowledgeUpdate(t.db, ada, updateId);
    expect(await holdsCovering(t.db, ackTarget)).toEqual([]);
  });

  it("needs an authorization to release, and releases only once", async () => {
    const h = await hold();
    const release = (ref: string) =>
      releaseHold(t.db, {
        tenantId: W,
        holdId: h.id,
        releasedByActorId: "st-dana",
        releaseAuthorizationRef: ref,
      });
    await expect(release("  ")).rejects.toMatchObject({ code: "INVALID" });
    await release("RELEASE-SYN-003");
    await expect(release("RELEASE-SYN-004")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses a hold without a reason or an authorization, or naming an unknown class", async () => {
    await expect(hold({ authorizationRef: "" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(hold({ reason: " " })).rejects.toMatchObject({ code: "INVALID" });
    await expect(hold({ recordClasses: ["everything" as never] })).rejects.toMatchObject({ code: "INVALID" });
  });

  it("audits placing and releasing, and keeps the chain intact", async () => {
    const h = await hold();
    await releaseHold(t.db, {
      tenantId: W,
      holdId: h.id,
      releasedByActorId: "st-dana",
      releaseAuthorizationRef: "R-1",
    });
    const actions = (await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.subjectId, h.id))).map(
      (e) => e.action,
    );
    expect(actions).toEqual(["retention.hold_placed", "retention.hold_released"]);
    expect((await verifyAuditChain(t.db, W)).ok).toBe(true);
  });
});

describe("the database's own guard on holds", () => {
  it("refuses deleting, truncating, reactivating or rescoping a hold", async () => {
    const h = await hold();
    const byId = eq(s.retentionHolds.id, h.id);
    await expect(t.db.delete(s.retentionHolds).where(byId)).rejects.toThrow();
    await expect(t.db.execute(sql`truncate retention_holds`)).rejects.toThrow();
    await expect(t.db.update(s.retentionHolds).set({ householdId: null }).where(byId)).rejects.toThrow();
    await expect(
      t.db
        .update(s.retentionHolds)
        .set({ recordClasses: ["hold"] })
        .where(byId),
    ).rejects.toThrow();
    await releaseHold(t.db, {
      tenantId: W,
      holdId: h.id,
      releasedByActorId: "st-dana",
      releaseAuthorizationRef: "R-2",
    });
    await expect(
      t.db
        .update(s.retentionHolds)
        .set({ status: "active", releasedAt: null, releasedByActorId: null, releaseAuthorizationRef: null })
        .where(byId),
    ).rejects.toThrow();
  });

  it("refuses a release without its authorization, even written directly", async () => {
    const h = await hold();
    await expect(
      t.db
        .update(s.retentionHolds)
        .set({ status: "released", releasedAt: new Date(), releasedByActorId: "st-dana" })
        .where(eq(s.retentionHolds.id, h.id)),
    ).rejects.toThrow();
  });
});

describe("every removal path", () => {
  it("consults the guard, or is a listed exemption", () => {
    const dir = path.resolve("src/server");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(dir, f));
    const exempt = new Set(["sessions"]); // ending access, not destroying records (services/retention.ts)
    const unguarded: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const m = line.match(/\.delete\((?:s\.)?([a-zA-Z]+)\)/);
        if (!m || exempt.has(m[1]!)) return;
        const before = lines.slice(Math.max(0, i - 15), i).join("\n");
        if (!before.includes("assertMayRemove("))
          unguarded.push(`${path.relative(dir, file)}:${i + 1} ${m[1]}`);
      });
    }
    expect(unguarded).toEqual([]);
  });
});
