/**
 * Staff lifecycle: changing someone's role at this hospice, and deactivating them.
 *
 * Hospice operations (`staff.lifecycle.manage`) acts on staff of its own organization only. Every
 * change is one transaction and leaves no broken ownership behind:
 *  - leaving the care-guide role ends every household assignment (escalations they owned there go
 *    back to "No owner assigned", as when any assignment ends);
 *  - deactivation also ends their organization role, releases every open escalation they own,
 *    unassigns their open care-team tasks, revokes their sessions and blocks sign-in.
 * Nobody can change themselves, and the last active hospice-operations person can't be removed.
 *
 * Founder decisions 38–39: changing a role and reactivating someone need the administrator's
 * `staff.role.manage`; operations can still deactivate (removing access never expands anyone's
 * authority), except an administrator. The last active administrator can't be removed either.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, like, lte, ne, or } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit, verifyAuditChain } from "../audit";
import { AccessError, requireStaffPermission, staffVisibleHouseholds, type ActorContext } from "../context";
import { can } from "@/domain/permissions";
import { activeAssignmentsOf, endInTx } from "./assignments";
import { actorNames, careGuidesFor } from "./common";
import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from "@/domain/model";
import { ESCALATION_WHAT } from "@/domain/queue";

export const STAFF_REASON_MAX = 500;
const NOT_FOUND = "That person isn't available.";

function checkReason(raw: string) {
  const reason = raw.trim();
  if (!reason) throw new AccessError("INVALID", "Add a short reason. Only staff will see it.");
  if (reason.length > STAFF_REASON_MAX)
    throw new AccessError("INVALID", `Keep the reason under ${STAFF_REASON_MAX} characters.`);
  return reason;
}

/** A staff member of the caller's organization (current or former), or the same refusal as a missing one. */
async function staffOfOrganization(conn: Conn, ctx: ActorContext, actorId: string) {
  requireStaffPermission(ctx, "staff.lifecycle.manage");
  if (!ctx.organizationId) throw new AccessError("OUT_OF_SCOPE", NOT_FOUND);
  const [actor] = await conn
    .select()
    .from(s.actors)
    .where(and(eq(s.actors.tenantId, ctx.tenantId), eq(s.actors.id, actorId), eq(s.actors.kind, "staff")));
  const roles = actor
    ? await conn
        .select()
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.tenantId, ctx.tenantId),
            eq(s.memberships.actorId, actorId),
            eq(s.memberships.organizationId, ctx.organizationId),
          ),
        )
        .orderBy(desc(s.memberships.createdAt))
    : [];
  if (!actor || !roles.length) throw new AccessError("OUT_OF_SCOPE", NOT_FOUND);
  const current = roles.find((r) => r.status === "active") ?? null;
  return { actor, roles, current, organizationId: ctx.organizationId };
}

async function activeOpsCount(
  conn: Conn,
  ctx: ActorContext,
  organizationId: string,
  role: StaffRole = "hospice_ops",
) {
  const rows = await conn
    .select({ actorId: s.memberships.actorId })
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, ctx.tenantId),
        eq(s.memberships.organizationId, organizationId),
        eq(s.memberships.roleCode, role),
        eq(s.memberships.status, "active"),
        isNull(s.actors.deactivatedAt),
      ),
    );
  return new Set(rows.map((r) => r.actorId)).size;
}

/** The hospice must keep at least one person in hospice operations and one active administrator. */
async function lastOfRole(conn: Conn, ctx: ActorContext, organizationId: string, role: string | undefined) {
  if (role !== "hospice_ops" && role !== "hospice_admin") return null;
  if ((await activeOpsCount(conn, ctx, organizationId, role)) > 1) return null;
  return role === "hospice_ops"
    ? "This hospice needs at least one person in hospice operations."
    : "This hospice needs at least one active administrator.";
}

