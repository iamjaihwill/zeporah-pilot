/**
 * The request lifecycle (founder decisions 79–83). A family support request stays an escalation
 * (decision 79); these are the steps around it that the family and the owner take.
 *
 * - **Waiting** (decision 80): the owner marks it waiting on the family or on someone else, naming
 *   only the kind of party ("the pharmacy"), never a clinical reason.
 * - **Withdraw and reopen** (decision 81): the person who sent it can withdraw it while it's open,
 *   and the owner is told. Within 7 days of its resolution they can reopen it with a reason, back to
 *   the same owner; after that, they send a new request.
 * - **Next update by** (decision 82): the owner says when the family will next hear. A missed time
 *   is an "Update overdue" exception for the owner and operations. It's a coordination commitment,
 *   never a clinical promise.
 * - **Offers** (decision 83): giving an escalation offers it; the current owner keeps it until the
 *   new owner accepts (see `giveEscalation`). Accept and decline are here.
 */
import { and, eq, ne } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, familyScope, staffScope, type ActorContext } from "../context";
import { actorNames, careGuidesFor, notify } from "./common";
import { escalationOwnerCandidates } from "./staff";
import { NEXT_UPDATE_MAX_DAYS, REASON_MAX, REOPEN_DAYS, WAITING_LABEL_MAX } from "@/domain/request-lifecycle";

const DAY = 86_400_000;

async function load(db: DB, ctx: ActorContext, id: string) {
  const [e] = await db
    .select()
    .from(s.escalations)
    .where(and(eq(s.escalations.tenantId, ctx.tenantId), eq(s.escalations.id, id)));
  if (!e) throw new AccessError("OUT_OF_SCOPE", "That request isn't available.");
  return e;
}

/** The family's own request: in their household, a support request, and sent by them. */
async function ownRequest(db: DB, ctx: ActorContext, id: string) {
  const scope = await familyScope(db, ctx, "household.view");
  const e = await load(db, ctx, id);
  if (e.householdId !== scope.householdId || e.sourceType !== "support_request")
    throw new AccessError("OUT_OF_SCOPE", "That request isn't available.");
  if (e.raisedByActorId !== ctx.actorId)
    throw new AccessError("NOT_PERMITTED", "Only the person who sent a request can change it.");
  return { scope, e };
}

/** A missed write means someone else changed it first. */
const changed = (r: unknown[]) => {
  if (!r.length) throw new AccessError("CONFLICT", "This request just changed. Refresh to see where it is.");
};

function reasonOf(text: string | undefined, required: string) {
  const r = (text ?? "").trim();
  if (!r) throw new AccessError("INVALID", required);
  if (r.length > REASON_MAX) throw new AccessError("INVALID", `Keep it under ${REASON_MAX} characters.`);
  return r;
}

/** Decision 81: the sender withdraws a request that isn't resolved yet; the owner is told. */
export async function withdrawRequest(db: DB, ctx: ActorContext, input: { id: string }) {
  const { scope, e } = await ownRequest(db, ctx, input.id);
  if (e.status === "resolved") throw new AccessError("INVALID", "This request is already closed.");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(s.escalations)
      .set({
        status: "resolved",
        closedReason: "withdrawn",
        resolvedAt: now,
        resolvedByActorId: ctx.actorId,
        stateChangedAt: now,
        waitingOn: null,
        waitingOnLabel: null,
        nextUpdateBy: null,
        offeredToActorId: null,
        offeredByActorId: null,
        offeredAt: null,
      })
      .where(
        and(
          eq(s.escalations.tenantId, ctx.tenantId),
          eq(s.escalations.id, e.id),
          ne(s.escalations.status, "resolved"),
        ),
      )
      .returning({ id: s.escalations.id })
      .then(changed);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "request.withdrawn",
      subjectType: "escalation",
      subjectId: e.id,
      summary: "A request to the care team was withdrawn.",
      visibility: "family",
    });
    const told = [e.ownerActorId, e.offeredToActorId].filter((x): x is string => !!x);
    if (told.length)
      await notify(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        recipients: told,
        kind: "support",
        title: "A family withdrew a request you had",
        link: "/staff/exceptions?view=all&kind=escalation",
      });
  });
}

/**
 * Decision 81: within 7 days of a resolution, the sender reopens it with a reason, back to the
 * person who resolved it. If that person can no longer take it, it goes back to the team unowned.
 */
