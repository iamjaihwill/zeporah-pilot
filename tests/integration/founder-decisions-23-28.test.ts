import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as settings from "@/server/services/settings";
import * as auth from "@/server/services/auth";
import * as reset from "@/server/services/password-reset";
import * as audit from "@/server/services/audit-review";
import * as notices from "@/server/services/email-notices";
import * as s from "@/server/db/schema";
import { hashPassword } from "@/server/auth/crypto";
import { actorForToken, createSession } from "@/server/session";
import { notify } from "@/server/services/common";
import { verifyAuditChain } from "@/server/audit";

/** Founder decisions 23–28 and the corrections in decision 29 (2026-10-13). */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  // The development mail sink exists only where development sign-in is on.
  vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "1");
  t = await freshDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  return t.close();
});

const mailbox = () => t.db.select().from(s.devMailbox);
const auditOf = (action: string) => t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, action));
/** 14:00 UTC is 10:00 in New York: outside the default 21:00–08:00 quiet hours. */
const DAYTIME = new Date("2026-10-13T14:00:00Z");
const NIGHT = new Date("2026-10-14T03:00:00Z"); // 23:00 in New York

async function ping(actorId: string, kind = "message") {
  await notify(t.db, {
    tenantId: "t-willow",
    householdId: "hh-okafor",
    recipients: [actorId],
    kind,
    title: "There's a new message",
    link: "/family/messages",
  });
}
async function optIn(actorId: string, cadence: "as_it_happens" | "daily_summary" | "essential_only") {
  await family.saveCommunication(t.db, await t.as(actorId), {
    notificationCadence: cadence,
    quietHoursStart: "21:00",
    quietHoursEnd: "08:00",
    emailNotices: true,
  });
}

