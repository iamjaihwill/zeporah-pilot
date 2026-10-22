/**
 * Bereavement follow-up: the planned check-ins of the 13-month programme (src/domain/bereavement.ts).
 *
 * A plan is created when a bereavement transition is confirmed. The care team records each check-in
 * (a human contact made outside Zeporah) with an outcome and an optional staff-only note. Families
 * see only what to expect and which check-ins have happened — never outcomes or notes. Visibility is
 * the usual staff rule: care guides see their assigned households, operations and reviewers the
 * whole hospice.
 */
import { PILOT_DISPLAY } from "@/domain/display-config";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, staffScope, staffVisibleHouseholds, type ActorContext } from "../context";
import { actorNames, careGuideNamesFor } from "./common";
import { can } from "@/domain/permissions";
import {
  BEREAVEMENT_STEPS,
  CONTACT_OUTCOME_LABELS,
  CONTACT_OUTCOMES,
  DUE_WINDOW_LABELS,
  dueWindow,
  stepOf,
  approxWhen,
  supportEndsAt,
  type ContactOutcome,
} from "@/domain/bereavement";

export const CHECK_IN_NOTE_MAX = 1000;

/** Creates the plan inside the confirming transaction. Idempotent per transition and step. */
export async function createPlanInTx(
  tx: Conn,
  t: { tenantId: string; householdId: string; transitionId: string; confirmedAt: Date },
) {
  await tx
    .insert(s.bereavementContacts)
    .values(
      BEREAVEMENT_STEPS.map((step) => ({
        tenantId: t.tenantId,
        householdId: t.householdId,
        transitionId: t.transitionId,
        step: step.code,
        dueOn: new Date(t.confirmedAt.getTime() + step.days * 86_400_000),
      })),
    )
    .onConflictDoNothing();
}

async function confirmedTransition(conn: Conn, tenantId: string, householdId: string) {
  const [t] = await conn
    .select()
    .from(s.bereavementTransitions)
    .where(
      and(
        eq(s.bereavementTransitions.tenantId, tenantId),
        eq(s.bereavementTransitions.householdId, householdId),
        eq(s.bereavementTransitions.state, "confirmed"),
      ),
    );
  return t ?? null;
}

async function contactsFor(conn: Conn, tenantId: string, householdIds: string[]) {
  if (!householdIds.length) return [];
  return conn
    .select()
    .from(s.bereavementContacts)
    .where(
      and(
        eq(s.bereavementContacts.tenantId, tenantId),
        inArray(s.bereavementContacts.householdId, householdIds),
      ),
    )
    .orderBy(asc(s.bereavementContacts.dueOn));
}

/** Staff: one household's plan, for its Overview tab. Null when the household has no plan. */
export async function staffPlan(conn: Conn, ctx: ActorContext, householdId: string, now = new Date()) {
  const scope = await staffScope(conn, ctx, householdId, "staff.household.view");
  const t = await confirmedTransition(conn, ctx.tenantId, scope.householdId);
  if (!t?.confirmedAt) return null;
  const rows = await contactsFor(conn, ctx.tenantId, [scope.householdId]);
  const names = await actorNames(
    conn,
    ctx.tenantId,
    rows.map((r) => r.completedByActorId),
  );
  return {
    supportEndsAt: supportEndsAt(t.confirmedAt),
    canRecord: can(ctx.staffRoles, "staff.task.manage", scope.lifecycle) && scope.lifecycle === "bereavement",
    declined: rows.some((r) => r.outcome === "declined"),
    contactPause: await contactPause(conn, ctx.tenantId, scope.householdId),
    steps: rows.map((r) => ({
      id: r.id,
      label: stepOf(r.step).staff,
      dueOn: r.dueOn,
      window: r.status === "planned" ? DUE_WINDOW_LABELS[dueWindow(r.dueOn, now)] : null,
      status: r.status,
      outcome: r.outcome ? CONTACT_OUTCOME_LABELS[r.outcome] : null,
      note: r.note,
      completedAt: r.completedAt,
      completedBy: r.completedByActorId ? (names.get(r.completedByActorId) ?? "") : null,
    })),
  };
}

/** Record a check-in that happened (or wasn't needed). Once per step. */
export async function recordCheckIn(
  db: DB,
  ctx: ActorContext,
  input: { contactId: string; outcome: ContactOutcome; note: string },
) {
  if (!CONTACT_OUTCOMES.includes(input.outcome)) throw new AccessError("INVALID", "Choose what happened.");
  const note = input.note.trim();
  if (note.length > CHECK_IN_NOTE_MAX)
    throw new AccessError("INVALID", `Keep the note under ${CHECK_IN_NOTE_MAX} characters.`);
  const [c] = await db
    .select()
    .from(s.bereavementContacts)
    .where(
      and(eq(s.bereavementContacts.tenantId, ctx.tenantId), eq(s.bereavementContacts.id, input.contactId)),
    );
  if (!c) throw new AccessError("OUT_OF_SCOPE", "That check-in isn't available.");
  const scope = await staffScope(db, ctx, c.householdId, "staff.task.manage");
  if (scope.lifecycle !== "bereavement")
    throw new AccessError("INVALID", "This household isn't in bereavement support any more.");
  await db.transaction(async (tx) => {
    const done = await tx
      .update(s.bereavementContacts)
      .set({
        status: "done",
        outcome: input.outcome,
        note,
        completedAt: new Date(),
        completedByActorId: ctx.actorId,
      })
      .where(
        and(
          eq(s.bereavementContacts.tenantId, ctx.tenantId),
          eq(s.bereavementContacts.id, c.id),
          eq(s.bereavementContacts.status, "planned"),
        ),
      )
      .returning({ id: s.bereavementContacts.id });
    if (!done.length)
      throw new AccessError("CONFLICT", "This check-in was already recorded. Refresh to see it.");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "bereavement.check_in_recorded",
      subjectType: "bereavement_contact",
      subjectId: c.id,
      // The note is staff-only and stays on the check-in; it isn't copied into the audit summary.
      summary: `${stepOf(c.step).staff} recorded: ${CONTACT_OUTCOME_LABELS[input.outcome].toLowerCase()}.`,
      visibility: "staff",
      context: { step: c.step, outcome: input.outcome },
    });
  });
}

