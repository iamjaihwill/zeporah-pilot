/**
 * Accounts, password sign-in and invitation acceptance.
 *
 * Boundaries come only from stored records: an invitation fixes the tenant, the household or
 * organization, the role and the email that may accept it. The acceptance request carries just
 * the token, a display name and a password, so editing the request can't change what's granted.
 * Failures that could reveal whether an account or invitation exists all use one generic message.
 */
import { and, desc, eq, gt, ne } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, requireStaffPermission, type ActorContext } from "../context";
import { can } from "@/domain/permissions";
import { publicUrl } from "@/domain/addresses";
import { addresses } from "../environment";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  dummyPasswordHash,
  hashPassword,
  hashToken,
  looksLikeEmail,
  newToken,
  normalizeEmail,
  verifyPassword,
} from "../auth/crypto";
import { actorNames } from "./common";
import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from "@/domain/model";

export const SIGN_IN_FAILED = "That email and password didn't work. Check them and try again.";
/** Separate sign-in pages for the care team and for families (founder direction, 2026-10-20). */
export const STAFF_ON_FAMILY_PAGE = "This is a care-team account. Sign in on the care-team sign-in page.";
export const FAMILY_ON_STAFF_PAGE =
  "This page is for hospice staff. Family members, helpers and people a hospice shared a packet with sign in on the main sign-in page.";

export type SignInAudience = "family" | "staff";
export const INVITATION_UNUSABLE =
  "This invitation link can't be used. It may have expired, already been used, or been cancelled. Ask the person who invited you for a new link.";
export const INVITATION_DAYS = 7;
export { LOCK_AFTER_FAILURES, LOCK_MINUTES } from "@/domain/sign-in";
import { LOCK_AFTER_FAILURES, LOCK_MINUTES } from "@/domain/sign-in";

export const passwordProblem = (password: string) =>
  password.length < PASSWORD_MIN_LENGTH
    ? `Use at least ${PASSWORD_MIN_LENGTH} characters.`
    : password.length > PASSWORD_MAX_LENGTH
      ? "That password is too long."
      : null;

/* ------------------------------------------------------------------ sign-in */

/**
 * Checks an email and password. Every failure — unknown email, wrong password, temporarily locked
 * account — returns the same message and takes about the same time.
 */
export async function signInWithPassword(
  db: DB,
  input: { email: string; password: string; audience?: SignInAudience | undefined },
) {
  const email = normalizeEmail(input.email);
  const [u] = await db.select().from(s.users).where(eq(s.users.email, email));
  if (!u) {
    await verifyPassword(input.password, await dummyPasswordHash());
    throw new AccessError("INVALID", SIGN_IN_FAILED);
  }
  const now = new Date();
  if (u.lockedUntil && u.lockedUntil > now) {
    await verifyPassword(input.password, await dummyPasswordHash());
    throw new AccessError("INVALID", SIGN_IN_FAILED);
  }
  if (!(await verifyPassword(input.password, u.passwordHash))) {
    const failures = u.failedAttempts + 1;
    const lock = failures >= LOCK_AFTER_FAILURES;
    await db
      .update(s.users)
      .set({
        failedAttempts: lock ? 0 : failures,
        lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : u.lockedUntil,
      })
      .where(eq(s.users.id, u.id));
    await appendAudit(db, {
      tenantId: u.tenantId,
      actorId: u.actorId,
      action: lock ? "auth.locked" : "auth.sign_in_failed",
      subjectType: "user",
      subjectId: u.id,
      summary: lock
        ? `Sign-in was paused for ${LOCK_MINUTES} minutes after repeated failed attempts.`
        : "A sign-in attempt failed.",
      visibility: "staff",
    });
    throw new AccessError("INVALID", SIGN_IN_FAILED);
  }
  const [a] = await db
    .select({ kind: s.actors.kind, deactivatedAt: s.actors.deactivatedAt })
    .from(s.actors)
    .where(and(eq(s.actors.tenantId, u.tenantId), eq(s.actors.id, u.actorId)));
  // A deactivated account gets the same message as a wrong password.
  if (!a || a.deactivatedAt) throw new AccessError("INVALID", SIGN_IN_FAILED);
  // Each sign-in page takes its own kind of account. Only said after a correct password, so it
  // tells nobody anything they couldn't already know; no session starts.
  if (input.audience === "staff" && a.kind !== "staff")
    throw new AccessError("INVALID", FAMILY_ON_STAFF_PAGE);
  if (input.audience === "family" && a.kind === "staff")
    throw new AccessError("INVALID", STAFF_ON_FAMILY_PAGE);
  await db
    .update(s.users)
    .set({ failedAttempts: 0, lockedUntil: null, lastSignInAt: now })
    .where(eq(s.users.id, u.id));
  return { tenantId: u.tenantId, actorId: u.actorId, userId: u.id, kind: a!.kind };
}

