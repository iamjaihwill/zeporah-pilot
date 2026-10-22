/**
 * People's actions on exceptions (decision 58; spec section 3.3). Exceptions are computed from
 * their source records (`coordinationQueue`), so every action first finds the row as this person
 * sees it — which keeps role scoping exactly as the list's, and refuses anything no longer open.
 * Only rule-derived rows are claimed here; escalations and tasks keep their own owners.
 *
 * Consent and authority work, owned work and team coverage can't be dismissed: they're resolved
 * through their own workflows (NOT_DISMISSABLE). Every action is audit-logged.
 */
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { appendAudit } from "../audit";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { AccessError, staffScope, staffVisibleHouseholds, type ActorContext } from "../context";
import { actorNames, householdMembers } from "./common";
import { coordinationQueue, escalationOwnerCandidates } from "./staff";
import { can } from "@/domain/permissions";
import { CATEGORY_LABELS, type QueueRow } from "@/domain/queue";

const label = (r: QueueRow) => CATEGORY_LABELS[r.category].toLowerCase();

async function openRow(db: DB, ctx: ActorContext, key: string) {
  const row = (await coordinationQueue(db, ctx)).find((r) => r.id === key);
  if (!row) throw new AccessError("OUT_OF_SCOPE", "That isn't open any more, or it isn't available to you.");
  if (!row.claimable) throw new AccessError("INVALID", "This one has its own owner; open it to work on it.");
  return row;
}

async function upsertClaim(
  tx: DB | Parameters<Parameters<DB["transaction"]>[0]>[0],
  ctx: ActorContext,
  row: QueueRow,
  set: Partial<typeof s.exceptionClaims.$inferInsert>,
) {
  await tx
    .insert(s.exceptionClaims)
    .values({
      tenantId: ctx.tenantId,
      householdId: row.householdId,
      key: row.id,
      ...set,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [s.exceptionClaims.tenantId, s.exceptionClaims.key],
      set: { ...set, updatedAt: new Date() },
    });
}

const audit = (
  tx: Parameters<typeof appendAudit>[0],
  ctx: ActorContext,
  row: QueueRow,
  action: string,
  summary: string,
  extra: { reason?: string; context?: Record<string, unknown> } = {},
) =>
  appendAudit(tx, {
    tenantId: ctx.tenantId,
    householdId: row.householdId,
    actorId: ctx.actorId,
    action,
    subjectType: "exception",
    subjectId: row.id,
    summary,
    visibility: "staff",
    ...(extra.reason ? { reason: extra.reason } : {}),
    context: { category: row.category, ...extra.context },
  });

export async function takeException(db: DB, ctx: ActorContext, key: string) {
  const row = await openRow(db, ctx, key);
  if (row.mine) return { ok: true };
  await db.transaction(async (tx) => {
    await upsertClaim(tx, ctx, row, { ownerActorId: ctx.actorId, state: "owned" });
    await audit(
      tx,
      ctx,
      row,
      "exception.taken",
      `${ctx.displayName} took ownership of a ${label(row)} exception.`,
    );
  });
  return { ok: true };
}

export async function assignException(
  db: DB,
  ctx: ActorContext,
  input: { key: string; toActorId: string; reason?: string | undefined },
) {
  if (!can(ctx.staffRoles, "staff.assignment.manage"))
    throw new AccessError("NOT_PERMITTED", "Your role doesn't include this action.");
  const row = await openRow(db, ctx, input.key);
  const to = (await escalationOwnerCandidates(db, ctx)).find((c) => c.actorId === input.toActorId);
  if (!to || !to.sees(row.householdId))
    throw new AccessError("INVALID", "Choose someone who works on this household.");
  const reason = input.reason?.trim() || undefined;
  await db.transaction(async (tx) => {
    await upsertClaim(tx, ctx, row, { ownerActorId: to.actorId, state: "owned" });
    await audit(
      tx,
      ctx,
      row,
      "exception.assigned",
      `${row.owner ?? "No owner"} → ${to.name}: a ${label(row)} exception was assigned.`,
      { ...(reason ? { reason } : {}), context: { from: row.ownerIds[0] ?? null, to: to.actorId } },
    );
  });
  return { ok: true };
}

