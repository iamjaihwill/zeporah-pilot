import { and, eq } from "drizzle-orm";
import type { Conn } from "./db/client";
import { actors, households, memberships } from "./db/schema";
import { appendAudit } from "./audit";
import { activeAuthorityByActor } from "./services/common";
import { can, type Permission } from "@/domain/permissions";
import { hasProtectedAccess } from "@/domain/lifecycle";
import type { HouseholdRole, LifecycleState, StaffRole } from "@/domain/model";

/** Who is asking. Built from the database on every request — never from client-supplied claims. */
export type ActorContext = {
  actorId: string;
  tenantId: string;
  kind: "family" | "staff" | "recipient";
  displayName: string;
  organizationId: string | null;
  staffRoles: StaffRole[];
  /** Households this staff member is assigned to as a care guide (care guides see only these). */
  assignedHouseholdIds: string[];
  /** Family memberships. In the pilot a family member belongs to one household. */
  householdRoles: { householdId: string; roles: HouseholdRole[] }[];
};

/** A refusal. `code` is stable; `message` is safe to show. */
export class AccessError extends Error {
  constructor(
    public code: "NOT_AUTHENTICATED" | "OUT_OF_SCOPE" | "NOT_PERMITTED" | "INVALID" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "AccessError";
  }
}

export async function loadContext(conn: Conn, actorId: string, tenantId: string): Promise<ActorContext> {
  const [actor] = await conn
    .select()
    .from(actors)
    .where(and(eq(actors.id, actorId), eq(actors.tenantId, tenantId)));
  // A deactivated person has no access at all, whatever sessions or memberships remain.
  if (!actor || actor.deactivatedAt) throw new AccessError("NOT_AUTHENTICATED", "Please sign in again.");
  const rows = await conn
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.actorId, actorId),
        eq(memberships.status, "active"),
      ),
    );
  const byHousehold = new Map<string, HouseholdRole[]>();
  const staffRoles: StaffRole[] = [];
  const assigned: string[] = [];
  let organizationId: string | null = null;
  const now = Date.now();
  for (const m of rows) {
    // Helpers and collaborators whose access period has ended (decision 42) have no role here.
    if (m.expiresAt && m.expiresAt.getTime() <= now) continue;
    // Temporary cover that hasn't started yet gives nothing (decision 59).
    if (m.startsAt && m.startsAt.getTime() > now) continue;
    if (m.organizationId) {
      organizationId = m.organizationId;
      staffRoles.push(m.roleCode as StaffRole);
    } else if (m.householdId && actor.kind === "staff") {
      // An assignment is an active care-guide membership on a household (see services/assignments.ts).
      if (m.roleCode === "care_guide") assigned.push(m.householdId);
    } else if (m.householdId) {
      byHousehold.set(m.householdId, [
        ...(byHousehold.get(m.householdId) ?? []),
        m.roleCode as HouseholdRole,
      ]);
    }
  }
  return {
    actorId,
    tenantId,
    kind: actor.kind,
    displayName: actor.displayName,
    organizationId,
    staffRoles,
    assignedHouseholdIds: assigned,
    householdRoles: [...byHousehold].map(([householdId, roles]) => ({ householdId, roles })),
  };
}

export type FamilyScope = {
  householdId: string;
  roles: HouseholdRole[];
  lifecycle: LifecycleState;
  householdName: string;
  patientName: string;
  organizationId: string;
  /**
   * May complete household setup: coordinators, and the patient while the household has no
   * active coordinator (decision 69). Use this, not the role matrix, for `onboarding.complete`.
   */
  maySetUp: boolean;
};

/**
 * The household a family member is acting in, after checking a permission.
 * Membership is looked up within the actor's own tenant only.
 */
export async function familyScope(
  conn: Conn,
  ctx: ActorContext,
  permission: Permission,
): Promise<FamilyScope> {
  if (ctx.kind !== "family") throw new AccessError("NOT_PERMITTED", "This page is for household members.");
  const first = ctx.householdRoles[0];
  if (!first) throw new AccessError("NOT_PERMITTED", "You're not part of a household right now.");
  const [h] = await conn
    .select()
    .from(households)
    .where(and(eq(households.tenantId, ctx.tenantId), eq(households.id, first.householdId)));
  if (!h) throw new AccessError("OUT_OF_SCOPE", "This household isn't available.");
  const lifecycle = h.lifecycleState as LifecycleState;
  const maySetUp =
    can(first.roles, "onboarding.complete", lifecycle) ||
    (first.roles.includes("patient") &&
      can(["coordinator"], "onboarding.complete", lifecycle) &&
      !(await hasActiveCoordinator(conn, ctx.tenantId, h.id)));
  if (permission === "onboarding.complete" ? !maySetUp : !can(first.roles, permission, lifecycle))
    throw new AccessError(
      "NOT_PERMITTED",
      "Your role in this household doesn't include this. The household coordinator can help.",
    );
  return {
    householdId: h.id,
    roles: first.roles,
    lifecycle,
    householdName: h.displayName,
    patientName: h.patientName,
    organizationId: h.organizationId,
    maySetUp,
  };
}

