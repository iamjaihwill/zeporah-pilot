/**
 * Operational reports (hospice operations) and closing a household after bereavement support.
 *
 * Reports are counts "as of now" for the operations lead's own hospice — never lists of people or
 * records — built from the same services and visibility rules as every other staff page.
 */
import { and, eq, gte, inArray, ne } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, requireStaffPermission, staffScope, type ActorContext } from "../context";
import { coordinationQueue } from "./staff";
import { roster } from "./assignments";
import { orgSettings } from "./org-settings";
import { sharingRegister } from "./register";
import { bereavementWorkload } from "./bereavement";
import { canTransition, LIFECYCLE_LABELS } from "@/domain/lifecycle";
import type { LifecycleState } from "@/domain/model";

export const CLOSE_REASON_MAX = 500;

export async function operationsReport(db: DB, ctx: ActorContext, now = new Date()) {
  requireStaffPermission(ctx, "staff.lifecycle.manage");
  // Operations, who open Reports: administrators hold the permission above but do no household
  // work (decision 39), so they don't get Reports or its exports.
  requireStaffPermission(ctx, "staff.household.view");
  const team = await roster(db, ctx);
  const households = [...team.guides.flatMap((g) => g.households), ...team.uncovered];
  const allHouseholds = await db
    .select({ id: s.households.id, lifecycle: s.households.lifecycleState })
    .from(s.households)
    .where(
      and(
        eq(s.households.tenantId, ctx.tenantId),
        eq(s.households.organizationId, ctx.organizationId ?? "-"),
      ),
    );
  const byStage = (["enrolled", "active_hospice", "bereavement", "closed"] as LifecycleState[]).map((l) => ({
    stage: LIFECYCLE_LABELS[l],
    n: allHouseholds.filter((h) => h.lifecycle === l).length,
  }));
  const queue = await coordinationQueue(db, ctx);
  const kinds = new Map<string, number>();
  for (const q of queue) kinds.set(q.kind, (kinds.get(q.kind) ?? 0) + 1);
  const ids = allHouseholds.map((h) => h.id);
  const escalations = ids.length
    ? await db
        .select({ status: s.escalations.status, owner: s.escalations.ownerActorId })
        .from(s.escalations)
        .where(
          and(
            eq(s.escalations.tenantId, ctx.tenantId),
            inArray(s.escalations.householdId, ids),
            // Same rule as the coordination queue: correction requests are counted as corrections.
            ne(s.escalations.kind, "consent_correction"),
          ),
        )
    : [];
  const consents = await sharingRegister(db, ctx, now);
  const stageCounts = new Map<string, number>();
  for (const c of consents) stageCounts.set(c.stageLabel, (stageCounts.get(c.stageLabel) ?? 0) + 1);
  const packets = ids.length
    ? await db
        .select({ state: s.packets.state })
        .from(s.packets)
        .where(and(eq(s.packets.tenantId, ctx.tenantId), inArray(s.packets.householdId, ids)))
    : [];
  const packetCounts = new Map<string, number>();
  for (const p of packets) packetCounts.set(p.state, (packetCounts.get(p.state) ?? 0) + 1);
  const grief = await bereavementWorkload(db, ctx, now);
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const recent = await db
    .select({ action: s.auditEvents.action })
    .from(s.auditEvents)
    .where(and(eq(s.auditEvents.tenantId, ctx.tenantId), gte(s.auditEvents.createdAt, since)));
  const count = (a: string) => recent.filter((r) => r.action === a).length;
  const recorded = ids.length
    ? await db
        .select({ id: s.bereavementContacts.id })
        .from(s.bereavementContacts)
        .where(
          and(
            eq(s.bereavementContacts.tenantId, ctx.tenantId),
            inArray(s.bereavementContacts.householdId, ids),
            eq(s.bereavementContacts.status, "done"),
            gte(s.bereavementContacts.completedAt, since),
          ),
        )
    : [];
  return {
    asOf: now,
    households: { byStage, uncovered: team.uncovered.length, total: households.length },
    caseload: team.guides.map((g) => ({ name: g.name, n: g.count })),
    queue: [...kinds].map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n),
    escalations: {
      open: escalations.filter((e) => e.status !== "resolved").length,
      unowned: escalations.filter((e) => e.status !== "resolved" && !e.owner).length,
    },
    consents: [...stageCounts].map(([stage, n]) => ({ stage, n })),
    corrections: consents.filter((c) => c.correctionOpen).length,
    packets: [...packetCounts].map(([state, n]) => ({ state, n })),
    bereavement: {
      dueWithinMonth: grief.open.filter((o) => o.window !== "later").length,
      recordedLast30Days: recorded.length,
    },
    access: {
      refusedLast30Days: count("access.denied"),
      failedSignInsLast30Days: count("auth.sign_in_failed"),
      lockoutsLast30Days: count("auth.locked"),
    },
  };
}

