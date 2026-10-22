/**
 * Team coverage and handoffs (decision 58, workstream 3; decisions 59–61).
 *
 * - Operations record a care guide's planned absence and offer cover for each of their households
 *   to another care guide, or offer a permanent transfer.
 * - Nothing changes until the receiving guide accepts. Before then they see only the household's
 *   name, who offered it, the dates and the note — never the record.
 * - Accepted cover is an ordinary care-guide membership that starts and ends at exact times
 *   (`starts_at`, `expires_at`), so every existing access check applies (decision 59). It's shown
 *   as Temporary in "Who can see what", and ends by itself.
 * - A guide may decline, with a reason (decision 61); a decline goes to operations as a Stalled
 *   handoff exception.
 * - Families are told when cover becomes active, not before (decision 62): one system-posted update
 *   to the coordinator, proxies with an active authority workflow and the patient, and Home names the
 *   covering guide for the window. Never the reason, and nothing before the start.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { appendAudit } from "../audit";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { AccessError, requireStaffPermission, staffVisibleHouseholds, type ActorContext } from "../context";
import { activeAuthorityByActor, actorNames, careGuidesFor, notify } from "./common";
import { can } from "@/domain/permissions";
import { familyDateTime } from "@/domain/dates";
import type { LifecycleState } from "@/domain/model";
import { orgSettings } from "./org-settings";
import { completeTransferInTx } from "./assignments";
import { preparedDrafts, usedPreparedDraft } from "./prepared";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_ABSENCE_DAYS = 60;

const clean = (raw: string, what: string, max: number) => {
  const v = raw.trim();
  if (v.length < 3) throw new AccessError("INVALID", `Add ${what}. Only staff will see it.`);
  if (v.length > max) throw new AccessError("INVALID", `Keep ${what} under ${max} characters.`);
  return v;
};

/** Active, non-deactivated care guides of the caller's organization. */
async function careGuides(conn: Conn, ctx: ActorContext) {
  if (!ctx.organizationId) return [];
  const rows = await conn
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
  return [...new Map(rows.map((r) => [r.actorId, r])).values()];
}

/** A care guide's permanent assignments (not cover). */
async function assignedTo(conn: Conn, tenantId: string, actorId: string) {
  return conn
    .select({
      householdId: s.memberships.householdId,
      name: s.households.displayName,
      lifecycle: s.households.lifecycleState,
    })
    .from(s.memberships)
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.memberships.householdId), eq(s.households.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, tenantId),
        eq(s.memberships.actorId, actorId),
        eq(s.memberships.roleCode, "care_guide"),
        eq(s.memberships.status, "active"),
        isNotNull(s.memberships.householdId),
        isNull(s.memberships.coverForActorId),
      ),
    );
}

/* ------------------------------------------------------------------ absences */

export async function recordAbsence(
  db: DB,
  ctx: ActorContext,
  input: { actorId: string; startsAt: Date; endsAt: Date; reason: string },
  now = new Date(),
) {
  requireStaffPermission(ctx, "staff.assignment.manage");
  const who = (await careGuides(db, ctx)).find((g) => g.actorId === input.actorId);
  if (!who) throw new AccessError("INVALID", "Choose a care guide from this hospice.");
  const { startsAt, endsAt } = input;
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)
    throw new AccessError("INVALID", "The absence needs to end after it starts.");
  if (endsAt.getTime() <= now.getTime()) throw new AccessError("INVALID", "That absence has already ended.");
  if (endsAt.getTime() - startsAt.getTime() > MAX_ABSENCE_DAYS * DAY)
    throw new AccessError("INVALID", `Record up to ${MAX_ABSENCE_DAYS} days at a time.`);
  const reason = clean(input.reason, "a short reason (no health details)", 200);
  return db.transaction(async (tx) => {
    const [a] = await tx
      .insert(s.staffAbsences)
      .values({
        tenantId: ctx.tenantId,
        actorId: who.actorId,
        startsAt,
        endsAt,
        reason,
        createdByActorId: ctx.actorId,
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "absence.recorded",
      subjectType: "staff_absence",
      subjectId: a!.id,
      summary: `A planned absence was recorded for ${who.name}.`,
      visibility: "staff",
      reason,
      context: { person: who.actorId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    });
    return { id: a!.id };
  });
}

