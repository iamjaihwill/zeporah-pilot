/**
 * Audit review for operations and reviewers: the tenant's append-only, hash-chained audit log,
 * filtered, newest first, with an integrity check.
 *
 * Visibility: events about a household appear only if the person can see that household under the
 * usual rule. Events not tied to a household — sign-ins, sessions, staff and invitation changes —
 * appear only for hospice operations (`staff.lifecycle.manage`). Nothing here changes the log.
 *
 * Export (founder decision 28, reopening decision 15): hospice operations and authority/consent
 * reviewers (`audit.export`) can download the events they can already see as CSV — the same
 * filters, at most 90 days, and no free text: the summary column is the app's fixed event label,
 * never the stored summary (which can quote a task title or a purpose). The export is itself
 * audit-logged, and the file opens with a confidentiality line, who exported it, when and the
 * filters (decision 29g).
 */
import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { PILOT_DISPLAY } from "@/domain/display-config";
import { appendAudit } from "../audit";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { verifyAuditChain } from "../audit";
import { AccessError, requireStaffPermission, staffVisibleHouseholds, type ActorContext } from "../context";
import { actorNames } from "./common";
import { can } from "@/domain/permissions";
import { DECISION_LABELS, auditLabel } from "@/domain/labels";
import { ROLE_LABELS } from "@/domain/model";
import { currentRoles, roleFor, shapeOf } from "./audit-shape";

export const AUDIT_CATEGORIES = {
  access: { label: "Access and sign-in", prefixes: ["access.", "auth.", "session."] },
  people: {
    label: "People and staff",
    prefixes: [
      "assignment.",
      "staff.",
      "invitation.",
      "household.member_",
      "absence.",
      "handoff.",
      "coverage.",
    ],
  },
  sharing: { label: "Sharing, consent and authority", prefixes: ["consent.", "authority.", "packet."] },
  care: {
    label: "Care coordination",
    prefixes: [
      "message.",
      "update.",
      "task.",
      "escalation.",
      "bereavement.",
      "lifecycle.",
      "onboarding.",
      "vault.",
      "exception.",
      "partner_event.",
      "summary.",
    ],
  },
} as const;
export type AuditCategory = keyof typeof AUDIT_CATEGORIES;
/** Days back: the last 24 hours, a week, a month, a quarter, a year. */
export const AUDIT_PERIODS = [1, 7, 30, 90, 365] as const;
/** Exports cover at most 90 days (decision 28), whichever way the period is chosen. */
const EXPORT_MAX_DAYS = 90;
const DAY = 86_400_000;

