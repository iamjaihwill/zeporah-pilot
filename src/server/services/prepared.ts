/**
 * The demo-safe Copilot foundation (decision 58, workstream 5). Deterministic only: no model is
 * connected, nothing leaves the app, and nothing here claims otherwise.
 *
 * - "Catch me up" is assembled by fixed rules from what this person can already open about one
 *   household. Every line cites the recorded events it comes from, and says when it was prepared.
 *   It never reads the patient's private notes, internal note text or message text, and it's never
 *   offered to administrators (they can't open households).
 * - Prepared drafts are synthetic examples for named demo moments, offered only while a demo
 *   snapshot is loaded, and always labelled "Prepared with Copilot · synthetic example". A person
 *   edits and sends them; the person is the actor, and the audit event says the draft was used.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { appendAudit } from "../audit";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { staffScope, type ActorContext } from "../context";
import { actorNames } from "./common";
import { coordinationQueue } from "./staff";
import { DEMO_DRAFTS, type SeedSnapshot } from "@/fixtures/demo-week";
import { auditLabel } from "@/domain/labels";
import { CATEGORY_LABELS } from "@/domain/queue";
import { LIFECYCLE_LABELS } from "@/domain/lifecycle";
import type { LifecycleState } from "@/domain/model";

export const PREPARED_SYNTHETIC_LABEL = "Prepared with Copilot · synthetic example";

/* ------------------------------------------------------------------ prepared drafts */

/** Which synthetic dataset is loaded (from the seed's own audit event). */
async function loadedSnapshot(conn: Conn, tenantId: string): Promise<SeedSnapshot> {
  const [e] = await conn
    .select({ context: s.auditEvents.context })
    .from(s.auditEvents)
    .where(and(eq(s.auditEvents.tenantId, tenantId), eq(s.auditEvents.action, "system.seeded")))
    .orderBy(desc(s.auditEvents.seq))
    .limit(1);
  return ((e?.context as { snapshot?: SeedSnapshot } | undefined)?.snapshot ?? "standard") as SeedSnapshot;
}

/** The synthetic drafts for this household, if a demo snapshot is loaded and the person may open it. */
export async function preparedDrafts(conn: Conn, ctx: ActorContext, householdId: string) {
  const scope = await staffScope(conn, ctx, householdId, "staff.household.view");
  if ((await loadedSnapshot(conn, ctx.tenantId)) === "standard") return null;
  const d = DEMO_DRAFTS[scope.householdId];
  return d ? { label: PREPARED_SYNTHETIC_LABEL, ...d } : null;
}

/** True only when the person says they used a draft and one was really on offer here. */
export async function usedPreparedDraft(
  conn: Conn,
  ctx: ActorContext,
  householdId: string,
  claimed?: boolean,
) {
  if (!claimed) return false;
  return !!(await preparedDrafts(conn, ctx, householdId).catch(() => null));
}

/* ------------------------------------------------------------------ catch me up */

type Source = { id: string; label: string; at: Date };
export type BriefLine = { text: string; sources: Source[] };

/** Partner event kinds in words (the record's Log a partner event uses the same three). */
const PARTNER_KIND_WORDS: Record<string, string> = {
  status: "a status change",
  request: "a request",
  acknowledgement: "an acknowledgement",
};

const FAMILY_CONTACT = ["message.sent", "update.acknowledged", "consent.confirmed", "escalation.raised"];
const TEAM_CONTACT = ["message.sent", "update.posted", "update.reached_by_phone"];

/**
 * A short, cited summary of one household for someone who can open it: stage, who's involved,
 * what's open and waiting, the last contact each way, what's shared outside and what ends soon.
 * Recorded as `summary.prepared` with the source event IDs (never the text).
 */
