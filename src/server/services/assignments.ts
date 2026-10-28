/**
 * Care-guide assignment: the one write path for which households a care guide works on.
 *
 * An assignment is an active `memberships` row for a staff actor on a household with the role
 * `care_guide` (v0.1 assigns care guides only; operations and reviewers see their whole
 * organization by role). Visibility follows it on the guide's next request, through
 * `staffSeesHousehold` in ../context.ts. Hospice operations (`staff.assignment.manage`) assigns
 * and ends; ending never deletes — the row is kept as `ended` with when and why.
 */
import { and, eq, inArray, isNotNull, isNull, lt, ne } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import {
  AccessError,
  requireStaffPermission,
  staffScope,
  staffSeesHousehold,
  staffVisibleHouseholds,
  type ActorContext,
  type StaffScope,
} from "../context";
import { careGuidesFor, notify } from "./common";
import { orgSettings } from "./org-settings";
import { can } from "@/domain/permissions";
import { LIFECYCLE_LABELS } from "@/domain/lifecycle";
import { ROLE_LABELS, type LifecycleState, type StaffRole } from "@/domain/model";

export const ASSIGNMENT_END_REASON_MAX = 500;

/** Active care guides in the caller's own organization and tenant. */
export async function organizationCareGuides(conn: Conn, ctx: ActorContext) {
  if (!ctx.organizationId) return [];
  const guides = await conn
    .select({ actorId: s.actors.id, name: s.actors.displayName })
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, ctx.tenantId),
        eq(s.memberships.organizationId, ctx.organizationId),
        eq(s.memberships.roleCode, "care_guide"),
        eq(s.memberships.status, "active"),
        eq(s.actors.kind, "staff"),
        isNull(s.actors.deactivatedAt),
      ),
    )
    .orderBy(s.actors.displayName);
  // Each guide's current caseload, so whoever assigns can see who has room.
  const held = guides.length
    ? await conn
        .select({ actorId: s.memberships.actorId })
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.tenantId, ctx.tenantId),
            inArray(
              s.memberships.actorId,
              guides.map((g) => g.actorId),
            ),
            eq(s.memberships.roleCode, "care_guide"),
            eq(s.memberships.status, "active"),
            isNotNull(s.memberships.householdId),
          ),
        )
    : [];
  return guides.map((g) => ({ ...g, caseload: held.filter((h) => h.actorId === g.actorId).length }));
}

/**
 * The household's care team for the Overview tab: everyone who can see the household sees the
 * assigned guides; operations also gets the guides who could be assigned.
 */
export async function careTeam(conn: Conn, ctx: ActorContext, scope: StaffScope) {
  const guides = await careGuidesFor(conn, ctx.tenantId, scope.householdId);
  const canManage = can(ctx.staffRoles, "staff.assignment.manage");
  const assigned = new Set(guides.map((g) => g.actorId));
  const eligible =
    canManage && scope.lifecycle !== "closed"
      ? (await organizationCareGuides(conn, ctx)).filter((g) => !assigned.has(g.actorId))
      : [];
  return {
    guides: guides.map((g) => ({
      membershipId: g.membershipId,
      actorId: g.actorId,
      name: g.name,
      since: g.since,
    })),
    canManage,
    closed: scope.lifecycle === "closed",
    eligible,
    /** The hospice's assignment defaults (decision 39). */
    defaults: (await orgSettings(conn, ctx.tenantId, ctx.organizationId)).assignment,
  };
}

/** Assign a care guide to a household in the caller's organization. */
export async function assignCareGuide(
  db: DB,
  ctx: ActorContext,
  input: { householdId: string; actorId: string },
) {
  requireStaffPermission(ctx, "staff.assignment.manage");
  const scope = await changeableScope(db, ctx, input.householdId);
  const guide = await eligibleGuide(db, ctx, input.actorId);
  return guardDuplicate(() => db.transaction((tx) => insertAssignment(tx, ctx, scope, guide)));
}

