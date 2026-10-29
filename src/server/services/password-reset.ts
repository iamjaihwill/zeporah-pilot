/**
 * Self-service password reset by email, for family accounts (founder decision 27, which reopens
 * decision 9 for them).
 *
 * - Family accounts only. Proxies and care-team accounts stay invite-only (decision 9's reason,
 *   conservative identity handling, still applies to them); their care team re-invites.
 * - A single-use link that expires after 30 minutes; only its hash is stored. Asking again
 *   replaces any earlier link.
 * - The same confirmation whether or not the email belongs to an account that can reset.
 * - Resetting signs the person out everywhere and clears any sign-in pause.
 * - Requests and resets are audit-logged (for accounts that exist).
 * - Only accounts whose email was proven by accepting an invitation sent to that exact address
 *   (decision 29e).
 * - After a reset, the account gets a "your password was changed" email and the household's care
 *   guides get an in-app notification naming no one (decision 29d).
 * - Needs a mail channel (../mail.ts). Where there isn't one, reset isn't offered.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError } from "../context";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  hashToken,
  newToken,
  normalizeEmail,
} from "../auth/crypto";
import { mailChannel, senderNameFor } from "../mail";
import { enqueue, NOTICE_EXPIRY_MS, trySendingNow } from "./outbox";
import { careGuidesFor, notify } from "./common";

export const RESET_MINUTES = 30;
/** Asking again within this window doesn't send another email (same confirmation either way). */
const RESEND_AFTER_MS = 60_000;

/** Shown after every request, whether or not an email went out. */
export const RESET_REQUESTED =
  "If that email belongs to a family account, we've sent it a link to reset the password. The link works once and expires in 30 minutes.";
export const RESET_UNUSABLE =
  "This reset link can't be used. It may have expired or already been used. Ask for a new one, or ask your care guide for a new invitation link.";
// The fixed wording, shared with the outbox's check (domain/email-wording.ts).
import { CHANGED_BODY, CHANGED_SUBJECT, RESET_BODY, RESET_SUBJECT } from "@/domain/email-wording";
export { CHANGED_BODY, CHANGED_SUBJECT, RESET_BODY, RESET_SUBJECT };

const passwordProblem = (password: string) =>
  password.length < PASSWORD_MIN_LENGTH
    ? `Use at least ${PASSWORD_MIN_LENGTH} characters.`
    : password.length > PASSWORD_MAX_LENGTH
      ? "That password is too long."
      : null;

export const passwordResetAvailable = () => mailChannel() !== null;

/**
 * May this account reset by email? A family account with at least one active household role, no
 * active proxy role, and an email proven by accepting an invitation sent to that exact address.
 * Staff, proxies and deactivated accounts can't.
 */
async function eligible(conn: Conn, user: typeof s.users.$inferSelect) {
  const [a] = await conn
    .select({ kind: s.actors.kind, deactivatedAt: s.actors.deactivatedAt })
    .from(s.actors)
    .where(and(eq(s.actors.tenantId, user.tenantId), eq(s.actors.id, user.actorId)));
  if (!a || a.kind !== "family" || a.deactivatedAt) return false;
  const roles = await conn
    .select({ role: s.memberships.roleCode })
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.tenantId, user.tenantId),
        eq(s.memberships.actorId, user.actorId),
        eq(s.memberships.status, "active"),
      ),
    );
  if (!roles.length || roles.some((r) => r.role === "proxy")) return false;
  const [proven] = await conn
    .select({ id: s.invitations.id })
    .from(s.invitations)
    .where(
      and(
        eq(s.invitations.tenantId, user.tenantId),
        eq(s.invitations.acceptedByActorId, user.actorId),
        eq(s.invitations.status, "accepted"),
        eq(s.invitations.inviteeEmail, user.email),
      ),
    )
    .limit(1);
  return !!proven;
}

/** Always resolves the same way; whether an email was sent is never revealed. */
export async function requestPasswordReset(db: DB, input: { email: string }, now = new Date()) {
  const channel = mailChannel();
  if (!channel) throw new AccessError("NOT_PERMITTED", "Password reset by email isn't available here.");
  const email = normalizeEmail(input.email);
  const token = newToken();
  const tokenHash = hashToken(token);
  const [u] = email.length <= 254 ? await db.select().from(s.users).where(eq(s.users.email, email)) : [];
  if (!u || !(await eligible(db, u))) return { message: RESET_REQUESTED };
  const [recent] = await db
    .select({ id: s.passwordResets.id })
    .from(s.passwordResets)
    .where(
      and(
        eq(s.passwordResets.userId, u.id),
        isNull(s.passwordResets.usedAt),
        gt(s.passwordResets.createdAt, new Date(now.getTime() - RESEND_AFTER_MS)),
      ),
    );
  if (recent) return { message: RESET_REQUESTED };
  const queued = await db.transaction(async (tx) => {
    // Only the newest link works.
    await tx
      .update(s.passwordResets)
      .set({ expiresAt: now })
      .where(and(eq(s.passwordResets.userId, u.id), isNull(s.passwordResets.usedAt)));
    const [r] = await tx
      .insert(s.passwordResets)
      .values({
        tenantId: u.tenantId,
        userId: u.id,
        tokenHash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + RESET_MINUTES * 60_000),
      })
      .returning({ id: s.passwordResets.id });
    // Decision 88: saved with the reset; the dispatcher sends it, and only while the link works.
    const id = await enqueue(
      tx,
      {
        tenantId: u.tenantId,
        householdId: await firstHousehold(tx, u.tenantId, u.actorId),
        kind: "password_reset",
        toActorId: u.actorId,
        toEmail: u.email,
        fromName: await senderNameFor(tx, u.tenantId),
        subject: RESET_SUBJECT,
        body: RESET_BODY,
        link: `/reset/${token}`,
        about: { resetId: r!.id },
        expiresAt: new Date(now.getTime() + RESET_MINUTES * 60_000),
      },
      now,
    );
    await appendAudit(tx, {
      tenantId: u.tenantId,
      actorId: u.actorId,
      action: "auth.reset_requested",
      subjectType: "user",
      subjectId: u.id,
      summary: `A password reset link was emailed. It expires in ${RESET_MINUTES} minutes.`,
      visibility: "staff",
      context: { resetId: r!.id, channel: channel.name },
      at: now,
    });
    return id;
  });
  await trySendingNow(db, [queued], now);
  return { message: RESET_REQUESTED };
}

