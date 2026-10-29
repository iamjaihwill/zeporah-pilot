/**
 * The outbox (founder decisions 88–91; brief §14). Every outgoing email is written here in the same
 * transaction as the change it reports, and sent separately, so a failed send never undoes the
 * change (brief §12: "a failed external alert does not make the underlying message unsent").
 *
 * - **Checks at send time** (decision 88): fixed wording only; the person still has an account and
 *   the same address; still relevant (a nudge whose notifications were all read, a reset link
 *   already used or replaced, a recipient's access ended); their own settings (email turned off;
 *   quiet hours postpone without counting an attempt); not expired; sent at most once.
 * - **Bounded retries** (decision 89): at most 5 attempts, the first at once and then 5 minutes,
 *   30 minutes, 2 hours and 8 hours after the one before (about 10.5 hours in all). Then the row is
 *   failed, and operations sees "Email not delivered" (decision 90).
 * - **No switching** (decision 91): nothing here tries another address or another channel.
 *
 * The only channel is the development mailbox (../mail.ts), and only where development sign-in is
 * on. A link is cleared from the row once it's settled, because it may hold a one-time token.
 */
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { mailChannel, type MailChannel } from "../mail";
import { allowedWording, type EmailKind } from "@/domain/email-wording";
import { inQuietHours } from "@/domain/quiet-hours";

export const MAX_ATTEMPTS = 5;
/** Minutes to wait after attempts 1–4 before the next one (decision 89). */
export const RETRY_WAIT_MINUTES = [5, 30, 120, 480] as const;
/** How long a nudge or "password changed" email stays worth sending (decision 89). */
export const NOTICE_EXPIRY_MS = 24 * 3_600_000;
/** Quiet hours hold a nudge back this long at a time, without counting an attempt. */
const QUIET_RECHECK_MS = 15 * 60_000;

const MINUTE = 60_000;
export const KIND_LABELS: Record<EmailKind, string> = {
  notice: "email notice",
  password_reset: "password reset link",
  password_changed: "password-changed notice",
  recipient_alert: "packet sign-in alert",
  invitation: "invitation",
};

export type OutgoingEmail = {
  tenantId: string;
  householdId?: string | null | undefined;
  kind: EmailKind;
  toActorId: string;
  toEmail: string;
  fromName: string;
  subject: string;
  body: string;
  link: string;
  about?: (typeof s.outbox.$inferInsert)["about"];
  expiresAt?: Date | null | undefined;
};

/** Saves an email to send, inside the caller's transaction. Nothing is sent here. */
export async function enqueue(conn: Conn, email: OutgoingEmail, now = new Date()) {
  const [row] = await conn
    .insert(s.outbox)
    .values({
      tenantId: email.tenantId,
      householdId: email.householdId ?? null,
      kind: email.kind,
      toActorId: email.toActorId,
      toEmail: email.toEmail,
      fromName: email.fromName,
      subject: email.subject,
      body: email.body,
      link: email.link,
      about: email.about ?? null,
      nextAttemptAt: now,
      expiresAt: email.expiresAt ?? null,
      createdAt: now,
    })
    .returning({ id: s.outbox.id });
  return row!.id;
}

type Row = typeof s.outbox.$inferSelect;
type Verdict = { send: true } | { drop: string } | { later: Date };

/** Decision 88: may this email go now? A drop reason names the rule, never the content. */
async function check(conn: Conn, row: Row, now: Date): Promise<Verdict> {
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime())
    return { drop: "Expired before it could be sent" };
  if (!allowedWording(row.kind, row)) return { drop: "Not the fixed wording for this kind of email" };
  const [actor] = await conn
    .select({ email: s.actors.email, deactivatedAt: s.actors.deactivatedAt })
    .from(s.actors)
    .where(and(eq(s.actors.tenantId, row.tenantId), eq(s.actors.id, row.toActorId)));
  if (!actor || actor.deactivatedAt) return { drop: "The person no longer has an account" };
  if ((actor.email ?? "").toLowerCase() !== row.toEmail.toLowerCase())
    return { drop: "The person's email address changed" };

  if (row.kind === "notice") {
    const [p] = await conn
      .select()
      .from(s.preferences)
      .where(and(eq(s.preferences.tenantId, row.tenantId), eq(s.preferences.actorId, row.toActorId)));
    if (!p?.emailNotices) return { drop: "Email notices are turned off" };
    if (inQuietHours(p.quietHoursStart, p.quietHoursEnd, now))
      return { later: new Date(now.getTime() + QUIET_RECHECK_MS) };
    const ids = row.about?.notificationIds ?? [];
    const unread = ids.length
      ? await conn
          .select({ householdId: s.notifications.householdId })
          .from(s.notifications)
          .where(
            and(
              eq(s.notifications.tenantId, row.tenantId),
              inArray(s.notifications.id, ids),
              isNull(s.notifications.readAt),
            ),
          )
      : [];
    if (!unread.length) return { drop: "Already read in the app" };
    const households = new Set(
      (
        await conn
          .select({ id: s.memberships.householdId })
          .from(s.memberships)
          .where(
            and(
              eq(s.memberships.tenantId, row.tenantId),
              eq(s.memberships.actorId, row.toActorId),
              eq(s.memberships.status, "active"),
            ),
          )
      ).map((m) => m.id),
    );
    if (!unread.some((n) => !n.householdId || households.has(n.householdId)))
      return { drop: "The person no longer has access" };
  }
  if (row.kind === "password_reset") {
    const [r] = row.about?.resetId
      ? await conn.select().from(s.passwordResets).where(eq(s.passwordResets.id, row.about.resetId))
      : [];
    if (!r || r.usedAt || r.expiresAt.getTime() <= now.getTime())
      return { drop: "The reset link was used or replaced" };
  }
  if (row.kind === "recipient_alert") {
    const [a] = row.about?.accessId
      ? await conn
          .select()
          .from(s.packetRecipientAccess)
          .where(eq(s.packetRecipientAccess.id, row.about.accessId))
      : [];
    if (!a || a.revokedAt || a.expiresAt.getTime() <= now.getTime())
      return { drop: "The recipient's access ended" };
  }
  return { send: true };
}

