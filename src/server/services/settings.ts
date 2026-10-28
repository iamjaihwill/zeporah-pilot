/**
 * Hospice-owned wording about routine messages, including its expected reply time (founder
 * decision 24). Zeporah never supplies a reply time: the hospice sets one, and it's required when
 * the wording is turned on. Until then families see only a fixed sentence that names no time
 * (REPLY_TIME_UNSET in components/expectation.tsx) and the hospice's 24-hour line.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, requireStaffPermission, type ActorContext } from "../context";
import { can } from "@/domain/permissions";
import { actorNames, organizationHotline } from "./common";

export type MessageExpectationInput = {
  enabled: boolean;
  handlingHours: string;
  expectation: string;
  fallback: string;
  replyTime: string;
};

/** The wording families see now, or null when the hospice hasn't set (or has turned off) any. */
export async function currentMessageExpectation(conn: Conn, tenantId: string, organizationId: string) {
  const [latest] = await conn
    .select()
    .from(s.messageExpectations)
    .where(
      and(
        eq(s.messageExpectations.tenantId, tenantId),
        eq(s.messageExpectations.organizationId, organizationId),
      ),
    )
    .orderBy(desc(s.messageExpectations.version))
    .limit(1);
  if (!latest || !latest.enabled || latest.effectiveFrom.getTime() > Date.now()) return null;
  return {
    version: latest.version,
    handlingHours: latest.handlingHours,
    expectation: latest.expectation,
    fallback: latest.fallback,
    replyTime: latest.replyTime,
    effectiveFrom: latest.effectiveFrom,
  };
}

function orgOf(ctx: ActorContext) {
  if (ctx.kind !== "staff" || !ctx.organizationId)
    throw new AccessError("NOT_PERMITTED", "This area is for the hospice care team.");
  return ctx.organizationId;
}

/** Current wording and full history, for the hospice's operations users. */
export async function getMessageSettings(db: DB, ctx: ActorContext) {
  requireStaffPermission(ctx, "org.settings.manage");
  const org = orgOf(ctx);
  const rows = await db
    .select()
    .from(s.messageExpectations)
    .where(
      and(eq(s.messageExpectations.tenantId, ctx.tenantId), eq(s.messageExpectations.organizationId, org)),
    )
    .orderBy(desc(s.messageExpectations.version));
  const names = await actorNames(
    db,
    ctx.tenantId,
    rows.map((r) => r.changedByActorId),
  );
  const [o] = await db
    .select({ name: s.organizations.name })
    .from(s.organizations)
    .where(and(eq(s.organizations.tenantId, ctx.tenantId), eq(s.organizations.id, org)));
  return {
    organization: o?.name ?? "",
    hotline: await organizationHotline(db, ctx.tenantId, org),
    current: await currentMessageExpectation(db, ctx.tenantId, org),
    history: rows.map((r) => ({
      version: r.version,
      enabled: r.enabled,
      handlingHours: r.handlingHours,
      expectation: r.expectation,
      fallback: r.fallback,
      replyTime: r.replyTime,
      effectiveFrom: r.effectiveFrom,
      changedBy: names.get(r.changedByActorId) ?? "",
    })),
  };
}

/** Saves a new version (earlier wording is kept). Turning it off is also a new version. */
export async function setMessageExpectation(db: DB, ctx: ActorContext, input: MessageExpectationInput) {
  requireStaffPermission(ctx, "org.settings.manage");
  const org = orgOf(ctx);
  const v = {
    handlingHours: input.handlingHours.trim().slice(0, 200),
    expectation: input.expectation.trim().slice(0, 400),
    fallback: input.fallback.trim().slice(0, 300),
    replyTime: input.replyTime.trim().slice(0, 80),
  };
  if (input.enabled && !v.expectation)
    throw new AccessError("INVALID", "Write what families should expect, or turn the message off.");
  if (input.enabled && !v.replyTime)
    throw new AccessError("INVALID", "Add the expected reply time, like “within 1 business day”.");
  const before = await currentMessageExpectation(db, ctx.tenantId, org);
  await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ version: s.messageExpectations.version })
      .from(s.messageExpectations)
      .where(
        and(eq(s.messageExpectations.tenantId, ctx.tenantId), eq(s.messageExpectations.organizationId, org)),
      )
      .orderBy(desc(s.messageExpectations.version))
      .limit(1);
    const version = (last?.version ?? 0) + 1;
    const now = new Date();
    await tx.insert(s.messageExpectations).values({
      tenantId: ctx.tenantId,
      organizationId: org,
      version,
      enabled: input.enabled,
      ...v,
      effectiveFrom: now,
      changedByActorId: ctx.actorId,
    });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: input.enabled ? "settings.message_expectation_set" : "settings.message_expectation_off",
      subjectType: "organization",
      subjectId: org,
      summary: input.enabled
        ? `Routine-message wording for families was updated (version ${version}).`
        : `Routine-message wording for families was turned off (version ${version}). Families see no response expectation.`,
      visibility: "staff",
      // Before and after (staff rework, section 6).
      context: { version, enabled: input.enabled, ...v, before: before ?? null },
    });
  });
}

/**
 * Organization details (staff rework, section 6): the 24-hour line families are told to call, and
 * the sender name on email notices. Operations can see them; only administrators change them
 * (founder decision 39). Every change is audit-logged with the values before and after.
 */
