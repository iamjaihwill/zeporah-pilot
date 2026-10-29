import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as reset from "@/server/services/password-reset";
import * as notices from "@/server/services/email-notices";
import { dispatchOutbox, enqueue, MAX_ATTEMPTS, RETRY_WAIT_MINUTES } from "@/server/services/outbox";
import { notify } from "@/server/services/common";
import { hashPassword } from "@/server/auth/crypto";
import type { MailChannel } from "@/server/mail";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";
import { NOTICE_BODY, NOTICE_LINK, NOTICE_SUBJECT } from "@/domain/email-wording";

/** The outbox (founder decisions 88–91), with synthetic people and the development mailbox only. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "1");
  t = await freshDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  return t.close();
});

/** 14:00 UTC is 10:00 in New York: outside the default 21:00–08:00 quiet hours. */
const DAYTIME = new Date("2026-10-13T14:00:00Z");
const NIGHT = new Date("2026-10-14T03:00:00Z");
const MIN = 60_000;
const failing: MailChannel = {
  name: "a channel that's down",
  send: async () => {
    throw new Error("connection refused (synthetic)");
  },
};

const mailbox = () => t.db.select().from(s.devMailbox);
const row = async (id: string) => (await t.db.select().from(s.outbox).where(eq(s.outbox.id, id)))[0]!;
const auditOf = (action: string) => t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, action));
const danielEmail = async () =>
  (await t.db.select().from(s.actors).where(eq(s.actors.id, "fm-daniel")))[0]!.email!;

/** One unread notification for Daniel, and email nudges turned on. */
async function unreadNotice() {
  await family.saveCommunication(t.db, await t.as("fm-daniel"), {
    notificationCadence: "as_it_happens",
    quietHoursStart: "21:00",
    quietHoursEnd: "08:00",
    emailNotices: true,
  });
  await notify(t.db, {
    tenantId: "t-willow",
    householdId: "hh-okafor",
    recipients: ["fm-daniel"],
    kind: "message",
    title: "There's a new message",
    link: "/family/messages",
  });
  const [n] = await t.db
    .select()
    .from(s.notifications)
    .where(and(eq(s.notifications.recipientActorId, "fm-daniel"), eq(s.notifications.kind, "message")));
  return n!.id;
}

/** A nudge for Daniel's notification, queued as the notice sender would. */
async function queueNotice(now = DAYTIME, extra: Partial<Parameters<typeof enqueue>[1]> = {}) {
  const id = await unreadNotice();
  return enqueue(
    t.db,
    {
      tenantId: "t-willow",
      householdId: "hh-okafor",
      kind: "notice",
      toActorId: "fm-daniel",
      toEmail: await danielEmail(),
      fromName: "Zeporah",
      subject: NOTICE_SUBJECT,
      body: NOTICE_BODY,
      link: NOTICE_LINK,
      about: { notificationIds: [id] },
      expiresAt: new Date(now.getTime() + 24 * 3_600_000),
      ...extra,
    },
    now,
  );
}