/** Staff workload: open check-ins across the bereavement households this person can see. */
export async function bereavementWorkload(db: DB, ctx: ActorContext, now = new Date()) {
  if (ctx.kind !== "staff") throw new AccessError("NOT_PERMITTED", "This area is for the hospice care team.");
  const households = (await staffVisibleHouseholds(db, ctx)).filter(
    (h) => h.lifecycleState === "bereavement",
  );
  const rows = await contactsFor(
    db,
    ctx.tenantId,
    households.map((h) => h.id),
  );
  const guides = await careGuideNamesFor(
    db,
    ctx.tenantId,
    households.map((h) => h.id),
  );
  const declined = new Set(rows.filter((r) => r.outcome === "declined").map((r) => r.householdId));
  // "I'd rather not be contacted for now" (item 13): shown here so nobody calls a family that asked
  // for space. Staff already see it on the household's page.
  const paused = new Map<string, { since: Date | null; by: string | null }>();
  for (const h of households) {
    const p = await contactPause(db, ctx.tenantId, h.id);
    if (p) paused.set(h.id, p);
  }
  const open = rows
    .filter((r) => r.status === "planned")
    .map((r) => ({
      id: r.id,
      householdId: r.householdId,
      household: households.find((h) => h.id === r.householdId)!.displayName,
      label: stepOf(r.step).staff,
      dueOn: r.dueOn,
      window: dueWindow(r.dueOn, now),
      careGuides: guides.get(r.householdId) ?? [],
      declined: declined.has(r.householdId),
      paused: paused.get(r.householdId) ?? null,
    }));
  // One entry per household: its next open check-in, and the rest of its plan behind it.
  const byHousehold = households
    .map((h) => {
      const mine = open.filter((o) => o.householdId === h.id);
      return mine.length
        ? { householdId: h.id, household: h.displayName, next: mine[0]!, more: mine.slice(1) }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.next.dueOn.getTime() - b.next.dueOn.getTime());
  const counts = new Map<string, number>();
  for (const r of open.filter((x) => x.window !== "later"))
    for (const g of r.careGuides.length ? r.careGuides : ["No care guide"])
      counts.set(g, (counts.get(g) ?? 0) + 1);
  return {
    households: households.length,
    open,
    windows: DUE_WINDOW_LABELS,
    /** Check-ins due within a month (or earlier and still open), per care guide. */
    byGuide: [...counts].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    byHousehold,
    canAssign: can(ctx.staffRoles, "staff.assignment.manage"),
  };
}

/** Check-ins due this week or overdue, in households whose contact isn't paused (the sidebar badge). */
export async function bereavementDueCount(db: DB, ctx: ActorContext, now = new Date()) {
  if (ctx.kind !== "staff") return 0;
  const w = await bereavementWorkload(db, ctx, now);
  return w.open.filter((o) => !o.paused && (o.window === "earlier" || o.window === "this_week")).length;
}

/** Family: what to expect and what's happened — never outcomes or notes. */
export async function familyPlan(conn: Conn, tenantId: string, householdId: string) {
  const t = await confirmedTransition(conn, tenantId, householdId);
  if (!t?.confirmedAt) return null;
  const rows = await contactsFor(conn, tenantId, [householdId]);
  return {
    supportEndsAt: supportEndsAt(t.confirmedAt),
    steps: rows.map((r) => ({
      label: stepOf(r.step).family,
      done: r.status === "done",
      // "Around one month · early Nov": roughly when, never an appointment.
      when: approxWhen(r.dueOn, PILOT_DISPLAY.timeZone),
    })),
  };
}

/** The household's "I'd rather not be contacted for now", if set (item 13). Staff-visible. */
export async function contactPause(conn: Conn, tenantId: string, householdId: string) {
  const [p] = await conn
    .select()
    .from(s.supportPreferences)
    .where(
      and(eq(s.supportPreferences.tenantId, tenantId), eq(s.supportPreferences.householdId, householdId)),
    );
  if (!p?.contactPaused) return null;
  const by = p.contactPausedByActorId
    ? ((await actorNames(conn, tenantId, [p.contactPausedByActorId])).get(p.contactPausedByActorId) ?? null)
    : null;
  return { since: p.contactPausedAt, by };
}
