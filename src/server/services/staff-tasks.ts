/**
 * Care-team tasks across a care guide's own coverage, and bulk assign/reassign (founder decision 40).
 *
 * - Care guides only (`staff.task.bulk_assign`), and only tasks in households they cover today.
 * - Only to an eligible care guide: an active care guide who covers that task's household (anyone
 *   else couldn't see the task). The caller is eligible too, so "assign to me" works.
 * - Always previewed first: each task, who has it now, its due date and what that means for the
 *   new person (overdue, due within two days). Then a reason and explicit confirmation.
 * - One audit event for the run (subject: the new assignee) plus one per task, and an in-app
 *   notice to the new assignee. Staff assignment changes aren't essential email (decision 47).
 * - Never households, never authority or consent: this touches `tasks.assignee_actor_id` only.
 */
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, requireStaffPermission, type ActorContext } from "../context";
import { actorNames, careGuidesFor, notify } from "./common";
import { dueState } from "./staff";

const SOON_MS = 2 * 86_400_000;
export const BULK_TASK_MAX = 50;

function coverage(ctx: ActorContext) {
  requireStaffPermission(ctx, "staff.task.bulk_assign");
  return ctx.assignedHouseholdIds;
}

/** Open care-team tasks in the caller's coverage, with who could take each. */
export async function myCoverageTasks(db: DB, ctx: ActorContext) {
  const ids = coverage(ctx);
  if (!ids.length) return { tasks: [], guides: [] };
  const rows = await db
    .select({ t: s.tasks, household: s.households.displayName })
    .from(s.tasks)
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.tasks.householdId), eq(s.households.tenantId, s.tasks.tenantId)),
    )
    .where(
      and(
        eq(s.tasks.tenantId, ctx.tenantId),
        inArray(s.tasks.householdId, ids),
        eq(s.tasks.audience, "staff"),
        eq(s.tasks.status, "open"),
      ),
    )
    .orderBy(s.tasks.dueAt, s.tasks.createdAt);
  const names = await actorNames(
    db,
    ctx.tenantId,
    rows.map((r) => r.t.assigneeActorId),
  );
  const guidesBy = new Map<string, { actorId: string; name: string }[]>();
  for (const h of ids)
    guidesBy.set(
      h,
      (await careGuidesFor(db, ctx.tenantId, h)).map((g) => ({ actorId: g.actorId, name: g.name })),
    );
  const guides = [...new Map([...guidesBy.values()].flat().map((g) => [g.actorId, g])).values()];
  // Done recently: care-team tasks completed or closed in the last 14 days, with who and when.
  const since = new Date(Date.now() - 14 * 86_400_000);
  const finished = await db
    .select({ t: s.tasks, household: s.households.displayName })
    .from(s.tasks)
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.tasks.householdId), eq(s.households.tenantId, s.tasks.tenantId)),
    )
    .where(
      and(
        eq(s.tasks.tenantId, ctx.tenantId),
        inArray(s.tasks.householdId, ids),
        eq(s.tasks.audience, "staff"),
        inArray(s.tasks.status, ["done", "closed"]),
        // Completing sets completedAt; closing sets updatedAt.
        or(gte(s.tasks.completedAt, since), gte(s.tasks.updatedAt, since)),
      ),
    )
    .orderBy(desc(sql`coalesce(${s.tasks.completedAt}, ${s.tasks.updatedAt})`));
  const doneNames = await actorNames(
    db,
    ctx.tenantId,
    finished.map((r) => r.t.completedByActorId),
  );
  return {
    tasks: rows.map(({ t, household }) => ({
      id: t.id,
      title: t.title,
      householdId: t.householdId,
      household,
      dueAt: t.dueAt,
      whenLabel: t.whenLabel,
      assignee: t.assigneeActorId ? (names.get(t.assigneeActorId) ?? null) : null,
      assigneeActorId: t.assigneeActorId,
      eligible: (guidesBy.get(t.householdId) ?? []).map((g) => g.actorId),
    })),
    guides,
    done: finished.map(({ t, household }) => ({
      id: t.id,
      title: t.title,
      householdId: t.householdId,
      household,
      status: t.status as "done" | "closed",
      by: t.completedByActorId ? (doneNames.get(t.completedByActorId) ?? "Someone") : null,
      at: t.completedAt ?? t.updatedAt,
      closedReason: t.closedReason,
    })),
  };
}

/** Open care-team tasks in the caller's coverage that are overdue or due today (the sidebar badge). */
export async function dueTaskCount(db: DB, ctx: ActorContext) {
  if (!ctx.staffRoles.includes("care_guide") || !ctx.assignedHouseholdIds.length) return 0;
  const rows = await db
    .select({ dueAt: s.tasks.dueAt })
    .from(s.tasks)
    .where(
      and(
        eq(s.tasks.tenantId, ctx.tenantId),
        inArray(s.tasks.householdId, ctx.assignedHouseholdIds),
        eq(s.tasks.audience, "staff"),
        eq(s.tasks.status, "open"),
      ),
    );
  const now = new Date();
  return rows.filter((r) => dueState(r.dueAt, now) !== null).length;
}