/* ------------------------------------------------------------------ staff invitations */

function staffOrg(ctx: ActorContext) {
  requireStaffPermission(ctx, "staff.invite");
  if (!ctx.organizationId) throw new AccessError("NOT_PERMITTED", "Your role doesn't include this action.");
  return ctx.organizationId;
}

/** Invite a care-team member to this hospice in one staff role. Returns the one-time link path. */
export async function createStaffInvitation(
  db: DB,
  ctx: ActorContext,
  input: { name: string; email: string; role: StaffRole },
) {
  const org = staffOrg(ctx);
  const email = normalizeEmail(input.email);
  if (!input.name.trim()) throw new AccessError("INVALID", "Add their name.");
  if (!looksLikeEmail(email)) throw new AccessError("INVALID", "Enter an email address.");
  if (!STAFF_ROLES.includes(input.role)) throw new AccessError("INVALID", "Choose a care-team role.");
  // Decision 39: inviting someone into any role but care guide grants authority, so it's for administrators.
  if (input.role !== "care_guide" && !can(ctx.staffRoles, "staff.role.manage"))
    throw new AccessError("NOT_PERMITTED", "Only an administrator can invite someone into that role.");
  const token = newToken();
  await db.transaction(async (tx) => {
    const [inv] = await tx
      .insert(s.staffInvitations)
      .values({
        tenantId: ctx.tenantId,
        organizationId: org,
        invitedByActorId: ctx.actorId,
        inviteeName: input.name.trim(),
        inviteeEmail: email,
        roleCode: input.role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "invitation.created",
      subjectType: "staff_invitation",
      subjectId: inv!.id,
      summary: `A care-team invitation was created for the ${ROLE_LABELS[input.role].toLowerCase()} role.`,
      visibility: "staff",
      context: { role: input.role },
    });
  });
  // A care-team invitation opens on the care address, where staff sign in.
  return { acceptPath: `/invite/${token}`, acceptUrl: publicUrl(addresses(), `/invite/${token}`, "care") };
}

export async function listStaffInvitations(db: DB, ctx: ActorContext) {
  const org = staffOrg(ctx);
  const rows = await db
    .select()
    .from(s.staffInvitations)
    .where(and(eq(s.staffInvitations.tenantId, ctx.tenantId), eq(s.staffInvitations.organizationId, org)))
    .orderBy(desc(s.staffInvitations.createdAt));
  const names = await actorNames(
    db,
    ctx.tenantId,
    rows.map((r) => r.invitedByActorId),
  );
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    name: r.inviteeName,
    email: r.inviteeEmail,
    role: ROLE_LABELS[r.roleCode as StaffRole],
    status: r.status === "pending" && r.expiresAt.getTime() <= now ? ("expired" as const) : r.status,
    invitedBy: names.get(r.invitedByActorId) ?? "",
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  }));
}

export async function cancelStaffInvitation(db: DB, ctx: ActorContext, id: string) {
  const org = staffOrg(ctx);
  await db.transaction(async (tx) => {
    const done = await tx
      .update(s.staffInvitations)
      .set({ status: "cancelled", respondedAt: new Date() })
      .where(
        and(
          eq(s.staffInvitations.tenantId, ctx.tenantId),
          eq(s.staffInvitations.organizationId, org),
          eq(s.staffInvitations.id, id),
          eq(s.staffInvitations.status, "pending"),
        ),
      )
      .returning();
    if (!done.length) throw new AccessError("INVALID", "That invitation is no longer pending.");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "invitation.cancelled",
      subjectType: "staff_invitation",
      subjectId: id,
      summary: "A care-team invitation was cancelled.",
      visibility: "staff",
    });
  });
}

