/**
 * Coordinators managing household tasks (founder decision 44), using the existing `tasks.create`
 * permission: the household coordinator and, by decision 48b, the patient (not after bereavement
 * begins). Both hold `tasks.create` in the permission matrix.
 *
 * - Non-clinical coordination only: no medical orders and no legal obligations. A short screen
 *   refuses the obvious ones and says why; it's a guard rail, not a guarantee, so the form also says it.
 * - Assign to a household member (not a helper, who comes in through a task-only invitation) or to
 *   one of the household's care guides.
 * - No hidden tasks about family members: a task is visible to the whole household, or — when it's
 *   sensitive and the coordinator chose so — to the assignee, the coordinators, the care team and
 *   the people named. The coordinator always chooses visibility explicitly for a sensitive task.
 * - Every change is audit-logged. A limited task's title never goes into a family-visible summary.
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, familyScope, type ActorContext, type FamilyScope } from "../context";
import { careGuidesFor, firstName, householdMembers, notify } from "./common";
import { can } from "@/domain/permissions";
import { householdOrgSettings } from "./org-settings";

export const TASK_TITLE_MAX = 120;
export const TASK_DETAIL_MAX = 600;

export { OUT_OF_SCOPE, OUT_OF_SCOPE_MESSAGE } from "@/domain/task-scope";
import { OUT_OF_SCOPE, OUT_OF_SCOPE_MESSAGE } from "@/domain/task-scope";

export type TaskInput = {
  title: string;
  detail: string;
  assigneeActorId: string | null;
  dueAt: string | null;
  sensitive: boolean;
  /** Required. For a sensitive task the form makes the coordinator choose; nothing is assumed. */
  visibility: "household" | "limited";
  sharedWith: string[];
};

async function coordinatorScope(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "tasks.create");
  const manages =
    scope.roles.includes("coordinator") ||
    (scope.roles.includes("patient") && scope.lifecycle !== "bereavement");
  if (!manages)
    throw new AccessError(
      "NOT_PERMITTED",
      "Only the household coordinator or the patient can add or change household tasks.",
    );
  if (scope.lifecycle === "closed") throw new AccessError("INVALID", "This household is closed.");
  return scope;
}

/** Who a coordinator may assign to: household members (not helpers) and the household's care guides. */
export async function assignableForHousehold(db: DB, ctx: ActorContext, scope: FamilyScope) {
  const members = (await householdMembers(db, ctx.tenantId, scope.householdId)).filter((m) =>
    m.roles.some((r) => r !== "helper"),
  );
  const guides = await careGuidesFor(db, ctx.tenantId, scope.householdId);
  return [
    ...members.map((m) => ({ actorId: m.actorId, name: m.name, kind: "family" as const })),
    ...guides.map((g) => ({ actorId: g.actorId, name: g.name, kind: "staff" as const })),
  ];
}

async function check(db: DB, ctx: ActorContext, scope: FamilyScope, input: TaskInput) {
  const title = input.title.trim();
  const detail = input.detail.trim();
  if (!title) throw new AccessError("INVALID", "Give the task a short title.");
  if (title.length > TASK_TITLE_MAX)
    throw new AccessError("INVALID", `Keep the title under ${TASK_TITLE_MAX} characters.`);
  if (detail.length > TASK_DETAIL_MAX)
    throw new AccessError("INVALID", `Keep the details under ${TASK_DETAIL_MAX} characters.`);
  if (OUT_OF_SCOPE.test(`${title} ${detail}`)) throw new AccessError("INVALID", OUT_OF_SCOPE_MESSAGE);
  if (input.visibility !== "household" && input.visibility !== "limited")
    throw new AccessError("INVALID", "Choose who can see this task.");
  const people = await assignableForHousehold(db, ctx, scope);
  if (input.assigneeActorId && !people.some((p) => p.actorId === input.assigneeActorId))
    throw new AccessError("INVALID", "Choose someone in this household or its care team.");
  const sharedWith = input.visibility === "limited" ? [...new Set(input.sharedWith)] : [];
  if (sharedWith.some((id) => !people.some((p) => p.actorId === id && p.kind === "family")))
    throw new AccessError("INVALID", "Share it only with people in this household.");
  let dueAt: Date | null = null;
  if (input.dueAt) {
    dueAt = new Date(input.dueAt);
    if (Number.isNaN(dueAt.getTime())) throw new AccessError("INVALID", "Enter a due date.");
  }
  const assignee = people.find((p) => p.actorId === input.assigneeActorId) ?? null;
  return { title, detail, dueAt, sharedWith, assignee };
}

/** Add a household task (decision 44). */
export async function createHouseholdTask(db: DB, ctx: ActorContext, input: TaskInput) {
  const scope = await coordinatorScope(db, ctx);
  const v = await check(db, ctx, scope, input);
  return db.transaction(async (tx) => {
    const [t] = await tx
      .insert(s.tasks)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        title: v.title,
        detail: v.detail,
        audience: "family",
        assigneeActorId: v.assignee?.actorId ?? null,
        ownerActorId: ctx.actorId,
        createdByActorId: ctx.actorId,
        dueAt: v.dueAt,
        visibility: input.visibility,
        sharedWith: v.sharedWith,
        source: "family",
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "task.created",
      subjectType: "task",
      subjectId: t!.id,
      summary:
        input.visibility === "limited"
          ? `${firstName(ctx.displayName)} added a task that only some people can see.`
          : `${firstName(ctx.displayName)} added a task: “${t!.title}”.`,
      visibility: "family",
      context: {
        visibility: input.visibility,
        sharedWith: v.sharedWith,
        assignee: v.assignee?.actorId ?? null,
      },
    });
    if (v.assignee)
      await notify(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        recipients: [v.assignee.actorId],
        except: ctx.actorId,
        kind: "task",
        title: "A task was assigned to you",
        link:
          v.assignee.kind === "staff" ? `/staff/households/${scope.householdId}?tab=tasks` : "/family/tasks",
      });
    return { id: t!.id };
  });
}