describe("decision 23: opt-in email nudges", () => {
  it("is off by default and sends nothing until the person opts in", async () => {
    const [p] = await t.db.select().from(s.preferences).where(eq(s.preferences.actorId, "fm-daniel"));
    expect(p?.emailNotices ?? false).toBe(false);
    await ping("fm-daniel");
    expect(await notices.sendDueEmailNotices(t.db, DAYTIME)).toBe(0);
    expect(await mailbox()).toHaveLength(0);
  });

  it("sends one generic email with no names, health details or message text", async () => {
    await optIn("fm-daniel", "as_it_happens");
    // Turning it on doesn't email about what was already there.
    expect(await notices.sendDueEmailNotices(t.db, DAYTIME)).toBe(0);
    await ping("fm-daniel");
    await ping("fm-daniel", "task");
    expect(await notices.sendDueEmailNotices(t.db, DAYTIME)).toBe(1);
    const [m] = await mailbox();
    expect(m).toMatchObject({
      toEmail: "fm-daniel@example.invalid",
      subject: notices.NOTICE_SUBJECT,
      body: notices.NOTICE_BODY,
      link: "/family/notifications",
    });
    for (const banned of ["Daniel", "Okafor", "Grace", "Maya", "message thread", "visit"])
      expect(`${m!.subject} ${m!.body} ${m!.link}`).not.toContain(banned);
    // Each notification is covered once.
    expect(await notices.sendDueEmailNotices(t.db, DAYTIME)).toBe(0);
    expect((await auditOf("notification.emailed")).length).toBe(1);
  });

  it("waits through quiet hours", async () => {
    await optIn("fm-daniel", "as_it_happens");
    await ping("fm-daniel");
    expect(await notices.sendDueEmailNotices(t.db, NIGHT)).toBe(0);
    expect(await notices.sendDueEmailNotices(t.db, DAYTIME)).toBe(1);
  });

  it("sends at most one a day on the daily summary", async () => {
    await optIn("fm-daniel", "daily_summary");
    await ping("fm-daniel");
    expect(await notices.sendDueEmailNotices(t.db, DAYTIME)).toBe(1);
    await ping("fm-daniel");
    expect(await notices.sendDueEmailNotices(t.db, new Date(DAYTIME.getTime() + 3_600_000))).toBe(0);
    expect(await notices.sendDueEmailNotices(t.db, new Date(DAYTIME.getTime() + 86_400_000))).toBe(1);
  });

  it("sends only for essential things under 'Only essentials' (decision 47)", async () => {
    await optIn("fm-daniel", "essential_only");
    for (const kind of ["update", "task_change", "vault", "onboarding", "staff_assignment"]) await ping("fm-daniel", kind);
    expect(await notices.sendDueEmailNotices(t.db, DAYTIME)).toBe(0);
    await ping("fm-daniel", "message");
    expect(await notices.sendDueEmailNotices(t.db, DAYTIME)).toBe(1);
  });

  it("emails right away only for essentials; routine things at most once a day (decision 47)", async () => {
    await optIn("fm-daniel", "as_it_happens");
    await ping("fm-daniel", "update");
    expect(await notices.sendDueEmailNotices(t.db, DAYTIME)).toBe(1); // the first digest
    await ping("fm-daniel", "update");
    const later = new Date(DAYTIME.getTime() + 3_600_000);
    expect(await notices.sendDueEmailNotices(t.db, later)).toBe(0); // routine: waits for tomorrow
    await ping("fm-daniel", "consent");
    expect(await notices.sendDueEmailNotices(t.db, later)).toBe(1); // essential: right away
  });

  it("reminds an assignee once when their task is due within a day (decision 47)", async () => {
    await t.db
      .update(s.tasks)
      .set({ dueAt: new Date(DAYTIME.getTime() + 6 * 3_600_000) })
      .where(eq(s.tasks.id, "tk-2"));
    expect(await notices.remindDueTasks(t.db, DAYTIME)).toBe(1);
    expect(await notices.remindDueTasks(t.db, DAYTIME)).toBe(0);
    const [n] = await t.db.select().from(s.notifications).where(eq(s.notifications.kind, "task_due"));
    expect(n).toMatchObject({ recipientActorId: "fm-chidi", title: "A task of yours is due soon" });
    expect(notices.isEssential("task_due")).toBe(true);
  });

  it("isn't offered, and can't be turned on, where there's no mail channel", async () => {
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "0");
    const daniel = await t.as("fm-daniel");
    expect((await family.getOnboarding(t.db, daniel)).email).toBeNull();
    await expect(optIn("fm-daniel", "as_it_happens")).rejects.toThrow(/aren't available/);
    expect(await notices.sendDueEmailNotices(t.db, DAYTIME)).toBe(0);
  });

  it("quiet hours wrap past midnight", () => {
    expect(notices.inQuietHours("21:00", "08:00", NIGHT)).toBe(true);
    expect(notices.inQuietHours("21:00", "08:00", DAYTIME)).toBe(false);
    expect(notices.inQuietHours("08:00", "08:00", NIGHT)).toBe(false);
  });
});

describe("decision 24: expected reply time", () => {
  it("operations are told until their hospice sets one (decision 29b)", async () => {
    expect((await staff.staffHome(t.db, await t.as("cst-jordan", "t-cedar"))).replyTimeMissing).toBe(true);
    expect((await staff.staffHome(t.db, await t.as("st-dana"))).replyTimeMissing).toBe(false);
    // Only people who can change hospice settings see it.
    expect((await staff.staffHome(t.db, await t.as("st-maya"))).replyTimeMissing).toBe(false);
  });

  it("is seeded for Willow Creek, unset for Cedar Valley, and required when wording is on", async () => {
    expect((await family.getThread(t.db, await t.as("fm-daniel"))).expectation?.replyTime).toBe(
      "within 1 business day",
    );
    expect((await family.getThread(t.db, await t.as("cfm-ben", "t-cedar"))).expectation).toBeNull();
    await expect(
      settings.setMessageExpectation(t.db, await t.as("st-dana"), {
        enabled: true,
        expectation: "Routine messages are read on weekdays (synthetic).",
        handlingHours: "",
        fallback: "",
        replyTime: " ",
      }),
    ).rejects.toThrow(/expected reply time/);
  });
});