/**
 * Close a household after bereavement support (operations). It becomes read-only under the
 * existing closed-state rules; open bereavement check-ins drop off the workload. Families aren't
 * sent anything (founder decision); their pages show the closed state.
 */
export async function closeHousehold(
  db: DB,
  ctx: ActorContext,
  input: { householdId: string; reason: string },
) {
  requireStaffPermission(ctx, "lifecycle.confirm");
  const reason = input.reason.trim();
  if (!reason) throw new AccessError("INVALID", "Add a short reason. Only staff will see it.");
  if (reason.length > CLOSE_REASON_MAX)
    throw new AccessError("INVALID", `Keep the reason under ${CLOSE_REASON_MAX} characters.`);
  const scope = await staffScope(db, ctx, input.householdId, "staff.household.view");
  if (!canTransition(scope.lifecycle, "closed"))
    throw new AccessError("INVALID", "Only a household in bereavement support can be closed.");
  await db.transaction(async (tx) => {
    const done = await tx
      .update(s.households)
      .set({ lifecycleState: "closed", lifecycleChangedAt: new Date() })
      .where(
        and(
          eq(s.households.tenantId, ctx.tenantId),
          eq(s.households.id, scope.householdId),
          eq(s.households.lifecycleState, "bereavement"),
        ),
      )
      .returning({ id: s.households.id });
    if (!done.length) throw new AccessError("CONFLICT", "This household was just closed by someone else.");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "lifecycle.closed",
      subjectType: "household",
      subjectId: scope.householdId,
      summary: "The household was closed after bereavement support. It is now read-only.",
      visibility: "staff",
      context: { reason },
    });
  });
}

const DAY = 86_400_000;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
};

/**
 * Trends for a date range, with the previous period of the same length for comparison (staff
 * rework, section 6). Counts and durations only — no names, households or record content.
 */
