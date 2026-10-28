import { lineForFamilies } from "@/domain/contact-line";
import { and, lte, eq, gt, inArray, isNull, like, or } from "drizzle-orm";
import type { Conn } from "../db/client";
import {
  actors,
  authorityEvidence,
  consentConfirmations,
  consentCorrectionRequests,
  consents,
  households,
  memberships,
  notifications,
  onboardingSteps,
  organizations,
} from "../db/schema";
import { effectiveAuthorityState } from "@/domain/authority-identity";
import { canSelfConfirm, consentStage, selfConfirmBlocker } from "@/domain/consent";
import { can, type Permission } from "@/domain/permissions";
import { hasProtectedAccess } from "@/domain/lifecycle";
import {
  ONBOARDING_STEPS,
  type AuditVisibility,
  type AuthorityType,
  type ConsentState,
  type HouseholdRole,
  type LifecycleState,
  type OnboardingStep,
  type StaffRole,
} from "@/domain/model";

export type Member = { actorId: string; roles: HouseholdRole[]; name: string };

/** The hospice's own 24-hour line, as recorded for its organization (synthetic in this prototype). */
/**
 * The confirmed 24-hour line as families see it, with the backup line when there is one (decision
 * 72). The one place the line is read for display; nothing keeps a copy.
 */
export async function organizationHotline(conn: Conn, tenantId: string, organizationId: string) {
  const [o] = await conn
    .select({ line: organizations.afterHoursLine, backup: organizations.afterHoursBackupLine })
    .from(organizations)
    .where(and(eq(organizations.tenantId, tenantId), eq(organizations.id, organizationId)));
  return o ? lineForFamilies(o.line, o.backup) : null;
}

/** Active family members of a household (within a tenant). */
export async function householdMembers(conn: Conn, tenantId: string, householdId: string): Promise<Member[]> {
  const rows = await conn
    .select({
      actorId: memberships.actorId,
      role: memberships.roleCode,
      name: actors.displayName,
      kind: actors.kind,
    })
    .from(memberships)
    .innerJoin(actors, and(eq(actors.id, memberships.actorId), eq(actors.tenantId, memberships.tenantId)))
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.householdId, householdId),
        eq(memberships.status, "active"),
        // Helpers and collaborators whose access period ended (decision 42) aren't members any more.
        or(isNull(memberships.expiresAt), gt(memberships.expiresAt, new Date())),
      ),
    );
  const by = new Map<string, Member>();
  for (const r of rows) {
    if (r.kind !== "family") continue;
    const m = by.get(r.actorId) ?? { actorId: r.actorId, roles: [], name: r.name };
    m.roles.push(r.role as HouseholdRole);
    by.set(r.actorId, m);
  }
  return [...by.values()];
}

/** Care guides assigned to a household. */
export async function careGuidesFor(conn: Conn, tenantId: string, householdId: string) {
  const rows = await conn
    .select({
      membershipId: memberships.id,
      actorId: memberships.actorId,
      name: actors.displayName,
      kind: actors.kind,
      since: memberships.createdAt,
      /** Temporary cover (decision 59): when it ends by itself, and whom it covers for. */
      until: memberships.expiresAt,
      coverFor: memberships.coverForActorId,
    })
    .from(memberships)
    .innerJoin(actors, and(eq(actors.id, memberships.actorId), eq(actors.tenantId, memberships.tenantId)))
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.householdId, householdId),
        eq(memberships.roleCode, "care_guide"),
        eq(memberships.status, "active"),
        // Cover counts only inside its window: started, and not yet ended (decision 59).
        or(isNull(memberships.expiresAt), gt(memberships.expiresAt, new Date())),
        or(isNull(memberships.startsAt), lte(memberships.startsAt, new Date())),
      ),
    )
    .orderBy(actors.displayName);
  return rows.filter((r) => r.kind === "staff");
}

/** Staff in a tenant holding a given organization role. */
export async function staffWithRole(conn: Conn, tenantId: string, role: StaffRole) {
  const rows = await conn
    .select({ actorId: memberships.actorId })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.roleCode, role),
        eq(memberships.status, "active"),
      ),
    );
  return rows.filter((r) => r.actorId).map((r) => r.actorId);
}

/** Authority types currently effective (active, linked, and not in conflict or identity review), per person. */
export async function activeAuthorityByActor(conn: Conn, tenantId: string, householdId: string) {
  const rows = await householdEvidence(conn, tenantId, householdId);
  const map = new Map<string, AuthorityType[]>();
  for (const r of rows)
    if (r.holderActorId && effectiveAuthorityState(r, rows) === "workflow_active")
      map.set(r.holderActorId, [...(map.get(r.holderActorId) ?? []), r.authorityType as AuthorityType]);
  return map;
}

