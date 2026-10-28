/**
 * A verified 24-hour clinical line (founder decision 72).
 *
 * - **Propose:** an administrator enters a new line (and an optional backup). Families keep seeing
 *   the last confirmed line until the change is confirmed.
 * - **Confirm:** someone other than the proposer, in operations or administration, calls the new
 *   line and records what they reached. Only then does it become the line families see. The
 *   database refuses a change confirmed by its own proposer (migration 0029).
 * - **Re-confirm:** at least every `RECONFIRM_DAYS`, someone calls the unchanged line and records it.
 *   System status flags the line when it's due, never confirmed, or waiting on a change.
 * - **One source of truth:** `organizations.after_hours_line` (and the backup), read by
 *   `organizationHotline`. Nothing else stores a copy.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, requireStaffPermission, type ActorContext } from "../context";
import { actorNames } from "./common";
import { confirmationDue, isWellFormedLine, LINE_FORMAT_MESSAGE } from "@/domain/contact-line";

const orgOf = (ctx: ActorContext) => {
  if (!ctx.organizationId) throw new AccessError("NOT_PERMITTED", "This needs a hospice.");
  return ctx.organizationId;
};

const clean = (text: string | null | undefined) => (text ?? "").trim().replace(/\s+/g, " ");

/** The live line, when it was last confirmed and by whom, whether it's due, and any waiting change. */
export async function lineStatus(conn: Conn, tenantId: string, organizationId: string, now = new Date()) {
  const [o] = await conn
    .select({ line: s.organizations.afterHoursLine, backup: s.organizations.afterHoursBackupLine })
    .from(s.organizations)
    .where(and(eq(s.organizations.tenantId, tenantId), eq(s.organizations.id, organizationId)));
  const c = s.contactLineChanges;
  const [last] = await conn
    .select()
    .from(c)
    .where(and(eq(c.tenantId, tenantId), eq(c.organizationId, organizationId), eq(c.status, "confirmed")))
    .orderBy(desc(c.confirmedAt))
    .limit(1);
  const [pending] = await conn
    .select()
    .from(c)
    .where(and(eq(c.tenantId, tenantId), eq(c.organizationId, organizationId), eq(c.status, "pending")));
  const names = await actorNames(conn, tenantId, [
    last?.confirmedByActorId ?? null,
    pending?.proposedByActorId ?? null,
  ]);
  const { dueAt, due } = confirmationDue(last?.confirmedAt ?? null, now);
  return {
    line: o?.line ?? "",
    backupLine: o?.backup ?? null,
    lastConfirmed: last
      ? {
          at: last.confirmedAt!,
          by: names.get(last.confirmedByActorId!) ?? "",
          note: last.confirmationNote ?? "",
        }
      : null,
    dueAt,
    due,
    pending: pending
      ? {
          id: pending.id,
          line: pending.line,
          backupLine: pending.backupLine,
          proposedBy: names.get(pending.proposedByActorId) ?? "",
          proposedByActorId: pending.proposedByActorId,
          proposedAt: pending.proposedAt,
        }
      : null,
  };
}

export async function myLineStatus(db: DB, ctx: ActorContext) {
  requireStaffPermission(ctx, "org.settings.manage");
  const status = await lineStatus(db, ctx.tenantId, orgOf(ctx));
  return {
    ...status,
    canPropose: ctx.staffRoles.includes("hospice_admin"),
    canConfirm: ctx.staffRoles.some((r) => r === "hospice_ops" || r === "hospice_admin"),
    /** The proposer can't confirm their own change. */
    canConfirmPending: !!status.pending && status.pending.proposedByActorId !== ctx.actorId,
  };
}

export async function proposeLine(
  db: DB,
  ctx: ActorContext,
  input: { line: string; backupLine?: string | null | undefined },
) {
  requireStaffPermission(ctx, "org.admin.settings");
  const org = orgOf(ctx);
  const line = clean(input.line);
  const backupLine = clean(input.backupLine) || null;
  if (!isWellFormedLine(line)) throw new AccessError("INVALID", LINE_FORMAT_MESSAGE);
  if (backupLine && !isWellFormedLine(backupLine)) throw new AccessError("INVALID", LINE_FORMAT_MESSAGE);
  const live = await lineStatus(db, ctx.tenantId, org);
  if (line === live.line && backupLine === live.backupLine)
    throw new AccessError("INVALID", "That's already the line families see.");
  return db.transaction(async (tx) => {
    // A newer proposal replaces one still waiting.
    await tx
      .update(s.contactLineChanges)
      .set({ status: "superseded", closedAt: new Date() })
      .where(
        and(
          eq(s.contactLineChanges.tenantId, ctx.tenantId),
          eq(s.contactLineChanges.organizationId, org),
          eq(s.contactLineChanges.status, "pending"),
        ),
      );
    const [row] = await tx
      .insert(s.contactLineChanges)
      .values({
        tenantId: ctx.tenantId,
        organizationId: org,
        kind: "change",
        line,
        backupLine,
        status: "pending",
        proposedByActorId: ctx.actorId,
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "contact_line.proposed",
      subjectType: "contact_line_change",
      subjectId: row!.id,
      summary:
        "A new 24-hour line was proposed. Families keep the current line until someone else confirms it.",
      visibility: "staff",
      before: { line: live.line, backupLine: live.backupLine },
      after: { line, backupLine },
    });
    return { id: row!.id };
  });
}