async function hasActiveCoordinator(conn: Conn, tenantId: string, householdId: string) {
  const [c] = await conn
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.householdId, householdId),
        eq(memberships.roleCode, "coordinator"),
        eq(memberships.status, "active"),
      ),
    );
  return !!c;
}

/** Non-throwing version for showing or hiding actions. */
export async function familyCan(conn: Conn, ctx: ActorContext, permission: Permission) {
  return familyScope(conn, ctx, permission).then(
    () => true,
    () => false,
  );
}

/**
 * Authority types currently effective for this person: active, linked to them, and not held by a
 * conflict or an unresolved identity question.
 */
export async function activeAuthorityTypes(
  conn: Conn,
  tenantId: string,
  householdId: string,
  actorId: string,
) {
  return (await activeAuthorityByActor(conn, tenantId, householdId)).get(actorId) ?? [];
}

export async function protectedAccess(conn: Conn, ctx: ActorContext, scope: FamilyScope) {
  return hasProtectedAccess({
    roles: scope.roles,
    lifecycle: scope.lifecycle,
    activeAuthorityTypes: await activeAuthorityTypes(conn, ctx.tenantId, scope.householdId, ctx.actorId),
  });
}

/**
 * The one rule for which households a staff member may see: their own organization's, in their
 * own tenant; care guides only those assigned to them. Operations and reviewers see the whole
 * organization. Used by staffScope and by every staff list (queue, home, search, escalations,
 * packets, reviews, notifications).
 *
 * Administrators (decision 39) hold no `staff.household.view`, so they see no household here.
 * Coverage — which care guide covers which household — is the one exception: whoever manages
 * assignments sees every household of their organization by name, for that purpose only.
 */
export function staffSeesHousehold(
  ctx: ActorContext,
  h: { id: string; tenantId: string; organizationId: string },
  purpose: "work" | "coverage" = "work",
) {
  const ownOrg =
    ctx.kind === "staff" &&
    !!ctx.organizationId &&
    h.tenantId === ctx.tenantId &&
    h.organizationId === ctx.organizationId;
  if (!ownOrg) return false;
  if (purpose === "coverage") return can(ctx.staffRoles, "staff.assignment.manage");
  return (
    ctx.staffRoles.some((r) => r !== "care_guide" && can([r], "staff.household.view")) ||
    (ctx.staffRoles.includes("care_guide") && ctx.assignedHouseholdIds.includes(h.id))
  );
}

/** The households a staff member may see, by name. Empty for anyone else. */
export async function staffVisibleHouseholds(
  conn: Conn,
  ctx: ActorContext,
  purpose: "work" | "coverage" = "work",
) {
  if (ctx.kind !== "staff" || !ctx.organizationId) return [];
  const rows = await conn
    .select()
    .from(households)
    .where(and(eq(households.tenantId, ctx.tenantId), eq(households.organizationId, ctx.organizationId)))
    .orderBy(households.displayName);
  return rows.filter((h) => staffSeesHousehold(ctx, h, purpose));
}

export type StaffScope = { householdId: string; lifecycle: LifecycleState; householdName: string };

/**
 * A household a staff member may act on. Looked up only inside the actor's tenant; a household
 * in another tenant is indistinguishable from one that doesn't exist (OUT_OF_SCOPE), and the
 * attempt is recorded. Care guides are limited to assigned households.
 */
export async function staffScope(
  conn: Conn,
  ctx: ActorContext,
  householdId: string,
  permission: Permission,
): Promise<StaffScope> {
  if (ctx.kind !== "staff") throw new AccessError("NOT_PERMITTED", "This area is for the hospice care team.");
  const [h] = await conn
    .select()
    .from(households)
    .where(and(eq(households.tenantId, ctx.tenantId), eq(households.id, householdId)));
  const purpose = permission === "staff.assignment.manage" ? "coverage" : "work";
  if (!h || !staffSeesHousehold(ctx, h, purpose)) {
    await appendAudit(conn, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "access.denied",
      subjectType: "household",
      subjectId: householdId,
      decision: "deny",
      reasonCode: "OUT_OF_SCOPE",
      summary: "A request for a household outside this person's scope was refused.",
      visibility: "staff",
    });
    // Administrators open no household (decision 39): say so, the same for every household, so it
    // reveals nothing about which ones exist.
    throw new AccessError(
      "OUT_OF_SCOPE",
      can(ctx.staffRoles, "staff.household.view")
        ? "This household isn't available to you. It may not exist, or it may not be assigned to you."
        : "Administrators don't open household records (decision 39). People, roles and settings are in Administration.",
    );
  }
  const lifecycle = h.lifecycleState as LifecycleState;
  if (!can(ctx.staffRoles, permission, lifecycle))
    throw new AccessError("NOT_PERMITTED", "Your role doesn't include this action.");
  return { householdId: h.id, lifecycle, householdName: h.displayName };
}

export function requireStaffPermission(ctx: ActorContext, permission: Permission) {
  if (ctx.kind !== "staff" || !can(ctx.staffRoles, permission))
    throw new AccessError("NOT_PERMITTED", "Your role doesn't include this action.");
}
