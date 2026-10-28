/**
 * Hospice workflow and organization settings (founder decision 39). Operations change the workflow
 * groups (`org.settings.manage`); only administrators change access limits and retention rules
 * (`org.admin.settings`). Every change is validated here, whatever the page sends, and audit-logged
 * with the values before and after. Defaults are the app's behaviour before each setting existed.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import * as z from "zod";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { actorNames } from "./common";
import { AccessError, requireStaffPermission, type ActorContext } from "../context";
import { can } from "@/domain/permissions";
import {
  ADMIN_GROUPS,
  GROUP_LABELS,
  OPERATIONS_GROUPS,
  REPORT_KEYS,
  withDefaults,
  type OrgSettings,
  type SettingsGroup,
} from "@/domain/org-settings";
import { OUT_OF_SCOPE, OUT_OF_SCOPE_MESSAGE } from "@/domain/task-scope";

// Built on first use, so loading this module stays cheap.
let schemas: { [K in SettingsGroup]: z.ZodType<OrgSettings[K]> } | null = null;
function SCHEMAS_() {
  if (schemas) return schemas;
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 21:00.");
  const label = z.string().trim().max(40, "Keep each label under 40 characters.");

  schemas = {
    queue: z.object({
      messageHighAfterHours: z.number().int().min(1).max(336).nullable(),
      routineNormalAfterDays: z.number().int().min(1).max(60).nullable(),
    }),
    exceptions: z.object({
      handoffAcceptHours: z.number().int().min(1).max(168),
      recipientUnopenedHours: z.number().int().min(1).max(336),
      accessEndingDays: z.number().int().min(1).max(60),
      ackOverdueHours: z.number().int().min(1).max(336),
      noTeamContactDays: z.number().int().min(1).max(60),
      coordinationRiskOpenCount: z.number().int().min(2).max(20),
    }),
    assignment: z.object({
      handOverByDefault: z.boolean(),
      caseloadWarnAt: z.number().int().min(1).max(200).nullable(),
    }),
    taskCatalog: z
      .array(
        z.object({
          id: z.string().min(1).max(40),
          title: z.string().trim().min(1, "Each task needs a title.").max(120),
          detail: z.string().trim().max(600),
          audience: z.enum(["family", "staff"]),
          dueInDays: z.number().int().min(0).max(365).nullable(),
        }),
      )
      .max(40, "Keep the catalog to 40 tasks."),
    notifications: z.object({
      cadence: z.enum(["as_it_happens", "daily_summary", "essential_only"]),
      quietStart: hhmm,
      quietEnd: hhmm,
    }),
    reports: z.object({
      defaultReport: z.enum(REPORT_KEYS),
      defaultDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
    }),
    // Blank labels mean "the standard wording", so they're dropped rather than stored.
    statusLabels: z
      .object({
        task: z.object({ open: label.optional(), done: label.optional(), closed: label.optional() }),
        escalation: z.object({
          open: label.optional(),
          acknowledged: label.optional(),
          resolved: label.optional(),
        }),
      })
      .transform((v) => ({
        task: Object.fromEntries(Object.entries(v.task).filter(([, x]) => x)),
        escalation: Object.fromEntries(Object.entries(v.escalation).filter(([, x]) => x)),
      })) as unknown as z.ZodType<OrgSettings["statusLabels"]>,
    enrollment: z.object({ cap: z.number().int().min(1).max(500) }),
    access: z.object({
      taskHelperMaxDays: z.number().int().min(1).max(365),
      collaborationMaxDays: z.number().int().min(1).max(365),
    }),
    retention: z.object({
      closedHouseholdsMonths: z.number().int().min(1).max(240).nullable(),
      messagesMonths: z.number().int().min(1).max(240).nullable(),
    }),
  };
  return schemas!;
}

/** The settings in force for an organization: what's stored, over the defaults. */
export async function orgSettings(conn: Conn, tenantId: string, organizationId: string | null) {
  if (!organizationId) return withDefaults(null);
  const [o] = await conn
    .select({ settings: s.organizations.settings })
    .from(s.organizations)
    .where(and(eq(s.organizations.tenantId, tenantId), eq(s.organizations.id, organizationId)));
  return withDefaults(o?.settings);
}

/** The settings for the hospice a household belongs to. */
export async function householdOrgSettings(conn: Conn, tenantId: string, householdId: string) {
  const [h] = await conn
    .select({ org: s.households.organizationId })
    .from(s.households)
    .where(and(eq(s.households.tenantId, tenantId), eq(s.households.id, householdId)));
  return orgSettings(conn, tenantId, h?.org ?? null);
}

const isAdminGroup = (g: SettingsGroup) => (ADMIN_GROUPS as readonly string[]).includes(g);

export async function settingsView(db: DB, ctx: ActorContext) {
  requireStaffPermission(ctx, "org.settings.manage");
  return {
    /** Who last changed each group (and the hospice details), from the audit entries saves write. */
    lastChanged: await lastChanged(db, ctx),
    values: await orgSettings(db, ctx.tenantId, ctx.organizationId),
    canEditOperations: can(ctx.staffRoles, "org.settings.manage"),
    canEditAdmin: can(ctx.staffRoles, "org.admin.settings"),
    operationsGroups: [...OPERATIONS_GROUPS],
    adminGroups: [...ADMIN_GROUPS],
  };
}