describe("decision 25: completing someone else's task", () => {
  const chidiTask = "tk-2"; // assigned to Chidi
  const danielTask = "tk-1"; // assigned to Daniel

  it("the coordinator can, and it's recorded as done for the assignee, who is told", async () => {
    await family.completeFamilyTask(t.db, await t.as("fm-daniel"), chidiTask);
    const [ev] = (await auditOf("task.completed")).filter((e) => e.subjectId === chidiTask);
    expect(ev!.summary).toBe("Marked done by Daniel for Chidi: “Pick up the equipment return form”.");
    const told = await t.db
      .select()
      .from(s.notifications)
      .where(and(eq(s.notifications.recipientActorId, "fm-chidi"), eq(s.notifications.kind, "task_change")));
    expect(told.some((n) => n.title === "Someone marked one of your tasks done")).toBe(true);
    const chidiView = await family.listFamilyTasks(t.db, await t.as("fm-chidi"));
    expect(chidiView.find((x) => x.id === chidiTask)?.done).toMatchObject({
      by: "Daniel Okafor",
      for: "Chidi Okafor",
    });
  });

  it("the patient can mark someone else's task (decision 29c)", async () => {
    const grace = await t.as("fm-grace");
    expect((await family.listFamilyTasks(t.db, grace)).find((x) => x.id === danielTask)?.canComplete).toBe(
      true,
    );
    await family.completeFamilyTask(t.db, grace, danielTask);
    const [ev] = (await auditOf("task.completed")).filter((e) => e.subjectId === danielTask);
    expect(ev!.summary).toBe("Marked done by Grace for Daniel: “Confirm which visit times work this week”.");
  });

  it("proxies and other family members can't mark someone else's task", async () => {
    for (const who of ["fm-ada", "fm-chidi"]) {
      const ctx = await t.as(who);
      const row = (await family.listFamilyTasks(t.db, ctx)).find((x) => x.id === danielTask);
      if (row) expect(row.canComplete).toBe(false);
      await expect(family.completeFamilyTask(t.db, ctx, danielTask)).rejects.toThrow();
    }
  });

  it("the assignee can mark their own", async () => {
    await family.completeFamilyTask(t.db, await t.as("fm-chidi"), chidiTask);
    const [ev] = (await auditOf("task.completed")).filter((e) => e.subjectId === chidiTask);
    expect(ev!.summary).toBe("Chidi finished “Pick up the equipment return form”.");
  });

  it("the household's care guide can, from the staff side; operations and others' guides can't", async () => {
    await expect(staff.completeStaffTask(t.db, await t.as("st-dana"), danielTask)).rejects.toThrow(
      /care guide/,
    );
    const overview = await staff.householdOverview(t.db, await t.as("st-maya"), "hh-okafor");
    expect(overview.tasks.find((x) => x.id === danielTask)?.canMarkDone).toBe(true);
    await staff.completeStaffTask(t.db, await t.as("st-maya"), danielTask);
    const [ev] = (await auditOf("task.completed")).filter((e) => e.subjectId === danielTask);
    expect(ev!.summary).toBe("Marked done by Maya for Daniel: “Confirm which visit times work this week”.");
    expect(ev!.visibility).toBe("family");
  });
});