export async function getHospiceDetailsWithDefaults(db: DB, ctx: ActorContext) {
  return {
    ...(await getHospiceDetails(db, ctx)),
    canEdit: can(ctx.staffRoles, "org.admin.settings"),
    canEditWorkflow: can(ctx.staffRoles, "org.settings.manage"),
    defaults: await codeDefaults(),
    responsibilities: SETTING_RESPONSIBILITIES,
  };
}

/**
 * Who may change what (founder decision 39). `where` says where it's changed today; "Not
 * configurable yet" means the app has a fixed value and no setting, which is future work.
 */
export const SETTING_RESPONSIBILITIES: {
  area: string;
  who: "Operations" | "Administrators";
  where: string;
}[] = [
  { area: "Routine-message wording and expected reply time", who: "Operations", where: "This page" },
  { area: "Queue thresholds", who: "Operations", where: "This page" },
  { area: "Assignment defaults", who: "Operations", where: "This page" },
  { area: "Task catalog", who: "Operations", where: "This page" },
  { area: "Notification defaults", who: "Operations", where: "This page" },
  { area: "Report views", who: "Operations", where: "This page" },
  {
    area: "Non-sensitive workflow statuses (task and escalation wording)",
    who: "Operations",
    where: "This page",
  },
  { area: "Staff roles and permissions; reactivation", who: "Administrators", where: "Team & coverage" },
  {
    area: "Organization details: 24-hour line, email sender name",
    who: "Administrators",
    where: "This page",
  },
  { area: "Security: sign-in limits, link lifetimes", who: "Administrators", where: "Set in code" },
  { area: "Integrations", who: "Administrators", where: "All disconnected (decision 18)" },
  { area: "Audit and export controls", who: "Administrators", where: "Set in code (decision 28)" },
  {
    area: "Retention rules (counted for review; nothing is deleted automatically)",
    who: "Administrators",
    where: "This page",
  },
  {
    area: "Organization-wide access limits (helpers and collaborators)",
    who: "Administrators",
    where: "This page",
  },
  { area: "Read-only mode", who: "Administrators", where: "Server setting" },
];

export async function getHospiceDetails(db: DB, ctx: ActorContext) {
  requireStaffPermission(ctx, "org.settings.manage");
  const org = orgOf(ctx);
  const [o] = await db
    .select({
      name: s.organizations.name,
      line: s.organizations.afterHoursLine,
      sender: s.organizations.emailSenderName,
    })
    .from(s.organizations)
    .where(and(eq(s.organizations.tenantId, ctx.tenantId), eq(s.organizations.id, org)));
  return { name: o?.name ?? "", afterHoursLine: o?.line ?? "", emailSenderName: o?.sender ?? "" };
}

/**
 * Defaults that are set in code today (shown read-only in Hospice settings). Which of these a
 * hospice should be able to change, and who (operations or an admin role), is an open question.
 */
export async function codeDefaults() {
  const { INVITATION_DAYS, LOCK_AFTER_FAILURES, LOCK_MINUTES } = await import("./auth");
  const { RESET_MINUTES } = await import("./password-reset");
  const { BEREAVEMENT_STEPS, BEREAVEMENT_SUPPORT_MONTHS } = await import("@/domain/bereavement");
  return [
    {
      label: "Invitation links last",
      value: `${INVITATION_DAYS} days`,
      note: "Family and care-team invitations",
    },
    {
      label: "Password reset links last",
      value: `${RESET_MINUTES} minutes`,
      note: "Family accounts (decision 27)",
    },
    {
      label: "Sign-in pauses after",
      value: `${LOCK_AFTER_FAILURES} failed attempts, for ${LOCK_MINUTES} minutes`,
      note: "",
    },
    {
      label: "Consent activation",
      value: "A different reviewer from the person who recorded it",
      note: "Policy, not a setting",
    },
    {
      label: "Packet release",
      value: "Checked at release: active consent, authority, scope and dates",
      note: "Policy, not a setting",
    },
    {
      label: "Bereavement plan",
      value: `${BEREAVEMENT_STEPS.length} check-ins over ${BEREAVEMENT_SUPPORT_MONTHS} months`,
      note: "Decision 10: configurable later",
    },
  ];
}

/**
 * The email sender name. The 24-hour line isn't changed here: a new line is proposed and confirmed
 * by a second person (decision 72, services/contact-line.ts).
 */
export async function setHospiceDetails(db: DB, ctx: ActorContext, input: { emailSenderName: string }) {
  requireStaffPermission(ctx, "org.admin.settings");
  const org = orgOf(ctx);
  const next = { emailSenderName: input.emailSenderName.trim().slice(0, 60) };
  const before = await getHospiceDetails(db, ctx);
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== before[k]);
  if (!changed.length) return;
  await db.transaction(async (tx) => {
    await tx
      .update(s.organizations)
      .set(next)
      .where(and(eq(s.organizations.tenantId, ctx.tenantId), eq(s.organizations.id, org)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "settings.hospice_details_changed",
      subjectType: "organization",
      subjectId: org,
      summary: "Hospice details were changed: email sender name.",
      visibility: "staff",
      context: {
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, next[k]])),
      },
    });
  });
}
