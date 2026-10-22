/**
 * Email nudges about in-app notifications (founder decision 23).
 *
 * - Family members only, and only if they opted in (off by default).
 * - One generic email: no names, health details or message text — just "there's a new update",
 *   with a link to sign in. The in-app notification is unchanged and still carries the detail.
 * - Follows the person's own settings: nothing during their quiet hours; "A daily summary" sends
 *   at most one email a day; "Only essentials" sends only for essential notifications.
 * - Founder decision 47: only essential notifications email right away, even "as it happens";
 *   routine ones are left for the in-app list and at most one digest email a day.
 * - Only about households the person can still see (as in-app notifications).
 * - Uses the mail channel in ../mail.ts. Where there isn't one, this does nothing.
 */
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { mailChannel, senderNameFor } from "../mail";
import { newReference, reportError } from "../observability";
import { PILOT_DISPLAY } from "@/domain/display-config";
import { notify } from "./common";

export const NOTICE_SUBJECT = "You have a new update in Zeporah";
export const NOTICE_BODY =
  "There's something new for you in Zeporah. Sign in to see it. To keep things private, this email never includes names, health details or message text.";
export const NOTICE_LINK = "/family/notifications";

/**
 * Essential (founder decision 47): an action, access, safety or time-sensitive change someone could
 * miss by checking the app later — invitations and access or role changes ("people"), account and
 * security alerts, direct messages, consent requests and changes, authority reviews, packet release
 * and hold outcomes ("sharing", "packet"), tasks assigned to them and imminent deadlines, and
 * care-transition or bereavement milestones. Everything else — routine updates, activity, minor
 * task changes ("task_change"), staff assignment changes, onboarding and vault activity — is not.
 */
export const ESSENTIAL_KINDS = [
  "people",
  "account",
  "password_changed",
  "message",
  "consent",
  "consent_review",
  "consent_correction",
  "acknowledgement",
  "authority",
  "sharing",
  "packet",
  "task",
  "task_due",
  "lifecycle",
  "transition",
  "bereavement",
] as const;
export const isEssential = (kind: string) => (ESSENTIAL_KINDS as readonly string[]).includes(kind);

/** How far ahead an open task counts as an imminent deadline. */
export const DUE_SOON_MS = 24 * 3_600_000;

/**
 * "Imminent deadlines" (decision 47): one in-app notice to the assignee when an open household task
 * is due within a day, never twice for the same task. The notice is essential, so it can email.
 */
export async function remindDueTasks(db: DB, now = new Date()) {
  const rows = await db
    .select({ t: s.tasks })
    .from(s.tasks)
    .where(
      and(
        eq(s.tasks.audience, "family"),
        eq(s.tasks.status, "open"),
        isNotNull(s.tasks.assigneeActorId),
        isNotNull(s.tasks.dueAt),
      ),
    );
  let made = 0;
  for (const { t } of rows) {
    const due = t.dueAt!.getTime();
    if (due < now.getTime() || due - now.getTime() > DUE_SOON_MS) continue;
    const link = `/family/tasks#task-${t.id}`;
    const [already] = await db
      .select({ id: s.notifications.id })
      .from(s.notifications)
      .where(
        and(
          eq(s.notifications.tenantId, t.tenantId),
          eq(s.notifications.kind, "task_due"),
          eq(s.notifications.link, link),
        ),
      );
    if (already) continue;
    await notify(db, {
      tenantId: t.tenantId,
      householdId: t.householdId,
      recipients: [t.assigneeActorId!],
      kind: "task_due",
      title: "A task of yours is due soon",
      link: `/family/tasks#task-${t.id}`,
    });
    made++;
  }
  return made;
}

const DAY_MS = 86_400_000;