/* ------------------------------------------------------------------ acceptance */

type Found =
  | { kind: "staff"; row: typeof s.staffInvitations.$inferSelect }
  | { kind: "family"; row: typeof s.invitations.$inferSelect };

/** A pending, unexpired invitation for this token, or null — never a reason why not. */
async function findUsable(conn: Conn, token: string): Promise<Found | null> {
  if (!token || token.length > 200) return null;
  const h = hashToken(token);
  const now = new Date();
  const [st] = await conn
    .select()
    .from(s.staffInvitations)
    .where(
      and(
        eq(s.staffInvitations.tokenHash, h),
        eq(s.staffInvitations.status, "pending"),
        gt(s.staffInvitations.expiresAt, now),
      ),
    );
  if (st) return { kind: "staff", row: st };
  const [fm] = await conn
    .select()
    .from(s.invitations)
    .where(
      and(
        eq(s.invitations.tokenHash, h),
        eq(s.invitations.status, "pending"),
        gt(s.invitations.expiresAt, now),
      ),
    );
  return fm?.inviteeEmail ? { kind: "family", row: fm } : null;
}

/**
 * What the invitation page may show before acceptance: the hospice, the role, who invited them
 * and the email that will be used. The household's name isn't shown until they've joined.
 */
export async function previewInvitation(db: DB, token: string) {
  const f = await findUsable(db, token);
  if (!f) throw new AccessError("OUT_OF_SCOPE", INVITATION_UNUSABLE);
  const orgId =
    f.kind === "staff"
      ? f.row.organizationId
      : (
          await db
            .select({ org: s.households.organizationId })
            .from(s.households)
            .where(and(eq(s.households.tenantId, f.row.tenantId), eq(s.households.id, f.row.householdId)))
        )[0]?.org;
  const [o] = orgId
    ? await db
        .select({ name: s.organizations.name })
        .from(s.organizations)
        .where(and(eq(s.organizations.tenantId, f.row.tenantId), eq(s.organizations.id, orgId)))
    : [];
  const inviter =
    (await actorNames(db, f.row.tenantId, [f.row.invitedByActorId])).get(f.row.invitedByActorId) ?? "";
  const email = f.kind === "staff" ? f.row.inviteeEmail : f.row.inviteeEmail!;
  const [existing] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email));
  return {
    kind: f.kind,
    organization: o?.name ?? "your hospice",
    role: ROLE_LABELS[f.row.roleCode as keyof typeof ROLE_LABELS],
    invitedBy: inviter.split(" ")[0] ?? "",
    inviteeName: f.row.inviteeName,
    email,
    /** Whether to ask for the existing password (link) or a new one (create). */
    hasAccount: !!existing,
  };
}

/**
 * Accepts an invitation: creates an account (or links an existing one, after its password is
 * checked), adds exactly the membership the invitation names, and marks the invitation used.
 * Returns what's needed to start a session.
 */