/** What changing or deactivating this person would affect, shown before anyone confirms. */
export async function staffMember(db: DB, ctx: ActorContext, actorId: string) {
  const p = await staffOfOrganization(db, ctx, actorId);
  const assignments = await activeAssignmentsOf(db, ctx, actorId);
  const escalations = await db
    .select({
      id: s.escalations.id,
      kind: s.escalations.kind,
      householdId: s.escalations.householdId,
      name: s.households.displayName,
    })
    .from(s.escalations)
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.escalations.householdId), eq(s.households.tenantId, s.escalations.tenantId)),
    )
    .where(
      and(
        eq(s.escalations.tenantId, ctx.tenantId),
        eq(s.escalations.ownerActorId, actorId),
        ne(s.escalations.status, "resolved"),
        eq(s.households.organizationId, p.organizationId),
      ),
    );
  const tasks = await openStaffTasksAssigned(db, ctx, actorId, p.organizationId);
  const lastRole = await lastOfRole(db, ctx, p.organizationId, p.current?.roleCode);
  const isLastOps = lastRole !== null;
  const canManageRoles = can(ctx.staffRoles, "staff.role.manage");
  return {
    actorId,
    name: p.actor.displayName,
    email: p.actor.email,
    role: p.current
      ? { code: p.current.roleCode as StaffRole, label: ROLE_LABELS[p.current.roleCode as StaffRole] }
      : null,
    deactivatedAt: p.actor.deactivatedAt,
    isSelf: actorId === ctx.actorId,
    isLastOps,
    lastRole,
    /** Role changes and reactivation are for administrators (decision 39). */
    canManageRoles,
    /** Administrators manage coverage without opening household records (decision 39). */
    canOpenHouseholds: can(ctx.staffRoles, "staff.household.view"),
    /** Operations can't deactivate an administrator. */
    canDeactivate: p.current?.roleCode !== "hospice_admin" || canManageRoles,
    ownership: await ownershipHistory(db, ctx, actorId, p.organizationId),
    timeline: await auditTimeline(db, ctx, actorId),
    history: p.roles.map((r) => ({
      role: ROLE_LABELS[r.roleCode as StaffRole],
      since: r.createdAt,
      endedAt: r.endedAt,
      endReason: r.endReason,
    })),
    impact: {
      assignments: assignments.map((a) => ({
        householdId: a.scope.householdId,
        name: a.scope.householdName,
      })),
      escalations: escalations.map((e) => ({
        id: e.id,
        what: ESCALATION_WHAT[e.kind] ?? "Escalation",
        householdId: e.householdId,
        household: e.name,
      })),
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, householdId: t.householdId })),
    },
  };
}

async function openStaffTasksAssigned(
  conn: Conn,
  ctx: ActorContext,
  actorId: string,
  organizationId: string,
) {
  const rows = await conn
    .select({ t: s.tasks, org: s.households.organizationId })
    .from(s.tasks)
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.tasks.householdId), eq(s.households.tenantId, s.tasks.tenantId)),
    )
    .where(
      and(
        eq(s.tasks.tenantId, ctx.tenantId),
        eq(s.tasks.assigneeActorId, actorId),
        eq(s.tasks.audience, "staff"),
        eq(s.tasks.status, "open"),
      ),
    );
  return rows.filter((r) => r.org === organizationId).map((r) => r.t);
}

function guard(ctx: ActorContext, p: Awaited<ReturnType<typeof staffOfOrganization>>) {
  if (p.actor.id === ctx.actorId)
    throw new AccessError(
      "INVALID",
      "You can't change your own role or account here. Ask another administrator.",
    );
  if (p.actor.deactivatedAt || !p.current)
    throw new AccessError("INVALID", "This person has already been deactivated.");
}

