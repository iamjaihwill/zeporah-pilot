/**
 * Staff read-access logging (founder decision 71, readiness D-04).
 *
 * - **Record reads:** opening one household's record or a part of it. One entry per person,
 *   household and view per `COALESCE_MINUTES`, because pages re-run their loaders on every visit.
 * - **List views:** one entry with the view and how many rows it showed, never the households.
 * - **What's kept:** who, their roles, household, view, time, and whether the household was outside
 *   their assignment or cover. Never content, search terms or what was on screen.
 * - **If the entry can't be written, the read is refused**, the same rule as packet release: a
 *   read that can't be recorded isn't shown.
 *
 * Logged where the server functions answer a request (src/functions), not inside the services, so
 * a service reading another service's data internally isn't mistaken for a person opening it.
 * Reviewable by privileged reviewers and administrators (`access_log.view`); never shown to households.
 */
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { AccessError, requireStaffPermission, type ActorContext } from "../context";
import { actorNames } from "./common";

export const COALESCE_MINUTES = 15;

/** Reads of one household's record, by the server function that answers them. */
export const RECORD_VIEWS = {
  household_overview: "Household record",
  access_map: "Who can see what",
  packet: "Packet",
  authority: "Authority evidence",
  consents: "Consents",
  consent_history: "Consent history",
  queue_detail: "Exception detail",
  prepared_drafts: "Prepared drafts",
  contacts: "Listed contacts",
} as const;

/** Views that list many households. */
export const LIST_VIEWS = {
  staff_home: "My work",
  queue: "Queue",
  household_search: "Households",
  staff_search: "Search",
  packets: "Packets",
  escalations: "Escalations",
  review_queue: "Review queue",
  sharing_register: "Sharing register",
  bereavement_workload: "Bereavement follow-up",
  coverage_board: "Team and coverage",
  resolved_exceptions: "Resolved exceptions",
  packet_draft_households: "New packet",
  coverage_tasks: "Coverage tasks",
  my_handoffs: "Handoffs",
  roster: "Care-team roster",
  staff_member: "Staff member",
  audit_review: "Audit review",
  access_log: "Who opened records",
} as const;

export type RecordView = keyof typeof RECORD_VIEWS;
export type ListView = keyof typeof LIST_VIEWS;

export const NOT_RECORDED = "This couldn't be recorded, so it isn't shown. Please try again.";

const since = () => new Date(Date.now() - COALESCE_MINUTES * 60_000);

async function recentEntry(conn: Conn, ctx: ActorContext, view: string, householdId: string | null) {
  const e = s.staffAccessEvents;
  const [r] = await conn
    .select({ id: e.id })
    .from(e)
    .where(
      and(
        eq(e.tenantId, ctx.tenantId),
        eq(e.actorId, ctx.actorId),
        eq(e.view, view),
        householdId ? eq(e.householdId, householdId) : isNull(e.householdId),
        gt(e.occurredAt, since()),
      ),
    )
    .limit(1);
  return !!r;
}

/** Records that this staff member opened part of one household's record (coalesced). */
export async function recordRead(conn: Conn, ctx: ActorContext, view: RecordView, householdId: string) {
  if (ctx.kind !== "staff") return;
  try {
    if (await recentEntry(conn, ctx, view, householdId)) return;
    await conn.insert(s.staffAccessEvents).values({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      roles: [...ctx.staffRoles],
      householdId,
      view,
      kind: "record",
      outsideAssignment: !ctx.assignedHouseholdIds.includes(householdId),
    });
  } catch {
    throw new AccessError("CONFLICT", NOT_RECORDED);
  }
}

/** Records that this staff member opened a list view, with its row count (coalesced). */
export async function recordListView(conn: Conn, ctx: ActorContext, view: ListView, rows: number | null) {
  if (ctx.kind !== "staff") return;
  try {
    if (await recentEntry(conn, ctx, view, null)) return;
    await conn.insert(s.staffAccessEvents).values({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      roles: [...ctx.staffRoles],
      view,
      kind: "list",
      rowCount: rows,
    });
  } catch {
    throw new AccessError("CONFLICT", NOT_RECORDED);
  }
}

/** Runs a record read, then records it; nothing is returned if the entry can't be written. */
export async function loggedRead<T>(
  db: DB,
  ctx: ActorContext,
  view: RecordView,
  read: () => Promise<T>,
  householdOf: (r: T) => string,
) {
  const r = await read();
  await recordRead(db, ctx, view, householdOf(r));
  return r;
}

/** Runs a list read, then records it with the number of rows when the result is a list. */
export async function loggedList<T>(db: DB, ctx: ActorContext, view: ListView, read: () => Promise<T>) {
  const r = await read();
  await recordListView(db, ctx, view, Array.isArray(r) ? r.length : null);
  return r;
}

/** The access log, newest first, for privileged reviewers and administrators. */
export async function accessLogReview(
  db: DB,
  ctx: ActorContext,
  filter: { householdId?: string | undefined; actorId?: string | undefined; limit?: number | undefined },
) {
  requireStaffPermission(ctx, "access_log.view");
  const e = s.staffAccessEvents;
  const rows = await db
    .select()
    .from(e)
    .where(
      and(
        eq(e.tenantId, ctx.tenantId),
        filter.householdId ? eq(e.householdId, filter.householdId) : undefined,
        filter.actorId ? eq(e.actorId, filter.actorId) : undefined,
      ),
    )
    .orderBy(desc(e.occurredAt))
    .limit(Math.min(filter.limit ?? 200, 500));
  const people = await actorNames(db, ctx.tenantId, [...new Set(rows.map((r) => r.actorId))]);
  const householdIds = [...new Set(rows.flatMap((r) => (r.householdId ? [r.householdId] : [])))];
  const households = householdIds.length
    ? await db
        .select({ id: s.households.id, name: s.households.displayName })
        .from(s.households)
        .where(eq(s.households.tenantId, ctx.tenantId))
    : [];
  const hName = new Map(households.map((h) => [h.id, h.name]));
  return rows.map((r) => ({
    id: r.id,
    at: r.occurredAt,
    who: people.get(r.actorId) ?? "",
    actorId: r.actorId,
    roles: r.roles,
    kind: r.kind,
    view:
      (RECORD_VIEWS as Record<string, string>)[r.view] ??
      (LIST_VIEWS as Record<string, string>)[r.view] ??
      r.view,
    household: r.householdId ? (hName.get(r.householdId) ?? "") : null,
    householdId: r.householdId,
    rowCount: r.rowCount,
    outsideAssignment: r.outsideAssignment,
  }));
}