/**
 * End a care-guide assignment. The guide loses access to the household on their next request.
 * Open escalations in this household that they owned go back to "No owner assigned", so the
 * queue never shows an owner who can no longer act on it.
 */
export async function endAssignment(
  db: DB,
  ctx: ActorContext,
  input: { membershipId: string; reason: string },
) {
  requireStaffPermission(ctx, "staff.assignment.manage");
  const reason = checkReason(input.reason);
  const a = await loadAssignment(db, ctx, input.membershipId);
  await db.transaction((tx) => endInTx(tx, ctx, a, reason));
}

/**
 * Hand a household from one care guide to another in one step: the old assignment ends (with the
 * reason) and the new one starts, together or not at all. Escalations the outgoing guide owned
 * here are released to "No owner assigned", exactly as when an assignment ends.
 */
export async function reassignCareGuide(
  db: DB,
  ctx: ActorContext,
  input: { membershipId: string; toActorId: string; reason: string; handOver?: boolean | undefined },
) {
  requireStaffPermission(ctx, "staff.assignment.manage");
  const reason = checkReason(input.reason);
  const a = await loadAssignment(db, ctx, input.membershipId);
  if (a.actorId === input.toActorId) throw new AccessError("INVALID", "Choose a different care guide.");
  const guide = await eligibleGuide(db, ctx, input.toActorId);
  return guardDuplicate(() =>
    db.transaction(async (tx) => {
      // Only when asked: the outgoing guide's open escalations and tasks here go to the new guide.
      // Otherwise they're released (no owner), as whenever an assignment ends.
      if (input.handOver) await handOverInTx(tx, ctx, a, guide);
      await endInTx(tx, ctx, a, reason);
      return insertAssignment(tx, ctx, a.scope, guide);
    }),
  );
}

/* ------------------------------------------------------------------ shared steps */

function checkReason(raw: string) {
  const reason = raw.trim();
  if (!reason) throw new AccessError("INVALID", "Add a short reason. Only staff will see it.");
  if (reason.length > ASSIGNMENT_END_REASON_MAX)
    throw new AccessError("INVALID", `Keep the reason under ${ASSIGNMENT_END_REASON_MAX} characters.`);
  return reason;
}

/** In scope (else the same refusal as a missing household), and not closed. */
async function changeableScope(conn: Conn, ctx: ActorContext, householdId: string) {
  // Coverage visibility (decision 39): administrators manage coverage without opening records.
  const [h] = await conn
    .select()
    .from(s.households)
    .where(and(eq(s.households.tenantId, ctx.tenantId), eq(s.households.id, householdId)));
  if (!h || !staffSeesHousehold(ctx, h, "coverage"))
    // The same refusal (and the same audit entry) as any other out-of-scope household.
    await staffScope(conn, ctx, householdId, "staff.household.view");
  const scope = {
    householdId: h!.id,
    lifecycle: h!.lifecycleState as LifecycleState,
    householdName: h!.displayName,
  };
  if (scope.lifecycle === "closed")
    throw new AccessError("INVALID", "This household is closed, so its care team can't change.");
  return scope;
}

export async function eligibleGuide(conn: Conn, ctx: ActorContext, actorId: string) {
  const guide = (await organizationCareGuides(conn, ctx)).find((g) => g.actorId === actorId);
  if (!guide) throw new AccessError("INVALID", "Choose a care guide from this hospice.");
  return guide;
}

async function guardDuplicate<T>(f: () => Promise<T>) {
  try {
    return await f();
  } catch (e) {
    if (e instanceof AccessError) throw e;
    // The unique index on active rows is the last word if two requests race.
    throw new AccessError("CONFLICT", "That care guide is already assigned to this household.");
  }
}

export type Assignment = { membershipId: string; actorId: string; name: string; scope: StaffScope };