/** Midnight at the start of a calendar day (YYYY-MM-DD) in the pilot's time zone. */
function dayStart(d: string) {
  const utc = new Date(`${d}T00:00:00Z`);
  const off = new Intl.DateTimeFormat("en-US", {
    timeZone: PILOT_DISPLAY.timeZone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(utc)
    .find((x) => x.type === "timeZoneName")!
    .value.match(/GMT([+-]\d+)?/);
  return new Date(utc.getTime() - Number(off?.[1] ?? 0) * 3_600_000);
}

/** The window an audit filter covers: a from/to range (whole days, inclusive) or the last N days. */
function windowOf(filter: AuditFilter, now: Date) {
  if (filter.from && filter.to) {
    const start = dayStart(filter.from);
    const end = new Date(dayStart(filter.to).getTime() + DAY);
    if (!(start < end))
      throw new AccessError("INVALID", "The start date needs to be on or before the end date.");
    if (end.getTime() - start.getTime() > 366 * DAY)
      throw new AccessError("INVALID", "Choose a range of a year or less.");
    return {
      start,
      end,
      days: Math.round((end.getTime() - start.getTime()) / DAY),
      range: { from: filter.from, to: filter.to },
    };
  }
  const days = (AUDIT_PERIODS as readonly number[]).includes(filter.days ?? 0) ? filter.days! : 30;
  return { start: new Date(now.getTime() - days * DAY), end: null, days, range: null };
}
const LIMIT = 300;

const categoryOf = (action: string): AuditCategory | "other" =>
  (Object.entries(AUDIT_CATEGORIES).find(([, c]) => c.prefixes.some((p) => action.startsWith(p)))?.[0] as
    | AuditCategory
    | undefined) ?? "other";

type AuditFilter = {
  /** Who did it (staff rework, section 6). */
  actorId?: string | undefined;
  /** Free text over event summaries and labels. */
  q?: string | undefined;
  category?: AuditCategory | undefined;
  householdId?: string | undefined;
  days?: number | undefined;
  /** A calendar range (YYYY-MM-DD, inclusive), instead of `days`. */
  from?: string | undefined;
  to?: string | undefined;
  /**
   * Where events came from (decision 58): a source, or events that used prepared content, or
   * events with a recorded two-person approval.
   */
  source?: AuditSourceFilter | undefined;
};

export const AUDIT_SOURCE_FILTERS = [
  "staff",
  "family",
  "recipient",
  "partner_simulated",
  "system",
  "rule",
  "prepared",
  "approval",
] as const;
export type AuditSourceFilter = (typeof AUDIT_SOURCE_FILTERS)[number];

function sourceMatches(r: typeof s.auditEvents.$inferSelect, f: AuditSourceFilter | undefined) {
  if (!f) return true;
  const x = shapeOf(r.context);
  if (f === "prepared") return x.prepared;
  if (f === "approval") return !!x.approval;
  return (x.source ?? (r.actorId ? null : "system")) === f;
}

/** The events this person may see under these filters, newest first. Shared by review and export. */
async function scopedEvents(db: DB, ctx: ActorContext, filter: AuditFilter, now: Date, max: number) {
  requireStaffPermission(ctx, "audit.view");
  // Care guides read their households' timelines on each household; this view is organization-wide.
  if (!ctx.staffRoles.some((r) => r !== "care_guide"))
    throw new AccessError("NOT_PERMITTED", "Your role doesn't include this action.");
  const { start, end, days, range } = windowOf(filter, now);
  const households = await staffVisibleHouseholds(db, ctx);
  const visible = households.map((h) => h.id);
  const orgLevel = can(ctx.staffRoles, "staff.lifecycle.manage");
  const onlyHousehold =
    filter.householdId && visible.includes(filter.householdId) ? filter.householdId : null;
  if (filter.householdId && !onlyHousehold)
    throw new AccessError("OUT_OF_SCOPE", "This household isn't available to you.");
  const scope = onlyHousehold
    ? eq(s.auditEvents.householdId, onlyHousehold)
    : orgLevel
      ? or(
          isNull(s.auditEvents.householdId),
          visible.length ? inArray(s.auditEvents.householdId, visible) : undefined,
        )
      : visible.length
        ? inArray(s.auditEvents.householdId, visible)
        : eq(s.auditEvents.householdId, "-");
  const rows = await db
    .select()
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.tenantId, ctx.tenantId),
        gte(s.auditEvents.createdAt, start),
        end ? lt(s.auditEvents.createdAt, end) : undefined,
        scope,
      ),
    )
    .orderBy(desc(s.auditEvents.seq))
    .limit(max);
  const needle = filter.q?.trim().toLowerCase().slice(0, 80) ?? "";
  // The people who appear in these events, for the "Who" filter (before it's applied).
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const picked = rows.filter(
    (r) =>
      (!filter.category || categoryOf(r.action) === filter.category) &&
      (!filter.actorId || r.actorId === filter.actorId) &&
      sourceMatches(r, filter.source) &&
      (!needle ||
        r.summary.toLowerCase().includes(needle) ||
        auditLabel(r.action).toLowerCase().includes(needle)),
  );
  return { days, range, onlyHousehold, households, picked, capped: rows.length === max, actorIds };
}

export async function auditReview(db: DB, ctx: ActorContext, filter: AuditFilter, now = new Date()) {
  const { days, range, onlyHousehold, households, picked, actorIds } = await scopedEvents(
    db,
    ctx,
    filter,
    now,
    2000,
  );
  const people = await actorNames(db, ctx.tenantId, actorIds);
  const shown = picked.slice(0, LIMIT);
  const names = await actorNames(
    db,
    ctx.tenantId,
    shown.map((r) => r.actorId),
  );
  const hName = new Map(households.map((h) => [h.id, h.displayName]));
  const chain = await verifyAuditChain(db, ctx.tenantId);
  const shape = shown.map((r) => shapeOf(r.context));
  // Events written before the approved shape (decision 58) didn't record roles: fall back to the
  // person's current role, and say so.
  const current = await currentRoles(
    db,
    ctx.tenantId,
    shown.filter((r, i) => r.actorId && !shape[i]!.roles).map((r) => r.actorId!),
  );
  const approvers = await actorNames(
    db,
    ctx.tenantId,
    shape.flatMap((x) => (x.approval ? [x.approval.requestedBy, x.approval.approvedBy] : [])),
  );
  return {
    days,
    range,
    category: filter.category ?? null,
    householdId: onlyHousehold,
    households: households.map((h) => ({ id: h.id, name: h.displayName })),
    people: [...people].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    actorId: filter.actorId ?? null,
    source: filter.source ?? null,
    q: filter.q ?? "",
    categories: Object.entries(AUDIT_CATEGORIES).map(([k, c]) => ({
      key: k as AuditCategory,
      label: c.label,
    })),
    total: picked.length,
    canExport: can(ctx.staffRoles, "audit.export"),
    canSeeAccessLog: can(ctx.staffRoles, "access_log.view"),
    truncated: picked.length > LIMIT,
    integrity: chain.ok
      ? { ok: true as const, checked: chain.count }
      : { ok: false as const, message: "The audit chain didn't verify. Report this to the security lead." },
    events: shown.map((r, i) => {
      const x = shape[i]!;
      const roles = x.roles ?? (r.actorId ? roleFor(current.get(r.actorId), r.householdId) : null);
      return {
        id: r.id,
        at: r.createdAt,
        action: r.action,
        category: categoryOf(r.action),
        by: r.actorId ? (names.get(r.actorId) ?? "Someone") : "System",
        household: r.householdId ? (hName.get(r.householdId) ?? null) : null,
        summary: r.summary,
        decision: r.decision,
        reasonCode: r.reasonCode,
        visibility: r.visibility,
        // What it's about, so the detail panel can link to the record (the viewer can already see it).
        householdId: r.householdId,
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        // Role at the time, where it was recorded; otherwise the current role, marked as such.
        role: roles?.length ? roles.map((c) => ROLE_LABELS[c] ?? c).join(" · ") : null,
        roleRecorded: !!x.roles,
        source: x.source ?? (r.actorId ? null : ("system" as const)),
        reason: x.reason,
        approval: x.approval
          ? {
              requestedBy: approvers.get(x.approval.requestedBy) ?? "Someone",
              approvedBy: approvers.get(x.approval.approvedBy) ?? "Someone",
            }
          : null,
        prepared: x.prepared,
      };
    }),
  };
}