export async function cancelAbsence(db: DB, ctx: ActorContext, absenceId: string) {
  requireStaffPermission(ctx, "staff.assignment.manage");
  const [a] = await db
    .select()
    .from(s.staffAbsences)
    .where(and(eq(s.staffAbsences.tenantId, ctx.tenantId), eq(s.staffAbsences.id, absenceId)));
  if (!a || a.cancelledAt) throw new AccessError("OUT_OF_SCOPE", "That absence isn't available.");
  const name = (await actorNames(db, ctx.tenantId, [a.actorId])).get(a.actorId) ?? "the care guide";
  await db.transaction(async (tx) => {
    await tx.update(s.staffAbsences).set({ cancelledAt: new Date() }).where(eq(s.staffAbsences.id, a.id));
    // Offers for it are withdrawn; cover already accepted ends now.
    const open = await tx
      .select()
      .from(s.handoffs)
      .where(
        and(
          eq(s.handoffs.tenantId, ctx.tenantId),
          eq(s.handoffs.absenceId, a.id),
          eq(s.handoffs.state, "offered"),
        ),
      );
    for (const h of open) await withdrawInTx(tx, ctx, h, "The absence was cancelled.");
    // Cover granted for this absence only: its window is exactly this absence's, so cover for the same
    // guide's other absences is untouched. Each end is recorded.
    const now = new Date();
    const ended = await tx
      .update(s.memberships)
      .set({ status: "ended", endedAt: now, endReason: "The absence was cancelled." })
      .where(
        and(
          eq(s.memberships.tenantId, ctx.tenantId),
          eq(s.memberships.coverForActorId, a.actorId),
          eq(s.memberships.status, "active"),
          eq(s.memberships.startsAt, a.startsAt),
          eq(s.memberships.expiresAt, a.endsAt),
          gt(s.memberships.expiresAt, now),
        ),
      )
      .returning();
    const coverNames = await actorNames(
      tx,
      ctx.tenantId,
      ended.map((m) => m.actorId),
    );
    for (const m of ended)
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        householdId: m.householdId,
        actorId: ctx.actorId,
        action: "coverage.ended",
        subjectType: "membership",
        subjectId: m.id,
        summary: `${coverNames.get(m.actorId) ?? "The covering care guide"}'s cover for this household ended early: the absence was cancelled.`,
        visibility: "staff",
        reason: "The absence was cancelled.",
        context: { endedAt: now.toISOString() },
      });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "absence.cancelled",
      subjectType: "staff_absence",
      subjectId: a.id,
      summary: `${name}'s planned absence was cancelled.`,
      visibility: "staff",
    });
  });
}

/* ------------------------------------------------------------------ offers */