async function plan(db: DB, ctx: ActorContext, input: { taskIds: string[]; toActorId: string }) {
  const ids = coverage(ctx);
  const taskIds = [...new Set(input.taskIds)];
  if (!taskIds.length) throw new AccessError("INVALID", "Choose at least one task.");
  if (taskIds.length > BULK_TASK_MAX)
    throw new AccessError("INVALID", `Choose at most ${BULK_TASK_MAX} tasks at a time.`);
  const rows = await db
    .select({ t: s.tasks, household: s.households.displayName })
    .from(s.tasks)
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.tasks.householdId), eq(s.households.tenantId, s.tasks.tenantId)),
    )
    .where(and(eq(s.tasks.tenantId, ctx.tenantId), inArray(s.tasks.id, taskIds)));
  // Anything outside the caller's coverage looks the same as something that doesn't exist.
  if (rows.length !== taskIds.length || rows.some((r) => !ids.includes(r.t.householdId)))
    throw new AccessError("OUT_OF_SCOPE", "One or more of these tasks isn't in your households.");
  if (rows.some((r) => r.t.audience !== "staff"))
    throw new AccessError(
      "INVALID",
      "Only care-team tasks can be assigned in bulk. Household tasks belong to the household.",
    );
  if (rows.some((r) => r.t.status !== "open"))
    throw new AccessError("INVALID", "One or more of these tasks is already done.");
  const now = Date.now();
  const names = await actorNames(db, ctx.tenantId, [
    input.toActorId,
    ...rows.map((r) => r.t.assigneeActorId),
  ]);
  const items = [];
  for (const { t, household } of rows) {
    const guides = await careGuidesFor(db, ctx.tenantId, t.householdId);
    if (!guides.some((g) => g.actorId === input.toActorId))
      throw new AccessError(
        "INVALID",
        `${names.get(input.toActorId) ?? "That person"} doesn't cover ${household}, so they can't take its tasks.`,
      );
    const due = t.dueAt?.getTime() ?? null;
    items.push({
      id: t.id,
      title: t.title,
      household,
      from: t.assigneeActorId ? (names.get(t.assigneeActorId) ?? "Someone") : null,
      unchanged: t.assigneeActorId === input.toActorId,
      dueAt: t.dueAt,
      dueImpact:
        due === null
          ? ("none" as const)
          : due < now
            ? ("overdue" as const)
            : due - now < SOON_MS
              ? ("soon" as const)
              : ("later" as const),
    });
  }
  return { to: { actorId: input.toActorId, name: names.get(input.toActorId) ?? "" }, items };
}

/** What would change, shown before anyone confirms. Changes nothing. */
export async function previewBulkTaskAssign(
  db: DB,
  ctx: ActorContext,
  input: { taskIds: string[]; toActorId: string },
) {
  const p = await plan(db, ctx, input);
  return {
    ...p,
    changing: p.items.filter((i) => !i.unchanged).length,
    overdue: p.items.filter((i) => !i.unchanged && i.dueImpact === "overdue").length,
    dueSoon: p.items.filter((i) => !i.unchanged && i.dueImpact === "soon").length,
  };
}

/** Assign or reassign the tasks. Due dates are kept as they are; the preview says what that means. */
export async function bulkAssignTasks(
  db: DB,
  ctx: ActorContext,
  input: { taskIds: string[]; toActorId: string; reason: string; confirmed: boolean },
) {
  if (!input.confirmed) throw new AccessError("INVALID", "Confirm the change first.");
  const reason = input.reason.trim();
  if (!reason) throw new AccessError("INVALID", "Add a short reason. Only staff will see it.");
  if (reason.length > 500) throw new AccessError("INVALID", "Keep the reason under 500 characters.");
  const p = await plan(db, ctx, input);
  const changing = p.items.filter((i) => !i.unchanged);
  if (!changing.length) throw new AccessError("INVALID", `${p.to.name} already has all of these.`);
  await db.transaction(async (tx) => {
    for (const i of changing) {
      const [t] = await tx
        .select()
        .from(s.tasks)
        .where(and(eq(s.tasks.tenantId, ctx.tenantId), eq(s.tasks.id, i.id)));
      const moved = await tx
        .update(s.tasks)
        .set({ assigneeActorId: p.to.actorId, updatedAt: new Date() })
        .where(and(eq(s.tasks.tenantId, ctx.tenantId), eq(s.tasks.id, i.id), eq(s.tasks.status, "open")))
        .returning({ id: s.tasks.id });
      if (!moved.length)
        throw new AccessError("CONFLICT", "One of these tasks just changed. Refresh and try again.");
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        householdId: t!.householdId,
        actorId: ctx.actorId,
        action: "task.reassigned",
        subjectType: "task",
        subjectId: i.id,
        summary: `A care-team task was assigned to ${p.to.name}.`,
        visibility: "staff",
        context: { from: t!.assigneeActorId, to: p.to.actorId, reason, bulk: true },
      });
    }
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "task.bulk_reassigned",
      subjectType: "actor",
      subjectId: p.to.actorId,
      summary: `${changing.length} care-team task${changing.length === 1 ? " was" : "s were"} assigned to ${p.to.name} in one step.`,
      visibility: "staff",
      context: {
        reason,
        taskIds: changing.map((i) => i.id),
        overdue: changing.filter((i) => i.dueImpact === "overdue").length,
        dueSoon: changing.filter((i) => i.dueImpact === "soon").length,
      },
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: null,
      recipients: [p.to.actorId],
      except: ctx.actorId,
      kind: "staff_assignment",
      title: "Care-team tasks were assigned to you",
      link: "/staff/tasks",
    });
  });
  return { changed: changing.length };
}