export async function trendsReport(db: DB, ctx: ActorContext, input: { days: number }, now = new Date()) {
  requireStaffPermission(ctx, "staff.lifecycle.manage");
  // Operations, who open Reports: administrators hold the permission above but do no household
  // work (decision 39), so they don't get Reports or its exports.
  requireStaffPermission(ctx, "staff.household.view");
  const days = [7, 30, 90].includes(input.days) ? input.days : 30;
  const to = now;
  const from = new Date(to.getTime() - days * DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);
  const hh = await db
    .select({ id: s.households.id })
    .from(s.households)
    .where(
      and(
        eq(s.households.tenantId, ctx.tenantId),
        eq(s.households.organizationId, ctx.organizationId ?? "-"),
      ),
    );
  const ids = hh.map((h) => h.id);
  const inRange = (d: Date | null, a: Date, b: Date) => !!d && d >= a && d < b;

  const esc = ids.length
    ? await db
        .select({ created: s.escalations.createdAt, resolved: s.escalations.resolvedAt })
        .from(s.escalations)
        .where(
          and(
            eq(s.escalations.tenantId, ctx.tenantId),
            inArray(s.escalations.householdId, ids),
            ne(s.escalations.kind, "consent_correction"),
          ),
        )
    : [];
  const hoursToResolve = (a: Date, b: Date) =>
    esc
      .filter((e) => inRange(e.resolved, a, b))
      .map((e) => (e.resolved!.getTime() - e.created.getTime()) / 3_600_000);

  const consents = ids.length
    ? await db
        .select({
          id: s.consents.id,
          activatedAt: s.consents.activatedAt,
          version: s.consents.activatedVersion,
        })
        .from(s.consents)
        .where(and(eq(s.consents.tenantId, ctx.tenantId), inArray(s.consents.householdId, ids)))
    : [];
  const confirmations = consents.length
    ? await db
        .select({
          consentId: s.consentConfirmations.consentId,
          version: s.consentConfirmations.consentVersion,
          at: s.consentConfirmations.confirmedAt,
        })
        .from(s.consentConfirmations)
        .where(eq(s.consentConfirmations.tenantId, ctx.tenantId))
    : [];
  const activationHours = (a: Date, b: Date) =>
    consents
      .filter((c) => inRange(c.activatedAt, a, b))
      .map((c) => {
        const conf = confirmations.find((x) => x.consentId === c.id && x.version === c.version);
        return conf ? (c.activatedAt!.getTime() - conf.at.getTime()) / 3_600_000 : null;
      })
      .filter((x): x is number => x !== null && x >= 0);

  const msgs = ids.length
    ? await db
        .select({
          householdId: s.messages.householdId,
          side: s.messages.authorSide,
          at: s.messages.createdAt,
        })
        .from(s.messages)
        .where(and(eq(s.messages.tenantId, ctx.tenantId), inArray(s.messages.householdId, ids)))
    : [];
  /** Households with a family message and no care-team reply since, at a given moment. */
  const waitingAt = (t: Date) =>
    ids.filter((h) => {
      const before = msgs.filter((m) => m.householdId === h && m.at <= t);
      const lastStaff = Math.max(0, ...before.filter((m) => m.side === "staff").map((m) => m.at.getTime()));
      return before.some((m) => m.side === "family" && m.at.getTime() > lastStaff);
    }).length;

  // Buckets cover the whole period: whole weeks from its start, the last one possibly shorter (it
  // ends now, and its label says "so far").
  const bucketDays = days <= 7 ? 1 : 7;
  const buckets = Array.from({ length: Math.ceil(days / bucketDays) }, (_, i) => {
    const start = new Date(from.getTime() + i * bucketDays * DAY);
    const end = new Date(Math.min(to.getTime(), start.getTime() + bucketDays * DAY));
    return { start, end };
  });
  const tile = (cur: number | null, prev: number | null) => ({ value: cur, previous: prev });

  // Prepared work (direction refinement D-6): how often people opened a summary or used a prepared
  // draft, counted from events already recorded. Never what any draft or summary said.
  const preparedEvents = ids.length
    ? await db
        .select({ action: s.auditEvents.action, context: s.auditEvents.context })
        .from(s.auditEvents)
        .where(
          and(
            eq(s.auditEvents.tenantId, ctx.tenantId),
            inArray(s.auditEvents.householdId, ids),
            inArray(s.auditEvents.action, [
              "summary.prepared",
              "message.sent",
              "handoff.offered",
              "packet.drafted",
            ]),
            gte(s.auditEvents.createdAt, from),
          ),
        )
    : [];
  const usedDraft = (action: string) =>
    preparedEvents.filter(
      (e) => e.action === action && (e.context as { prepared?: boolean }).prepared === true,
    ).length;

  return {
    days,
    from,
    to,
    bucket: bucketDays === 1 ? ("day" as const) : ("week" as const),
    bucketDays,
    tiles: {
      escalationsRaised: tile(
        esc.filter((e) => inRange(e.created, from, to)).length,
        esc.filter((e) => inRange(e.created, prevFrom, from)).length,
      ),
      medianHoursToResolve: tile(median(hoursToResolve(from, to)), median(hoursToResolve(prevFrom, from))),
      consentsActivated: tile(
        consents.filter((c) => inRange(c.activatedAt, from, to)).length,
        consents.filter((c) => inRange(c.activatedAt, prevFrom, from)).length,
      ),
      medianHoursToActivate: tile(median(activationHours(from, to)), median(activationHours(prevFrom, from))),
      messagesWaitingNow: tile(waitingAt(to), waitingAt(from)),
    },
    prepared: {
      summaries: preparedEvents.filter((e) => e.action === "summary.prepared").length,
      replies: usedDraft("message.sent"),
      handoffNotes: usedDraft("handoff.offered"),
      packetContents: usedDraft("packet.drafted"),
    },
    escalationVolume: buckets.map((b) => ({
      start: b.start,
      end: b.end,
      n: esc.filter((e) => inRange(e.created, b.start, b.end)).length,
    })),
    timeToResolve: buckets.map((b) => ({
      start: b.start,
      end: b.end,
      hours: median(hoursToResolve(b.start, b.end)),
    })),
    messagesWaiting: buckets.map((b) => ({ start: b.start, end: b.end, n: waitingAt(b.end) })),
  };
}