async function insertOffer(
  tx: Conn,
  ctx: ActorContext,
  o: {
    householdId: string;
    householdName: string;
    from: { actorId: string; name: string };
    to: { actorId: string; name: string };
    kind: "cover" | "transfer";
    note: string;
    absenceId?: string | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    /** The note started from a synthetic prepared draft (decision 58, workstream 5). */
    prepared?: boolean;
  },
  now: Date,
) {
  const hours = (await orgSettings(tx as DB, ctx.tenantId, ctx.organizationId)).exceptions.handoffAcceptHours;
  const [h] = await tx
    .insert(s.handoffs)
    .values({
      tenantId: ctx.tenantId,
      householdId: o.householdId,
      fromActorId: o.from.actorId,
      toActorId: o.to.actorId,
      absenceId: o.absenceId ?? null,
      kind: o.kind,
      note: o.note,
      startsAt: o.startsAt ?? null,
      endsAt: o.endsAt ?? null,
      acceptBy: new Date(now.getTime() + hours * HOUR),
      offeredByActorId: ctx.actorId,
    })
    .returning();
  await appendAudit(tx, {
    tenantId: ctx.tenantId,
    householdId: o.householdId,
    actorId: ctx.actorId,
    action: "handoff.offered",
    subjectType: "handoff",
    subjectId: h!.id,
    summary:
      o.kind === "cover"
        ? `Cover for this household was offered to ${o.to.name} while ${o.from.name} is away.`
        : `This household was offered to ${o.to.name}, to take over from ${o.from.name}.`,
    visibility: "staff",
    ...(o.prepared ? { prepared: true } : {}),
    context: { kind: o.kind, to: o.to.actorId, from: o.from.actorId },
  });
  // A generic notice: no household name, no note (they'll see those on My work).
  await notify(tx, {
    tenantId: ctx.tenantId,
    householdId: o.householdId,
    recipients: [o.to.actorId],
    kind: "handoff",
    title: "A household was offered to you",
    link: "/staff/#handoffs",
  });
  return h!;
}

/** Offer cover for one of an absent guide's households (decision 59: access only in the window). */
export async function offerCover(
  db: DB,
  ctx: ActorContext,
  input: {
    absenceId: string;
    householdId: string;
    toActorId: string;
    note: string;
    prepared?: boolean | undefined;
  },
  now = new Date(),
) {
  requireStaffPermission(ctx, "staff.assignment.manage");
  const prepared = await usedPreparedDraft(db, ctx, input.householdId, input.prepared);
  const [a] = await db
    .select()
    .from(s.staffAbsences)
    .where(and(eq(s.staffAbsences.tenantId, ctx.tenantId), eq(s.staffAbsences.id, input.absenceId)));
  if (!a || a.cancelledAt || a.endsAt.getTime() <= now.getTime())
    throw new AccessError("OUT_OF_SCOPE", "That absence isn't available.");
  const hh = (await assignedTo(db, ctx.tenantId, a.actorId)).find((x) => x.householdId === input.householdId);
  if (!hh) throw new AccessError("INVALID", "Choose one of the absent care guide's households.");
  if (input.toActorId === a.actorId)
    throw new AccessError("INVALID", "Choose someone other than the absent care guide.");
  const guides = await careGuides(db, ctx);
  const to = guides.find((g) => g.actorId === input.toActorId);
  if (!to) throw new AccessError("INVALID", "Choose a care guide from this hospice.");
  const away = await db
    .select()
    .from(s.staffAbsences)
    .where(
      and(
        eq(s.staffAbsences.tenantId, ctx.tenantId),
        eq(s.staffAbsences.actorId, to.actorId),
        isNull(s.staffAbsences.cancelledAt),
        gt(s.staffAbsences.endsAt, a.startsAt),
        lte(s.staffAbsences.startsAt, a.endsAt),
      ),
    );
  if (away.length) throw new AccessError("INVALID", `${to.name} is away for part of that time too.`);
  const from = {
    actorId: a.actorId,
    name: (await actorNames(db, ctx.tenantId, [a.actorId])).get(a.actorId) ?? "",
  };
  const note = input.note.trim().slice(0, 500);
  return db.transaction(async (tx) => {
    // One live offer per household and absence: a new offer replaces one that's still open.
    const prior = await tx
      .select()
      .from(s.handoffs)
      .where(
        and(
          eq(s.handoffs.tenantId, ctx.tenantId),
          eq(s.handoffs.absenceId, a.id),
          eq(s.handoffs.householdId, hh.householdId!),
          or(eq(s.handoffs.state, "offered"), eq(s.handoffs.state, "accepted")),
        ),
      );
    if (prior.some((p) => p.state === "accepted"))
      throw new AccessError("CONFLICT", "Cover for this household has already been accepted.");
    for (const p of prior) await withdrawInTx(tx, ctx, p, `Offered to ${to.name} instead.`);
    const h = await insertOffer(
      tx,
      ctx,
      {
        householdId: hh.householdId!,
        householdName: hh.name,
        from,
        to,
        kind: "cover",
        note,
        absenceId: a.id,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        prepared,
      },
      now,
    );
    return { id: h.id };
  });
}