/** The household an account's email is about, for the "Email not delivered" exception. */
async function firstHousehold(conn: Conn, tenantId: string, actorId: string) {
  const [m] = await conn
    .select({ id: s.memberships.householdId })
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.tenantId, tenantId),
        eq(s.memberships.actorId, actorId),
        eq(s.memberships.status, "active"),
      ),
    )
    .limit(1);
  return m?.id ?? null;
}

async function findUsable(conn: Conn, token: string, now: Date) {
  if (!token || token.length > 200) return null;
  const [r] = await conn
    .select()
    .from(s.passwordResets)
    .where(
      and(
        eq(s.passwordResets.tokenHash, hashToken(token)),
        isNull(s.passwordResets.usedAt),
        gt(s.passwordResets.expiresAt, now),
      ),
    );
  if (!r) return null;
  const [u] = await conn.select().from(s.users).where(eq(s.users.id, r.userId));
  return u && (await eligible(conn, u)) ? { reset: r, user: u } : null;
}

/** Whether a reset link can still be used (the page checks before asking for a password). */
export async function checkResetLink(db: DB, token: string, now = new Date()) {
  if (!(await findUsable(db, token, now))) throw new AccessError("OUT_OF_SCOPE", RESET_UNUSABLE);
  return { ok: true as const };
}

/** Set a new password from a reset link. Uses the link, and signs the person out everywhere. */
export async function completePasswordReset(
  db: DB,
  input: { token: string; password: string },
  now = new Date(),
) {
  if (!passwordResetAvailable())
    throw new AccessError("NOT_PERMITTED", "Password reset by email isn't available here.");
  const found = await findUsable(db, input.token, now);
  if (!found) throw new AccessError("OUT_OF_SCOPE", RESET_UNUSABLE);
  const problem = passwordProblem(input.password);
  if (problem) throw new AccessError("INVALID", problem);
  const hash = await hashPassword(input.password);
  const { reset, user } = found;
  const queued = await db.transaction(async (tx) => {
    // Use the link exactly once, even if two requests race.
    const used = await tx
      .update(s.passwordResets)
      .set({ usedAt: now })
      .where(and(eq(s.passwordResets.id, reset.id), isNull(s.passwordResets.usedAt)))
      .returning({ id: s.passwordResets.id });
    if (!used.length) throw new AccessError("OUT_OF_SCOPE", RESET_UNUSABLE);
    await tx
      .update(s.passwordResets)
      .set({ expiresAt: now })
      .where(and(eq(s.passwordResets.userId, user.id), isNull(s.passwordResets.usedAt)));
    await tx
      .update(s.users)
      .set({ passwordHash: hash, failedAttempts: 0, lockedUntil: null })
      .where(eq(s.users.id, user.id));
    const ended = await tx
      .delete(s.sessions)
      .where(and(eq(s.sessions.tenantId, user.tenantId), eq(s.sessions.actorId, user.actorId)))
      .returning({ id: s.sessions.id });
    await appendAudit(tx, {
      tenantId: user.tenantId,
      actorId: user.actorId,
      action: "auth.password_reset",
      subjectType: "user",
      subjectId: user.id,
      summary: "The password was reset with an email link. Every signed-in session was signed out.",
      visibility: "staff",
      context: { resetId: reset.id, sessionsEnded: ended.length },
      at: now,
    });
    // Decision 29d: tell the account, and the household's care guides (without naming anyone).
    const id = await enqueue(
      tx,
      {
        tenantId: user.tenantId,
        householdId: await firstHousehold(tx, user.tenantId, user.actorId),
        kind: "password_changed",
        toActorId: user.actorId,
        toEmail: user.email,
        fromName: await senderNameFor(tx, user.tenantId),
        subject: CHANGED_SUBJECT,
        body: CHANGED_BODY,
        link: "/",
        expiresAt: new Date(now.getTime() + NOTICE_EXPIRY_MS),
      },
      now,
    );
    const households = await tx
      .select({ id: s.memberships.householdId })
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.tenantId, user.tenantId),
          eq(s.memberships.actorId, user.actorId),
          eq(s.memberships.status, "active"),
        ),
      );
    for (const h of households) {
      if (!h.id) continue;
      const guides = await careGuidesFor(tx, user.tenantId, h.id);
      await notify(tx, {
        tenantId: user.tenantId,
        householdId: h.id,
        recipients: guides.map((g) => g.actorId),
        kind: "account",
        title: "A household member's password was reset",
        link: `/staff/households/${h.id}?tab=overview`,
      });
    }
    return id;
  });
  await trySendingNow(db, [queued], now);
  return { ok: true as const };
}