/* ------------------------------------------------------------------ the report set (decision 41) */

const AGE_BUCKETS = [
  ["Under a day", 1],
  ["1–3 days", 3],
  ["3–7 days", 7],
  ["Over a week", Infinity],
] as const;

/**
 * The figures behind the initial report set (founder decision 41) that the snapshot and trends
 * don't already give: open work by age, overdue tasks, sharing exceptions, bereavement follow-up
 * and each care guide's workload. Counts only, and staff names only where the report is about the
 * workforce — never a household, patient or family member.
 */
export async function reportSet(db: DB, ctx: ActorContext, now = new Date()) {
  requireStaffPermission(ctx, "staff.lifecycle.manage");
  // Operations, who open Reports: administrators hold the permission above but do no household
  // work (decision 39), so they don't get Reports or its exports.
  requireStaffPermission(ctx, "staff.household.view");
  const hh = await db
    .select({ id: s.households.id, lifecycle: s.households.lifecycleState })
    .from(s.households)
    .where(
      and(
        eq(s.households.tenantId, ctx.tenantId),
        eq(s.households.organizationId, ctx.organizationId ?? "-"),
      ),
    );
  const ids = hh.map((h) => h.id);
  const live = hh.filter((h) => h.lifecycle !== "closed").map((h) => h.id);

  // Open work and aging
  const queue = await coordinationQueue(db, ctx);
  const ageDays = (d: Date) => (now.getTime() - new Date(d).getTime()) / DAY;
  const aging = AGE_BUCKETS.map(([label, max], i) => ({
    label,
    n: queue.filter((q) => {
      const a = ageDays(q.since);
      const min = i === 0 ? -Infinity : AGE_BUCKETS[i - 1]![1];
      return a >= min && a < max;
    }).length,
  }));
  const tasks = ids.length
    ? await db
        .select({ audience: s.tasks.audience, dueAt: s.tasks.dueAt, assignee: s.tasks.assigneeActorId })
        .from(s.tasks)
        .where(
          and(
            eq(s.tasks.tenantId, ctx.tenantId),
            inArray(s.tasks.householdId, ids),
            eq(s.tasks.status, "open"),
          ),
        )
    : [];
  const overdue = tasks.filter((t) => t.dueAt && t.dueAt.getTime() < now.getTime());

  // Exceptions: consents, corrections, packets
  const packets = ids.length
    ? await db
        .select({ state: s.packets.state, reason: s.packets.lastReasonCode, expiresAt: s.packets.expiresAt })
        .from(s.packets)
        .where(and(eq(s.packets.tenantId, ctx.tenantId), inArray(s.packets.householdId, ids)))
    : [];
  const heldBy = new Map<string, number>();
  for (const p of packets.filter((x) => x.state === "held" || x.state === "denied"))
    heldBy.set(p.reason ?? "UNKNOWN", (heldBy.get(p.reason ?? "UNKNOWN") ?? 0) + 1);
  const register = await sharingRegister(db, ctx, now);
  const week = now.getTime() + 7 * DAY;

  // Bereavement follow-up
  const grief = await bereavementWorkload(db, ctx, now);
  const paused = ids.length
    ? await db
        .select({ id: s.supportPreferences.householdId })
        .from(s.supportPreferences)
        .where(
          and(
            eq(s.supportPreferences.tenantId, ctx.tenantId),
            inArray(s.supportPreferences.householdId, ids),
            eq(s.supportPreferences.contactPaused, true),
          ),
        )
    : [];

  // Workforce: each active care guide's coverage and open work
  const team = await roster(db, ctx);
  const esc = ids.length
    ? await db
        .select({ owner: s.escalations.ownerActorId })
        .from(s.escalations)
        .where(
          and(
            eq(s.escalations.tenantId, ctx.tenantId),
            inArray(s.escalations.householdId, ids),
            ne(s.escalations.status, "resolved"),
          ),
        )
    : [];
  const staff = ctx.organizationId
    ? await db
        .select({ role: s.memberships.roleCode, deactivated: s.actors.deactivatedAt })
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
          ),
        )
    : [];

  return {
    /** The hospice's default report view (decision 39). */
    defaults: (await orgSettings(db, ctx.tenantId, ctx.organizationId)).reports,
    openWork: {
      total: queue.length,
      aging,
      unownedEscalations: queue.filter((q) => q.kind === "escalation" && q.ownerIds.length === 0).length,
      overdueTasks: {
        household: overdue.filter((t) => t.audience === "family").length,
        careTeam: overdue.filter((t) => t.audience === "staff").length,
      },
      unassignedCareTeamTasks: tasks.filter((t) => t.audience === "staff" && !t.assignee).length,
    },
    exceptions: {
      consentsNeedingAction: register.filter((c) =>
        ["awaiting_confirmation", "needs_review", "awaiting_activation"].includes(c.stage),
      ).length,
      correctionsOpen: register.filter((c) => c.correctionOpen).length,
      packetsHeldOrDenied: [...heldBy].map(([reason, n]) => ({ reason, n })),
      packetsExpiringThisWeek: packets.filter(
        (p) =>
          p.state === "released" && p.expiresAt.getTime() > now.getTime() && p.expiresAt.getTime() <= week,
      ).length,
      consentsExpiringThisWeek: register.filter(
        (c) => c.stage === "active" && c.expiresAt && new Date(c.expiresAt).getTime() <= week,
      ).length,
    },
    bereavement: {
      households: grief.households,
      overdue: grief.open.filter((o) => o.window === "earlier").length,
      thisWeek: grief.open.filter((o) => o.window === "this_week").length,
      thisMonth: grief.open.filter((o) => o.window === "this_month").length,
      contactPaused: paused.length,
      declined: new Set(grief.open.filter((o) => o.declined).map((o) => o.householdId)).size,
      byGuide: grief.byGuide,
    },
    workforce: {
      guides: team.guides.map((g) => ({
        name: g.name,
        households: g.count,
        escalations: esc.filter((e) => e.owner === g.actorId).length,
      })),
      uncovered: team.uncovered.filter((h) => live.includes(h.id)).length,
      byRole: [...new Set(staff.filter((x) => !x.deactivated).map((x) => x.role))].map((role) => ({
        role,
        n: staff.filter((x) => !x.deactivated && x.role === role).length,
      })),
      former: team.former.length,
    },
  };
}
