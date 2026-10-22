/**
 * Coordination Record v2 (decision 58; docs/enterprise-record-and-exceptions-spec.md, section 2):
 * the unified timeline's events, and the context column beside it. Read-only, and only ever for a
 * household the person can already open (callers pass a scope from `staffScope`).
 *
 * Nothing clinical: care-plan context is the household's own coordination record and a pointer to
 * the EHR. Partner events are staff-entered and labelled simulated (decision 60).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { appendAudit } from "../audit";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { AccessError, staffScope, type ActorContext, type StaffScope } from "../context";
import { activeAuthorityByActor, actorNames, effectiveConsentState } from "./common";
import { coordinationQueue } from "./staff";
import { currentRoles, roleFor, shapeOf } from "./audit-shape";
import { can } from "@/domain/permissions";
import {
  AUTHORITY_TYPE_LABELS,
  ROLE_LABELS,
  SHARE_CATEGORY_LABELS,
  type AuthorityType,
  type HouseholdRole,
  type RoleCode,
  type ShareCategory,
} from "@/domain/model";

type AuditRow = typeof s.auditEvents.$inferSelect;

/** Each timeline event with the person's role at the time, where it came from, and what it's about. */
export async function timelineEvents(db: DB, tenantId: string, householdId: string, rows: AuditRow[]) {
  const shapes = rows.map((r) => shapeOf(r.context));
  const fallback = await currentRoles(
    db,
    tenantId,
    rows.filter((r, i) => r.actorId && !shapes[i]!.roles).map((r) => r.actorId!),
  );
  const names = await actorNames(
    db,
    tenantId,
    rows.map((r) => r.actorId),
  );
  // What an outside organization said is kept on its own row, not in the audit summary.
  const partnerIds = rows
    .filter((r) => r.action === "partner_event.logged" && r.subjectId)
    .map((r) => r.subjectId!);
  const partner = partnerIds.length
    ? await db
        .select()
        .from(s.partnerEvents)
        .where(and(eq(s.partnerEvents.tenantId, tenantId), inArray(s.partnerEvents.id, partnerIds)))
    : [];
  const said = new Map(partner.map((p) => [p.id, p]));
  return rows.map((r, i) => {
    const x = shapes[i]!;
    const roles = x.roles ?? (r.actorId ? roleFor(fallback.get(r.actorId), householdId) : null);
    const p = r.subjectId ? said.get(r.subjectId) : undefined;
    return {
      id: r.id,
      at: r.createdAt,
      actor: r.actorId ? (names.get(r.actorId) ?? "Someone") : "System",
      role: roles?.length ? roles.map((c) => ROLE_LABELS[c] ?? c).join(" · ") : null,
      roleRecorded: !!x.roles,
      source: x.source ?? (r.actorId ? null : ("system" as const)),
      prepared: x.prepared,
      action: r.action,
      decision: r.decision,
      reasonCode: r.reasonCode,
      summary: r.summary,
      visibility: r.visibility,
      householdId: r.householdId,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      /** For a logged partner event: who said what, and when it happened. */
      partner: p ? { organization: p.organizationLabel, said: p.summary, occurredAt: p.occurredAt } : null,
    };
  });
}