const EXPORT_MAX = 10_000;
/** First line of every export (decision 29g). */
export const EXPORT_NOTICE =
  "Confidential: Zeporah audit export. Store and share it only under your hospice's records policy.";
export const EXPORT_COLUMNS = [
  "timestamp",
  "event_code",
  "summary",
  "actor",
  "household",
  "decision",
] as const;

/** One CSV cell: quoted, and never read as a spreadsheet formula. */
export function cell(v: string) {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV of the events this person can see under these filters (decision 28). Audit-logged. */
export async function auditExport(db: DB, ctx: ActorContext, filter: AuditFilter, now = new Date()) {
  requireStaffPermission(ctx, "audit.export");
  if (filter.days !== undefined && !(AUDIT_PERIODS as readonly number[]).includes(filter.days))
    throw new AccessError("INVALID", "Choose one of the periods offered.");
  if (windowOf(filter, now).days > EXPORT_MAX_DAYS)
    throw new AccessError("INVALID", "Exports cover at most 90 days. Choose a shorter period.");
  const { days, range, onlyHousehold, households, picked, capped } = await scopedEvents(
    db,
    ctx,
    filter,
    now,
    EXPORT_MAX,
  );
  if (capped) throw new AccessError("INVALID", "That's too many events for one file. Narrow the filters.");
  const names = await actorNames(
    db,
    ctx.tenantId,
    picked.map((r) => r.actorId),
  );
  const hName = new Map(households.map((h) => [h.id, h.displayName]));
  // Decision 29g: the file says what it is, who made it, when and with which filters.
  const kind = filter.category ? AUDIT_CATEGORIES[filter.category].label : "All kinds";
  const household = onlyHousehold ? (hName.get(onlyHousehold) ?? "") : "All households you can see";
  const lines = [
    cell(EXPORT_NOTICE),
    cell(`Exported by ${ctx.displayName} at ${now.toISOString()}`),
    cell(
      `Filters: ${range ? `${range.from} to ${range.to}` : `last ${days} days`}; ${kind}; ${household}; ${picked.length} events`,
    ),
    "",
    EXPORT_COLUMNS.join(","),
    ...picked.map((r) =>
      [
        r.createdAt.toISOString(),
        r.action,
        auditLabel(r.action),
        r.actorId ? (names.get(r.actorId) ?? "Someone") : "System",
        r.householdId ? (hName.get(r.householdId) ?? "") : "",
        r.decision ? (DECISION_LABELS[r.decision] ?? r.decision) : "",
      ]
        .map(cell)
        .join(","),
    ),
  ];
  await appendAudit(db, {
    tenantId: ctx.tenantId,
    householdId: onlyHousehold,
    actorId: ctx.actorId,
    action: "audit.exported",
    subjectType: "audit_log",
    subjectId: null,
    summary: `An audit export was downloaded: ${picked.length} events ${range ? `from ${range.from} to ${range.to}` : `from the last ${days} days`}.`,
    visibility: "staff",
    context: {
      days,
      range,
      category: filter.category ?? null,
      householdId: onlyHousehold,
      actorId: filter.actorId ?? null,
      // Not "source": that key records where this event itself came from (decision 58).
      sourceFilter: filter.source ?? null,
      // The search words are recorded only as whether there were any (they could be anything).
      searched: !!filter.q?.trim(),
      rows: picked.length,
    },
    at: now,
  });
  const date = now.toISOString().slice(0, 10);
  return {
    filename: range
      ? `zeporah-audit-${date}-${range.from}-to-${range.to}.csv`
      : `zeporah-audit-${date}-last-${days}-days.csv`,
    csv: lines.join("\r\n") + "\r\n",
    rows: picked.length,
  };
}