export async function reopenRequest(db: DB, ctx: ActorContext, input: { id: string; reason: string }) {
  const { scope, e } = await ownRequest(db, ctx, input.id);
  const reason = reasonOf(input.reason, "Say what still needs attention.");
  if (e.status !== "resolved") throw new AccessError("INVALID", "This request is still open.");
  if (e.closedReason === "withdrawn")
    throw new AccessError("INVALID", "You withdrew this request. Send a new one instead.");
  const now = new Date();
  if (!e.resolvedAt || e.resolvedAt.getTime() < now.getTime() - REOPEN_DAYS * DAY)
    throw new AccessError(
      "INVALID",
      `Requests can be reopened for ${REOPEN_DAYS} days after they're resolved. Send a new one instead.`,
    );
  const back = e.resolvedByActorId
    ? (await escalationOwnerCandidates(db, { ...ctx, organizationId: scope.organizationId })).find(
        (c) => c.actorId === e.resolvedByActorId && c.sees(e.householdId),
      )
    : undefined;
  await db.transaction(async (tx) => {
    await tx
      .update(s.escalations)
      .set({
        status: back ? "acknowledged" : "open",
        ownerActorId: back?.actorId ?? null,
        closedReason: null,
        resolvedAt: null,
        resolvedByActorId: null,
        reopenedAt: now,
        reopenReason: reason,
        stateChangedAt: now,
      })
      .where(
        and(
          eq(s.escalations.tenantId, ctx.tenantId),
          eq(s.escalations.id, e.id),
          eq(s.escalations.status, "resolved"),
        ),
      )
      .returning({ id: s.escalations.id })
      .then(changed);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "request.reopened",
      subjectType: "escalation",
      subjectId: e.id,
      summary: "A resolved request was reopened.",
      visibility: "family",
      context: { owner: back?.actorId ?? null },
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: back
        ? [back.actorId]
        : (await careGuidesFor(tx, ctx.tenantId, scope.householdId)).map((g) => g.actorId),
      kind: "support",
      title: "A family reopened a request",
      link: "/staff/exceptions?view=all&kind=escalation",
    });
  });
}

function requireStaff(ctx: ActorContext) {
  if (ctx.kind !== "staff") throw new AccessError("NOT_PERMITTED", "This is for the care team.");
}

/** The owner's own open support request (staff side). */
async function ownedRequest(db: DB, ctx: ActorContext, id: string) {
  requireStaff(ctx);
  const e = await load(db, ctx, id);
  const scope = await staffScope(db, ctx, e.householdId, "staff.escalation.manage");
  if (e.status === "resolved") throw new AccessError("INVALID", "This is already resolved.");
  if (e.ownerActorId !== ctx.actorId)
    throw new AccessError("NOT_PERMITTED", "Only the person who owns this can change where it stands.");
  return { scope, e };
}

/** Decision 82: a time in the future, within two weeks. */
export function checkNextUpdate(at: Date | string, now = new Date()) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) throw new AccessError("INVALID", "Choose when they'll next hear from you.");
  if (d.getTime() <= now.getTime()) throw new AccessError("INVALID", "Choose a time that hasn't passed yet.");
  if (d.getTime() > now.getTime() + NEXT_UPDATE_MAX_DAYS * DAY)
    throw new AccessError("INVALID", `Choose a time within ${NEXT_UPDATE_MAX_DAYS} days.`);
  return d;
}

/**
 * Decisions 80 and 82: the owner says what it's waiting on (or that it's back with them) and when
 * the family will next hear. Marking it waiting needs a next-update time.
 */
export async function setRequestProgress(
  db: DB,
  ctx: ActorContext,
  input: {
    id: string;
    waitingOn: "family" | "other" | null;
    /** For "other": the kind of party, such as "the pharmacy". Never a clinical reason. */
    waitingOnLabel?: string | undefined;
    nextUpdateBy?: Date | string | null | undefined;
  },
) {
  const { scope, e } = await ownedRequest(db, ctx, input.id);
  if (e.sourceType !== "support_request")
    throw new AccessError("INVALID", "Only a family's request has these steps.");
  if (input.waitingOn !== null && input.waitingOn !== "family" && input.waitingOn !== "other")
    throw new AccessError("INVALID", "Choose who it's waiting on.");
  const label = input.waitingOn === "other" ? (input.waitingOnLabel ?? "").trim() : "";
  if (label.length > WAITING_LABEL_MAX)
    throw new AccessError("INVALID", `Keep who it's waiting on under ${WAITING_LABEL_MAX} characters.`);
  if (input.waitingOn && !input.nextUpdateBy)
    throw new AccessError("INVALID", "Say when the family will next hear from you.");
  const nextUpdateBy = input.nextUpdateBy ? checkNextUpdate(input.nextUpdateBy) : e.nextUpdateBy;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(s.escalations)
      .set({
        waitingOn: input.waitingOn,
        waitingOnLabel: label || null,
        nextUpdateBy,
        ...(input.waitingOn !== e.waitingOn ? { stateChangedAt: now } : {}),
      })
      .where(
        and(
          eq(s.escalations.tenantId, ctx.tenantId),
          eq(s.escalations.id, e.id),
          eq(s.escalations.status, "acknowledged"),
          eq(s.escalations.ownerActorId, ctx.actorId),
        ),
      )
      .returning({ id: s.escalations.id })
      .then(changed);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: input.waitingOn ? "request.waiting" : "request.next_update",
      subjectType: "escalation",
      subjectId: e.id,
      summary: input.waitingOn
        ? `${ctx.displayName} marked a request waiting on ${input.waitingOn === "family" ? "the family" : "someone else"}.`
        : `${ctx.displayName} updated where a request stands.`,
      visibility: "staff",
      context: { waitingOn: input.waitingOn, nextUpdateBy: nextUpdateBy?.toISOString() ?? null },
    });
  });
}

