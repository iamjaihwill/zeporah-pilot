/**
 * The staff workspace frame (staff rework, section 2): each person's own density and saved queue
 * views, the sidebar's work counts, and global search.
 *
 * Search only ever looks inside the households this person can already see (the shared
 * visibility rule: tenant, organization and, for care guides, their assignments), and shows the
 * same names and titles those screens already show — never message or note text.
 */
import { and, eq, ilike, inArray, ne, or } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { AccessError, staffVisibleHouseholds, type ActorContext } from "../context";
import { ESCALATION_WHAT, coordinationQueue, openEscalationCount } from "./staff";
import { endExpiredCover, postCoverNotices } from "./coverage";
import { recordEndedRecipientAccess } from "./recipient";
import { orgSettings } from "./org-settings";
import { organizationHotline } from "./common";
import { dueTaskCount } from "./staff-tasks";
import { bereavementDueCount } from "./bereavement";
import { can } from "@/domain/permissions";
import { ROLE_LABELS, type HouseholdRole } from "@/domain/model";

function requireStaff(ctx: ActorContext) {
  if (ctx.kind !== "staff") throw new AccessError("NOT_PERMITTED", "This area is for the hospice care team.");
}

async function prefsRow(db: DB, ctx: ActorContext) {
  const [p] = await db
    .select({ density: s.preferences.density, savedViews: s.preferences.savedViews })
    .from(s.preferences)
    .where(and(eq(s.preferences.tenantId, ctx.tenantId), eq(s.preferences.actorId, ctx.actorId)));
  return { density: p?.density ?? "comfortable", savedViews: p?.savedViews ?? [] };
}

