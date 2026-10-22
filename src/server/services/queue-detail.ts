/**
 * What the queue's detail panel shows for one item (staff rework, section 3). Each kind is read
 * through the same scope and permission checks its own screen uses (staffScope with the screen's
 * permission), and the actions it offers are the existing ones — this adds a place to see them,
 * not a new way around a check.
 */
import { and, desc, eq, inArray, like } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { AccessError, staffScope, type ActorContext } from "../context";
import { actorNames, consentWorkflow, membersWho } from "./common";
import { ESCALATION_WHAT } from "./staff";
import { can } from "@/domain/permissions";
import { SHARE_CATEGORY_LABELS, type ShareCategory } from "@/domain/model";
import { actionLabel, type QueueKind } from "@/domain/queue";

export async function queueDetail(
  db: DB,
  ctx: ActorContext,
  input: { kind: QueueKind; subjectId: string | null; householdId: string; key?: string | undefined },
) {
  const T = ctx.tenantId;
  const scope = await staffScope(db, ctx, input.householdId, "staff.household.view");
  const base = { householdId: scope.householdId, household: scope.householdName };

  if (input.kind === "escalation" && input.subjectId) {
    await staffScope(db, ctx, input.householdId, "staff.escalation.manage");
    const [e] = await db
      .select()
      .from(s.escalations)
      .where(
        and(
          eq(s.escalations.tenantId, T),
          eq(s.escalations.id, input.subjectId),
          eq(s.escalations.householdId, scope.householdId),
        ),
      );
    if (!e) throw new AccessError("OUT_OF_SCOPE", "That escalation isn't available.");
    // Its recent history: who did which kind of action, from the audit log (never the summary text,
    // the same rule as the queue). Staff already see these on the household's timeline.
    const events = await db
      .select({ action: s.auditEvents.action, actorId: s.auditEvents.actorId, at: s.auditEvents.createdAt })
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.tenantId, T),
          eq(s.auditEvents.subjectId, e.id),
          like(s.auditEvents.action, "escalation.%"),
        ),
      )
      .orderBy(desc(s.auditEvents.seq))
      .limit(5);
    const names = await actorNames(db, T, [
      e.ownerActorId,
      e.raisedByActorId,
      e.resolvedByActorId,
      ...events.map((x) => x.actorId),
    ]);
    return {
      ...base,
      kind: "escalation" as const,
      id: e.id,
      what: ESCALATION_WHAT[e.kind] ?? "Needs a person",
      summary: e.summary,
      status: e.status,
      raisedAt: e.createdAt,
      raisedBy: e.raisedByActorId ? (names.get(e.raisedByActorId) ?? null) : null,
      owner: e.ownerActorId ? { id: e.ownerActorId, name: names.get(e.ownerActorId) ?? "Someone" } : null,
      mine: e.ownerActorId === ctx.actorId,
      resolution: e.resolution,
      resolvedBy: e.resolvedByActorId ? (names.get(e.resolvedByActorId) ?? null) : null,
      resolvedAt: e.resolvedAt,
      fromFamily: e.sourceType === "support_request",
      isCorrection: e.kind === "consent_correction",
      canReplyToFamily: can(ctx.staffRoles, "staff.thread.send", scope.lifecycle),
      canAssign: can(ctx.staffRoles, "staff.assignment.manage"),
      history: events.map((x) => ({
        who: x.actorId ? (names.get(x.actorId) ?? "Someone") : "The system",
        did: actionLabel(x.action),
        at: x.at,
      })),
    };
  }

  if ((input.kind === "consent" || input.kind === "correction") && input.subjectId) {
    const [c] = await db
      .select()
      .from(s.consents)
      .where(
        and(
          eq(s.consents.tenantId, T),
          eq(s.consents.id, input.subjectId),
          eq(s.consents.householdId, scope.householdId),
        ),
      );
    if (!c) throw new AccessError("OUT_OF_SCOPE", "That consent isn't available.");
    const wf = await consentWorkflow(db, c);
    const [conf] = await db
      .select()
      .from(s.consentConfirmations)
      .where(
        and(
          eq(s.consentConfirmations.tenantId, T),
          eq(s.consentConfirmations.consentId, c.id),
          eq(s.consentConfirmations.consentVersion, c.version),
        ),
      );
    const names = await actorNames(db, T, [c.recordedByActorId, conf?.actorId ?? null]);
    return {
      ...base,
      kind: "consent" as const,
      id: c.id,
      recipient: c.recipientName,
      purpose: c.purpose,
      included: (c.scope as ShareCategory[]).map((k) => SHARE_CATEGORY_LABELS[k] ?? k),
      startsAt: c.startsAt,
      expiresAt: c.expiresAt,
      version: c.version,
      stage: wf.stage,
      correction: !!wf.correction,
      grantedBy: c.grantedByName,
      recordedBy: names.get(c.recordedByActorId) ?? "",
      confirmed: conf ? { by: names.get(conf.actorId) ?? c.grantedByName, at: conf.confirmedAt } : null,
      canActivate:
        can(ctx.staffRoles, "consent.activate", scope.lifecycle) &&
        wf.stage === "awaiting_activation" &&
        !wf.correction &&
        c.recordedByActorId !== ctx.actorId,
      recordedByMe: c.recordedByActorId === ctx.actorId,
    };
  }

  if (input.kind === "message") {
    await staffScope(db, ctx, input.householdId, "staff.household.view");
    const recent = await db
      .select()
      .from(s.messages)
      .where(and(eq(s.messages.tenantId, T), eq(s.messages.householdId, scope.householdId)))
      .orderBy(desc(s.messages.createdAt))
      .limit(6);
    const names = await actorNames(
      db,
      T,
      recent.map((m) => m.authorActorId),
    );
    return {
      ...base,
      kind: "message" as const,
      id: input.subjectId,
      messages: recent.reverse().map((m) => ({
        id: m.id,
        side: m.authorSide,
        author: names.get(m.authorActorId) ?? "",
        body: m.body,
        at: m.createdAt,
      })),
      canReply: can(ctx.staffRoles, "staff.thread.send", scope.lifecycle),
    };
  }

  if (input.kind === "packet" && input.subjectId) {
    const [p] = await db
      .select()
      .from(s.packets)
      .where(
        and(
          eq(s.packets.tenantId, T),
          eq(s.packets.id, input.subjectId),
          eq(s.packets.householdId, scope.householdId),
        ),
      );
    if (!p) throw new AccessError("OUT_OF_SCOPE", "That packet isn't available.");
    return {
      ...base,
      kind: "packet" as const,
      id: p.id,
      recipient: p.recipientName,
      purpose: p.purpose,
      state: p.state,
      expiresAt: p.expiresAt,
      reason: p.lastReasonCode,
    };
  }

  // Exceptions (decision 58): the last 5 recorded actions on the item, and for an unread update the
  // people still to acknowledge it (for "Reached by phone").
  const keys = [input.subjectId, input.key].filter((x): x is string => !!x);
  const events = keys.length
    ? await db
        .select({ action: s.auditEvents.action, actorId: s.auditEvents.actorId, at: s.auditEvents.createdAt })
        .from(s.auditEvents)
        .where(and(eq(s.auditEvents.tenantId, T), inArray(s.auditEvents.subjectId, keys)))
        .orderBy(desc(s.auditEvents.seq))
        .limit(5)
    : [];
  const names = await actorNames(
    db,
    T,
    events.map((x) => x.actorId),
  );
  let waitingOn: { actorId: string; name: string }[] = [];
  if (input.kind === "acknowledgement" && input.subjectId) {
    const members = await membersWho(db, T, scope.householdId, scope.lifecycle, {
      permission: "updates.acknowledge",
    });
    const acked = await db
      .select({ actorId: s.acknowledgements.actorId })
      .from(s.acknowledgements)
      .where(
        and(
          eq(s.acknowledgements.tenantId, T),
          eq(s.acknowledgements.subjectType, "update"),
          eq(s.acknowledgements.subjectId, input.subjectId),
        ),
      );
    waitingOn = members
      .filter((m) => !acked.some((a) => a.actorId === m.actorId))
      .map((m) => ({ actorId: m.actorId, name: m.name }));
  }
  return {
    ...base,
    kind: "other" as const,
    id: input.subjectId,
    waitingOn,
    canAssign: can(ctx.staffRoles, "staff.assignment.manage"),
    history: events.map((x) => ({
      who: x.actorId ? (names.get(x.actorId) ?? "Someone") : "The system",
      did: actionLabel(x.action),
      at: x.at,
    })),
  };
}

export type QueueDetail = Awaited<ReturnType<typeof queueDetail>>;