/** Change someone's single organization role. Leaving the care-guide role ends their assignments. */
export async function changeStaffRole(
  db: DB,
  ctx: ActorContext,
  input: { actorId: string; role: StaffRole; reason: string },
) {
  requireStaffPermission(ctx, "staff.role.manage");
  const reason = checkReason(input.reason);
  if (!STAFF_ROLES.includes(input.role)) throw new AccessError("INVALID", "Choose a care-team role.");
  const p = await staffOfOrganization(db, ctx, input.actorId);
  guard(ctx, p);
  const from = p.current!.roleCode as StaffRole;
  if (from === input.role) throw new AccessError("INVALID", `${p.actor.displayName} already has that role.`);
  const last = await lastOfRole(db, ctx, p.organizationId, from);
  if (last) throw new AccessError("INVALID", last);
  await db.transaction(async (tx) => {
    const ended = await tx
      .update(s.memberships)
      .set({ status: "ended", endedAt: new Date(), endReason: `Role changed: ${reason}` })
      .where(and(eq(s.memberships.id, p.current!.id), eq(s.memberships.status, "active")))
      .returning({ id: s.memberships.id });
    if (!ended.length)
      throw new AccessError("CONFLICT", "Someone else just changed this person. Refresh to see.");
    await tx.insert(s.memberships).values({
      tenantId: ctx.tenantId,
      actorId: p.actor.id,
      organizationId: p.organizationId,
      roleCode: input.role,
    });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "staff.role_changed",
      subjectType: "actor",
      subjectId: p.actor.id,
      summary: `${p.actor.displayName}'s role changed from ${ROLE_LABELS[from].toLowerCase()} to ${ROLE_LABELS[input.role].toLowerCase()}.`,
      visibility: "staff",
      context: { from, to: input.role, reason },
      before: { role: from },
      after: { role: input.role },
    });
    if (from === "care_guide")
      for (const a of await activeAssignmentsOf(tx, ctx, p.actor.id))
        await endInTx(tx, ctx, a, `Role changed: ${reason}`);
  });
}

/**
 * Deactivate a staff member. They lose all access at once; their past work stays on the record,
 * attributed to them.
 */
export async function deactivateStaff(db: DB, ctx: ActorContext, input: { actorId: string; reason: string }) {
  const reason = checkReason(input.reason);
  const p = await staffOfOrganization(db, ctx, input.actorId);
  guard(ctx, p);
  if (p.current!.roleCode === "hospice_admin") requireStaffPermission(ctx, "staff.role.manage");
  const last = await lastOfRole(db, ctx, p.organizationId, p.current!.roleCode);
  if (last) throw new AccessError("INVALID", last);
  const name = p.actor.displayName;
  await db.transaction(async (tx) => {
    const now = new Date();
    const marked = await tx
      .update(s.actors)
      .set({ deactivatedAt: now })
      .where(
        and(eq(s.actors.tenantId, ctx.tenantId), eq(s.actors.id, p.actor.id), isNull(s.actors.deactivatedAt)),
      )
      .returning({ id: s.actors.id });
    if (!marked.length) throw new AccessError("CONFLICT", "This person has already been deactivated.");
    // Household assignments first (each audited, releasing escalations in that household)…
    for (const a of await activeAssignmentsOf(tx, ctx, p.actor.id))
      await endInTx(tx, ctx, a, `Deactivated: ${reason}`);
    // …then the organization role.
    await tx
      .update(s.memberships)
      .set({ status: "ended", endedAt: now, endReason: `Deactivated: ${reason}` })
      .where(
        and(
          eq(s.memberships.tenantId, ctx.tenantId),
          eq(s.memberships.actorId, p.actor.id),
          eq(s.memberships.organizationId, p.organizationId),
          eq(s.memberships.status, "active"),
        ),
      );
    // Any other open escalation they own (e.g. one taken as a reviewer) goes back to no owner.
    const released = await tx
      .update(s.escalations)
      .set({ status: "open", ownerActorId: null })
      .where(
        and(
          eq(s.escalations.tenantId, ctx.tenantId),
          eq(s.escalations.ownerActorId, p.actor.id),
          ne(s.escalations.status, "resolved"),
        ),
      )
      .returning({ id: s.escalations.id, householdId: s.escalations.householdId });
    for (const e of released)
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        householdId: e.householdId,
        actorId: ctx.actorId,
        action: "escalation.owner_released",
        subjectType: "escalation",
        subjectId: e.id,
        summary: `${name} no longer owns this escalation because their account was deactivated. It has no owner now.`,
        visibility: "staff",
        context: { previousOwner: p.actor.id },
      });
    // Their open care-team tasks lose the assignee, so the queue shows "No owner assigned".
    const tasks = await openStaffTasksAssigned(tx, ctx, p.actor.id, p.organizationId);
    if (tasks.length)
      await tx
        .update(s.tasks)
        .set({ assigneeActorId: null })
        .where(
          and(
            eq(s.tasks.tenantId, ctx.tenantId),
            inArray(
              s.tasks.id,
              tasks.map((t) => t.id),
            ),
          ),
        );
    for (const t of tasks)
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        householdId: t.householdId,
        actorId: ctx.actorId,
        action: "task.unassigned",
        subjectType: "task",
        subjectId: t.id,
        summary: `${name} is no longer assigned this task because their account was deactivated.`,
        visibility: "staff",
        context: { previousAssignee: p.actor.id },
      });
    await tx
      .delete(s.sessions)
      .where(and(eq(s.sessions.tenantId, ctx.tenantId), eq(s.sessions.actorId, p.actor.id)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "staff.deactivated",
      subjectType: "actor",
      subjectId: p.actor.id,
      summary: `${name}'s account was deactivated. Their sessions ended and they can no longer sign in.`,
      visibility: "staff",
      context: { reason, role: p.current!.roleCode },
    });
  });
}