/** Assign several in one step: a preview, a required reason, then this (decision 40's pattern). */
export async function bulkAssignExceptions(
  db: DB,
  ctx: ActorContext,
  input: { keys: string[]; toActorId: string; reason: string },
) {
  if (!input.reason.trim()) throw new AccessError("INVALID", "Give a reason; only staff will see it.");
  if (input.keys.length > 50) throw new AccessError("INVALID", "Choose up to 50 at a time.");
  const results: { key: string; ok: boolean; message?: string }[] = [];
  for (const key of [...new Set(input.keys)])
    try {
      await assignException(db, ctx, { key, toActorId: input.toActorId, reason: input.reason });
      results.push({ key, ok: true });
    } catch (e) {
      results.push({
        key,
        ok: false,
        message: e instanceof AccessError ? e.message : "That didn't go through.",
      });
    }
  return results;
}

const canManage = (ctx: ActorContext, row: QueueRow) =>
  row.mine || can(ctx.staffRoles, "staff.assignment.manage");

export async function markWaiting(
  db: DB,
  ctx: ActorContext,
  input: { key: string; on: "family" | "partner" | "staff"; note?: string | undefined },
) {
  const row = await openRow(db, ctx, input.key);
  if (!canManage(ctx, row)) throw new AccessError("NOT_PERMITTED", "Take ownership first.");
  const note = input.note?.trim().slice(0, 140) || null;
  await db.transaction(async (tx) => {
    await upsertClaim(tx, ctx, row, {
      ownerActorId: row.ownerIds[0] ?? ctx.actorId,
      state: "waiting",
      waitingOn: input.on,
      waitingNote: note,
    });
    await audit(
      tx,
      ctx,
      row,
      "exception.waiting",
      `Marked as waiting on ${input.on === "partner" ? "a partner" : input.on === "family" ? "the family" : "staff"}.`,
      { context: { on: input.on } },
    );
  });
  return { ok: true };
}

export async function releaseException(db: DB, ctx: ActorContext, key: string) {
  const row = await openRow(db, ctx, key);
  if (!row.mine) throw new AccessError("INVALID", "You don't own this one.");
  await db.transaction(async (tx) => {
    await upsertClaim(tx, ctx, row, { ownerActorId: null, state: null, waitingOn: null, waitingNote: null });
    await audit(tx, ctx, row, "exception.owner_released", `${ctx.displayName} released ownership.`);
  });
  return { ok: true };
}

export async function dismissException(db: DB, ctx: ActorContext, input: { key: string; reason: string }) {
  const row = await openRow(db, ctx, input.key);
  if (!row.dismissable)
    throw new AccessError("INVALID", "This can't be dismissed; it's resolved through its own workflow.");
  if (!canManage(ctx, row)) throw new AccessError("NOT_PERMITTED", "Take ownership first.");
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 280)
    throw new AccessError("INVALID", "Give a reason (up to 280 characters); only staff will see it.");
  await db.transaction(async (tx) => {
    await upsertClaim(tx, ctx, row, {
      dismissedReason: reason,
      dismissedByActorId: ctx.actorId,
      dismissedAt: new Date(),
    });
    await audit(
      tx,
      ctx,
      row,
      "exception.dismissed",
      `${ctx.displayName} dismissed a ${label(row)} exception.`,
      {
        reason,
      },
    );
  });
  return { ok: true };
}

/**
 * Unread critical update (exception E-8): someone reached the person by phone. The family's own
 * acknowledgement state doesn't change; this only records the call.
 */