async function editable(db: DB, ctx: ActorContext, scope: FamilyScope, taskId: string) {
  const [t] = await db
    .select()
    .from(s.tasks)
    .where(
      and(
        eq(s.tasks.tenantId, ctx.tenantId),
        eq(s.tasks.householdId, scope.householdId),
        eq(s.tasks.id, taskId),
        eq(s.tasks.audience, "family"),
      ),
    );
  if (!t) throw new AccessError("OUT_OF_SCOPE", "This task isn't available.");
  // The care team's own tasks stay theirs to change.
  if (t.source !== "family")
    throw new AccessError("NOT_PERMITTED", "Your care team added this task, so only they can change it.");
  if (t.status !== "open") throw new AccessError("INVALID", "Only open tasks can be changed.");
  return t;
}

/** Edit an open task the household added. Records which fields changed, never their content. */
export async function editHouseholdTask(db: DB, ctx: ActorContext, input: TaskInput & { id: string }) {
  const scope = await coordinatorScope(db, ctx);
  const t = await editable(db, ctx, scope, input.id);
  const v = await check(db, ctx, scope, input);
  const next = {
    title: v.title,
    detail: v.detail,
    assigneeActorId: v.assignee?.actorId ?? null,
    dueAt: v.dueAt,
    visibility: input.visibility,
    sharedWith: v.sharedWith,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
    (k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(t[k] ?? null),
  );
  if (!changed.length) return;
  await db.transaction(async (tx) => {
    await tx
      .update(s.tasks)
      .set({ ...next, updatedAt: new Date() })
      .where(and(eq(s.tasks.tenantId, ctx.tenantId), eq(s.tasks.id, t.id)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "task.updated",
      subjectType: "task",
      subjectId: t.id,
      summary: `${firstName(ctx.displayName)} changed a task.`,
      visibility: "family",
      context: { changed, previousAssignee: t.assigneeActorId },
    });
    const recipients = [next.assigneeActorId, t.assigneeActorId].filter((x): x is string => !!x);
    if (recipients.length)
      await notify(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        recipients,
        except: ctx.actorId,
        kind: "task_change",
        title: "A task has an update",
        link: "/family/tasks",
      });
  });
}

/** Close an open task that's no longer needed (not the same as done). A reason is required. */
export async function closeHouseholdTask(db: DB, ctx: ActorContext, input: { id: string; reason: string }) {
  const scope = await coordinatorScope(db, ctx);
  const t = await editable(db, ctx, scope, input.id);
  const reason = input.reason.trim();
  if (!reason) throw new AccessError("INVALID", "Say briefly why it's no longer needed.");
  if (reason.length > 300) throw new AccessError("INVALID", "Keep the reason under 300 characters.");
  await db.transaction(async (tx) => {
    await tx
      .update(s.tasks)
      .set({ status: "closed", closedReason: reason, updatedAt: new Date() })
      .where(and(eq(s.tasks.tenantId, ctx.tenantId), eq(s.tasks.id, t.id), eq(s.tasks.status, "open")));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "task.closed",
      subjectType: "task",
      subjectId: t.id,
      summary:
        t.visibility === "limited"
          ? `${firstName(ctx.displayName)} closed a task that only some people could see.`
          : `${firstName(ctx.displayName)} closed “${t.title}”: no longer needed.`,
      visibility: "family",
      context: { reason },
    });
    // Helpers whose access came from this task lose it now (decision 42).
    await tx
      .update(s.memberships)
      .set({ status: "ended", endedAt: new Date(), endReason: "task_closed" })
      .where(
        and(
          eq(s.memberships.tenantId, ctx.tenantId),
          eq(s.memberships.taskId, t.id),
          eq(s.memberships.status, "active"),
        ),
      );
    if (t.assigneeActorId)
      await notify(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        recipients: [t.assigneeActorId],
        except: ctx.actorId,
        kind: "task_change",
        title: "A task you had is no longer needed",
        link: "/family/tasks",
      });
  });
}

/** What the task form offers: whether this person manages tasks, and who they can assign to or share with. */
export async function taskFormOptions(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "tasks.view");
  // Decision 42: whoever can invite may ask someone to help with one task.
  const canInvite = can(scope.roles, "people.invite", scope.lifecycle);
  const manages =
    scope.roles.includes("coordinator") ||
    (scope.roles.includes("patient") && scope.lifecycle !== "bereavement");
  if (!manages || scope.lifecycle === "closed")
    return { canManage: false, canInvite, people: [], catalog: [] };
  // The hospice's task catalog (decision 39): household tasks only.
  const catalog = (await householdOrgSettings(db, ctx.tenantId, scope.householdId)).taskCatalog.filter(
    (t) => t.audience === "family",
  );
  return { canManage: true, canInvite, people: await assignableForHousehold(db, ctx, scope), catalog };
}