/** The offer, as the offered person reads it. */
async function offeredToMe(db: DB, ctx: ActorContext, id: string) {
  requireStaff(ctx);
  const e = await load(db, ctx, id);
  const scope = await staffScope(db, ctx, e.householdId, "staff.escalation.manage");
  if (e.offeredToActorId !== ctx.actorId || e.status === "resolved")
    throw new AccessError("INVALID", "This isn't waiting for your answer.");
  return { scope, e };
}

/** Decision 83: the offered person accepts and becomes the owner. */
export async function acceptEscalationOffer(
  db: DB,
  ctx: ActorContext,
  input: { id: string; nextUpdateBy?: Date | string | undefined },
) {
  const { scope, e } = await offeredToMe(db, ctx, input.id);
  const nextUpdateBy = input.nextUpdateBy ? checkNextUpdate(input.nextUpdateBy) : e.nextUpdateBy;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(s.escalations)
      .set({
        ownerActorId: ctx.actorId,
        status: "acknowledged",
        offeredToActorId: null,
        offeredByActorId: null,
        offeredAt: null,
        nextUpdateBy,
        stateChangedAt: now,
      })
      .where(
        and(
          eq(s.escalations.tenantId, ctx.tenantId),
          eq(s.escalations.id, e.id),
          eq(s.escalations.offeredToActorId, ctx.actorId),
          ne(s.escalations.status, "resolved"),
        ),
      )
      .returning({ id: s.escalations.id })
      .then(changed);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "escalation.offer_accepted",
      subjectType: "escalation",
      subjectId: e.id,
      summary: `${ctx.displayName} accepted an escalation.`,
      visibility: "staff",
      context: { from: e.ownerActorId },
    });
    const told = [e.ownerActorId, e.offeredByActorId].filter((x): x is string => !!x);
    if (told.length)
      await notify(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        recipients: told,
        kind: "handoff",
        title: "An escalation offer was accepted",
        link: "/staff/exceptions?view=all&kind=escalation",
        except: ctx.actorId,
      });
  });
}

/** Decision 83: the offered person declines with a reason; the current owner keeps it. */
export async function declineEscalationOffer(
  db: DB,
  ctx: ActorContext,
  input: { id: string; reason: string },
) {
  const { scope, e } = await offeredToMe(db, ctx, input.id);
  const reason = reasonOf(input.reason, "Say why, so it can go to someone else.");
  await db.transaction(async (tx) => {
    await tx
      .update(s.escalations)
      .set({ offeredToActorId: null, offeredByActorId: null, offeredAt: null })
      .where(
        and(
          eq(s.escalations.tenantId, ctx.tenantId),
          eq(s.escalations.id, e.id),
          eq(s.escalations.offeredToActorId, ctx.actorId),
        ),
      )
      .returning({ id: s.escalations.id })
      .then(changed);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "escalation.offer_declined",
      subjectType: "escalation",
      subjectId: e.id,
      summary: `${ctx.displayName} declined an escalation.`,
      visibility: "staff",
      context: { reason },
    });
    const told = [e.offeredByActorId, e.ownerActorId].filter((x): x is string => !!x);
    if (told.length)
      await notify(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        recipients: told,
        kind: "handoff",
        title: "An escalation offer was declined",
        link: "/staff/exceptions?view=all&kind=escalation",
        except: ctx.actorId,
      });
  });
}

/** Names for the family's list: the owner's display name (the screen uses the first name only). */
export async function ownerNames(db: DB, tenantId: string, rows: { ownerActorId: string | null }[]) {
  return actorNames(
    db,
    tenantId,
    rows.map((r) => r.ownerActorId),
  );
}