/** Offer a household permanently to another care guide; nothing changes until they accept (C-7). */
export async function offerTransfer(
  db: DB,
  ctx: ActorContext,
  input: { householdId: string; fromActorId: string; toActorId: string; note: string },
  now = new Date(),
) {
  requireStaffPermission(ctx, "staff.assignment.manage");
  const hh = (await assignedTo(db, ctx.tenantId, input.fromActorId)).find(
    (x) => x.householdId === input.householdId,
  );
  if (!hh) throw new AccessError("INVALID", "That care guide isn't assigned to this household.");
  if (hh.lifecycle === "closed")
    throw new AccessError("INVALID", "This household is closed, so its care team can't change.");
  const guides = await careGuides(db, ctx);
  const to = guides.find((g) => g.actorId === input.toActorId);
  const from = guides.find((g) => g.actorId === input.fromActorId);
  if (!to || !from || to.actorId === from.actorId)
    throw new AccessError("INVALID", "Choose a different care guide from this hospice.");
  if ((await assignedTo(db, ctx.tenantId, to.actorId)).some((x) => x.householdId === hh.householdId))
    throw new AccessError("INVALID", `${to.name} is already assigned to this household.`);
  const note = input.note.trim().slice(0, 500);
  return db.transaction(async (tx) => {
    const h = await insertOffer(
      tx,
      ctx,
      { householdId: hh.householdId!, householdName: hh.name, from, to, kind: "transfer", note },
      now,
    );
    return { id: h.id };
  });
}

async function withdrawInTx(tx: Conn, ctx: ActorContext, h: typeof s.handoffs.$inferSelect, reason: string) {
  // Only an open or declined offer: one the guide has just accepted stays accepted.
  const withdrawn = await tx
    .update(s.handoffs)
    .set({ state: "withdrawn", respondedAt: new Date() })
    .where(and(eq(s.handoffs.id, h.id), inArray(s.handoffs.state, ["offered", "declined"])))
    .returning({ id: s.handoffs.id });
  if (!withdrawn.length) throw new AccessError("CONFLICT", "That offer was accepted or withdrawn just now.");
  await appendAudit(tx, {
    tenantId: ctx.tenantId,
    householdId: h.householdId,
    actorId: ctx.actorId,
    action: "handoff.withdrawn",
    subjectType: "handoff",
    subjectId: h.id,
    summary: "A handoff offer was withdrawn.",
    visibility: "staff",
    reason,
  });
}

export async function withdrawHandoff(db: DB, ctx: ActorContext, handoffId: string) {
  requireStaffPermission(ctx, "staff.assignment.manage");
  const [h] = await db
    .select()
    .from(s.handoffs)
    .where(and(eq(s.handoffs.tenantId, ctx.tenantId), eq(s.handoffs.id, handoffId)));
  if (!h || (h.state !== "offered" && h.state !== "declined"))
    throw new AccessError("OUT_OF_SCOPE", "That offer isn't open any more.");
  await db.transaction((tx) => withdrawInTx(tx, ctx, h, "Withdrawn by operations."));
}

/* ------------------------------------------------------------------ the receiving guide */

async function offeredToMe(conn: Conn, ctx: ActorContext, handoffId: string) {
  const [h] = await conn
    .select()
    .from(s.handoffs)
    .where(
      and(
        eq(s.handoffs.tenantId, ctx.tenantId),
        eq(s.handoffs.id, handoffId),
        eq(s.handoffs.toActorId, ctx.actorId),
        eq(s.handoffs.state, "offered"),
      ),
    );
  if (!h) throw new AccessError("OUT_OF_SCOPE", "That offer isn't open any more.");
  return h;
}