describe("decision 27: family password reset by email", () => {
  /** An account as an accepted invitation would leave it (`proven` = the invitation went to this email). */
  async function account(actorId: string, proven = true) {
    const [a] = await t.db.select().from(s.actors).where(eq(s.actors.id, actorId));
    const [m] = await t.db.select().from(s.memberships).where(eq(s.memberships.actorId, actorId));
    if (m?.householdId)
      await t.db.insert(s.invitations).values({
        tenantId: a!.tenantId,
        householdId: m.householdId,
        invitedByActorId: "st-maya",
        inviteeName: a!.displayName,
        inviteeContact: a!.email,
        inviteeEmail: proven ? a!.email : "an-earlier-address@example.invalid",
        // Households invite family members; a later role change doesn't change the proven email.
        roleCode: "family_member",
        acceptedByActorId: actorId,
        status: "accepted",
        expiresAt: new Date(Date.now() + 86_400_000),
      });
    const [u] = await t.db
      .insert(s.users)
      .values({
        tenantId: a!.tenantId,
        actorId,
        email: a!.email,
        passwordHash: await hashPassword("old-synthetic-pass-1"),
      })
      .returning();
    return u!;
  }
  const linkToken = async () => {
    const mail = (await mailbox()).filter((m) => m.kind === "password_reset");
    return mail.at(-1)?.link.replace("/reset/", "") ?? null;
  };

  it("emails a single-use link, signs out every session, and audit-logs both steps", async () => {
    const u = await account("fm-daniel");
    const session = await createSession(t.db, {
      tenantId: u.tenantId,
      actorId: u.actorId,
      userId: u.id,
      method: "password",
    });
    expect(await actorForToken(t.db, session)).not.toBeNull();
    const r = await reset.requestPasswordReset(t.db, { email: "FM-DANIEL@example.invalid " });
    expect(r.message).toBe(reset.RESET_REQUESTED);
    const token = await linkToken();
    expect(token).toBeTruthy();
    const [row] = await t.db.select().from(s.passwordResets);
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(30 * 60_000);

    await reset.completePasswordReset(t.db, { token: token!, password: "new-synthetic-pass-2" });
    expect(await actorForToken(t.db, session)).toBeNull();
    await expect(
      auth.signInWithPassword(t.db, { email: u.email, password: "new-synthetic-pass-2" }),
    ).resolves.toBeTruthy();
    // Used once only.
    await expect(
      reset.completePasswordReset(t.db, { token: token!, password: "another-synthetic-3" }),
    ).rejects.toThrow(reset.RESET_UNUSABLE);
    expect(await auditOf("auth.reset_requested")).toHaveLength(1);
    const [done] = await auditOf("auth.password_reset");
    expect(done!.context).toMatchObject({ sessionsEnded: 1 });
    // Decision 29d: the account is told, and the care guide is told without anyone being named.
    const changed = (await mailbox()).filter((m) => m.kind === "password_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      toEmail: u.email,
      subject: reset.CHANGED_SUBJECT,
      body: reset.CHANGED_BODY,
    });
    const [guideNote] = await t.db
      .select()
      .from(s.notifications)
      .where(and(eq(s.notifications.recipientActorId, "st-maya"), eq(s.notifications.kind, "account")));
    expect(guideNote!.title).toBe("A household member's password was reset");
    expect(guideNote!.link).toBe("/staff/households/hh-okafor?tab=overview");
    expect((await verifyAuditChain(t.db, u.tenantId)).ok).toBe(true);
  });

  it("gives the same answer for unknown emails, proxies and staff, and sends them nothing", async () => {
    await account("fm-ada"); // proxy
    await account("st-maya"); // care team
    for (const email of ["nobody@example.invalid", "fm-ada@example.invalid", "st-maya@example.invalid"])
      expect((await reset.requestPasswordReset(t.db, { email })).message).toBe(reset.RESET_REQUESTED);
    expect(await mailbox()).toHaveLength(0);
    expect(await t.db.select().from(s.passwordResets)).toHaveLength(0);
  });

  it("only works for an email proven by an accepted invitation (decision 29e)", async () => {
    await account("fm-daniel", false);
    expect((await reset.requestPasswordReset(t.db, { email: "fm-daniel@example.invalid" })).message).toBe(
      reset.RESET_REQUESTED,
    );
    expect(await mailbox()).toHaveLength(0);
  });

  it("expires after 30 minutes, and a newer link replaces an older one", async () => {
    await account("fm-daniel");
    const start = new Date();
    await reset.requestPasswordReset(t.db, { email: "fm-daniel@example.invalid" }, start);
    const first = await linkToken();
    await reset.requestPasswordReset(
      t.db,
      { email: "fm-daniel@example.invalid" },
      new Date(start.getTime() + 2 * 60_000),
    );
    const second = await linkToken();
    expect(second).not.toBe(first);
    await expect(
      reset.checkResetLink(t.db, first!, new Date(start.getTime() + 3 * 60_000)),
    ).rejects.toThrow();
    await expect(
      reset.checkResetLink(t.db, second!, new Date(start.getTime() + 33 * 60_000)),
    ).rejects.toThrow();
    await expect(
      reset.checkResetLink(t.db, second!, new Date(start.getTime() + 10 * 60_000)),
    ).resolves.toBeTruthy();
  });

  it("isn't available where there's no mail channel", async () => {
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "0");
    await expect(reset.requestPasswordReset(t.db, { email: "fm-daniel@example.invalid" })).rejects.toThrow(
      /isn't available/,
    );
  });
});

