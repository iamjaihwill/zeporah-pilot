/**
 * Reading the approved audit shape (decision 58) back out of stored events: roles at the time,
 * source, reason, approval and the "prepared" flag. Shared by Audit review and the household
 * record's timeline. Older events lack these fields; callers fall back to current roles.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { AUDIT_SOURCES, type AuditApproval, type AuditSource } from "@/domain/audit-shape";
import type { RoleCode } from "@/domain/model";

/** The approved-shape fields of one event's context, read defensively (older events lack them). */
export function shapeOf(c: Record<string, unknown>) {
  const roles = Array.isArray(c["actorRoles"]) ? (c["actorRoles"] as RoleCode[]) : null;
  const source = (AUDIT_SOURCES as readonly string[]).includes(c["source"] as string)
    ? (c["source"] as AuditSource)
    : null;
  const a = c["approval"] as Partial<AuditApproval> | undefined;
  return {
    roles,
    source,
    reason: typeof c["reason"] === "string" ? c["reason"] : null,
    approval: a?.requestedBy && a.approvedBy ? (a as AuditApproval) : null,
    prepared: c["prepared"] === true,
  };
}

export type Held = { org: RoleCode[]; byHousehold: Map<string, RoleCode[]> };

/** People's current roles: staff roles in the hospice, and family roles per household. */
export async function currentRoles(db: DB, tenantId: string, ids: string[]) {
  const map = new Map<string, Held>();
  const list = [...new Set(ids)];
  if (!list.length) return map;
  const rows = await db
    .select({
      actorId: s.memberships.actorId,
      role: s.memberships.roleCode,
      householdId: s.memberships.householdId,
    })
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.tenantId, tenantId),
        inArray(s.memberships.actorId, list),
        eq(s.memberships.status, "active"),
      ),
    );
  for (const r of rows) {
    const h: Held = map.get(r.actorId) ?? { org: [], byHousehold: new Map() };
    if (r.householdId === null) h.org.push(r.role as RoleCode);
    else h.byHousehold.set(r.householdId, [...(h.byHousehold.get(r.householdId) ?? []), r.role as RoleCode]);
    map.set(r.actorId, h);
  }
  return map;
}

export function roleFor(h: Held | undefined, householdId: string | null) {
  if (!h) return null;
  if (h.org.length) return [...new Set(h.org)];
  return householdId ? (h.byHousehold.get(householdId) ?? null) : null;
}