/**
 * What's been offered to me: the household's name, who offered it, the kind, the dates and the
 * note. Nothing from the record until I accept (and, for cover, until it starts).
 */
export async function myHandoffs(db: DB, ctx: ActorContext) {
  if (ctx.kind !== "staff") return [];
  const rows = await db
    .select({ h: s.handoffs, household: s.households.displayName })
    .from(s.handoffs)
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.handoffs.householdId), eq(s.households.tenantId, s.handoffs.tenantId)),
    )
    .where(
      and(
        eq(s.handoffs.tenantId, ctx.tenantId),
        eq(s.handoffs.toActorId, ctx.actorId),
        eq(s.handoffs.state, "offered"),
      ),
    )
    .orderBy(s.handoffs.acceptBy);
  const names = await actorNames(
    db,
    ctx.tenantId,
    rows.flatMap((r) => [r.h.fromActorId, r.h.offeredByActorId]),
  );
  return rows.map(({ h, household }) => ({
    id: h.id,
    household,
    kind: h.kind,
    from: names.get(h.fromActorId) ?? "",
    offeredBy: names.get(h.offeredByActorId) ?? "",
    offeredAt: h.offeredAt,
    acceptBy: h.acceptBy,
    startsAt: h.startsAt,
    endsAt: h.endsAt,
    note: h.note,
  }));
}

export async function acceptHandoff(db: DB, ctx: ActorContext, handoffId: string, now = new Date()) {
  const h = await offeredToMe(db, ctx, handoffId);
  if (!ctx.staffRoles.includes("care_guide"))
    throw new AccessError("NOT_PERMITTED", "Only care guides can accept a household.");
  if (h.kind === "cover" && h.endsAt && h.endsAt.getTime() <= now.getTime())
    throw new AccessError("INVALID", "That cover has already ended, so there's nothing to accept.");
  const names = await actorNames(db, ctx.tenantId, [h.fromActorId]);
  const from = { actorId: h.fromActorId, name: names.get(h.fromActorId) ?? "the care guide" };
  const me = { actorId: ctx.actorId, name: ctx.displayName };
  await db.transaction(async (tx) => {
    // Still open: operations may have withdrawn or replaced it since it was read.
    const taken = await tx
      .update(s.handoffs)
      .set({ state: "accepted", respondedAt: new Date() })
      .where(and(eq(s.handoffs.id, h.id), eq(s.handoffs.state, "offered")))
      .returning({ id: s.handoffs.id });
    if (!taken.length) throw new AccessError("OUT_OF_SCOPE", "That offer isn't open any more.");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: h.householdId,
      actorId: ctx.actorId,
      action: "handoff.accepted",
      subjectType: "handoff",
      subjectId: h.id,
      summary: `${me.name} accepted ${h.kind === "cover" ? "cover for" : "taking over"} this household.`,
      visibility: "staff",
    });
    if (h.kind === "transfer") {
      await completeTransferInTx(tx, ctx, {
        householdId: h.householdId,
        from,
        to: me,
        reason: `Handed over to ${me.name} (accepted handoff).`,
      });
      return;
    }
    // Cover (decision 59): an ordinary care-guide membership, only for the window, ending by itself.
    const reason = `Covering while ${from.name} is away.`;
    const [m] = await tx
      .insert(s.memberships)
      .values({
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        householdId: h.householdId,
        roleCode: "care_guide",
        startsAt: h.startsAt,
        expiresAt: h.endsAt,
        coverForActorId: h.fromActorId,
        grantReason: reason,
      })
      .onConflictDoNothing()
      .returning({ id: s.memberships.id });
    // Already assigned here: they keep their own assignment; nothing to grant.
    if (!m) return;
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: h.householdId,
      actorId: ctx.actorId,
      action: "coverage.granted",
      subjectType: "membership",
      subjectId: m.id,
      summary: `${me.name} covers this household while ${from.name} is away.`,
      visibility: "staff",
      reason,
      context: {
        coverFor: h.fromActorId,
        startsAt: h.startsAt?.toISOString() ?? null,
        endsAt: h.endsAt?.toISOString() ?? null,
      },
    });
  });
}