/**
 * Reactivate a deactivated staff member (founder decision 38, reopening decision 3). Administrators
 * only, with a reason and a chosen role. Sign-in and that one organization role come back; former
 * household assignments, escalations and tasks do **not** — they're assigned again deliberately.
 */
export async function reactivateStaff(
  db: DB,
  ctx: ActorContext,
  input: { actorId: string; role: StaffRole; reason: string },
) {
  requireStaffPermission(ctx, "staff.role.manage");
  const reason = checkReason(input.reason);
  if (!STAFF_ROLES.includes(input.role)) throw new AccessError("INVALID", "Choose a care-team role.");
  const p = await staffOfOrganization(db, ctx, input.actorId);
  if (p.actor.id === ctx.actorId) throw new AccessError("INVALID", "You can't reactivate yourself.");
  if (!p.actor.deactivatedAt) throw new AccessError("INVALID", `${p.actor.displayName} is already active.`);
  await db.transaction(async (tx) => {
    const back = await tx
      .update(s.actors)
      .set({ deactivatedAt: null })
      .where(
        and(
          eq(s.actors.tenantId, ctx.tenantId),
          eq(s.actors.id, p.actor.id),
          eq(s.actors.deactivatedAt, p.actor.deactivatedAt!),
        ),
      )
      .returning({ id: s.actors.id });
    if (!back.length)
      throw new AccessError("CONFLICT", "Someone else just changed this person. Refresh to see.");
    await tx.insert(s.memberships).values({
      tenantId: ctx.tenantId,
      actorId: p.actor.id,
      organizationId: p.organizationId,
      roleCode: input.role,
    });
    // A fresh start on sign-in: no lockout carried over from before.
    await tx
      .update(s.users)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(and(eq(s.users.tenantId, ctx.tenantId), eq(s.users.actorId, p.actor.id)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "staff.reactivated",
      subjectType: "actor",
      subjectId: p.actor.id,
      summary: `${p.actor.displayName}'s account was reactivated as ${ROLE_LABELS[input.role].toLowerCase()}. Earlier household assignments were not restored.`,
      visibility: "staff",
      context: { reason, role: input.role, deactivatedAt: p.actor.deactivatedAt!.toISOString() },
    });
  });
}