/** An active-or-ended care-guide assignment the caller may change; anything else looks missing. */
async function loadAssignment(conn: Conn, ctx: ActorContext, membershipId: string): Promise<Assignment> {
  const [m] = await conn
    .select()
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, ctx.tenantId),
        eq(s.memberships.id, membershipId),
        eq(s.memberships.roleCode, "care_guide"),
        eq(s.actors.kind, "staff"),
        isNotNull(s.memberships.householdId),
      ),
    );
  // A missing row, a family membership or another tenant's row all look the same.
  if (!m) throw new AccessError("OUT_OF_SCOPE", "That assignment isn't available.");
  const scope = await changeableScope(conn, ctx, m.memberships.householdId!);
  return { membershipId: m.memberships.id, actorId: m.actors.id, name: m.actors.displayName, scope };
}

export async function insertAssignment(
  tx: Conn,
  ctx: ActorContext,
  scope: StaffScope,
  guide: { actorId: string; name: string },
) {
  const [row] = await tx
    .insert(s.memberships)
    .values({
      tenantId: ctx.tenantId,
      actorId: guide.actorId,
      householdId: scope.householdId,
      roleCode: "care_guide",
    })
    .onConflictDoNothing()
    .returning({ id: s.memberships.id });
  if (!row) throw new AccessError("CONFLICT", "That care guide is already assigned to this household.");
  await appendAudit(tx, {
    tenantId: ctx.tenantId,
    householdId: scope.householdId,
    actorId: ctx.actorId,
    action: "assignment.created",
    subjectType: "membership",
    subjectId: row.id,
    summary: `${guide.name} was assigned to this household as a care guide.`,
    visibility: "staff",
    context: { assignee: guide.actorId, role: "care_guide" },
  });
  return { id: row.id };
}

/** Moves the outgoing guide's open escalations and care-team tasks in this household to the new guide. */
async function handOverInTx(
  tx: Conn,
  ctx: ActorContext,
  a: Assignment,
  to: { actorId: string; name: string },
) {
  const escalations = await tx
    .update(s.escalations)
    .set({ ownerActorId: to.actorId })
    .where(
      and(
        eq(s.escalations.tenantId, ctx.tenantId),
        eq(s.escalations.householdId, a.scope.householdId),
        eq(s.escalations.ownerActorId, a.actorId),
        ne(s.escalations.status, "resolved"),
      ),
    )
    .returning({ id: s.escalations.id });
  for (const e of escalations)
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: a.scope.householdId,
      actorId: ctx.actorId,
      action: "escalation.owner_transferred",
      subjectType: "escalation",
      subjectId: e.id,
      summary: `This escalation was handed from ${a.name} to ${to.name} when the household was reassigned.`,
      visibility: "staff",
      context: { from: a.actorId, to: to.actorId },
    });
  const tasks = await tx
    .update(s.tasks)
    .set({ assigneeActorId: to.actorId })
    .where(
      and(
        eq(s.tasks.tenantId, ctx.tenantId),
        eq(s.tasks.householdId, a.scope.householdId),
        eq(s.tasks.assigneeActorId, a.actorId),
        eq(s.tasks.audience, "staff"),
        eq(s.tasks.status, "open"),
      ),
    )
    .returning({ id: s.tasks.id });
  for (const t of tasks)
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: a.scope.householdId,
      actorId: ctx.actorId,
      action: "task.reassigned",
      subjectType: "task",
      subjectId: t.id,
      summary: `This task was handed from ${a.name} to ${to.name} when the household was reassigned.`,
      visibility: "staff",
      context: { from: a.actorId, to: to.actorId },
    });
  if (escalations.length || tasks.length)
    await notify(tx, {
      tenantId: ctx.tenantId,
      recipients: [to.actorId],
      householdId: a.scope.householdId,
      kind: "handoff",
      title: "Open work for a household was handed to you",
      link: `/staff/households/${a.scope.householdId}?tab=overview`,
    });
}

/** Ends one assignment inside a transaction; also used when staff are deactivated. */
/**
 * A household transfer the receiving care guide accepted (decision 58, story C-7): exactly what
 * Reassign with "hand over open work" does — the outgoing guide's open escalations and care-team
 * tasks here move to the receiving guide, the outgoing assignment ends with the reason, and the new
 * one starts — together or not at all. Called with the receiving guide's context.
 */
