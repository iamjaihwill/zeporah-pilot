/**
 * Task-only helpers (founder decision 42). A helper sees the one task they were asked to help
 * with and the minimum context to do it: what it is, any details, when it's due, the first name of
 * who asked, and the hospice's 24-hour line. Nothing else: no household pages, people, messages,
 * updates or vault — every household service refuses them, because the helper role holds no
 * household permission at all (domain/permissions.ts).
 *
 * Access ends when the task is done or closed, or on the stated date, whichever comes first.
 */
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { AccessError, type ActorContext } from "../context";
import { actorNames, organizationHotline } from "./common";
import { markFamilyTaskDone } from "./tasks";

async function helperTasks(db: DB, ctx: ActorContext) {
  if (ctx.kind !== "family") throw new AccessError("NOT_PERMITTED", "This page is for helpers.");
  const rows = await db
    .select({ m: s.memberships, t: s.tasks, h: s.households })
    .from(s.memberships)
    .innerJoin(
      s.tasks,
      and(eq(s.tasks.id, s.memberships.taskId), eq(s.tasks.tenantId, s.memberships.tenantId)),
    )
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.tasks.householdId), eq(s.households.tenantId, s.tasks.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, ctx.tenantId),
        eq(s.memberships.actorId, ctx.actorId),
        eq(s.memberships.roleCode, "helper"),
        eq(s.memberships.status, "active"),
        or(isNull(s.memberships.expiresAt), gt(s.memberships.expiresAt, new Date())),
        eq(s.tasks.status, "open"),
      ),
    );
  // The task must still be theirs: if it was reassigned, their access to it has ended.
  return rows.filter((r) => r.t.assigneeActorId === ctx.actorId && r.t.householdId === r.m.householdId);
}

/** Everything a helper may see: their open helper tasks, each with its minimum context. */
export async function helperView(db: DB, ctx: ActorContext) {
  const rows = await helperTasks(db, ctx);
  const names = await actorNames(
    db,
    ctx.tenantId,
    rows.map((r) => r.t.ownerActorId),
  );
  const out = [];
  for (const { m, t, h } of rows)
    out.push({
      id: t.id,
      title: t.title,
      detail: t.detail,
      dueAt: t.dueAt,
      askedBy: (names.get(t.ownerActorId) ?? "").split(" ")[0] ?? "",
      accessEndsAt: m.expiresAt,
      hotline: await organizationHotline(db, ctx.tenantId, h.organizationId),
    });
  return { name: ctx.displayName, tasks: out };
}

/** A helper marks their task done. Their access ends with it (tasks.ts ends the membership). */
export async function completeHelperTask(db: DB, ctx: ActorContext, taskId: string) {
  const row = (await helperTasks(db, ctx)).find((r) => r.t.id === taskId);
  if (!row) throw new AccessError("OUT_OF_SCOPE", "This task isn't available.");
  await db.transaction(async (tx) => {
    const ok = await markFamilyTaskDone(
      tx,
      row.t,
      { actorId: ctx.actorId, name: ctx.displayName, kind: "family" },
      ctx.displayName,
    );
    if (!ok) throw new AccessError("INVALID", "This task is already done.");
  });
}
