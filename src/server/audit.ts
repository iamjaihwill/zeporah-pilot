import { createHash } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Conn } from "./db/client";
import { actors, auditEvents, memberships } from "./db/schema";
import type { AuditApproval, AuditSource } from "@/domain/audit-shape";
import type { AuditVisibility, RoleCode } from "@/domain/model";
import type { Decision, ReasonCode } from "@/domain/policy/reason-codes";

export type AuditInput = {
  tenantId: string;
  householdId?: string | null;
  actorId?: string | null;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  decision?: Decision | null;
  reasonCode?: ReasonCode | null;
  /** Plain, safe text. Never paste message bodies, notes or document contents here. */
  summary: string;
  visibility: AuditVisibility;
  context?: Record<string, unknown>;
  at?: Date;
  /**
   * The approved audit shape (decision 58). Each is stored in `context`. `actorRoles` (the actor's
   * roles at the time) and `source` are filled in from the actor when not given.
   */
  actorRoles?: RoleCode[];
  source?: AuditSource;
  /** Why, in the person's words, where an action requires a reason. */
  reason?: string;
  /** For sensitive changes: the values before and after (never message, note or document text). */
  before?: unknown;
  after?: unknown;
  approval?: AuditApproval;
  /** A person accepted content prepared by Copilot. The person is still the actor. */
  prepared?: boolean;
};

/**
 * The only way to write an audit event. There is deliberately no update or delete here, and the
 * database rejects both anyway. Each event's hash covers its content plus the previous event's
 * hash in the same tenant, so any later tampering is detectable by `auditChainFindings`.
 *
 * Appends to one tenant's chain happen one at a time: a transaction-scoped advisory lock is held
 * from reading the previous event until the caller's transaction ends, so two requests can't both
 * follow the same event. The database refuses a fork anyway (migration 0024). Keep the
 * surrounding transaction short: other audit writes for the tenant wait for it.
 */
export async function appendAudit(conn: Conn, e: AuditInput) {
  return conn.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`zeporah.audit:${e.tenantId}`}, 0))`,
    );
    return appendLocked(tx, e);
  });
}

async function appendLocked(conn: Conn, e: AuditInput) {
  const [prev] = await conn
    .select({ hash: auditEvents.hash })
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, e.tenantId))
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  const createdAt = e.at ?? new Date();
  const who = e.actorId ? await actorAtTheTime(conn, e.tenantId, e.actorId, e.householdId ?? null) : null;
  const context: Record<string, unknown> = { ...e.context };
  const roles = e.actorRoles ?? who?.roles;
  if (roles?.length) context["actorRoles"] = roles;
  context["source"] = e.source ?? who?.kind ?? "system";
  for (const k of ["reason", "before", "after", "approval", "prepared"] as const)
    if (e[k] !== undefined) context[k] = e[k];
  const row = {
    tenantId: e.tenantId,
    householdId: e.householdId ?? null,
    actorId: e.actorId ?? null,
    action: e.action,
    subjectType: e.subjectType,
    subjectId: e.subjectId ?? null,
    decision: e.decision ?? null,
    reasonCode: e.reasonCode ?? null,
    summary: e.summary,
    visibility: e.visibility,
    context,
    createdAt,
    prevHash: prev?.hash ?? null,
  };
  const hash = hashEvent(row);
  const [saved] = await conn
    .insert(auditEvents)
    .values({ ...row, hash })
    .returning();
  return saved!;
}

/**
 * The actor's kind and roles when the event is written: staff roles in their hospice, or their
 * roles in this household (family), or the outside-recipient role.
 */
async function actorAtTheTime(conn: Conn, tenantId: string, actorId: string, householdId: string | null) {
  const [actor] = await conn
    .select({ kind: actors.kind })
    .from(actors)
    .where(and(eq(actors.tenantId, tenantId), eq(actors.id, actorId)));
  if (!actor) return null;
  if (actor.kind === "recipient")
    return { kind: "recipient" as const, roles: ["external_recipient"] as RoleCode[] };
  const rows = await conn
    .select({ role: memberships.roleCode, householdId: memberships.householdId })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.actorId, actorId),
        eq(memberships.status, "active"),
        actor.kind === "staff"
          ? isNull(memberships.householdId)
          : householdId
            ? eq(memberships.householdId, householdId)
            : undefined,
      ),
    );
  return { kind: actor.kind, roles: [...new Set(rows.map((r) => r.role as RoleCode))] };
}

/** JSON with object keys sorted at every level, so the same content always hashes the same. */
function canonical(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

function hashEvent(row: Record<string, unknown>) {
  return createHash("sha256").update(canonical(row)).digest("hex");
}

export type ChainFinding =
  /** The event's content no longer matches its hash: it was changed after it was written. */
  | { kind: "hash_mismatch"; eventId: string; seq: number }
  /** The event doesn't follow the one before it: something between them is missing or reordered. */
  | { kind: "broken_link"; eventId: string; seq: number }
  /** More than one event follows the same event (or starts the chain): the chain forked. */
  | { kind: "fork"; eventIds: string[]; after: string | null }
  /** The earliest event follows something that isn't there: the start of the chain is missing. */
  | { kind: "missing_start"; eventId: string; seq: number };

/** What a clean result still can't show. Reported with every result, so "no findings" isn't read as more. */
export const CHAIN_LIMITS = [
  "Events removed from the end, or a whole chain rewritten, can't be detected until checkpoints are kept outside the database (SB-04).",
  "It shows the recorded events weren't changed, not that every action was recorded.",
  "Times come from the server's clock, not an independent time source.",
] as const;

/**
 * Checks a tenant's whole chain and reports every problem found, in order. A clean result has no
 * findings; it is still bounded by `CHAIN_LIMITS`.
 */
export async function auditChainFindings(conn: Conn, tenantId: string) {
  const rows = await conn
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, tenantId)))
    .orderBy(auditEvents.seq);
  const findings: ChainFinding[] = [];
  const followers = new Map<string | null, string[]>();
  let prev: string | null | undefined;
  for (const r of rows) {
    const { id: _id, seq: _seq, hash, ...rest } = r;
    followers.set(r.prevHash, [...(followers.get(r.prevHash) ?? []), r.id]);
    if (prev === undefined) {
      if (r.prevHash !== null) findings.push({ kind: "missing_start", eventId: r.id, seq: r.seq });
    } else if (r.prevHash !== prev) findings.push({ kind: "broken_link", eventId: r.id, seq: r.seq });
    if (hashEvent(rest) !== hash) findings.push({ kind: "hash_mismatch", eventId: r.id, seq: r.seq });
    prev = hash;
  }
  for (const [after, ids] of followers)
    if (ids.length > 1) findings.push({ kind: "fork", eventIds: ids, after });
  const last = rows.at(-1);
  return {
    events: rows.length,
    head: last ? { eventId: last.id, seq: last.seq, hash: last.hash } : null,
    findings,
    limits: CHAIN_LIMITS,
  };
}

/** The short form: whether the chain checked clean, and the first event with a finding. */
export async function verifyAuditChain(conn: Conn, tenantId: string) {
  const r = await auditChainFindings(conn, tenantId);
  const first = r.findings[0];
  if (!first) return { ok: true as const, count: r.events };
  return { ok: false as const, brokenAt: "eventId" in first ? first.eventId : first.eventIds[0]! };
}
