/**
 * Marking a household task done (founder decisions 25 and 29c).
 *
 * Who may: the person it's assigned to, the household coordinator, the patient, or the household's
 * care guide. No one else: not other family members, and not proxies. A task with no assignee can
 * be marked done by the coordinator, the patient or the care guide.
 *
 * Marking someone else's task done records "Marked done by X for Y" and tells the assignee.
 */
import { assertMayRemove } from "./retention";
import { and, eq } from "drizzle-orm";
import type { Conn } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { careGuidesFor, firstName, notify } from "./common";

export type TaskRow = typeof s.tasks.$inferSelect;

/**
 * The family-side rule. `roles` are the person's roles in this household. The patient's role stops
 * applying at bereavement, as everywhere else (domain/permissions.ts).
 */
export const familyMayComplete = (
  t: TaskRow,
  actorId: string,
  roles: readonly string[],
  lifecycle?: string,
) =>
  t.audience === "family" &&
  t.status === "open" &&
  (t.assigneeActorId === actorId ||
    roles.includes("coordinator") ||
    (roles.includes("patient") && lifecycle !== "bereavement"));

/**
 * Who in the household sees a task (decisions 44 and 46). Household-visible tasks: the assignee and
 * everyone but family members (who see their own tasks only, as before). Limited tasks: the
 * assignee, the coordinators, whoever added it and the people named — the patient too, only when
 * named (or when they added it). The care
 * team always sees household tasks on the staff side. Helpers see only their own task (helpers.ts).
 */
export const familyMaySee = (t: TaskRow, actorId: string, roles: readonly string[]) =>
  t.audience === "family" &&
  (t.assigneeActorId === actorId ||
    (t.visibility === "limited"
      ? roles.includes("coordinator") || t.sharedWith.includes(actorId) || t.ownerActorId === actorId
      : roles.some((r) => r !== "family_member" && r !== "helper")));

/** The staff-side rule: only an active care guide of this household. */
export async function careGuideMayComplete(conn: Conn, t: TaskRow, actorId: string) {
  if (t.audience !== "family" || t.status !== "open") return false;
  return (await careGuidesFor(conn, t.tenantId, t.householdId)).some((g) => g.actorId === actorId);
}

/** Summary for the record: the plain "finished" wording, or "Marked done by X for Y". */
export function doneSummary(title: string, by: string, assignee: string | null, forSomeoneElse: boolean) {
  return forSomeoneElse && assignee
    ? `Marked done by ${firstName(by)} for ${firstName(assignee)}: “${title}”.`
    : `${firstName(by)} finished “${title}”.`;
}

/** Mark it done, write the audit event and send the notifications. Caller has checked the rule. */
export async function markFamilyTaskDone(
  tx: Conn,
  t: TaskRow,
  by: { actorId: string; name: string; kind: "family" | "staff" },
  assigneeName: string | null,
) {
  const forSomeoneElse = !!t.assigneeActorId && t.assigneeActorId !== by.actorId;
  const done = await tx
    .update(s.tasks)
    .set({ status: "done", completedAt: new Date(), completedByActorId: by.actorId })
    .where(and(eq(s.tasks.tenantId, t.tenantId), eq(s.tasks.id, t.id), eq(s.tasks.status, "open")))
    .returning({ id: s.tasks.id });
  if (!done.length) return false;
  // A task-only helper's access ends with the task (decision 42).
  await tx
    .update(s.memberships)
    .set({ status: "ended", endedAt: new Date(), endReason: "task_done" })
    .where(
      and(
        eq(s.memberships.tenantId, t.tenantId),
        eq(s.memberships.taskId, t.id),
        eq(s.memberships.status, "active"),
      ),
    );
  await appendAudit(tx, {
    tenantId: t.tenantId,
    householdId: t.householdId,
    actorId: by.actorId,
    action: "task.completed",
    subjectType: "task",
    subjectId: t.id,
    summary:
      t.visibility === "limited"
        ? "A task that only some people can see was marked done."
        : doneSummary(t.title, by.name, assigneeName, forSomeoneElse),
    visibility: "family",
    context: forSomeoneElse ? { forActorId: t.assigneeActorId } : {},
  });
  const guides = await careGuidesFor(tx, t.tenantId, t.householdId);
  await notify(tx, {
    tenantId: t.tenantId,
    householdId: t.householdId,
    recipients: [t.ownerActorId, ...guides.map((g) => g.actorId)].filter((r) => r !== t.assigneeActorId),
    except: by.actorId,
    kind: "task_change",
    title: "A task has an update",
    link: t.ownerActorId.startsWith("st") ? `/staff/households/${t.householdId}?tab=tasks` : "/family/tasks",
  });
  if (forSomeoneElse)
    await notify(tx, {
      tenantId: t.tenantId,
      householdId: t.householdId,
      recipients: [t.assigneeActorId!],
      except: by.actorId,
      kind: "task_change",
      title: "Someone marked one of your tasks done",
      link: "/family/tasks",
    });
  return true;
}

/** Put a done household task back to open. Caller has checked who may. Removes the done marker. */
export async function reopenTask(conn: Conn, t: TaskRow, by: { actorId: string; name: string }) {
  await conn.transaction(async (tx) => {
    const reopened = await tx
      .update(s.tasks)
      .set({ status: "open", completedAt: null, completedByActorId: null })
      .where(and(eq(s.tasks.tenantId, t.tenantId), eq(s.tasks.id, t.id), eq(s.tasks.status, "done")))
      .returning({ id: s.tasks.id });
    if (!reopened.length) return;
    // "Your care team asked to know when it's done": it isn't done any more.
    if (t.completedByActorId) {
      await assertMayRemove(tx, {
        tenantId: t.tenantId,
        householdId: t.householdId,
        table: "acknowledgements",
        purpose: "correction",
      });
      await tx
        .delete(s.acknowledgements)
        .where(
          and(
            eq(s.acknowledgements.tenantId, t.tenantId),
            eq(s.acknowledgements.subjectType, "task"),
            eq(s.acknowledgements.subjectId, t.id),
            eq(s.acknowledgements.actorId, t.completedByActorId),
          ),
        );
    }
    await appendAudit(tx, {
      tenantId: t.tenantId,
      householdId: t.householdId,
      actorId: by.actorId,
      action: "task.reopened",
      subjectType: "task",
      subjectId: t.id,
      summary:
        t.visibility === "limited"
          ? `${firstName(by.name)} reopened a task.`
          : `${firstName(by.name)} reopened “${t.title}”.`,
      visibility: "family",
    });
    const guides = await careGuidesFor(tx, t.tenantId, t.householdId);
    await notify(tx, {
      tenantId: t.tenantId,
      householdId: t.householdId,
      recipients: [t.ownerActorId, t.assigneeActorId ?? "", ...guides.map((g) => g.actorId)],
      except: by.actorId,
      kind: "task_change",
      title: "A task has an update",
      link: t.ownerActorId.startsWith("st")
        ? `/staff/households/${t.householdId}?tab=tasks`
        : "/family/tasks",
    });
  });
}