async function settle(
  conn: Conn,
  row: Row,
  state: "dropped" | "failed",
  reason: string,
  attempts: number,
  now: Date,
) {
  await conn
    .update(s.outbox)
    .set({ state, reason, attempts, link: null, settledAt: now })
    .where(and(eq(s.outbox.id, row.id), eq(s.outbox.state, "pending")));
  await appendAudit(conn, {
    tenantId: row.tenantId,
    householdId: row.householdId,
    actorId: null,
    action: state === "failed" ? "email.undelivered" : "email.dropped",
    subjectType: "actor",
    subjectId: row.toActorId,
    summary:
      state === "failed"
        ? `A ${KIND_LABELS[row.kind]} couldn't be delivered after ${attempts} attempts.`
        : `A ${KIND_LABELS[row.kind]} wasn't sent: ${reason.toLowerCase()}.`,
    visibility: "staff",
    context: { outboxId: row.id, kind: row.kind, reason },
    at: now,
  });
}

/**
 * Send what's due. Safe to call often and from several places: a row is sent at most once. With
 * `ids`, only those rows (a sender trying its own email right after its change commits). Returns
 * how many were sent.
 */
export async function dispatchOutbox(
  db: DB,
  opts: { now?: Date; ids?: string[]; channel?: MailChannel | null } = {},
) {
  const now = opts.now ?? new Date();
  const channel = opts.channel === undefined ? mailChannel() : opts.channel;
  if (!channel) return 0;
  const due = await db
    .select()
    .from(s.outbox)
    .where(
      and(
        eq(s.outbox.state, "pending"),
        lte(s.outbox.nextAttemptAt, now),
        opts.ids ? inArray(s.outbox.id, opts.ids.length ? opts.ids : ["-"]) : undefined,
      ),
    )
    .orderBy(s.outbox.nextAttemptAt)
    .limit(50);
  let sent = 0;
  for (const row of due) {
    const verdict = await check(db, row, now);
    if ("drop" in verdict) {
      await db.transaction((tx) =>
        settle(tx as unknown as Conn, row, "dropped", verdict.drop, row.attempts, now),
      );
      continue;
    }
    if ("later" in verdict) {
      await db
        .update(s.outbox)
        .set({ nextAttemptAt: verdict.later })
        .where(and(eq(s.outbox.id, row.id), eq(s.outbox.state, "pending")));
      continue;
    }
    const attempt = row.attempts + 1;
    try {
      await db.transaction(async (tx) => {
        // Claim it first: if another dispatcher got there, this one sends nothing.
        const claimed = await tx
          .update(s.outbox)
          .set({ state: "sent", attempts: attempt, link: null, reason: null, settledAt: now })
          .where(
            and(eq(s.outbox.id, row.id), eq(s.outbox.state, "pending"), eq(s.outbox.attempts, row.attempts)),
          )
          .returning({ id: s.outbox.id });
        if (!claimed.length) throw new Claimed();
        await channel.send(tx, {
          tenantId: row.tenantId,
          fromName: row.fromName,
          to: row.toEmail,
          kind: row.kind,
          subject: row.subject,
          body: row.body,
          link: row.link!,
        });
      });
      sent++;
    } catch (e) {
      if (e instanceof Claimed) continue;
      // The send failed and its transaction rolled back; the change it reports is untouched.
      if (attempt >= MAX_ATTEMPTS)
        await db.transaction((tx) =>
          settle(tx as unknown as Conn, row, "failed", "Couldn't be delivered", attempt, now),
        );
      else
        await db
          .update(s.outbox)
          .set({
            attempts: attempt,
            reason: "Delivery failed; trying again",
            nextAttemptAt: new Date(now.getTime() + RETRY_WAIT_MINUTES[attempt - 1]! * MINUTE),
          })
          .where(and(eq(s.outbox.id, row.id), eq(s.outbox.state, "pending")));
    }
  }
  return sent;
}

class Claimed extends Error {}

/**
 * For a sender, right after its change commits: try its own emails now, so they don't wait for the
 * next tick. A failure here is already recorded on the row; the change has happened either way.
 */
export async function trySendingNow(db: DB, ids: (string | null | undefined)[], now = new Date()) {
  const mine = ids.filter((x): x is string => !!x);
  if (!mine.length) return;
  try {
    await dispatchOutbox(db, { ids: mine, now });
  } catch {
    // Left for the next tick: the row is still pending.
  }
}

/** Emails that couldn't be delivered, for the "Email not delivered" exception (decision 90). */
export async function undelivered(conn: Conn, tenantId: string) {
  return conn
    .select({
      id: s.outbox.id,
      householdId: s.outbox.householdId,
      kind: s.outbox.kind,
      toActorId: s.outbox.toActorId,
      attempts: s.outbox.attempts,
      settledAt: s.outbox.settledAt,
      createdAt: s.outbox.createdAt,
    })
    .from(s.outbox)
    .where(and(eq(s.outbox.tenantId, tenantId), eq(s.outbox.state, "failed")));
}