export async function declineHandoff(
  db: DB,
  ctx: ActorContext,
  input: { handoffId: string; reason: string },
) {
  const h = await offeredToMe(db, ctx, input.handoffId);
  const reason = clean(input.reason, "a reason", 280);
  await db.transaction(async (tx) => {
    const declined = await tx
      .update(s.handoffs)
      .set({ state: "declined", respondedAt: new Date(), declineReason: reason })
      .where(and(eq(s.handoffs.id, h.id), eq(s.handoffs.state, "offered")))
      .returning({ id: s.handoffs.id });
    if (!declined.length) throw new AccessError("OUT_OF_SCOPE", "That offer isn't open any more.");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: h.householdId,
      actorId: ctx.actorId,
      action: "handoff.declined",
      subjectType: "handoff",
      subjectId: h.id,
      summary: `${ctx.displayName} declined a handoff (decision 61).`,
      visibility: "staff",
      reason,
    });
  });
}

/* ------------------------------------------------------------------ cover that has ended */

/**
 * Cover ends at its exact time without any job running: access checks already ignore it after
 * `expires_at`. This records the end (`coverage.ended`, actor: System) the first time anyone opens
 * the workspace afterwards, and marks the membership ended.
 */
export async function endExpiredCover(db: DB, tenantId: string, now = new Date()) {
  const expired = await db
    .select()
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.tenantId, tenantId),
        eq(s.memberships.status, "active"),
        isNotNull(s.memberships.coverForActorId),
        lte(s.memberships.expiresAt, now),
      ),
    );
  if (!expired.length) return 0;
  const names = await actorNames(
    db,
    tenantId,
    expired.map((m) => m.actorId),
  );
  await db.transaction(async (tx) => {
    for (const m of expired) {
      const done = await tx
        .update(s.memberships)
        .set({ status: "ended", endedAt: m.expiresAt, endReason: "Cover ended at its scheduled time." })
        .where(and(eq(s.memberships.id, m.id), eq(s.memberships.status, "active")))
        .returning({ id: s.memberships.id });
      if (!done.length) continue;
      await appendAudit(tx, {
        tenantId,
        householdId: m.householdId,
        actorId: null,
        action: "coverage.ended",
        subjectType: "membership",
        subjectId: m.id,
        summary: `${names.get(m.actorId) ?? "The covering care guide"}'s cover for this household ended at its scheduled time.`,
        visibility: "staff",
        source: "system",
        context: { endedAt: m.expiresAt?.toISOString() ?? null },
      });
    }
  });
  return expired.length;
}

/* ------------------------------------------------------------------ operations' view */