describe("decision 88: sent separately from the change it reports", () => {
  it("a failed send leaves the change in place and the email waiting", async () => {
    const notification = await unreadNotice();
    const email = await danielEmail();
    const id = await t.db.transaction(async (tx) => {
      await tx
        .update(s.households)
        .set({ displayName: "Changed (synthetic)" })
        .where(eq(s.households.id, "hh-okafor"));
      return enqueue(
        tx as never,
        {
          tenantId: "t-willow",
          householdId: "hh-okafor",
          kind: "notice",
          toActorId: "fm-daniel",
          toEmail: email,
          fromName: "Zeporah",
          subject: NOTICE_SUBJECT,
          body: NOTICE_BODY,
          link: NOTICE_LINK,
          about: { notificationIds: [notification] },
          expiresAt: new Date(DAYTIME.getTime() + 24 * 3_600_000),
        },
        DAYTIME,
      );
    });
    expect(await dispatchOutbox(t.db, { now: DAYTIME, channel: failing })).toBe(0);
    const [h] = await t.db.select().from(s.households).where(eq(s.households.id, "hh-okafor"));
    expect(h?.displayName).toBe("Changed (synthetic)");
    expect(await row(id)).toMatchObject({ state: "pending", attempts: 1 });
    expect((await row(id)).nextAttemptAt.getTime()).toBe(DAYTIME.getTime() + RETRY_WAIT_MINUTES[0] * MIN);
    expect(await mailbox()).toHaveLength(0);
  });

  it("sends each email once, even when two dispatchers run together, and clears its link", async () => {
    const id = await queueNotice();
    const [a, b] = await Promise.all([
      dispatchOutbox(t.db, { now: DAYTIME }),
      dispatchOutbox(t.db, { now: DAYTIME }),
    ]);
    expect(a + b).toBe(1);
    expect(await mailbox()).toHaveLength(1);
    expect(await row(id)).toMatchObject({ state: "sent", attempts: 1, link: null });
    expect(await dispatchOutbox(t.db, { now: DAYTIME })).toBe(0);
    expect(await mailbox()).toHaveLength(1);
  });

  it("the real senders queue first and send right after: a password reset", async () => {
    // An account whose email was proven by accepting an invitation (decision 27's rule).
    const email = await danielEmail();
    await t.db.insert(s.invitations).values({
      tenantId: "t-willow",
      householdId: "hh-okafor",
      invitedByActorId: "st-maya",
      inviteeName: "Daniel Okafor",
      inviteeContact: email,
      inviteeEmail: email,
      roleCode: "family_member",
      acceptedByActorId: "fm-daniel",
      status: "accepted",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await t.db.insert(s.users).values({
      tenantId: "t-willow",
      actorId: "fm-daniel",
      email,
      passwordHash: await hashPassword("synthetic-pass-phrase-1"),
    });
    await reset.requestPasswordReset(t.db, { email: await danielEmail() });
    const [o] = await t.db.select().from(s.outbox).where(eq(s.outbox.kind, "password_reset"));
    expect(o).toMatchObject({ state: "sent", link: null });
    const [m] = await mailbox();
    expect(m?.link).toMatch(/\/reset\/[A-Za-z0-9_-]+$/);
  });
});

describe("decision 89: at most 5 attempts over about 10 hours", () => {
  it("waits 5 min, 30 min, 2 h and 8 h, then fails for good", async () => {
    const id = await queueNotice(DAYTIME, { expiresAt: null });
    let at = DAYTIME;
    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      // Not due yet: nothing is tried early.
      if (n > 1) {
        await dispatchOutbox(t.db, { now: new Date(at.getTime() - MIN), channel: failing });
        expect((await row(id)).attempts).toBe(n - 1);
      }
      await dispatchOutbox(t.db, { now: at, channel: failing });
      expect((await row(id)).attempts).toBe(n);
      if (n < MAX_ATTEMPTS) at = new Date(at.getTime() + RETRY_WAIT_MINUTES[n - 1]! * MIN);
    }
    expect((at.getTime() - DAYTIME.getTime()) / 3_600_000).toBeCloseTo(10.58, 1);
    expect(await row(id)).toMatchObject({ state: "failed", attempts: 5, link: null });
    const [ev] = await auditOf("email.undelivered");
    expect(ev).toMatchObject({ visibility: "staff", householdId: "hh-okafor" });
    expect(ev!.summary).not.toContain(NOTICE_SUBJECT);
    // Decision 91: nothing tries another channel or address afterwards.
    await dispatchOutbox(t.db, { now: new Date(at.getTime() + 48 * 3_600_000) });
    expect(await mailbox()).toHaveLength(0);
  });

  it("drops an email whose time has passed", async () => {
    const id = await queueNotice(DAYTIME, { expiresAt: new Date(DAYTIME.getTime() + MIN) });
    await dispatchOutbox(t.db, { now: new Date(DAYTIME.getTime() + 2 * MIN) });
    expect(await row(id)).toMatchObject({ state: "dropped", reason: "Expired before it could be sent" });
  });
});

describe("decision 90: Email not delivered, for operations", () => {
  async function failOne() {
    const id = await queueNotice(DAYTIME, { expiresAt: null });
    await t.db
      .update(s.outbox)
      .set({ attempts: MAX_ATTEMPTS - 1 })
      .where(eq(s.outbox.id, id));
    await dispatchOutbox(t.db, { now: DAYTIME, channel: failing });
    return id;
  }

  it("names who and what kind, never the content, and operations can close it", async () => {
    const id = await failOne();
    const rows = await staff.coordinationQueue(t.db, await t.as("st-dana"));
    const r = rows.find((x) => x.kind === "undelivered" && x.subjectId === id)!;
    expect(r).toMatchObject({
      category: "undelivered",
      household: "The Okafor household",
      dismissable: true,
      claimable: true,
    });
    expect(r.summary).toBe("Daniel Okafor's email notice wasn't delivered");
    expect(JSON.stringify(r)).not.toContain(NOTICE_BODY);
    expect(JSON.stringify(r)).not.toContain(await danielEmail());
  });

  it("isn't shown to care guides", async () => {
    const id = await failOne();
    const rows = await staff.coordinationQueue(t.db, await t.as("st-maya"));
    expect(rows.some((x) => x.kind === "undelivered" && x.subjectId === id)).toBe(false);
  });
});

describe("decision 88: checks at send time", () => {
  it("drops a nudge that was read in the app, or whose email was turned off", async () => {
    const read = await queueNotice();
    await t.db.update(s.notifications).set({ readAt: DAYTIME });
    await dispatchOutbox(t.db, { now: DAYTIME });
    expect(await row(read)).toMatchObject({ state: "dropped", reason: "Already read in the app" });

    const off = await queueNotice();
    await t.db
      .update(s.preferences)
      .set({ emailNotices: false })
      .where(eq(s.preferences.actorId, "fm-daniel"));
    await dispatchOutbox(t.db, { now: DAYTIME });
    expect(await row(off)).toMatchObject({ state: "dropped", reason: "Email notices are turned off" });
    expect(await mailbox()).toHaveLength(0);
  });

  it("holds a nudge through quiet hours without counting an attempt", async () => {
    const id = await queueNotice(NIGHT);
    await dispatchOutbox(t.db, { now: NIGHT });
    expect(await row(id)).toMatchObject({ state: "pending", attempts: 0 });
    expect((await row(id)).nextAttemptAt.getTime()).toBeGreaterThan(NIGHT.getTime());
  });

  it("drops anything that isn't the fixed wording, or whose address changed", async () => {
    const wording = await queueNotice(DAYTIME, { body: "Daniel, Grace's medication changed (synthetic)." });
    await dispatchOutbox(t.db, { now: DAYTIME });
    expect(await row(wording)).toMatchObject({
      state: "dropped",
      reason: "Not the fixed wording for this kind of email",
    });
    const moved = await queueNotice(DAYTIME, { toEmail: "old.address@example.invalid" });
    await dispatchOutbox(t.db, { now: DAYTIME });
    expect(await row(moved)).toMatchObject({
      state: "dropped",
      reason: "The person's email address changed",
    });
    expect(await mailbox()).toHaveLength(0);
    // Dropped sends are recorded for staff, with the reason and never the content.
    const dropped = await auditOf("email.dropped");
    expect(dropped.length).toBe(2);
    expect(dropped.every((e) => e.visibility === "staff" && !e.summary.includes("medication"))).toBe(true);
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });

  it("the notice sender still sends right away when nothing stops it", async () => {
    await unreadNotice();
    expect(await notices.sendDueEmailNotices(t.db, DAYTIME)).toBe(1);
    const [o] = await t.db.select().from(s.outbox).where(eq(s.outbox.kind, "notice"));
    expect(o).toMatchObject({ state: "sent", toActorId: "fm-daniel" });
    expect(await mailbox()).toHaveLength(1);
  });
});
