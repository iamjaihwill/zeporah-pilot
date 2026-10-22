/**
 * Household member administration by the household itself.
 *
 * Someone whose role can invite (the coordinator, or the patient) can change another member between
 * Family member and Proxy, or remove them from the household. Patient and coordinator roles, and
 * changing yourself, stay with the care team. A change is refused — calmly, with what to do instead
 * — while the person is named as giving consent on a live consent or is linked to an authority
 * record, so consent and authority never change as a side effect. Every change is audited; nothing
 * is deleted, and a removed person keeps their account (they can be invited back).
 */
import { and, eq, isNull, ne } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, familyScope, type ActorContext } from "../context";
import { careGuidesFor, consentWorkflow, householdMembers, notify } from "./common";
import { ROLE_LABELS, type HouseholdRole } from "@/domain/model";

/** Roles a household may manage itself. */
export const SELF_MANAGED_ROLES = ["family_member", "proxy"] as const;
type SelfManaged = (typeof SELF_MANAGED_ROLES)[number];
const NOT_FOUND = "That person isn't part of this household.";

/** Why this person's role can't change from the household side right now, or null. */
export async function memberChangeBlocker(
  conn: Conn,
  tenantId: string,
  householdId: string,
  actorId: string,
) {
  const consents = await conn
    .select()
    .from(s.consents)
    .where(
      and(
        eq(s.consents.tenantId, tenantId),
        eq(s.consents.householdId, householdId),
        eq(s.consents.grantedByActorId, actorId),
      ),
    );
  let live = 0;
  for (const c of consents) {
    const { stage } = await consentWorkflow(conn, c);
    if (stage !== "revoked" && stage !== "expired") live++;
  }
  if (live)
    return `${live === 1 ? "A sharing consent that's still open names them" : `${live} sharing consents that are still open name them`} as the person giving consent. Your care team can help with that first.`;
  const evidence = await conn
    .select({ id: s.authorityEvidence.id })
    .from(s.authorityEvidence)
    .where(
      and(
        eq(s.authorityEvidence.tenantId, tenantId),
        eq(s.authorityEvidence.householdId, householdId),
        eq(s.authorityEvidence.holderActorId, actorId),
        ne(s.authorityEvidence.state, "withdrawn"),
      ),
    );
  const links = await conn
    .select({ id: s.authorityIdentityLinks.id })
    .from(s.authorityIdentityLinks)
    .where(
      and(
        eq(s.authorityIdentityLinks.tenantId, tenantId),
        eq(s.authorityIdentityLinks.actorId, actorId),
        isNull(s.authorityIdentityLinks.supersededAt),
      ),
    );
  if (evidence.length || links.length)
    return "They're linked to an authority record. Your care team needs to review that first.";
  return null;
}

/** The member, if the caller may manage them; otherwise a calm refusal. */
async function manageable(conn: Conn, ctx: ActorContext, actorId: string) {
  const scope = await familyScope(conn, ctx, "people.invite");
  if (actorId === ctx.actorId)
    throw new AccessError("INVALID", "You can't change your own role here. Your care team can help.");
  const member = (await householdMembers(conn, ctx.tenantId, scope.householdId)).find(
    (m) => m.actorId === actorId,
  );
  if (!member) throw new AccessError("OUT_OF_SCOPE", NOT_FOUND);
  if (!member.roles.every((r) => (SELF_MANAGED_ROLES as readonly HouseholdRole[]).includes(r)))
    throw new AccessError("INVALID", "Only your care team can change the patient's or coordinator's role.");
  const blocker = await memberChangeBlocker(conn, ctx.tenantId, scope.householdId, actorId);
  if (blocker) throw new AccessError("INVALID", blocker);
  return { scope, member };
}

/** Change another member between Family member and Proxy. */
export async function changeMemberRole(
  db: DB,
  ctx: ActorContext,
  input: { actorId: string; role: SelfManaged },
) {
  if (!SELF_MANAGED_ROLES.includes(input.role))
    throw new AccessError("INVALID", "Choose Family member or Proxy.");
  const { scope, member } = await manageable(db, ctx, input.actorId);
  if (member.roles.length === 1 && member.roles[0] === input.role)
    throw new AccessError("INVALID", `${member.name} already has that role.`);
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(s.memberships)
      .set({ status: "ended", endedAt: now, endReason: "Role changed by the household" })
      .where(
        and(
          eq(s.memberships.tenantId, ctx.tenantId),
          eq(s.memberships.householdId, scope.householdId),
          eq(s.memberships.actorId, member.actorId),
          eq(s.memberships.status, "active"),
        ),
      );
    await tx.insert(s.memberships).values({
      tenantId: ctx.tenantId,
      actorId: member.actorId,
      householdId: scope.householdId,
      roleCode: input.role,
    });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "household.member_role_changed",
      subjectType: "actor",
      subjectId: member.actorId,
      summary: `${member.name}'s role is now ${ROLE_LABELS[input.role].toLowerCase()}.`,
      visibility: "family",
      context: { from: member.roles, to: input.role },
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: [member.actorId],
      kind: "people",
      title: "Your role in your household changed",
      link: "/family/people",
    });
  });
}

/** Remove another member from the household. Their open household tasks lose the assignee. */
export async function removeMember(db: DB, ctx: ActorContext, input: { actorId: string }) {
  const { scope, member } = await manageable(db, ctx, input.actorId);
  await db.transaction(async (tx) => {
    const now = new Date();
    const ended = await tx
      .update(s.memberships)
      .set({ status: "ended", endedAt: now, endReason: "Removed by the household" })
      .where(
        and(
          eq(s.memberships.tenantId, ctx.tenantId),
          eq(s.memberships.householdId, scope.householdId),
          eq(s.memberships.actorId, member.actorId),
          eq(s.memberships.status, "active"),
        ),
      )
      .returning({ id: s.memberships.id });
    if (!ended.length)
      throw new AccessError("CONFLICT", "This person was just removed. Refresh to see the household.");
    const tasks = await tx
      .update(s.tasks)
      .set({ assigneeActorId: null })
      .where(
        and(
          eq(s.tasks.tenantId, ctx.tenantId),
          eq(s.tasks.householdId, scope.householdId),
          eq(s.tasks.assigneeActorId, member.actorId),
          eq(s.tasks.status, "open"),
        ),
      )
      .returning({ id: s.tasks.id });
    for (const t of tasks)
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        actorId: ctx.actorId,
        action: "task.unassigned",
        subjectType: "task",
        subjectId: t.id,
        summary: `${member.name} is no longer assigned this task because they left the household.`,
        visibility: "family",
        context: { previousAssignee: member.actorId },
      });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "household.member_removed",
      subjectType: "actor",
      subjectId: member.actorId,
      summary: `${member.name} is no longer part of this household.`,
      visibility: "family",
      context: { roles: member.roles },
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: null,
      recipients: [member.actorId],
      kind: "people",
      title: "Your access to a household changed",
      link: "/family",
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: (await careGuidesFor(tx, ctx.tenantId, scope.householdId)).map((g) => g.actorId),
      kind: "people",
      title: "A household member's access changed",
      link: `/staff/households/${scope.householdId}?tab=overview`,
    });
  });
}