async function upsert(db: DB, ctx: ActorContext, patch: Partial<typeof s.preferences.$inferInsert>) {
  await db
    .insert(s.preferences)
    .values({ tenantId: ctx.tenantId, actorId: ctx.actorId, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({ target: s.preferences.actorId, set: { ...patch, updatedAt: new Date() } });
}

/** Everything the frame needs: this person's settings and the Work counts. */
export async function staffShell(db: DB, ctx: ActorContext) {
  requireStaff(ctx);
  // Cover past its end time is recorded as ended (decision 59); access already stopped at that time.
  await endExpiredCover(db, ctx.tenantId);
  await recordEndedRecipientAccess(db, ctx.tenantId);
  // Decision 62: cover that has started tells its household (no timer: the first load after the start).
  await postCoverNotices(db, ctx.tenantId);
  const q = await coordinationQueue(db, ctx);
  const prefs = await prefsRow(db, ctx);
  return {
    /** The hospice's status wording (decision 39), applied to the workspace's status chips. */
    statusLabels: (await orgSettings(db, ctx.tenantId, ctx.organizationId)).statusLabels,
    density: prefs.density,
    savedViews: prefs.savedViews,
    /** Shown in the offline banner (decision 85): the hospice's 24-hour line. */
    hotline: ctx.organizationId ? await organizationHotline(db, ctx.tenantId, ctx.organizationId) : null,
    counts: {
      queue: q.length,
      /** Exceptions that are yours or have no owner (decision 58). */
      exceptions: q.filter((r) => r.mine || r.ownerIds.length === 0).length,
      mine: q.filter((r) => r.mine).length,
      unassigned: q.filter((r) => r.kind === "escalation" && r.ownerIds.length === 0).length,
      escalations: await openEscalationCount(db, ctx),
      /** Care-team tasks overdue or due today in the caller's coverage (care guides only). */
      tasksDue: await dueTaskCount(db, ctx),
      /** Bereavement check-ins due this week or overdue (contact not paused). */
      bereavementDue: await bereavementDueCount(db, ctx),
      consents: q.filter((r) => r.kind === "consent").length,
      authority: q.filter((r) => r.kind === "authority").length,
      messages: q.filter((r) => r.kind === "message").length,
    },
  };
}

/** Density is each person's own (section 1). */
export async function setDensity(db: DB, ctx: ActorContext, density: "comfortable" | "compact") {
  requireStaff(ctx);
  await upsert(db, ctx, { density });
}

const VIEW_KEYS = ["view", "kind", "who", "household", "status", "priority", "sort", "dir"];
/** Save the current queue filters and sort as a named view (section 3). Up to 12, names unique. */
export async function saveQueueView(
  db: DB,
  ctx: ActorContext,
  input: { name: string; search: Record<string, string> },
) {
  requireStaff(ctx);
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new AccessError("INVALID", "Give the view a name.");
  // Only filter and sort keys are kept: a saved view never stores a selected item or any content.
  const search = Object.fromEntries(
    Object.entries(input.search).filter(
      ([k, v]) => VIEW_KEYS.includes(k) && typeof v === "string" && v.length <= 100,
    ),
  );
  const { savedViews } = await prefsRow(db, ctx);
  const next = [...savedViews.filter((v) => v.name !== name), { name, search }].slice(-12);
  await upsert(db, ctx, { savedViews: next });
  return next;
}

export async function deleteQueueView(db: DB, ctx: ActorContext, name: string) {
  requireStaff(ctx);
  const { savedViews } = await prefsRow(db, ctx);
  await upsert(db, ctx, { savedViews: savedViews.filter((v) => v.name !== name) });
}

export type SearchHit = {
  type: "household" | "person" | "packet" | "consent" | "escalation" | "staff";
  id: string;
  title: string;
  /** Context the viewer can already see on the linked screen (household name, role). */
  detail: string;
  link: string;
};

/**
 * Global search (⌘K). Scoped exactly like every staff list: only households this person can see.
 * Escalations are matched on their kind and household, never on what a family wrote.
 */
export async function staffSearch(db: DB, ctx: ActorContext, q: string): Promise<SearchHit[]> {
  requireStaff(ctx);
  const needle = q.trim();
  if (needle.length < 2) return [];
  // Staff members, for whoever manages the team (operations, administrators): the same people
  // Team & coverage already lists. Administrators, who see no households, get only these.
  const staffHits: SearchHit[] = [];
  if (can(ctx.staffRoles, "staff.lifecycle.manage") && ctx.organizationId) {
    const like0 = `%${needle.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await db
      .selectDistinct({ actorId: s.actors.id, name: s.actors.displayName, gone: s.actors.deactivatedAt })
      .from(s.memberships)
      .innerJoin(
        s.actors,
        and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
      )
      .where(
        and(
          eq(s.memberships.tenantId, ctx.tenantId),
          eq(s.memberships.organizationId, ctx.organizationId),
          eq(s.actors.kind, "staff"),
          ilike(s.actors.displayName, like0),
        ),
      )
      .limit(8);
    for (const r of rows)
      staffHits.push({
        type: "staff",
        id: r.actorId,
        title: r.name,
        detail: r.gone ? "Former staff" : "Staff member",
        link: `/staff/team/${r.actorId}`,
      });
  }
  const hh = await staffVisibleHouseholds(db, ctx);
  if (!hh.length) return staffHits;
  const ids = hh.map((h) => h.id);
  const nameOf = new Map(hh.map((h) => [h.id, h.displayName]));
  const like = `%${needle.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const lower = needle.toLowerCase();
  const hits: SearchHit[] = [];

  for (const h of hh)
    if (h.displayName.toLowerCase().includes(lower) || h.patientName.toLowerCase().includes(lower))
      hits.push({
        type: "household",
        id: h.id,
        title: h.displayName,
        detail: `Patient: ${h.patientName}`,
        link: `/staff/households/${h.id}`,
      });

  const people = await db
    .select({
      actorId: s.actors.id,
      name: s.actors.displayName,
      householdId: s.memberships.householdId,
      role: s.memberships.roleCode,
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
        eq(s.memberships.status, "active"),
        ilike(s.actors.displayName, like),
      ),
    )
    .limit(10);
  for (const p of people)
    hits.push({
      type: "person",
      id: `${p.actorId}:${p.householdId}`,
      title: p.name,
      detail: `${ROLE_LABELS[p.role as HouseholdRole] ?? p.role} · ${nameOf.get(p.householdId!) ?? ""}`,
      link: `/staff/households/${p.householdId}?tab=overview`,
    });

  const packets = await db
    .select({
      id: s.packets.id,
      householdId: s.packets.householdId,
      recipient: s.packets.recipientName,
      purpose: s.packets.purpose,
    })
    .from(s.packets)
    .where(
      and(
        eq(s.packets.tenantId, ctx.tenantId),
        inArray(s.packets.householdId, ids),
        or(ilike(s.packets.recipientName, like), ilike(s.packets.purpose, like)),
      ),
    )
    .limit(8);
  for (const p of packets)
    hits.push({
      type: "packet",
      id: p.id,
      title: `Packet for ${p.recipient || "an unnamed recipient"}`,
      detail: nameOf.get(p.householdId) ?? "",
      link: `/staff/packets/${p.id}`,
    });

  const consents = await db
    .select({
      id: s.consents.id,
      householdId: s.consents.householdId,
      recipient: s.consents.recipientName,
      purpose: s.consents.purpose,
    })
    .from(s.consents)
    .where(
      and(
        eq(s.consents.tenantId, ctx.tenantId),
        inArray(s.consents.householdId, ids),
        or(ilike(s.consents.recipientName, like), ilike(s.consents.purpose, like)),
      ),
    )
    .limit(8);
  for (const c of consents)
    hits.push({
      type: "consent",
      id: c.id,
      title: `Consent for ${c.recipient}`,
      detail: `${c.purpose} · ${nameOf.get(c.householdId) ?? ""}`,
      link: `/staff/households/${c.householdId}/consents/${c.id}`,
    });

  // Escalations: by household name or kind label only.
  const matchingHouseholds = hh.filter((h) => h.displayName.toLowerCase().includes(lower)).map((h) => h.id);
  const kinds = Object.entries(ESCALATION_WHAT)
    .filter(([, l]) => l.toLowerCase().includes(lower))
    .map(([k]) => k);
  if (matchingHouseholds.length || kinds.length) {
    const esc = await db
      .select({ id: s.escalations.id, householdId: s.escalations.householdId, kind: s.escalations.kind })
      .from(s.escalations)
      .where(
        and(
          eq(s.escalations.tenantId, ctx.tenantId),
          inArray(s.escalations.householdId, ids),
          ne(s.escalations.status, "resolved"),
          or(
            matchingHouseholds.length ? inArray(s.escalations.householdId, matchingHouseholds) : undefined,
            kinds.length ? inArray(s.escalations.kind, kinds) : undefined,
          ),
        ),
      )
      .limit(8);
    for (const e of esc)
      hits.push({
        type: "escalation",
        id: e.id,
        title: ESCALATION_WHAT[e.kind] ?? "Escalation",
        detail: nameOf.get(e.householdId) ?? "",
        link: `/staff/exceptions?view=all&sel=escalation:${e.id}`,
      });
  }
  return [...hits, ...staffHits].slice(0, 30);
}

export const canBulkAssign = (ctx: ActorContext) => can(ctx.staffRoles, "staff.assignment.manage");