export async function confirmLine(
  db: DB,
  ctx: ActorContext,
  input: { changeId: string; reached: boolean; note: string },
) {
  requireStaffPermission(ctx, "contact_line.confirm");
  const org = orgOf(ctx);
  const note = clean(input.note).slice(0, 200);
  if (!input.reached)
    throw new AccessError(
      "INVALID",
      "Confirm only after calling it and reaching the hospice's after-hours service. If it didn't work, withdraw the change.",
    );
  if (!note) throw new AccessError("INVALID", "Say what you reached, for example “nurse line answered”.");
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(s.contactLineChanges)
      .where(
        and(
          eq(s.contactLineChanges.tenantId, ctx.tenantId),
          eq(s.contactLineChanges.organizationId, org),
          eq(s.contactLineChanges.id, input.changeId),
          eq(s.contactLineChanges.status, "pending"),
        ),
      );
    if (!c) throw new AccessError("CONFLICT", "This change isn't waiting any more.");
    if (c.proposedByActorId === ctx.actorId)
      throw new AccessError(
        "NOT_PERMITTED",
        "Someone other than the person who proposed it has to call it and confirm.",
      );
    const now = new Date();
    await tx
      .update(s.contactLineChanges)
      .set({ status: "confirmed", confirmedByActorId: ctx.actorId, confirmedAt: now, confirmationNote: note })
      .where(eq(s.contactLineChanges.id, c.id));
    await tx
      .update(s.organizations)
      .set({ afterHoursLine: c.line, afterHoursBackupLine: c.backupLine })
      .where(and(eq(s.organizations.tenantId, ctx.tenantId), eq(s.organizations.id, org)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "contact_line.confirmed",
      subjectType: "contact_line_change",
      subjectId: c.id,
      summary: "The new 24-hour line was called, confirmed and is now shown to families.",
      visibility: "staff",
      after: { line: c.line, backupLine: c.backupLine },
      approval: { requestedBy: c.proposedByActorId, approvedBy: ctx.actorId },
    });
  });
}

export async function withdrawLine(db: DB, ctx: ActorContext, input: { changeId: string }) {
  requireStaffPermission(ctx, "contact_line.confirm");
  const org = orgOf(ctx);
  await db.transaction(async (tx) => {
    const [c] = await tx
      .update(s.contactLineChanges)
      .set({ status: "withdrawn", closedAt: new Date() })
      .where(
        and(
          eq(s.contactLineChanges.tenantId, ctx.tenantId),
          eq(s.contactLineChanges.organizationId, org),
          eq(s.contactLineChanges.id, input.changeId),
          eq(s.contactLineChanges.status, "pending"),
        ),
      )
      .returning();
    if (!c) throw new AccessError("CONFLICT", "This change isn't waiting any more.");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "contact_line.withdrawn",
      subjectType: "contact_line_change",
      subjectId: c.id,
      summary: "A proposed 24-hour line was withdrawn. Families still see the confirmed line.",
      visibility: "staff",
    });
  });
}

/** Someone called the unchanged line and reached the after-hours service. */
export async function reconfirmLine(db: DB, ctx: ActorContext, input: { reached: boolean; note: string }) {
  requireStaffPermission(ctx, "contact_line.confirm");
  const org = orgOf(ctx);
  const note = clean(input.note).slice(0, 200);
  if (!input.reached)
    throw new AccessError(
      "INVALID",
      "Confirm only after calling it and reaching the hospice's after-hours service. If it didn't work, tell an administrator now.",
    );
  if (!note) throw new AccessError("INVALID", "Say what you reached, for example “nurse line answered”.");
  const live = await lineStatus(db, ctx.tenantId, org);
  await db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .insert(s.contactLineChanges)
      .values({
        tenantId: ctx.tenantId,
        organizationId: org,
        kind: "reconfirmation",
        line: live.line,
        backupLine: live.backupLine,
        status: "confirmed",
        proposedByActorId: ctx.actorId,
        proposedAt: now,
        confirmedByActorId: ctx.actorId,
        confirmedAt: now,
        confirmationNote: note,
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "contact_line.reconfirmed",
      subjectType: "contact_line_change",
      subjectId: row!.id,
      summary: "The 24-hour line was called and confirmed again.",
      visibility: "staff",
    });
  });
}