export async function acceptInvitation(
  db: DB,
  input: { token: string; displayName: string; password: string },
) {
  const f = await findUsable(db, input.token);
  if (!f) throw new AccessError("OUT_OF_SCOPE", INVITATION_UNUSABLE);
  const tenantId = f.row.tenantId;
  const email = f.kind === "staff" ? f.row.inviteeEmail : f.row.inviteeEmail!;
  const role = f.row.roleCode;
  const actorKind: "staff" | "family" = f.kind === "staff" ? "staff" : "family";

  const [existing] = await db.select().from(s.users).where(eq(s.users.email, email));
  let link: { actorId: string; userId: string } | null = null;
  let newAccount: { name: string; hash: string } | null = null;
  if (existing) {
    // Linking: the existing account's own password must be given, under the usual lockout rules.
    try {
      await signInWithPassword(db, { email, password: input.password });
    } catch {
      throw new AccessError("INVALID", SIGN_IN_FAILED);
    }
    const [a] = await db
      .select()
      .from(s.actors)
      .where(and(eq(s.actors.tenantId, existing.tenantId), eq(s.actors.id, existing.actorId)));
    if (existing.tenantId !== tenantId || a?.kind !== actorKind)
      throw new AccessError(
        "CONFLICT",
        "This email already has a different kind of Zeporah account. Ask for an invitation to another email address.",
      );
    if (f.kind === "family") {
      const [other] = await db
        .select({ id: s.memberships.id })
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.tenantId, tenantId),
            eq(s.memberships.actorId, existing.actorId),
            eq(s.memberships.status, "active"),
            ne(s.memberships.householdId, f.row.householdId),
          ),
        );
      if (other)
        throw new AccessError(
          "CONFLICT",
          "In this pilot an account can belong to one household. Ask for an invitation to another email address.",
        );
    }
    link = { actorId: existing.actorId, userId: existing.id };
  } else {
    const name = input.displayName.trim();
    if (!name || name.length > 120)
      throw new AccessError("INVALID", "Add the name you'd like others to see.");
    const problem = passwordProblem(input.password);
    if (problem) throw new AccessError("INVALID", problem);
    // Hashing is slow on purpose, so it happens before the transaction.
    newAccount = { name, hash: await hashPassword(input.password) };
  }

  // Account (if new), invitation use and membership succeed or fail together.
  return db.transaction(async (tx) => {
    let actorId: string;
    let userId: string;
    if (link) ({ actorId, userId } = link);
    else {
      const [a] = await tx
        .insert(s.actors)
        .values({ tenantId, kind: actorKind, displayName: newAccount!.name, email })
        .returning();
      const [u] = await tx
        .insert(s.users)
        .values({ tenantId, actorId: a!.id, email, passwordHash: newAccount!.hash })
        .returning();
      actorId = a!.id;
      userId = u!.id;
    }
    // Use the invitation exactly once, even if two acceptances race.
    const now = new Date();
    const used =
      f.kind === "staff"
        ? await tx
            .update(s.staffInvitations)
            .set({ status: "accepted", respondedAt: now, acceptedByActorId: actorId })
            .where(and(eq(s.staffInvitations.id, f.row.id), eq(s.staffInvitations.status, "pending")))
            .returning({ id: s.staffInvitations.id })
        : await tx
            .update(s.invitations)
            .set({ status: "accepted", respondedAt: now, acceptedByActorId: actorId })
            .where(and(eq(s.invitations.id, f.row.id), eq(s.invitations.status, "pending")))
            .returning({ id: s.invitations.id });
    if (!used.length) throw new AccessError("OUT_OF_SCOPE", INVITATION_UNUSABLE);

    const scope =
      f.kind === "staff" ? { organizationId: f.row.organizationId } : { householdId: f.row.householdId };
    const [already] = await tx
      .select({ id: s.memberships.id })
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.tenantId, tenantId),
          eq(s.memberships.actorId, actorId),
          eq(s.memberships.roleCode, role),
          eq(s.memberships.status, "active"),
          f.kind === "staff"
            ? eq(s.memberships.organizationId, f.row.organizationId)
            : eq(s.memberships.householdId, f.row.householdId),
        ),
      );
    if (!already)
      await tx.insert(s.memberships).values({
        tenantId,
        actorId,
        roleCode: role,
        ...scope,
        // Helpers and collaborators (decision 42): the task and the end date the invitation stated.
        ...(f.kind === "family" ? { taskId: f.row.taskId, expiresAt: f.row.accessExpiresAt } : {}),
      });
    // A task-only helper is now the one doing the task.
    if (f.kind === "family" && f.row.accessModel === "task" && f.row.taskId)
      await tx
        .update(s.tasks)
        .set({ assigneeActorId: actorId, updatedAt: now })
        .where(
          and(
            eq(s.tasks.tenantId, tenantId),
            eq(s.tasks.id, f.row.taskId),
            eq(s.tasks.householdId, f.row.householdId),
            eq(s.tasks.status, "open"),
          ),
        );
    await appendAudit(tx, {
      tenantId,
      householdId: f.kind === "family" ? f.row.householdId : null,
      actorId,
      action: "invitation.accepted",
      subjectType: f.kind === "staff" ? "staff_invitation" : "invitation",
      subjectId: f.row.id,
      summary: `An invitation was accepted; the new member joined as ${ROLE_LABELS[role as keyof typeof ROLE_LABELS].toLowerCase()}.`,
      visibility: f.kind === "staff" ? "staff" : "family",
      context: { role, linkedExistingAccount: !!existing },
    });
    return { tenantId, actorId, userId, kind: actorKind };
  });
}
