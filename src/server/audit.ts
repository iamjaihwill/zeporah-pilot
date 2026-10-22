import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
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
 * hash in the same tenant, so any later tampering is detectable by `verifyAuditChain`.
 */
export async function appendAudit(conn: Conn, e: AuditInput) {
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

/** Recompute every hash in a tenant's chain. Returns the first broken event, if any. */
export async function verifyAuditChain(conn: Conn, tenantId: string) {
  const rows = await conn
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, tenantId)))
    .orderBy(auditEvents.seq);
  let prev: string | null = null;
  for (const r of rows) {
    const { id: _id, seq: _seq, hash, ...rest } = r;
    if (r.prevHash !== prev || hashEvent(rest) !== hash) return { ok: false as const, brokenAt: r.id };
    prev = hash;
  }
  return { ok: true as const, count: rows.length };
}