/**
 * Households this person has covered and escalations they've owned, newest first (decision 38).
 * Assignments come from memberships; escalation ownership from the audit trail, since ownership
 * changes are recorded there and nowhere else.
 */
export type OwnershipHistory = {
  assignments: {
    householdId: string;
    household: string;
    since: Date;
    endedAt: Date | null;
    endReason: string | null;
  }[];
  escalations: {
    id: string;
    kind: string;
    household: string;
    state: "owned" | "resolved";
    resolvedAt: Date | null;
  }[];
};
export type TimelineEntry = { id: string; action: string; at: Date; byThem: boolean; summary: string | null };

async function ownershipHistory(
  conn: Conn,
  ctx: ActorContext,
  actorId: string,
  organizationId: string,
): Promise<OwnershipHistory> {
  const assignments = await conn
    .select({
      householdId: s.memberships.householdId,
      household: s.households.displayName,
      since: s.memberships.createdAt,
      endedAt: s.memberships.endedAt,
      endReason: s.memberships.endReason,
    })
    .from(s.memberships)
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.memberships.householdId), eq(s.households.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, ctx.tenantId),
        eq(s.memberships.actorId, actorId),
        eq(s.memberships.roleCode, "care_guide"),
        eq(s.households.organizationId, organizationId),
      ),
    )
    .orderBy(desc(s.memberships.createdAt));
  const escalations = await conn
    .select({
      id: s.escalations.id,
      kind: s.escalations.kind,
      household: s.households.displayName,
      status: s.escalations.status,
      ownerActorId: s.escalations.ownerActorId,
      resolvedByActorId: s.escalations.resolvedByActorId,
      resolvedAt: s.escalations.resolvedAt,
    })
    .from(s.escalations)
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.escalations.householdId), eq(s.households.tenantId, s.escalations.tenantId)),
    )
    .where(
      and(
        eq(s.escalations.tenantId, ctx.tenantId),
        eq(s.households.organizationId, organizationId),
        or(eq(s.escalations.ownerActorId, actorId), eq(s.escalations.resolvedByActorId, actorId)),
      ),
    )
    .orderBy(desc(s.escalations.createdAt));
  return {
    assignments: assignments.map((a) => ({ ...a, householdId: a.householdId! })),
    escalations: escalations.map((e) => ({
      id: e.id,
      kind: e.kind,
      household: e.household,
      state: e.status === "resolved" ? ("resolved" as const) : ("owned" as const),
      resolvedAt: e.resolvedAt,
    })),
  };
}

/** What this person did, and what was done to their account, newest first: fixed labels and safe summaries only. */
async function auditTimeline(conn: Conn, ctx: ActorContext, actorId: string): Promise<TimelineEntry[]> {
  const rows = await conn
    .select({
      id: s.auditEvents.id,
      action: s.auditEvents.action,
      summary: s.auditEvents.summary,
      at: s.auditEvents.createdAt,
      actorId: s.auditEvents.actorId,
      householdId: s.auditEvents.householdId,
    })
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.tenantId, ctx.tenantId),
        or(
          eq(s.auditEvents.actorId, actorId),
          and(eq(s.auditEvents.subjectType, "actor"), eq(s.auditEvents.subjectId, actorId)),
        ),
      ),
    )
    .orderBy(desc(s.auditEvents.seq))
    .limit(40);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    at: r.at,
    byThem: r.actorId === actorId,
    // Account events are about this person; their own actions are named by the fixed label only,
    // because a stored summary can quote a task title or a purpose.
    summary: r.householdId ? null : r.summary,
  }));
}

/**
 * The administrator's overview (decision 39): who's on the team, invitations waiting, and the
 * latest changes to roles, accounts and settings. Organization-level only — no households.
 */