describe("decision 28: audit CSV export", () => {
  it("operations and reviewers can export; care guides and family can't", async () => {
    for (const who of ["st-dana", "st-priya"]) {
      const r = await audit.auditExport(t.db, await t.as(who), { days: 30 });
      expect(r.csv.split("\r\n")[4]).toBe("timestamp,event_code,summary,actor,household,decision");
    }
    await expect(audit.auditExport(t.db, await t.as("st-maya"), { days: 30 })).rejects.toThrow();
    await expect(audit.auditExport(t.db, await t.as("fm-daniel"), { days: 30 })).rejects.toThrow();
  });

  it("caps the range at 90 days and stays inside the tenant", async () => {
    const dana = await t.as("st-dana");
    await expect(audit.auditExport(t.db, dana, { days: 365 })).rejects.toThrow(/90 days/);
    const r = await audit.auditExport(t.db, dana, { days: 90 });
    expect(r.csv).not.toContain("Cedar");
    expect(r.csv).not.toContain("Moss");
    const jordan = await audit.auditExport(t.db, await t.as("cst-jordan", "t-cedar"), { days: 90 });
    expect(jordan.csv).not.toContain("Okafor");
  });

  it("never includes stored summaries, so no task titles, purposes or message text", async () => {
    const r = await audit.auditExport(t.db, await t.as("st-dana"), { days: 90 });
    const summaries = (await t.db.select({ summary: s.auditEvents.summary }).from(s.auditEvents)).map(
      (x) => x.summary,
    );
    // e.g. "Daniel finished “Tell the care guide about visitors this weekend”."
    const quoted = summaries.filter((x) => /“.+”/.test(x));
    expect(quoted.length).toBeGreaterThan(0);
    for (const q of quoted) expect(r.csv).not.toContain(q.match(/“(.+)”/)![1]!);
    expect(r.csv).not.toContain("Thursday 10am");
    expect(r.filename).toMatch(/^zeporah-audit-\d{4}-\d\d-\d\d-last-90-days\.csv$/);
  });

  it("labels the file: confidential, who exported it, when, and the filters (decision 29g)", async () => {
    const now = new Date("2026-10-13T15:00:00Z");
    const r = await audit.auditExport(t.db, await t.as("st-dana"), { days: 30, category: "sharing" }, now);
    const [notice, by, filters, blank] = r.csv.split("\r\n");
    expect(notice).toBe(`"${audit.EXPORT_NOTICE}"`);
    expect(by).toBe(`"Exported by Dana Brooks at 2026-10-13T15:00:00.000Z"`);
    expect(filters).toBe(
      `"Filters: last 30 days; Sharing, consent and authority; All households you can see; ${r.rows} events"`,
    );
    expect(blank).toBe("");
  });

  it("records the export itself in the audit log", async () => {
    const r = await audit.auditExport(t.db, await t.as("st-dana"), { days: 7, category: "sharing" });
    const [ev] = await auditOf("audit.exported");
    expect(ev!.context).toMatchObject({ days: 7, category: "sharing", rows: r.rows });
    expect(ev!.actorId).toBe("st-dana");
  });

  it("neutralises spreadsheet formulas", async () => {
    await t.db.update(s.actors).set({ displayName: "=HYPERLINK(1)" }).where(eq(s.actors.id, "st-dana"));
    const r = await audit.auditExport(t.db, await t.as("st-dana"), { days: 90 });
    expect(r.csv).not.toMatch(/(^|,)"=HYPERLINK/m);
    expect(r.csv).toContain(`"'=HYPERLINK(1)"`);
  });
});