export async function completeTransferInTx(
  tx: Conn,
  ctx: ActorContext,
  input: {
    householdId: string;
    from: { actorId: string; name: string };
    to: { actorId: string; name: string };
    reason: string;
  },
) {
  const [h] = await tx
    .select()
    .from(s.households)
    .where(and(eq(s.households.tenantId, ctx.tenantId), eq(s.households.id, input.householdId)));
  if (!h || h.lifecycleState === "closed")
    throw new AccessError("INVALID", "This household is closed, so its care team can't change.");
  const scope = {
    householdId: h.id,
    lifecycle: h.lifecycleState as LifecycleState,
    householdName: h.displayName,
  };
  const [m] = await tx
    .select({ id: s.memberships.id })
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.tenantId, ctx.tenantId),
        eq(s.memberships.householdId, h.id),
        eq(s.memberships.actorId, input.from.actorId),
        eq(s.memberships.roleCode, "care_guide"),
        eq(s.memberships.status, "active"),
        isNull(s.memberships.coverForActorId),
      ),
    );
  if (!m) throw new AccessError("CONFLICT", `${input.from.name} isn't assigned to this household any more.`);
  const a: Assignment = { membershipId: m.id, actorId: input.from.actorId, name: input.from.name, scope };
  await handOverInTx(tx, ctx, a, input.to);
  await endInTx(tx, ctx, a, input.reason);
  return insertAssignment(tx, ctx, scope, input.to);
}

export async function endInTx(tx: Conn, ctx: ActorContext, a: Assignment, reason: string) {
  const ended = await tx
    .update(s.memberships)
    .set({ status: "ended", endedAt: new Date(), endReason: reason })
    .where(
      and(
        eq(s.memberships.tenantId, ctx.tenantId),
        eq(s.memberships.id, a.membershipId),
        eq(s.memberships.status, "active"),
      ),
    )
    .returning({ id: s.memberships.id });
  if (!ended.length)
    throw new AccessError("CONFLICT", "This assignment has already ended. Refresh to see the care team.");
  await appendAudit(tx, {
    tenantId: ctx.tenantId,
    householdId: a.scope.householdId,
    actorId: ctx.actorId,
    action: "assignment.ended",
    subjectType: "membership",
    subjectId: a.membershipId,
    summary: `${a.name}'s care-guide assignment to this household ended.`,
    visibility: "staff",
    context: { assignee: a.actorId, role: "care_guide", reason },
  });
  const released = await tx
    .update(s.escalations)
    .set({ status: "open", ownerActorId: null })
    .where(
      and(
        eq(s.escalations.tenantId, ctx.tenantId),
        eq(s.escalations.householdId, a.scope.householdId),
        eq(s.escalations.ownerActorId, a.actorId),
        ne(s.escalations.status, "resolved"),
      ),
    )
    .returning({ id: s.escalations.id });
  for (const e of released)
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: a.scope.householdId,
      actorId: ctx.actorId,
      action: "escalation.owner_released",
      subjectType: "escalation",
      subjectId: e.id,
      summary: `${a.name} no longer owns this escalation because their assignment ended. It has no owner now.`,
      visibility: "staff",
      context: { previousOwner: a.actorId },
    });
  // Their open care-team tasks here lose the assignee, so the queue shows "No owner assigned".
  const tasks = await tx
    .update(s.tasks)
    .set({ assigneeActorId: null })
    .where(
      and(
        eq(s.tasks.tenantId, ctx.tenantId),
        eq(s.tasks.householdId, a.scope.householdId),
        eq(s.tasks.assigneeActorId, a.actorId),
        eq(s.tasks.audience, "staff"),
        eq(s.tasks.status, "open"),
      ),
    )
    .returning({ id: s.tasks.id });
  for (const t of tasks)
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: a.scope.householdId,
      actorId: ctx.actorId,
      action: "task.unassigned",
      subjectType: "task",
      subjectId: t.id,
      summary: `${a.name} is no longer assigned this task because their assignment ended.`,
      visibility: "staff",
      context: { previousAssignee: a.actorId },
    });
}

