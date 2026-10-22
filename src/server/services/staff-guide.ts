/**
 * The care-team first-time guide (2026-10-21): a short tour per role, then a "Getting started"
 * checklist on the landing page.
 *
 * - Offered to people who joined this hospice in the last 30 days and haven't hidden it; anyone
 *   can take the tour again from Help.
 * - Checklist items tick off from the person's own audit entries (what they've actually done), so
 *   nothing new is recorded about them. The only things stored are when they finished or skipped
 *   the tour and when they hid the checklist (preferences.guide).
 */
import { and, eq, inArray, min } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { AccessError, type ActorContext } from "../context";
import { guideRole, type GuideRole } from "@/domain/staff-guide";

export const NEWCOMER_DAYS = 30;

function requireStaff(ctx: ActorContext) {
  if (ctx.kind !== "staff") throw new AccessError("NOT_PERMITTED", "This area is for the hospice care team.");
}

type Item = {
  key: string;
  label: string;
  /** Where to do it. */
  to: string;
  search?: Record<string, string>;
  /** The audit action that shows it's been done (by this person); "tour" is the tour itself. */
  done: string;
  /** Only entries with no household (staff-level), e.g. staff invitations. */
  staffLevel?: boolean;
};

const TOUR: Item = { key: "tour", label: "Take the 1-minute tour", to: "", done: "tour" };

export const CHECKLISTS: Record<GuideRole, Item[]> = {
  care_guide: [
    TOUR,
    {
      key: "own",
      label: "Take ownership of an escalation",
      to: "/staff/exceptions",
      search: { view: "unowned" },
      done: "escalation.owned",
    },
    {
      key: "reply",
      label: "Reply to a household",
      to: "/staff/exceptions",
      search: { view: "family" },
      done: "message.sent",
    },
    { key: "task", label: "Complete a care-team task", to: "/staff/tasks", done: "task.completed" },
  ],
  hospice_ops: [
    TOUR,
    {
      key: "assign",
      label: "Assign a care guide to a household",
      to: "/staff/team",
      done: "assignment.created",
    },
    {
      key: "wording",
      label: "Set what families are told about replies",
      to: "/staff/settings",
      search: { section: "messaging" },
      done: "settings.message_expectation_set",
    },
    {
      key: "invite",
      label: "Invite a care-team member",
      to: "/staff/team",
      done: "invitation.created",
      staffLevel: true,
    },
  ],
  privileged_reviewer: [
    TOUR,
    { key: "review", label: "Record an authority review", to: "/staff/reviews", done: "authority.reviewed" },
    {
      key: "activate",
      label: "Activate a consent",
      to: "/staff/exceptions",
      search: { view: "consent" },
      done: "consent.activated",
    },
    { key: "release", label: "Release a packet", to: "/staff/packets", done: "packet.released" },
  ],
  hospice_admin: [
    TOUR,
    {
      key: "invite",
      label: "Invite a care-team member",
      to: "/staff/team",
      done: "invitation.created",
      staffLevel: true,
    },
    { key: "setting", label: "Review a hospice setting", to: "/staff/settings", done: "settings.changed" },
    {
      key: "role",
      label: "Check someone's role on Team & coverage",
      to: "/staff/team",
      done: "staff.role_changed",
    },
  ],
};

async function prefs(db: DB, ctx: ActorContext) {
  const [p] = await db
    .select({ guide: s.preferences.guide })
    .from(s.preferences)
    .where(and(eq(s.preferences.tenantId, ctx.tenantId), eq(s.preferences.actorId, ctx.actorId)));
  return p?.guide ?? {};
}

/** What the guide shows this person now. */
export async function guideState(db: DB, ctx: ActorContext, now = new Date()) {
  requireStaff(ctx);
  const role = guideRole(ctx.staffRoles);
  const g = await prefs(db, ctx);
  // When they joined: their earliest active role at this hospice.
  const [joined] = ctx.organizationId
    ? await db
        .select({ at: min(s.memberships.createdAt) })
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.tenantId, ctx.tenantId),
            eq(s.memberships.actorId, ctx.actorId),
            eq(s.memberships.organizationId, ctx.organizationId),
            eq(s.memberships.status, "active"),
          ),
        )
    : [];
  const since = joined?.at ? new Date(joined.at) : null;
  const newcomer = !!since && now.getTime() - since.getTime() < NEWCOMER_DAYS * 86_400_000;
  const items = CHECKLISTS[role];
  const actions = items.map((i) => i.done).filter((a) => a !== "tour");
  const mine = actions.length
    ? await db
        .select({ action: s.auditEvents.action, householdId: s.auditEvents.householdId })
        .from(s.auditEvents)
        .where(
          and(
            eq(s.auditEvents.tenantId, ctx.tenantId),
            eq(s.auditEvents.actorId, ctx.actorId),
            inArray(s.auditEvents.action, actions),
          ),
        )
    : [];
  const checklist = items.map((i) => ({
    key: i.key,
    label: i.label,
    to: i.to,
    search: i.search ?? null,
    done:
      i.done === "tour"
        ? !!g.tourDoneAt
        : mine.some((m) => m.action === i.done && (!i.staffLevel || m.householdId === null)),
  }));
  return {
    role,
    newcomer,
    tourDone: !!g.tourDoneAt,
    /** The welcome card: new here, tour not taken, checklist not hidden. */
    showWelcome: newcomer && !g.tourDoneAt && !g.welcomeDismissedAt && !g.checklistHiddenAt,
    /** The checklist: new here and not hidden (it stays, ticked, until hidden). */
    showChecklist: newcomer && !g.checklistHiddenAt,
    checklist,
  };
}

/** Records finishing (or skipping) the tour, or hiding the checklist. Only this person's own. */
export async function updateGuide(
  db: DB,
  ctx: ActorContext,
  input: {
    tourDone?: boolean | undefined;
    dismissWelcome?: boolean | undefined;
    hideChecklist?: boolean | undefined;
  },
) {
  requireStaff(ctx);
  const g = await prefs(db, ctx);
  const at = new Date().toISOString();
  const next = {
    ...g,
    ...(input.tourDone ? { tourDoneAt: g.tourDoneAt ?? at } : {}),
    ...(input.dismissWelcome ? { welcomeDismissedAt: at } : {}),
    ...(input.hideChecklist ? { checklistHiddenAt: at } : {}),
  };
  await db
    .insert(s.preferences)
    .values({ tenantId: ctx.tenantId, actorId: ctx.actorId, guide: next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: s.preferences.actorId, set: { guide: next, updatedAt: new Date() } });
  return next;
}