/** Minutes after midnight, in the pilot's display time zone. */
function localMinutes(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PILOT_DISPLAY.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return n("hour") * 60 + n("minute");
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Quiet hours may wrap past midnight (21:00–08:00). Equal start and end means none. */
export function inQuietHours(start: string, end: string, at: Date) {
  const a = toMinutes(start);
  const b = toMinutes(end);
  if (a === b) return false;
  const now = localMinutes(at);
  return a < b ? now >= a && now < b : now >= a || now < b;
}

/**
 * Send whatever nudges are due now. Safe to call often: each notification is covered at most once.
 * Returns how many emails went out.
 */
export async function sendDueEmailNotices(db: DB, now = new Date()) {
  await remindDueTasks(db, now);
  const channel = mailChannel();
  if (!channel) return 0;
  const people = await db
    .select({
      tenantId: s.preferences.tenantId,
      actorId: s.preferences.actorId,
      cadence: s.preferences.notificationCadence,
      quietStart: s.preferences.quietHoursStart,
      quietEnd: s.preferences.quietHoursEnd,
      last: s.preferences.lastEmailNoticeAt,
      email: s.actors.email,
    })
    .from(s.preferences)
    .innerJoin(
      s.actors,
      and(eq(s.actors.tenantId, s.preferences.tenantId), eq(s.actors.id, s.preferences.actorId)),
    )
    .where(
      and(eq(s.preferences.emailNotices, true), eq(s.actors.kind, "family"), isNull(s.actors.deactivatedAt)),
    );
  let sent = 0;
  for (const p of people) {
    if (!p.email || inQuietHours(p.quietStart, p.quietEnd, now)) continue;
    if (p.cadence === "daily_summary" && p.last && now.getTime() - p.last.getTime() < DAY_MS) continue;
    const households = (
      await db
        .select({ id: s.memberships.householdId })
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.tenantId, p.tenantId),
            eq(s.memberships.actorId, p.actorId),
            eq(s.memberships.status, "active"),
          ),
        )
    )
      .map((m) => m.id)
      .filter((x): x is string => !!x);
    const pending = await db
      .select({ id: s.notifications.id, kind: s.notifications.kind })
      .from(s.notifications)
      .where(
        and(
          eq(s.notifications.tenantId, p.tenantId),
          eq(s.notifications.recipientActorId, p.actorId),
          isNull(s.notifications.emailedAt),
          isNull(s.notifications.readAt),
          households.length
            ? or(isNull(s.notifications.householdId), inArray(s.notifications.householdId, households))
            : isNull(s.notifications.householdId),
          p.cadence === "essential_only" ? inArray(s.notifications.kind, [...ESSENTIAL_KINDS]) : undefined,
        ),
      );
    if (!pending.length) continue;
    // Decision 47: right away only for something essential; routine things at most once a day.
    if (
      p.cadence === "as_it_happens" &&
      !pending.some((n) => isEssential(n.kind)) &&
      p.last &&
      now.getTime() - p.last.getTime() < DAY_MS
    )
      continue;
    await db.transaction(async (tx) => {
      await channel.send(tx, {
        tenantId: p.tenantId,
        fromName: await senderNameFor(tx, p.tenantId),
        to: p.email,
        kind: "notice",
        subject: NOTICE_SUBJECT,
        body: NOTICE_BODY,
        link: NOTICE_LINK,
      });
      await tx
        .update(s.notifications)
        .set({ emailedAt: now })
        .where(
          and(
            eq(s.notifications.tenantId, p.tenantId),
            inArray(
              s.notifications.id,
              pending.map((n) => n.id),
            ),
          ),
        );
      await tx
        .update(s.preferences)
        .set({ lastEmailNoticeAt: now })
        .where(eq(s.preferences.actorId, p.actorId));
      await appendAudit(tx, {
        tenantId: p.tenantId,
        actorId: null,
        action: "notification.emailed",
        subjectType: "actor",
        subjectId: p.actorId,
        summary: "A generic email notice was sent (no names, health details or message text).",
        visibility: "staff",
        context: { channel: channel.name, covered: pending.length },
        at: now,
      });
    });
    sent++;
  }
  return sent;
}

/**
 * Turning email on doesn't send anything about notifications that already existed: they're marked
 * as covered, so the first email is about something new.
 */
export async function markExistingCovered(conn: Conn, tenantId: string, actorId: string, now = new Date()) {
  await conn
    .update(s.notifications)
    .set({ emailedAt: now })
    .where(
      and(
        eq(s.notifications.tenantId, tenantId),
        eq(s.notifications.recipientActorId, actorId),
        isNull(s.notifications.emailedAt),
      ),
    );
}

/**
 * In development, look for due nudges once a minute (the dev server's only background job). The
 * timer lives on globalThis so hot reloads never start a second one.
 */
const g = globalThis as { __zeporahNoticeTimer?: ReturnType<typeof setInterval> };
export function startEmailNoticeTimer(getDb: () => Promise<DB>) {
  // Test servers send due notices explicitly ("Send due email notices now"), never on a timer, so a
  // test can't race the minute tick.
  if (process.env["ZEPORAH_NOTICE_TIMER"] === "off") return;
  if (g.__zeporahNoticeTimer || !mailChannel()) return;
  g.__zeporahNoticeTimer = setInterval(() => {
    void getDb()
      .then((db) => sendDueEmailNotices(db))
      .catch((e) => reportError(e, newReference()));
  }, 60_000);
  g.__zeporahNoticeTimer.unref?.();
}