/* ------------------------------------------------------------------ roster */

/**
 * The operations view of who covers which households: active care guides with their households,
 * households with no care guide, staff who see the whole organization by role, and assignments
 * still held by someone who is no longer an active care guide here (to be ended or reassigned).
 */
export async function roster(db: DB, ctx: ActorContext) {
  requireStaffPermission(ctx, "staff.assignment.manage");
  const households = await staffVisibleHouseholds(db, ctx, "coverage");
  const ids = households.map((h) => h.id);
  const orgRows = ctx.organizationId
    ? await db
        .select({ actorId: s.actors.id, name: s.actors.displayName, role: s.memberships.roleCode })
        .from(s.memberships)
        .innerJoin(
          s.actors,
          and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
        )
        .where(
          and(
            eq(s.memberships.tenantId, ctx.tenantId),
            eq(s.memberships.organizationId, ctx.organizationId),
            eq(s.memberships.status, "active"),
            eq(s.actors.kind, "staff"),
            isNull(s.actors.deactivatedAt),
          ),
        )
        .orderBy(s.actors.displayName)
    : [];
  const assignments = ids.length
    ? await db
        .select({
          membershipId: s.memberships.id,
          actorId: s.actors.id,
          name: s.actors.displayName,
          householdId: s.memberships.householdId,
          since: s.memberships.createdAt,
        })
        .from(s.memberships)
        .innerJoin(
          s.actors,
          and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
        )
        .where(
          and(
            eq(s.memberships.tenantId, ctx.tenantId),
            inArray(s.memberships.householdId, ids),
            eq(s.memberships.roleCode, "care_guide"),
            eq(s.memberships.status, "active"),
            eq(s.actors.kind, "staff"),
          ),
        )
    : [];
  // Workload: open escalations each person owns, and their overdue care-team tasks.
  const openEscalations = ids.length
    ? await db
        .select({ ownerActorId: s.escalations.ownerActorId })
        .from(s.escalations)
        .where(
          and(
            eq(s.escalations.tenantId, ctx.tenantId),
            inArray(s.escalations.householdId, ids),
            ne(s.escalations.status, "resolved"),
          ),
        )
    : [];
  const overdue = ids.length
    ? await db
        .select({ assigneeActorId: s.tasks.assigneeActorId })
        .from(s.tasks)
        .where(
          and(
            eq(s.tasks.tenantId, ctx.tenantId),
            inArray(s.tasks.householdId, ids),
            eq(s.tasks.audience, "staff"),
            eq(s.tasks.status, "open"),
            lt(s.tasks.dueAt, new Date()),
          ),
        )
    : [];
  const byId = new Map(households.map((h) => [h.id, h]));
  const hh = (householdId: string) => {
    const h = byId.get(householdId)!;
    return {
      id: h.id,
      name: h.displayName,
      lifecycle: h.lifecycleState as LifecycleState,
      lifecycleLabel: LIFECYCLE_LABELS[h.lifecycleState as LifecycleState],
    };
  };
  const guideIds = new Set(orgRows.filter((r) => r.role === "care_guide").map((r) => r.actorId));
  const guides = [
    ...new Map(orgRows.filter((r) => r.role === "care_guide").map((r) => [r.actorId, r])).values(),
  ].map((g) => {
    const mine = assignments
      .filter((a) => a.actorId === g.actorId)
      .map((a) => ({ membershipId: a.membershipId, since: a.since, ...hh(a.householdId!) }))
      .sort((x, y) => x.name.localeCompare(y.name));
    return {
      actorId: g.actorId,
      name: g.name,
      count: mine.length,
      households: mine,
      // Workload beside the household count (as in the Workforce report).
      escalations: openEscalations.filter((e) => e.ownerActorId === g.actorId).length,
      overdueTasks: overdue.filter((x) => x.assigneeActorId === g.actorId).length,
    };
  });
  const covered = new Set(assignments.filter((a) => guideIds.has(a.actorId)).map((a) => a.householdId));
  const roles = new Map<string, string[]>();
  for (const r of orgRows) roles.set(r.actorId, [...(roles.get(r.actorId) ?? []), r.role]);
  return {
    /** The hospice's assignment defaults (decision 39). */
    defaults: (await orgSettings(db, ctx.tenantId, ctx.organizationId)).assignment,
    /** Administrators manage coverage without opening household records (decision 39). */
    canOpenHouseholds: can(ctx.staffRoles, "staff.household.view"),
    guides,
    uncovered: households
      .filter((h) => !covered.has(h.id) && h.lifecycleState !== "closed")
      .map((h) => hh(h.id)),
    organizationWide: [...roles]
      .filter(([, rs]) => rs.some((r) => r !== "care_guide"))
      .map(([actorId, rs]) => ({
        actorId,
        name: orgRows.find((r) => r.actorId === actorId)!.name,
        roles: rs.map((r) => ROLE_LABELS[r as StaffRole]),
      })),
    /** Deactivated staff who held a role here, newest first. */
    former: await formerStaff(db, ctx),
    /** Assignments held by someone who isn't an active care guide here any more. */
    ineligible: assignments
      .filter((a) => !guideIds.has(a.actorId))
      .map((a) => ({
        membershipId: a.membershipId,
        actorId: a.actorId,
        guideName: a.name,
        household: hh(a.householdId!),
      })),
  };
}