export async function householdEvidence(conn: Conn, tenantId: string, householdId: string) {
  return conn
    .select()
    .from(authorityEvidence)
    .where(and(eq(authorityEvidence.tenantId, tenantId), eq(authorityEvidence.householdId, householdId)));
}

/**
 * Decision 43: the care team sees vault items shared with staff or with the household, never one
 * that's private to someone or shared only with selected people (protected ones included).
 */
export function staffMaySeeVaultItem(item: { audience: string }) {
  return item.audience === "staff" || item.audience === "household";
}

/** Household members allowed to see something, by permission or protected access. */
export async function membersWho(
  conn: Conn,
  tenantId: string,
  householdId: string,
  lifecycle: LifecycleState,
  test: { permission: Permission } | { protectedAccess: true },
) {
  const members = await householdMembers(conn, tenantId, householdId);
  if ("permission" in test) return members.filter((m) => can(m.roles, test.permission, lifecycle));
  const auth = await activeAuthorityByActor(conn, tenantId, householdId);
  return members.filter((m) =>
    hasProtectedAccess({ roles: m.roles, lifecycle, activeAuthorityTypes: auth.get(m.actorId) ?? [] }),
  );
}

/** Family members who may see an audit event of a given visibility. */
export async function audienceFor(
  conn: Conn,
  tenantId: string,
  householdId: string,
  lifecycle: LifecycleState,
  v: AuditVisibility,
) {
  if (v === "staff") return [];
  if (v === "family") return householdMembers(conn, tenantId, householdId);
  if (v === "sharing")
    return membersWho(conn, tenantId, householdId, lifecycle, { permission: "consent.view" });
  return membersWho(conn, tenantId, householdId, lifecycle, { protectedAccess: true });
}

/**
 * In-app notifications. Titles are generic by design — no names, diagnoses, document titles or
 * message text — because notifications are the most likely place for details to leak.
 */
export async function notify(
  conn: Conn,
  n: {
    tenantId: string;
    recipients: string[];
    householdId: string | null;
    kind: string;
    title: string;
    link: string;
    except?: string;
  },
) {
  const to = [...new Set(n.recipients)].filter((r) => r && r !== n.except);
  if (!to.length) return;
  await conn.insert(notifications).values(
    to.map((recipientActorId) => ({
      tenantId: n.tenantId,
      recipientActorId,
      householdId: n.householdId,
      kind: n.kind,
      title: n.title,
      link: n.link,
    })),
  );
}

/** Mark the actor's own unread notifications that point at a link as read (e.g. after acting on it). */
export async function markLinkRead(conn: Conn, tenantId: string, actorId: string, link: string) {
  await conn
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.recipientActorId, actorId),
        // A link may point at one item on the page ("/family/messages#entry-…").
        or(eq(notifications.link, link), like(notifications.link, `${link}#%`)),
        isNull(notifications.readAt),
      ),
    );
}

export async function onboardingState(conn: Conn, tenantId: string, householdId: string) {
  const rows = await conn
    .select()
    .from(onboardingSteps)
    .where(and(eq(onboardingSteps.tenantId, tenantId), eq(onboardingSteps.householdId, householdId)));
  const done = new Map(rows.map((r) => [r.step as OnboardingStep, r.completedAt]));
  const steps = ONBOARDING_STEPS.map((step) => ({
    step,
    done: done.has(step),
    completedAt: done.get(step) ?? null,
  }));
  return {
    steps,
    complete: steps.every((s) => s.done),
    next: steps.find((s) => !s.done)?.step ?? null,
    has: (s: OnboardingStep) => done.has(s),
  };
}

/** A consent past its expiry date is expired even if nobody has marked it so. */
export function effectiveConsentState(
  c: { state: string; expiresAt: Date; startsAt: Date },
  now = new Date(),
): ConsentState | "scheduled" {
  if (c.state === "active" && c.expiresAt.getTime() <= now.getTime()) return "expired";
  if (c.state === "active" && c.startsAt.getTime() > now.getTime()) return "scheduled";
  return c.state as ConsentState;
}

/**
 * Authority evidence is in conflict if it, or any other record of the same type for the same
 * household naming a different person, is in conflict.
 */
/**
 * One authority record with the state sharing should act on (see effectiveAuthorityState):
 * a different-person conflict, or an unresolved identity question, holds it.
 */
export async function effectiveAuthority(conn: Conn, tenantId: string, evidenceId: string) {
  const [ev] = await conn
    .select()
    .from(authorityEvidence)
    .where(and(eq(authorityEvidence.tenantId, tenantId), eq(authorityEvidence.id, evidenceId)));
  if (!ev) return null;
  const all = await householdEvidence(conn, tenantId, ev.householdId);
  return {
    ...ev,
    effectiveState: effectiveAuthorityState(ev, all),
    authorityType: ev.authorityType as AuthorityType,
  };
}