/** The latest change to each settings group, and to the hospice details, with who made it. */
async function lastChanged(db: DB, ctx: ActorContext) {
  if (!ctx.organizationId) return {};
  const rows = await db
    .select({
      action: s.auditEvents.action,
      actorId: s.auditEvents.actorId,
      at: s.auditEvents.createdAt,
      context: s.auditEvents.context,
    })
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.tenantId, ctx.tenantId),
        eq(s.auditEvents.subjectId, ctx.organizationId),
        inArray(s.auditEvents.action, ["settings.changed", "settings.hospice_details_changed"]),
      ),
    )
    .orderBy(desc(s.auditEvents.seq))
    .limit(200);
  const names = await actorNames(
    db,
    ctx.tenantId,
    rows.map((r) => r.actorId),
  );
  const out: Partial<Record<SettingsGroup | "hospiceDetails", { by: string; at: Date }>> = {};
  for (const r of rows) {
    const key =
      r.action === "settings.hospice_details_changed"
        ? "hospiceDetails"
        : ((r.context as { group?: SettingsGroup }).group ?? null);
    if (key && !out[key])
      out[key] = { by: r.actorId ? (names.get(r.actorId) ?? "Someone") : "The system", at: r.at };
  }
  return out;
}

/** Replace one group. Operations groups need `org.settings.manage`; organization groups `org.admin.settings`. */
export async function updateSettingsGroup(
  db: DB,
  ctx: ActorContext,
  input: { group: SettingsGroup; value: unknown },
) {
  if (!(input.group in SCHEMAS_())) throw new AccessError("INVALID", "That isn't a setting.");
  requireStaffPermission(ctx, isAdminGroup(input.group) ? "org.admin.settings" : "org.settings.manage");
  if (!ctx.organizationId) throw new AccessError("NOT_PERMITTED", "Your role doesn't include this action.");
  const parsed = SCHEMAS_()[input.group].safeParse(input.value);
  if (!parsed.success)
    throw new AccessError("INVALID", parsed.error.issues[0]?.message ?? "Check the values.");
  const value = parsed.data;
  // The same guard rail as household tasks: no medical orders or legal steps in the catalog.
  if (input.group === "taskCatalog")
    for (const t of value as OrgSettings["taskCatalog"])
      if (OUT_OF_SCOPE.test(`${t.title} ${t.detail}`)) throw new AccessError("INVALID", OUT_OF_SCOPE_MESSAGE);
  const [o] = await db
    .select({ settings: s.organizations.settings })
    .from(s.organizations)
    .where(and(eq(s.organizations.tenantId, ctx.tenantId), eq(s.organizations.id, ctx.organizationId)));
  const before = withDefaults(o?.settings)[input.group];
  if (JSON.stringify(before) === JSON.stringify(value)) return;
  await db.transaction(async (tx) => {
    await tx
      .update(s.organizations)
      .set({ settings: { ...(o?.settings ?? {}), [input.group]: value } })
      .where(and(eq(s.organizations.tenantId, ctx.tenantId), eq(s.organizations.id, ctx.organizationId!)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "settings.changed",
      subjectType: "organization",
      subjectId: ctx.organizationId!,
      summary: `Hospice setting changed: ${GROUP_LABELS[input.group].toLowerCase()}.`,
      visibility: "staff",
      context: { group: input.group, before, after: value },
    });
  });
}

/* ------------------------------------------------------------------ retention review */

/**
 * Records past the hospice's retention periods, counted for review. Nothing is deleted: the app has
 * no deletion, and the audit log is append-only by design.
 */
export async function retentionReview(db: DB, ctx: ActorContext, now = new Date()) {
  requireStaffPermission(ctx, "org.admin.settings");
  const r = (await orgSettings(db, ctx.tenantId, ctx.organizationId)).retention;
  const monthsAgo = (m: number) => new Date(now.getTime() - m * 30.44 * 86_400_000);
  const hh = await db
    .select()
    .from(s.households)
    .where(
      and(
        eq(s.households.tenantId, ctx.tenantId),
        eq(s.households.organizationId, ctx.organizationId ?? "-"),
      ),
    );
  const ids = hh.map((h) => h.id);
  const closedPast =
    r.closedHouseholdsMonths === null
      ? null
      : hh.filter(
          (h) =>
            h.lifecycleState === "closed" &&
            h.lifecycleChangedAt &&
            h.lifecycleChangedAt < monthsAgo(r.closedHouseholdsMonths!),
        ).length;
  let messagesPast: number | null = null;
  if (r.messagesMonths !== null) {
    const msgs = ids.length
      ? await db
          .select({ at: s.messages.createdAt, h: s.messages.householdId })
          .from(s.messages)
          .where(eq(s.messages.tenantId, ctx.tenantId))
      : [];
    messagesPast = msgs.filter((m) => ids.includes(m.h) && m.at < monthsAgo(r.messagesMonths!)).length;
  }
  return { rules: r, closedHouseholdsPast: closedPast, messagesPast };
}