/** Absences now or ahead, each of the absent guide's households and its cover state. */
export async function coverageBoard(db: DB, ctx: ActorContext, now = new Date()) {
  requireStaffPermission(ctx, "staff.assignment.manage");
  const guides = await careGuides(db, ctx);
  const absences = await db
    .select()
    .from(s.staffAbsences)
    .where(
      and(
        eq(s.staffAbsences.tenantId, ctx.tenantId),
        isNull(s.staffAbsences.cancelledAt),
        gt(s.staffAbsences.endsAt, now),
      ),
    )
    .orderBy(s.staffAbsences.startsAt);
  const offers = await db
    .select()
    .from(s.handoffs)
    .where(and(eq(s.handoffs.tenantId, ctx.tenantId), ne(s.handoffs.state, "withdrawn")))
    .orderBy(desc(s.handoffs.offeredAt));
  const names = new Map(guides.map((g) => [g.actorId, g.name]));
  const extra = await actorNames(db, ctx.tenantId, [
    ...absences.map((a) => a.actorId),
    ...offers.map((o) => o.toActorId),
  ]);
  const nameOf = (id: string) => names.get(id) ?? extra.get(id) ?? "Someone";
  const visible = new Set((await staffVisibleHouseholds(db, ctx, "coverage")).map((h) => h.id));
  const absentDuring = (actorId: string, a: typeof s.staffAbsences.$inferSelect) =>
    absences.some(
      (b) => b.actorId === actorId && b.id !== a.id && b.endsAt > a.startsAt && b.startsAt < a.endsAt,
    );
  const board = [];
  for (const a of absences) {
    const hh = (await assignedTo(db, ctx.tenantId, a.actorId)).filter((x) => visible.has(x.householdId!));
    board.push({
      id: a.id,
      person: nameOf(a.actorId),
      personId: a.actorId,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      reason: a.reason,
      started: a.startsAt.getTime() <= now.getTime(),
      households: await Promise.all(
        hh.map(async (x) => {
          const o = offers.find((h) => h.absenceId === a.id && h.householdId === x.householdId);
          // Other guides on this household who aren't away then: it may not need cover at all.
          const others = (await careGuidesFor(db, ctx.tenantId, x.householdId!)).filter(
            (g) => g.actorId !== a.actorId && !g.coverFor && !absentDuring(g.actorId, a),
          );
          return {
            householdId: x.householdId!,
            name: x.name,
            alsoAssigned: others.map((g) => g.name),
            // A synthetic prepared handoff note, only while a demo snapshot is loaded.
            preparedNote:
              (await preparedDrafts(db, ctx, x.householdId!).catch(() => null))?.handoffNote ?? null,
            cover: o
              ? {
                  id: o.id,
                  state: o.state,
                  to: nameOf(o.toActorId),
                  acceptBy: o.acceptBy,
                  stalled: o.state === "offered" && o.acceptBy.getTime() < now.getTime(),
                  declineReason: o.declineReason,
                }
              : null,
          };
        }),
      ),
      candidates: guides.filter((g) => g.actorId !== a.actorId && !absentDuring(g.actorId, a)),
    });
  }
  return {
    guides,
    absences: board,
    transfers: offers
      .filter((o) => o.kind === "transfer" && (o.state === "offered" || o.state === "declined"))
      .map((o) => ({
        id: o.id,
        householdId: o.householdId,
        state: o.state,
        to: nameOf(o.toActorId),
        from: nameOf(o.fromActorId),
        acceptBy: o.acceptBy,
        declineReason: o.declineReason,
      })),
  };
}

/* ------------------------------------------------------------------ telling the household (decision 62) */

export const COVER_NOTICE_KIND = "cover_started";

/** Who is told: the coordinator, proxies with an active authority workflow, and the patient if they see updates. */
async function coverNoticeAudience(
  conn: Conn,
  tenantId: string,
  householdId: string,
  lifecycle: LifecycleState,
  now: Date,
) {
  const members = await conn
    .select({
      actorId: s.memberships.actorId,
      role: s.memberships.roleCode,
      expiresAt: s.memberships.expiresAt,
    })
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, tenantId),
        eq(s.memberships.householdId, householdId),
        eq(s.memberships.status, "active"),
        eq(s.actors.kind, "family"),
      ),
    );
  const authority = await activeAuthorityByActor(conn, tenantId, householdId);
  const audience = members
    .filter((m) => !m.expiresAt || m.expiresAt.getTime() > now.getTime())
    .filter(
      (m) =>
        m.role === "coordinator" ||
        (m.role === "proxy" && authority.has(m.actorId)) ||
        (m.role === "patient" && can(["patient"], "updates.view", lifecycle)),
    )
    .map((m) => m.actorId);
  return [...new Set(audience)].sort();
}

