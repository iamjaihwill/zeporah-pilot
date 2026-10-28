/**
 * Retention holds and the removal guard (brief reconciliation increment 5).
 *
 * Every path that removes a record asks `assertMayRemove` first. Two purposes:
 *
 * - **disposal**: removing records because their time is up. Always refused: there is no approved
 *   retention policy (decision D-05, PB-11), and Zeporah has no disposal path at all yet.
 * - **correction**: someone undoing or replacing their own recent work (taking back an
 *   acknowledgement, reopening a task, changing a draft packet's contents). Allowed unless an
 *   active hold covers it.
 *
 * If the check itself fails, nothing is removed. A hold preserves; it never grants access,
 * discloses anything, or restarts a retention clock. Releasing a hold removes nothing and leaves
 * any other hold in force.
 *
 * Exempt, because they end access rather than destroy records, and a hold must never block them:
 * signing out and ending sessions (`sessions`, in session.ts, password-reset.ts and team.ts). The
 * development data reset (functions/session.ts) exists only behind the development gate.
 *
 * Open decision: who may place and release holds. Until it's made there is no screen or server
 * function for either; `placeHold` and `releaseHold` are reachable only from code and tests.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Conn } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError } from "../context";
import { classOf, RECORD_CLASSES, type RecordClass } from "@/domain/record-classes";

export type RemovalTarget = {
  tenantId: string;
  householdId: string | null;
  /** The table rows would be removed from (its database name). */
  table: string;
  purpose: "disposal" | "correction";
};

export type RemovalDecision =
  | { allowed: true }
  | { allowed: false; reason: "held" | "no_approved_policy" | "guard_unavailable"; holdIds: string[] };

export const HELD_MESSAGE =
  "This can't be changed right now: these records are being kept as they are. Nothing was changed.";
export const GUARD_UNAVAILABLE_MESSAGE =
  "We couldn't check whether these records are being kept, so nothing was changed. Please try again.";

/** Active holds that cover this table's record class in this household (or the whole tenant). */
export async function holdsCovering(conn: Conn, t: Omit<RemovalTarget, "purpose">) {
  const cls = classOf(t.table);
  const h = s.retentionHolds;
  return conn
    .select()
    .from(h)
    .where(
      and(
        eq(h.tenantId, t.tenantId),
        eq(h.status, "active"),
        t.householdId ? or(isNull(h.householdId), eq(h.householdId, t.householdId)) : undefined,
        sql`(${h.recordClasses} = '[]'::jsonb or ${h.recordClasses} @> jsonb_build_array(${cls}::text))`,
      ),
    );
}

export async function mayRemove(conn: Conn, t: RemovalTarget): Promise<RemovalDecision> {
  let holdIds: string[];
  try {
    holdIds = (await holdsCovering(conn, t)).map((r) => r.id);
  } catch {
    return { allowed: false, reason: "guard_unavailable", holdIds: [] };
  }
  if (holdIds.length) return { allowed: false, reason: "held", holdIds };
  if (t.purpose === "disposal") return { allowed: false, reason: "no_approved_policy", holdIds: [] };
  return { allowed: true };
}

/** Throws unless the removal may go ahead. Call it inside the transaction that removes. */
export async function assertMayRemove(conn: Conn, t: RemovalTarget) {
  const d = await mayRemove(conn, t);
  if (d.allowed) return;
  if (d.reason === "guard_unavailable") throw new AccessError("CONFLICT", GUARD_UNAVAILABLE_MESSAGE);
  if (d.reason === "held") throw new AccessError("CONFLICT", HELD_MESSAGE);
  throw new AccessError(
    "NOT_PERMITTED",
    "Records aren't removed for age: there's no approved retention policy.",
  );
}

/** Places a hold. Code and tests only, until decision on who may (see the file comment). */
export async function placeHold(
  conn: Conn,
  input: {
    tenantId: string;
    householdId: string | null;
    /** Empty: every class. */
    recordClasses: RecordClass[];
    reason: string;
    authorizationRef: string;
    placedByActorId: string;
  },
) {
  const unknown = input.recordClasses.filter((c) => !(RECORD_CLASSES as readonly string[]).includes(c));
  if (unknown.length) throw new AccessError("INVALID", `Unknown record class: ${unknown.join(", ")}.`);
  if (!input.reason.trim() || !input.authorizationRef.trim())
    throw new AccessError("INVALID", "A hold needs a reason and the authorization it rests on.");
  return conn.transaction(async (tx) => {
    const [hold] = await tx
      .insert(s.retentionHolds)
      .values({
        tenantId: input.tenantId,
        householdId: input.householdId,
        recordClasses: [...new Set(input.recordClasses)],
        reason: input.reason.trim(),
        authorizationRef: input.authorizationRef.trim(),
        placedByActorId: input.placedByActorId,
      })
      .returning();
    await appendAudit(tx, {
      tenantId: input.tenantId,
      householdId: input.householdId,
      actorId: input.placedByActorId,
      action: "retention.hold_placed",
      subjectType: "retention_hold",
      subjectId: hold!.id,
      summary: "A retention hold was placed. Covered records can't be removed while it's active.",
      visibility: "staff",
      context: { recordClasses: hold!.recordClasses, wholeTenant: input.householdId === null },
    });
    return hold!;
  });
}

/**
 * Releases one hold. Removes nothing, restores no access, and leaves every other hold in force:
 * `stillHeldBy` lists the active holds that still cover the same scope. Records become subject to
 * ordinary retention again only once a retention policy exists (D-05); any disposal then needs its
 * own approval.
 */
export async function releaseHold(
  conn: Conn,
  input: { tenantId: string; holdId: string; releasedByActorId: string; releaseAuthorizationRef: string },
) {
  if (!input.releaseAuthorizationRef.trim())
    throw new AccessError("INVALID", "Releasing a hold needs the authorization it rests on.");
  return conn.transaction(async (tx) => {
    const [released] = await tx
      .update(s.retentionHolds)
      .set({
        status: "released",
        releasedAt: new Date(),
        releasedByActorId: input.releasedByActorId,
        releaseAuthorizationRef: input.releaseAuthorizationRef.trim(),
      })
      .where(
        and(
          eq(s.retentionHolds.tenantId, input.tenantId),
          eq(s.retentionHolds.id, input.holdId),
          eq(s.retentionHolds.status, "active"),
        ),
      )
      .returning();
    if (!released) throw new AccessError("CONFLICT", "This hold isn't active.");
    const others = await tx
      .select({ id: s.retentionHolds.id })
      .from(s.retentionHolds)
      .where(
        and(
          eq(s.retentionHolds.tenantId, input.tenantId),
          eq(s.retentionHolds.status, "active"),
          released.householdId
            ? or(isNull(s.retentionHolds.householdId), eq(s.retentionHolds.householdId, released.householdId))
            : undefined,
        ),
      );
    await appendAudit(tx, {
      tenantId: input.tenantId,
      householdId: released.householdId,
      actorId: input.releasedByActorId,
      action: "retention.hold_released",
      subjectType: "retention_hold",
      subjectId: released.id,
      summary: "A retention hold was released. Nothing was removed.",
      visibility: "staff",
      context: { otherActiveHolds: others.length },
    });
    return { hold: released, stillHeldBy: others.map((o) => o.id) };
  });
}