export async function catchMeUp(db: DB, ctx: ActorContext, householdId: string, now = new Date()) {
  const scope = await staffScope(db, ctx, householdId, "staff.household.view");
  const T = ctx.tenantId;
  const H = scope.householdId;
  const events = await db
    .select()
    .from(s.auditEvents)
    .where(and(eq(s.auditEvents.tenantId, T), eq(s.auditEvents.householdId, H)))
    .orderBy(desc(s.auditEvents.seq))
    .limit(300);
  const actorIds = [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))];
  const kinds = actorIds.length
    ? await db
        .select({ id: s.actors.id, kind: s.actors.kind })
        .from(s.actors)
        .where(and(eq(s.actors.tenantId, T), inArray(s.actors.id, actorIds)))
    : [];
  const kindOf = new Map(kinds.map((k) => [k.id, k.kind]));
  const names = await actorNames(db, T, actorIds);
  const src = (e: (typeof events)[number]): Source => ({
    id: e.id,
    label: auditLabel(e.action),
    at: e.createdAt,
  });
  const latest = (pred: (e: (typeof events)[number]) => boolean) => events.find(pred);
  const lines: BriefLine[] = [];

  // Stage and care team, from their latest recorded change.
  const stageEvent = latest((e) => e.action.startsWith("lifecycle.") || e.action === "onboarding.completed");
  const teamEvent = latest((e) => e.action.startsWith("assignment.") || e.action.startsWith("coverage."));
  if (stageEvent || teamEvent)
    lines.push({
      text: `${LIFECYCLE_LABELS[scope.lifecycle as LifecycleState]}.${teamEvent ? ` Latest care-team change: ${auditLabel(teamEvent.action).toLowerCase()}.` : ""}`,
      sources: [stageEvent, teamEvent].filter((x): x is (typeof events)[number] => !!x).map(src),
    });

  // What's open, from the same exceptions this person sees.
  const open = (await coordinationQueue(db, ctx)).filter((r) => r.householdId === H);
  if (open.length) {
    const byCat = new Map<string, number>();
    for (const r of open)
      byCat.set(CATEGORY_LABELS[r.category], (byCat.get(CATEGORY_LABELS[r.category]) ?? 0) + 1);
    const cited = open
      .map(
        (r) =>
          latest((e) => !!r.subjectId && e.subjectId === r.subjectId) ?? latest((e) => e.subjectId === r.id),
      )
      .filter((x): x is (typeof events)[number] => !!x);
    if (cited.length)
      lines.push({
        text: `${open.length} open: ${[...byCat].map(([c, n]) => `${c.toLowerCase()} (${n})`).join(", ")}.`,
        sources: [...new Map(cited.map((e) => [e.id, src(e)])).values()].slice(0, 6),
      });
    const waiting = open.filter(
      (r) => r.waitingOn || r.category === "partner_waiting" || r.category === "unread_update",
    );
    const wCited = waiting
      .map(
        (r) =>
          latest((e) => !!r.subjectId && e.subjectId === r.subjectId) ?? latest((e) => e.subjectId === r.id),
      )
      .filter((x): x is (typeof events)[number] => !!x);
    if (wCited.length)
      lines.push({
        text: `Waiting on others: ${waiting.map((r) => r.summary).join("; ")}.`,
        sources: [...new Map(wCited.map((e) => [e.id, src(e)])).values()].slice(0, 6),
      });
  }

  // The last contact each way (what kind and when; never message text).
  const fromFamily = latest(
    (e) => FAMILY_CONTACT.includes(e.action) && kindOf.get(e.actorId ?? "") === "family",
  );
  if (fromFamily)
    lines.push({
      text: `Last from the household: ${names.get(fromFamily.actorId!) ?? "Someone"}, ${auditLabel(fromFamily.action).toLowerCase()}.`,
      sources: [src(fromFamily)],
    });
  const fromTeam = latest((e) => TEAM_CONTACT.includes(e.action) && kindOf.get(e.actorId ?? "") === "staff");
  if (fromTeam)
    lines.push({
      text: `Last from the care team: ${names.get(fromTeam.actorId!) ?? "Someone"}, ${auditLabel(fromTeam.action).toLowerCase()}.`,
      sources: [src(fromTeam)],
    });

  // Outside: the latest partner news, and access granted that's still open.
  const partner = latest((e) => e.action === "partner_event.logged");
  if (partner && partner.subjectId) {
    const [p] = await db.select().from(s.partnerEvents).where(eq(s.partnerEvents.id, partner.subjectId));
    if (p)
      lines.push({
        text: `Latest from outside (simulated): ${PARTNER_KIND_WORDS[p.kind] ?? "news"} from ${p.organizationLabel}.`,
        sources: [src(partner)],
      });
  }
  const access = await db
    .select({ a: s.packetRecipientAccess, p: s.packets })
    .from(s.packetRecipientAccess)
    .innerJoin(
      s.packets,
      and(
        eq(s.packets.id, s.packetRecipientAccess.packetId),
        eq(s.packets.tenantId, s.packetRecipientAccess.tenantId),
      ),
    )
    .where(and(eq(s.packetRecipientAccess.tenantId, T), eq(s.packets.householdId, H)));
  const live = access.filter(({ a }) => !a.revokedAt && a.expiresAt.getTime() > now.getTime());
  const granted = live
    .map(({ p }) => latest((e) => e.action === "packet.recipient_access_granted" && e.subjectId === p.id))
    .filter((x): x is (typeof events)[number] => !!x);
  if (granted.length)
    lines.push({
      text: `Shared outside, read-only: ${live.map(({ p }) => `“${p.purpose}” with ${p.recipientName}`).join("; ")}.`,
      sources: granted.map(src),
    });

  await appendAudit(db, {
    tenantId: T,
    householdId: H,
    actorId: ctx.actorId,
    action: "summary.prepared",
    subjectType: "household",
    subjectId: H,
    summary: `${ctx.displayName} viewed a prepared summary (${lines.reduce((n, l) => n + l.sources.length, 0)} sources).`,
    visibility: "staff",
    context: { sources: lines.flatMap((l) => l.sources.map((x) => x.id)), lines: lines.length },
  });
  return { household: scope.householdName, asOf: now, lines };
}