/** Households → their assigned care guides' names, for the households list. */
export async function careGuideNames(conn: Conn, tenantId: string, householdIds: string[]) {
  const map = new Map<string, string[]>();
  if (!householdIds.length) return map;
  const rows = await conn
    .select({ householdId: s.memberships.householdId, name: s.actors.displayName })
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, tenantId),
        inArray(s.memberships.householdId, householdIds),
        eq(s.memberships.roleCode, "care_guide"),
        eq(s.memberships.status, "active"),
        eq(s.actors.kind, "staff"),
      ),
    )
    .orderBy(s.actors.displayName);
  for (const r of rows) map.set(r.householdId!, [...(map.get(r.householdId!) ?? []), r.name]);
  return map;
}

/**
 * Every active care-guide assignment a person holds in the caller's organization, including on
 * closed households — for ending them all when the person's role changes or they're deactivated.
 */
export async function activeAssignmentsOf(conn: Conn, ctx: ActorContext, actorId: string) {
  if (!ctx.organizationId) return [];
  const rows = await conn
    .select({ m: s.memberships, name: s.actors.displayName, h: s.households })
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.memberships.householdId), eq(s.households.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, ctx.tenantId),
        eq(s.memberships.actorId, actorId),
        eq(s.memberships.roleCode, "care_guide"),
        eq(s.memberships.status, "active"),
        eq(s.households.organizationId, ctx.organizationId),
        eq(s.actors.kind, "staff"),
      ),
    );
  return rows.map(
    (r): Assignment => ({
      membershipId: r.m.id,
      actorId,
      name: r.name,
      scope: {
        householdId: r.h.id,
        lifecycle: r.h.lifecycleState as LifecycleState,
        householdName: r.h.displayName,
      },
    }),
  );
}

async function formerStaff(conn: Conn, ctx: ActorContext) {
  if (!ctx.organizationId) return [];
  const rows = await conn
    .selectDistinct({ actorId: s.actors.id, name: s.actors.displayName, at: s.actors.deactivatedAt })
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, ctx.tenantId),
        eq(s.memberships.organizationId, ctx.organizationId),
        isNotNull(s.actors.deactivatedAt),
      ),
    );
  return rows
    .map((r) => ({ actorId: r.actorId, name: r.name, deactivatedAt: r.at! }))
    .sort((x, y) => y.deactivatedAt.getTime() - x.deactivatedAt.getTime());
}