/**
 * Decision 62 (register R-05, option C): when accepted cover becomes active, post one system update
 * to the household's audience saying who their care guide is and until when. There's no timer: like
 * `coverage.ended`, it's posted on the first workspace or family load after the start, once per
 * cover. Cover cancelled before it starts never becomes active, so nothing is posted for it.
 */
export async function postCoverNotices(db: DB, tenantId: string, now = new Date()) {
  const started = await db
    .select({ m: s.memberships, lifecycle: s.households.lifecycleState })
    .from(s.memberships)
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.memberships.householdId), eq(s.households.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, tenantId),
        eq(s.memberships.status, "active"),
        isNotNull(s.memberships.coverForActorId),
        lte(s.memberships.startsAt, now),
        gt(s.memberships.expiresAt, now),
        ne(s.households.lifecycleState, "closed"),
      ),
    );
  if (!started.length) return 0;
  const posted = new Set(
    (
      await db
        .select({ sourceId: s.familyUpdates.sourceId })
        .from(s.familyUpdates)
        .where(
          and(
            eq(s.familyUpdates.tenantId, tenantId),
            eq(s.familyUpdates.systemKind, COVER_NOTICE_KIND),
            inArray(
              s.familyUpdates.sourceId,
              started.map(({ m }) => m.id),
            ),
          ),
        )
    ).map((r) => r.sourceId),
  );
  let n = 0;
  for (const { m, lifecycle } of started) {
    if (posted.has(m.id) || !m.householdId || !m.expiresAt) continue;
    const audience = await coverNoticeAudience(db, tenantId, m.householdId, lifecycle as LifecycleState, now);
    if (!audience.length) continue;
    const names = await actorNames(db, tenantId, [m.actorId, m.coverForActorId]);
    const who = names.get(m.actorId) ?? "A care guide from your care team";
    const away = names.get(m.coverForActorId!) ?? "Your usual care guide";
    const until = familyDateTime(m.expiresAt);
    const householdId = m.householdId;
    const endsAt = m.expiresAt;
    await db.transaction(async (tx) => {
      // The unique (kind, source) index makes this once per cover, even with two loads at once.
      const [u] = await tx
        .insert(s.familyUpdates)
        .values({
          tenantId,
          householdId,
          authorActorId: null,
          title: `${who} is your care guide until ${until}`,
          body: `${away} is away until then. Messages reach your care team as usual, and your hospice's 24-hour line is unchanged.`,
          requiresAck: false,
          audienceActorIds: audience,
          systemKind: COVER_NOTICE_KIND,
          sourceId: m.id,
        })
        .onConflictDoNothing()
        .returning({ id: s.familyUpdates.id });
      if (!u) return;
      await appendAudit(tx, {
        tenantId,
        householdId,
        actorId: null,
        action: "update.cover_notice_posted",
        subjectType: "family_update",
        subjectId: u.id,
        summary: `A cover notice was posted to the household: ${who} is their care guide until ${until}.`,
        // Staff-visible: the household's own activity list would show it to members outside its audience.
        visibility: "staff",
        source: "system",
        context: {
          coverMembershipId: m.id,
          audience,
          startsAt: m.startsAt?.toISOString() ?? null,
          endsAt: endsAt.toISOString(),
        },
      });
      n++;
    });
  }
  return n;
}

/** The care guide covering this household right now, if any (decision 62: Home names them for the window). */
export async function activeCover(conn: Conn, tenantId: string, householdId: string, now = new Date()) {
  const [m] = await conn
    .select({ actorId: s.memberships.actorId, until: s.memberships.expiresAt, name: s.actors.displayName })
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, tenantId),
        eq(s.memberships.householdId, householdId),
        eq(s.memberships.status, "active"),
        isNotNull(s.memberships.coverForActorId),
        lte(s.memberships.startsAt, now),
        gt(s.memberships.expiresAt, now),
      ),
    )
    .orderBy(desc(s.memberships.startsAt))
    .limit(1);
  return m && m.until ? { name: m.name, until: m.until } : null;
}