/** The context column: participants, care team and its history, organizations, open items. */
export async function recordContext(db: DB, ctx: ActorContext, scope: StaffScope) {
  const T = ctx.tenantId;
  const H = scope.householdId;
  const rows = await db
    .select({
      id: s.memberships.id,
      actorId: s.memberships.actorId,
      role: s.memberships.roleCode,
      status: s.memberships.status,
      createdAt: s.memberships.createdAt,
      endedAt: s.memberships.endedAt,
      endReason: s.memberships.endReason,
      expiresAt: s.memberships.expiresAt,
      taskId: s.memberships.taskId,
      coverFor: s.memberships.coverForActorId,
      startsAt: s.memberships.startsAt,
      grantReason: s.memberships.grantReason,
      name: s.actors.displayName,
      kind: s.actors.kind,
    })
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .where(and(eq(s.memberships.tenantId, T), eq(s.memberships.householdId, H)))
    .orderBy(desc(s.memberships.createdAt));
  const now = Date.now();
  const live = (r: (typeof rows)[number]) =>
    r.status === "active" &&
    (!r.expiresAt || r.expiresAt.getTime() > now) &&
    (!r.startsAt || r.startsAt.getTime() <= now);

  // Participants: each household member, their roles, and how their access comes about.
  const authority = await activeAuthorityByActor(db, T, H);
  const people = new Map<
    string,
    { actorId: string; name: string; roles: HouseholdRole[]; until: Date | null; taskOnly: boolean }
  >();
  for (const r of rows.filter((r) => r.kind === "family" && live(r))) {
    const p = people.get(r.actorId) ?? {
      actorId: r.actorId,
      name: r.name,
      roles: [],
      until: null,
      taskOnly: false,
    };
    p.roles.push(r.role as HouseholdRole);
    if (r.expiresAt) p.until = r.expiresAt;
    if (r.taskId) p.taskOnly = true;
    people.set(r.actorId, p);
  }
  const participants = [...people.values()].map((p) => ({
    ...p,
    roleLabels: p.roles.map((r) => ROLE_LABELS[r]),
    authority: (authority.get(p.actorId) ?? []).map((t) => AUTHORITY_TYPE_LABELS[t as AuthorityType]),
  }));
  const former = rows
    .filter((r) => r.kind === "family" && !live(r))
    .map((r) => ({ name: r.name, role: ROLE_LABELS[r.role as RoleCode], endedAt: r.endedAt ?? r.expiresAt }));

  // Care team: assigned and covering guides now, and every assignment there has been.
  const guides = rows.filter((r) => r.kind === "staff" && r.role === "care_guide");
  const coverNames = await actorNames(
    db,
    T,
    guides.map((g) => g.coverFor),
  );
  const guide = (g: (typeof guides)[number]) => ({
    membershipId: g.id,
    actorId: g.actorId,
    name: g.name,
    since: g.createdAt,
    endedAt: g.endedAt,
    endReason: g.endReason,
    until: g.expiresAt,
    from: g.startsAt,
    coverFor: g.coverFor ? (coverNames.get(g.coverFor) ?? "Someone") : null,
    reason: g.grantReason,
  });
  const handoffRows = await db
    .select()
    .from(s.handoffs)
    .where(and(eq(s.handoffs.tenantId, T), eq(s.handoffs.householdId, H), eq(s.handoffs.state, "offered")));
  const handoffNames = await actorNames(
    db,
    T,
    handoffRows.flatMap((h) => [h.toActorId, h.fromActorId]),
  );

  // Organizations: everyone outside the household this household shares with, grouped by name.
  const consents = await db
    .select()
    .from(s.consents)
    .where(and(eq(s.consents.tenantId, T), eq(s.consents.householdId, H)));
  const packets = await db
    .select()
    .from(s.packets)
    .where(and(eq(s.packets.tenantId, T), eq(s.packets.householdId, H)));
  const access = packets.length
    ? await db
        .select()
        .from(s.packetRecipientAccess)
        .where(
          and(
            eq(s.packetRecipientAccess.tenantId, T),
            inArray(
              s.packetRecipientAccess.packetId,
              packets.map((p) => p.id),
            ),
          ),
        )
    : [];
  const log = packets.length
    ? await db
        .select()
        .from(s.packetAccessLog)
        .where(
          and(
            eq(s.packetAccessLog.tenantId, T),
            inArray(
              s.packetAccessLog.packetId,
              packets.map((p) => p.id),
            ),
          ),
        )
    : [];
  const recipientNames = await actorNames(
    db,
    T,
    access.map((a) => a.recipientActorId),
  );
  const orgs = new Map<
    string,
    {
      name: string;
      consents: { id: string; purpose: string; state: string; until: Date; includes: string[] }[];
      access: {
        packetId: string;
        purpose: string;
        person: string;
        until: Date;
        ended: boolean;
        opened: Date | null;
        acknowledged: Date | null;
      }[];
    }
  >();
  const org = (name: string) => {
    const o = orgs.get(name) ?? { name, consents: [], access: [] };
    orgs.set(name, o);
    return o;
  };
  for (const c of consents)
    org(c.recipientName).consents.push({
      id: c.id,
      purpose: c.purpose,
      state: effectiveConsentState(c),
      until: c.expiresAt,
      includes: (c.scope as ShareCategory[]).map((k) => SHARE_CATEGORY_LABELS[k] ?? k),
    });
  for (const a of access) {
    const p = packets.find((x) => x.id === a.packetId)!;
    const mine = log.filter((l) => l.packetId === a.packetId && l.actorId === a.recipientActorId);
    const first = (k: string) =>
      mine
        .filter((l) => l.action === k)
        .map((l) => l.at)
        .sort((x, y) => x.getTime() - y.getTime())[0] ?? null;
    org(p.recipientName).access.push({
      packetId: p.id,
      purpose: p.purpose,
      person: recipientNames.get(a.recipientActorId) ?? "The named recipient",
      until: a.expiresAt,
      ended: !!a.revokedAt || a.expiresAt.getTime() <= now,
      opened: first("viewed"),
      acknowledged: a.acknowledgedAt ?? first("acknowledged"),
    });
  }

  // Open items: the coordination queue's rows for this household (Exceptions replace these in Phase 2).
  const open = (await coordinationQueue(db, ctx)).filter((r) => r.householdId === H);

  return {
    participants,
    former,
    careTeam: {
      current: guides.filter(live).map(guide),
      /** Accepted cover that hasn't started: shown, with no access until it does (decision 59). */
      upcoming: guides
        .filter(
          (r) =>
            r.status === "active" &&
            !!r.startsAt &&
            r.startsAt.getTime() > now &&
            (!r.expiresAt || r.expiresAt.getTime() > now),
        )
        .map(guide),
      history: guides.map(guide),
      handoffsOffered: handoffRows.map((h) => ({
        id: h.id,
        kind: h.kind,
        to: handoffNames.get(h.toActorId) ?? "Someone",
        from: handoffNames.get(h.fromActorId) ?? "Someone",
        offeredAt: h.offeredAt,
        acceptBy: h.acceptBy,
      })),
    },
    organizations: [...orgs.values()].sort((a, b) => a.name.localeCompare(b.name)),
    openItems: open.map((r) => ({
      id: r.id,
      kind: r.kind,
      summary: r.summary,
      owner: r.owner,
      state: r.state,
      next: r.next,
      age: r.age,
      since: r.since,
      priority: r.priority,
      priorityReason: r.priorityReason,
      link: r.link,
      /** When the next step is to take ownership and the viewer may. */
      takeEscalationId: r.takeEscalationId,
    })),
    /** Who may log a partner event (decision 60): assigned or covering care guides, and operations. */
    canLogPartnerEvent: can(ctx.staffRoles, "partner_event.log", scope.lifecycle),
  };
}