/** Can this person confirm a consent themselves right now? (patient while active, or an applicable authority holder) */
export async function grantorCanSelfConfirm(
  conn: Conn,
  tenantId: string,
  householdId: string,
  actorId: string | null,
) {
  if (!actorId) return false;
  const [h] = await conn
    .select({ lifecycle: households.lifecycleState })
    .from(households)
    .where(and(eq(households.tenantId, tenantId), eq(households.id, householdId)));
  if (!h) return false;
  const member = (await householdMembers(conn, tenantId, householdId)).find((m) => m.actorId === actorId);
  if (!member) return false;
  const auth = await activeAuthorityByActor(conn, tenantId, householdId);
  return canSelfConfirm({
    roles: member.roles,
    lifecycle: h.lifecycle as LifecycleState,
    activeAuthorityTypes: auth.get(actorId) ?? [],
  });
}

/** Where a consent is in its three-stage workflow, plus the confirmation of its current version (if any). */
/** The open correction request for a consent, if any (at most one, enforced by the database). */
export async function openCorrection(conn: Conn, tenantId: string, consentId: string) {
  const [r] = await conn
    .select()
    .from(consentCorrectionRequests)
    .where(
      and(
        eq(consentCorrectionRequests.tenantId, tenantId),
        eq(consentCorrectionRequests.consentId, consentId),
        eq(consentCorrectionRequests.status, "open"),
      ),
    );
  return r ?? null;
}

/** Whether this person can confirm in the app and, if not, why — for staff warnings and family copy. */
export async function grantorEligibility(
  conn: Conn,
  tenantId: string,
  householdId: string,
  actorId: string | null,
) {
  const [h] = await conn
    .select({ lifecycle: households.lifecycleState })
    .from(households)
    .where(and(eq(households.tenantId, tenantId), eq(households.id, householdId)));
  const member = actorId
    ? (await householdMembers(conn, tenantId, householdId)).find((m) => m.actorId === actorId)
    : undefined;
  const auth = actorId
    ? await activeAuthorityByActor(conn, tenantId, householdId)
    : new Map<string, AuthorityType[]>();
  const blocker = selfConfirmBlocker({
    member: !!member && !!h,
    roles: member?.roles ?? [],
    lifecycle: (h?.lifecycle ?? "closed") as LifecycleState,
    activeAuthorityTypes: (actorId && auth.get(actorId)) || [],
  });
  return { canConfirm: blocker === null, reason: blocker };
}

export async function consentWorkflow(conn: Conn, c: typeof consents.$inferSelect, now = new Date()) {
  const [confirmation] = await conn
    .select()
    .from(consentConfirmations)
    .where(
      and(
        eq(consentConfirmations.tenantId, c.tenantId),
        eq(consentConfirmations.consentId, c.id),
        eq(consentConfirmations.consentVersion, c.version),
      ),
    );
  const grantorCanConfirm = await grantorCanSelfConfirm(conn, c.tenantId, c.householdId, c.grantedByActorId);
  const stage = consentStage({
    state: c.state,
    version: c.version,
    activatedVersion: c.activatedVersion,
    confirmedVersion: confirmation ? confirmation.consentVersion : null,
    startsAt: c.startsAt,
    expiresAt: c.expiresAt,
    grantorCanConfirm,
    now,
  });
  const correction = await openCorrection(conn, c.tenantId, c.id);
  return {
    stage,
    confirmation: confirmation ?? null,
    grantorCanConfirm,
    /** An unresolved request to correct this consent; while it's open nothing can be shared under it. */
    correction,
    /** Confirmed and activated for this version, with no open correction: required for any release. */
    releasable: !!confirmation && c.state === "active" && c.activatedVersion === c.version && !correction,
  };
}

export async function actorNames(conn: Conn, tenantId: string, ids: (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await conn
    .select({ id: actors.id, name: actors.displayName })
    .from(actors)
    .where(and(eq(actors.tenantId, tenantId), inArray(actors.id, list)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export const firstName = (name: string) => name.split(" ")[0] ?? name;

/** Households → their active care guides' names. */
export async function careGuideNamesFor(conn: Conn, tenantId: string, householdIds: string[]) {
  const map = new Map<string, string[]>();
  if (!householdIds.length) return map;
  const rows = await conn
    .select({ householdId: memberships.householdId, name: actors.displayName })
    .from(memberships)
    .innerJoin(actors, and(eq(actors.id, memberships.actorId), eq(actors.tenantId, memberships.tenantId)))
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        inArray(memberships.householdId, householdIds),
        eq(memberships.roleCode, "care_guide"),
        eq(memberships.status, "active"),
        eq(actors.kind, "staff"),
      ),
    )
    .orderBy(actors.displayName);
  for (const r of rows) map.set(r.householdId!, [...(map.get(r.householdId!) ?? []), r.name]);
  return map;
}