export async function adminOverview(db: DB, ctx: ActorContext) {
  requireStaffPermission(ctx, "staff.role.manage");
  if (!ctx.organizationId) throw new AccessError("NOT_PERMITTED", "Your role doesn't include this action.");
  const org = ctx.organizationId;
  const members = await db
    .select({ actorId: s.memberships.actorId, role: s.memberships.roleCode, gone: s.actors.deactivatedAt })
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, ctx.tenantId),
        eq(s.memberships.organizationId, org),
        eq(s.memberships.status, "active"),
      ),
    );
  const byRole = STAFF_ROLES.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    n: members.filter((m) => m.role === role && !m.gone).length,
  }));
  const former = await db
    .selectDistinct({ id: s.actors.id })
    .from(s.actors)
    .innerJoin(
      s.memberships,
      and(eq(s.memberships.actorId, s.actors.id), eq(s.memberships.tenantId, s.actors.tenantId)),
    )
    .where(
      and(
        eq(s.actors.tenantId, ctx.tenantId),
        eq(s.memberships.organizationId, org),
        isNotNull(s.actors.deactivatedAt),
      ),
    );
  const now = Date.now();
  const invites = (
    await db
      .select()
      .from(s.staffInvitations)
      .where(and(eq(s.staffInvitations.tenantId, ctx.tenantId), eq(s.staffInvitations.organizationId, org)))
      .orderBy(desc(s.staffInvitations.createdAt))
  ).filter((i) => i.status === "pending" && i.expiresAt.getTime() > now);
  const recent = await db
    .select()
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.tenantId, ctx.tenantId),
        isNull(s.auditEvents.householdId),
        or(
          like(s.auditEvents.action, "staff.%"),
          like(s.auditEvents.action, "settings.%"),
          eq(s.auditEvents.subjectType, "staff_invitation"),
          eq(s.auditEvents.action, "task.bulk_reassigned"),
        ),
      ),
    )
    .orderBy(desc(s.auditEvents.seq))
    .limit(12);
  const names = await actorNames(
    db,
    ctx.tenantId,
    recent.map((r) => r.actorId),
  );
  return {
    byRole,
    active: byRole.reduce((a, b) => a + b.n, 0),
    former: former.length,
    invites: invites.map((i) => ({
      id: i.id,
      name: i.inviteeName,
      role: ROLE_LABELS[i.roleCode as StaffRole],
      expiresAt: i.expiresAt,
    })),
    recent: recent.map((r) => ({
      id: r.id,
      action: r.action,
      summary: r.summary,
      by: r.actorId ? (names.get(r.actorId) ?? "Someone") : "The system",
      at: r.createdAt,
    })),
    /** Decision 58, workstream 4: the audit chain's state, and coverage as counts (no households named). */
    integrity: await verifyAuditChain(db, ctx.tenantId),
    coverage: await coverageCounts(db, ctx),
  };
}

/** How many households have no care guide, and how many guides are away now or soon. Counts only. */
async function coverageCounts(db: DB, ctx: ActorContext) {
  const households = (await staffVisibleHouseholds(db, ctx, "coverage")).filter(
    (h) => h.lifecycleState !== "closed",
  );
  let withoutGuide = 0;
  for (const h of households) if (!(await careGuidesFor(db, ctx.tenantId, h.id)).length) withoutGuide++;
  const now = new Date();
  const away = await db
    .select({ id: s.staffAbsences.id })
    .from(s.staffAbsences)
    .where(
      and(
        eq(s.staffAbsences.tenantId, ctx.tenantId),
        isNull(s.staffAbsences.cancelledAt),
        gt(s.staffAbsences.endsAt, now),
        lte(s.staffAbsences.startsAt, new Date(now.getTime() + 3 * 86_400_000)),
      ),
    );
  return { households: households.length, withoutGuide, away: away.length };
}