export const PARTNER_EVENT_KINDS = ["status", "request", "acknowledgement"] as const;

/**
 * Record what an outside organization said (decision 60): care guides for households they're
 * assigned to or covering, and hospice operations. Staff-entered and labelled simulated; it goes
 * on this household's timeline only and isn't sent anywhere.
 */
export async function logPartnerEvent(
  db: DB,
  ctx: ActorContext,
  input: {
    householdId: string;
    organization: string;
    kind: (typeof PARTNER_EVENT_KINDS)[number];
    said: string;
    occurredAt: Date;
  },
  now = new Date(),
) {
  // Care guides reach only households they're assigned to or covering (staffScope); operations, any.
  const scope = await staffScope(db, ctx, input.householdId, "partner_event.log");
  if (scope.lifecycle === "closed")
    throw new AccessError("INVALID", "This household is closed, so nothing new can be added.");
  const organization = input.organization.trim();
  const said = input.said.trim();
  if (!organization || organization.length > 120)
    throw new AccessError("INVALID", "Name the organization (up to 120 characters).");
  if (!said || said.length > 280)
    throw new AccessError("INVALID", "Say what they told you, in up to 280 characters.");
  if (!(PARTNER_EVENT_KINDS as readonly string[]).includes(input.kind))
    throw new AccessError("INVALID", "Choose what kind of event it was.");
  const when = input.occurredAt;
  if (Number.isNaN(when.getTime()) || when.getTime() > now.getTime() + 5 * 60_000)
    throw new AccessError("INVALID", "When it happened can't be in the future.");
  if (when.getTime() < now.getTime() - 30 * 86_400_000)
    throw new AccessError("INVALID", "Log events from the last 30 days.");
  return db.transaction(async (tx) => {
    const [e] = await tx
      .insert(s.partnerEvents)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        organizationLabel: organization,
        kind: input.kind,
        summary: said,
        occurredAt: when,
        enteredByActorId: ctx.actorId,
        source: "staff_entered",
        simulated: true,
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "partner_event.logged",
      subjectType: "partner_event",
      subjectId: e!.id,
      // The organization's words stay on the partner event; the summary stays generic.
      summary: `${ctx.displayName} logged a simulated ${input.kind} from ${organization}.`,
      visibility: "staff",
      source: "partner_simulated",
      context: { simulated: true, kind: input.kind },
      at: now,
    });
    return { id: e!.id };
  });
}