export async function reachedByPhone(
  db: DB,
  ctx: ActorContext,
  input: { updateId: string; personActorId: string },
) {
  const [u] = await db
    .select()
    .from(s.familyUpdates)
    .where(and(eq(s.familyUpdates.tenantId, ctx.tenantId), eq(s.familyUpdates.id, input.updateId)));
  if (!u) throw new AccessError("OUT_OF_SCOPE", "That update isn't available.");
  const scope = await staffScope(db, ctx, u.householdId, "staff.household.view");
  const person = (await householdMembers(db, ctx.tenantId, scope.householdId)).find(
    (m) => m.actorId === input.personActorId,
  );
  if (!person) throw new AccessError("INVALID", "Choose someone in the household.");
  await appendAudit(db, {
    tenantId: ctx.tenantId,
    householdId: scope.householdId,
    actorId: ctx.actorId,
    action: "update.reached_by_phone",
    subjectType: "family_update",
    subjectId: u.id,
    summary: `${ctx.displayName} recorded reaching ${person.name} by phone.`,
    visibility: "staff",
    context: { person: person.actorId },
  });
  return { ok: true };
}

/**
 * Resolved in the last 14 days, each with what resolved it, who and when: resolved escalations,
 * dismissed exceptions, finished care-team tasks, accepted handoffs and calls recorded.
 */
export async function resolvedExceptions(db: DB, ctx: ActorContext, now = new Date()) {
  const hh = await staffVisibleHouseholds(db, ctx);
  if (!hh.length) return [];
  const ids = hh.map((h) => h.id);
  const name = (id: string | null) => hh.find((h) => h.id === id)?.displayName ?? "";
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const events = await db
    .select()
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.tenantId, ctx.tenantId),
        inArray(s.auditEvents.householdId, ids),
        gt(s.auditEvents.createdAt, since),
        inArray(s.auditEvents.action, [
          "escalation.resolved",
          "exception.dismissed",
          "task.completed",
          "task.closed",
          "handoff.accepted",
          "handoff.withdrawn",
          "update.reached_by_phone",
        ]),
      ),
    )
    .orderBy(desc(s.auditEvents.seq))
    .limit(200);
  const names = await actorNames(
    db,
    ctx.tenantId,
    events.map((e) => e.actorId),
  );
  const HOW: Record<string, string> = {
    "escalation.resolved": "Resolved",
    "exception.dismissed": "Dismissed",
    "task.completed": "Task completed",
    "task.closed": "Task closed as not needed",
    "handoff.accepted": "Handoff accepted",
    "update.reached_by_phone": "Reached by phone",
  };
  // A withdrawn offer that had passed its accept-by time was a stalled handoff, rerouted.
  const withdrawnIds = events.filter((e) => e.action === "handoff.withdrawn").map((e) => e.subjectId!);
  const stalled = new Set(
    withdrawnIds.length
      ? (
          await db
            .select({ id: s.handoffs.id, acceptBy: s.handoffs.acceptBy, respondedAt: s.handoffs.respondedAt })
            .from(s.handoffs)
            .where(and(eq(s.handoffs.tenantId, ctx.tenantId), inArray(s.handoffs.id, withdrawnIds)))
        )
          .filter((h) => h.respondedAt && h.respondedAt.getTime() > h.acceptBy.getTime())
          .map((h) => h.id)
      : [],
  );
  // A call clears an unread update only once everyone it's waiting on is covered: until then the
  // update is still open, so the call isn't listed as a resolution.
  const stillOpen = new Set(
    (await coordinationQueue(db, ctx)).filter((r) => r.kind === "acknowledgement").map((r) => r.subjectId),
  );
  return events
    .filter((e) => !(e.action === "update.reached_by_phone" && stillOpen.has(e.subjectId)))
    .map((e) => ({
      id: e.id,
      household: name(e.householdId),
      householdId: e.householdId!,
      how:
        e.action === "handoff.withdrawn"
          ? stalled.has(e.subjectId!)
            ? "Stalled handoff rerouted"
            : "Handoff withdrawn"
          : (HOW[e.action] ?? "Resolved"),
      by: e.actorId ? (names.get(e.actorId) ?? "Someone") : "The system",
      at: e.createdAt,
      summary: e.summary,
      reason: typeof e.context["reason"] === "string" ? (e.context["reason"] as string) : null,
    }));
}
