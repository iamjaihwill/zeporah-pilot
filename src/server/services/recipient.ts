/**
 * Packet recipients (founder decision 45): a released packet's named recipient reads it in Zeporah,
 * signed in and read-only. Never an attachment.
 *
 * - Purpose-, recipient- and time-bound: access exists only for the person the packet names, only
 *   for that packet, only until the release's expiry, and ends at once if the release is revoked.
 * - The view says who sent it, who it's for, why, what's included, for how long, its status and
 *   its access history. While active, the recipient can acknowledge receipt or ask a question.
 * - Zeporah offers no download, print view, export or forward. It can't stop a screenshot; the
 *   page says so plainly rather than promising more.
 * - The alert email (development mail sink only, decision 18) carries fixed wording and a link —
 *   never the hospice's household, the patient, the purpose or any packet content.
 * - Everything is audit-logged; the recipient's own access history is shown to them and to staff.
 */
import { lineForFamilies } from "@/domain/contact-line";
import { and, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, type ActorContext } from "../context";
import { hashPassword, hashToken, looksLikeEmail, newToken, normalizeEmail } from "../auth/crypto";
import { mailChannel, senderNameFor } from "../mail";
import { enqueue } from "./outbox";
import { actorNames, careGuidesFor, householdMembers, notify, staffWithRole } from "./common";
import { passwordProblem } from "./auth";
import {
  AUTHORITY_TYPE_LABELS,
  SHARE_CATEGORY_LABELS,
  VAULT_STATUS_LABELS,
  type AuthorityType,
  type ShareCategory,
  type VaultStatus,
} from "@/domain/model";
import { statusOf } from "@/domain/status";

// The fixed wording (decision 48c), shared with the outbox's check (domain/email-wording.ts).
import { RECIPIENT_ALERT_BODY, RECIPIENT_ALERT_SUBJECT } from "@/domain/email-wording";
export { RECIPIENT_ALERT_BODY, RECIPIENT_ALERT_SUBJECT };
export const NOT_AVAILABLE = "This packet isn't available to you.";
const VIEW_LOG_GAP_MS = 10 * 60_000;

/* ------------------------------------------------------------------ granting and ending */

/** Called inside the release transaction: give the named recipient read access until the expiry. */
export async function grantRecipientAccess(
  tx: Conn,
  ctx: ActorContext,
  p: typeof s.packets.$inferSelect,
  receipt: { id: string; expiresAt: Date },
) {
  if (!p.recipientEmail) return null;
  const email = normalizeEmail(p.recipientEmail);
  let [actor] = await tx
    .select()
    .from(s.actors)
    .where(
      and(eq(s.actors.tenantId, ctx.tenantId), eq(s.actors.email, email), eq(s.actors.kind, "recipient")),
    );
  if (!actor)
    [actor] = await tx
      .insert(s.actors)
      .values({
        tenantId: ctx.tenantId,
        kind: "recipient",
        displayName: p.recipientContactName || p.recipientName,
        email,
      })
      .returning();
  const [account] = await tx
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.tenantId, ctx.tenantId), eq(s.users.actorId, actor!.id)));
  const token = account ? null : newToken();
  const [access] = await tx
    .insert(s.packetRecipientAccess)
    .values({
      tenantId: ctx.tenantId,
      packetId: p.id,
      receiptId: receipt.id,
      recipientActorId: actor!.id,
      expiresAt: receipt.expiresAt,
      setupTokenHash: token ? hashToken(token) : null,
    })
    .returning();
  await appendAudit(tx, {
    tenantId: ctx.tenantId,
    householdId: p.householdId,
    actorId: ctx.actorId,
    action: "packet.recipient_access_granted",
    subjectType: "packet",
    subjectId: p.id,
    summary: "The named recipient can read this packet in Zeporah, read-only, until it expires.",
    visibility: "sharing",
    context: {
      recipientActorId: actor!.id,
      expiresAt: receipt.expiresAt.toISOString(),
      // Decision 48c: whether the sign-in alert went out decides which release note is true.
      alerted: mailChannel() !== null,
    },
  });
  // Decision 88: saved with the access it reports; the caller sends it once this commits.
  const alertId = mailChannel()
    ? await enqueue(tx, {
        tenantId: ctx.tenantId,
        householdId: p.householdId,
        kind: "recipient_alert",
        toActorId: actor!.id,
        toEmail: email,
        fromName: await senderNameFor(tx, ctx.tenantId),
        subject: RECIPIENT_ALERT_SUBJECT,
        body: RECIPIENT_ALERT_BODY,
        link: token ? `/recipient/setup/${token}` : "/recipient",
        about: { accessId: access!.id },
      })
    : null;
  return { ...access!, alerted: !!alertId, alertId };
}

/** Packets whose named recipient was sent the sign-in alert (decision 48c). */
export async function alertedPackets(conn: Conn, tenantId: string, packetIds: string[]) {
  if (!packetIds.length) return new Set<string>();
  const rows = await conn
    .select({ id: s.auditEvents.subjectId, context: s.auditEvents.context })
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.tenantId, tenantId),
        eq(s.auditEvents.action, "packet.recipient_access_granted"),
        inArray(s.auditEvents.subjectId, packetIds),
      ),
    );
  return new Set(rows.filter((r) => (r.context as { alerted?: boolean } | null)?.alerted).map((r) => r.id!));
}

/** Called inside the revoke transaction: the recipient's access ends at once. */
export async function endRecipientAccess(tx: Conn, tenantId: string, packetId: string) {
  await tx
    .update(s.packetRecipientAccess)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(s.packetRecipientAccess.tenantId, tenantId),
        eq(s.packetRecipientAccess.packetId, packetId),
        isNull(s.packetRecipientAccess.revokedAt),
      ),
    );
}

/* ------------------------------------------------------------------ the recipient's view */

function requireRecipient(ctx: ActorContext) {
  if (ctx.kind !== "recipient")
    throw new AccessError("NOT_PERMITTED", "This area is for named packet recipients.");
}

type AccessRow = typeof s.packetRecipientAccess.$inferSelect;
const statusOfAccess = (a: AccessRow, packetState: string, now = Date.now()) =>
  a.revokedAt || packetState === "revoked"
    ? ("revoked" as const)
    : a.expiresAt.getTime() <= now
      ? ("expired" as const)
      : ("active" as const);

const STATUS_TEXT = {
  active: "Active",
  expired: "Expired — no longer available",
  revoked: "Withdrawn by the hospice — no longer available",
} as const;

/** Packets released to this person, newest first. Names the hospice and purpose only. */
export async function recipientPackets(db: DB, ctx: ActorContext) {
  requireRecipient(ctx);
  const rows = await db
    .select({ a: s.packetRecipientAccess, p: s.packets, org: s.organizations.name })
    .from(s.packetRecipientAccess)
    .innerJoin(
      s.packets,
      and(
        eq(s.packets.id, s.packetRecipientAccess.packetId),
        eq(s.packets.tenantId, s.packetRecipientAccess.tenantId),
      ),
    )
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.packets.householdId), eq(s.households.tenantId, s.packets.tenantId)),
    )
    .innerJoin(
      s.organizations,
      and(
        eq(s.organizations.id, s.households.organizationId),
        eq(s.organizations.tenantId, s.households.tenantId),
      ),
    )
    .where(
      and(
        eq(s.packetRecipientAccess.tenantId, ctx.tenantId),
        eq(s.packetRecipientAccess.recipientActorId, ctx.actorId),
      ),
    )
    .orderBy(desc(s.packetRecipientAccess.grantedAt));
  return {
    name: ctx.displayName,
    packets: rows.map(({ a, p, org }) => {
      const status = statusOfAccess(a, p.state);
      return {
        id: p.id,
        from: org,
        purpose: p.purpose,
        recipientName: p.recipientName,
        grantedAt: a.grantedAt,
        expiresAt: a.expiresAt,
        status,
        statusText: STATUS_TEXT[status],
        acknowledged: !!a.acknowledgedAt,
      };
    }),
  };
}

async function accessFor(conn: Conn, ctx: ActorContext, packetId: string) {
  requireRecipient(ctx);
  const [row] = await conn
    .select({ a: s.packetRecipientAccess, p: s.packets })
    .from(s.packetRecipientAccess)
    .innerJoin(
      s.packets,
      and(
        eq(s.packets.id, s.packetRecipientAccess.packetId),
        eq(s.packets.tenantId, s.packetRecipientAccess.tenantId),
      ),
    )
    .where(
      and(
        eq(s.packetRecipientAccess.tenantId, ctx.tenantId),
        eq(s.packetRecipientAccess.recipientActorId, ctx.actorId),
        eq(s.packetRecipientAccess.packetId, packetId),
      ),
    )
    .orderBy(desc(s.packetRecipientAccess.grantedAt))
    .limit(1);
  // Someone else's packet, an unknown id and another tenant's all look the same.
  if (!row) throw new AccessError("OUT_OF_SCOPE", NOT_AVAILABLE);
  return { ...row, status: statusOfAccess(row.a, row.p.state) };
}

async function log(
  conn: Conn,
  ctx: ActorContext,
  packetId: string,
  action: "viewed" | "acknowledged" | "clarification_requested",
) {
  await conn
    .insert(s.packetAccessLog)
    .values({ tenantId: ctx.tenantId, packetId, actorId: ctx.actorId, action });
}

/**
 * The authorized materials, built from the current records, one section per category in the
 * release's manifest and nothing else. Minimum necessary: no clinical record, no documents.
 */
async function materials(conn: Conn, tenantId: string, householdId: string, manifest: string[]) {
  const out: { category: string; label: string; lines: string[] }[] = [];
  const [record] = await conn
    .select()
    .from(s.careCoordinationRecords)
    .where(
      and(
        eq(s.careCoordinationRecords.tenantId, tenantId),
        eq(s.careCoordinationRecords.householdId, householdId),
      ),
    );
  for (const c of manifest as ShareCategory[]) {
    let lines: string[] = [];
    if (c === "contact_details") {
      const members = await householdMembers(conn, tenantId, householdId);
      const contact = members.find((m) => m.roles.includes("coordinator"));
      lines = contact
        ? [`Household contact: ${contact.name} (household coordinator)`]
        : ["No household contact recorded."];
    } else if (c === "care_coordination_summary")
      lines = [record?.familyPriorities || "No summary recorded."];
    else if (c === "visit_schedule") lines = [record?.visitRhythm || "No visit schedule recorded."];
    else if (c === "vault_status") {
      const items = await conn
        .select()
        .from(s.vaultItems)
        .where(
          and(
            eq(s.vaultItems.tenantId, tenantId),
            eq(s.vaultItems.householdId, householdId),
            eq(s.vaultItems.sensitivity, "standard"),
            inArray(s.vaultItems.audience, ["staff", "household"]),
          ),
        );
      lines = items.map(
        (i) =>
          `${i.title}: ${VAULT_STATUS_LABELS[i.status as VaultStatus]}${i.keptWhere ? ` — kept ${i.keptWhere}` : ""}`,
      );
    } else if (c === "authority_status") {
      const ev = await conn
        .select()
        .from(s.authorityEvidence)
        .where(
          and(eq(s.authorityEvidence.tenantId, tenantId), eq(s.authorityEvidence.householdId, householdId)),
        );
      lines = [
        ...ev.map(
          (e) =>
            `${e.holderName} — ${AUTHORITY_TYPE_LABELS[e.authorityType as AuthorityType]}: ${statusOf("authority", e.state).label}`,
        ),
        "This is a workflow status, not a legal determination.",
      ];
    } else if (c === "bereavement_contact") {
      const members = await householdMembers(conn, tenantId, householdId);
      const contact = members.find((m) => m.roles.includes("coordinator"));
      lines = contact ? [`Bereavement support contact: ${contact.name}`] : ["No contact recorded."];
    }
    out.push({ category: c, label: SHARE_CATEGORY_LABELS[c], lines });
  }
  return out;
}

/** One packet, read-only. Materials only while access is active. Each view is logged (at most every 10 minutes). */
export async function recipientPacket(db: DB, ctx: ActorContext, packetId: string) {
  const { a, p, status } = await accessFor(db, ctx, packetId);
  const [receipt] = await db
    .select()
    .from(s.packetReleaseReceipts)
    .where(
      and(eq(s.packetReleaseReceipts.tenantId, ctx.tenantId), eq(s.packetReleaseReceipts.id, a.receiptId)),
    );
  const [h] = await db
    .select({
      org: s.organizations.name,
      line: s.organizations.afterHoursLine,
      backup: s.organizations.afterHoursBackupLine,
    })
    .from(s.households)
    .innerJoin(
      s.organizations,
      and(
        eq(s.organizations.id, s.households.organizationId),
        eq(s.organizations.tenantId, s.households.tenantId),
      ),
    )
    .where(and(eq(s.households.tenantId, ctx.tenantId), eq(s.households.id, p.householdId)));
  if (status === "active") {
    const [last] = await db
      .select()
      .from(s.packetAccessLog)
      .where(
        and(
          eq(s.packetAccessLog.tenantId, ctx.tenantId),
          eq(s.packetAccessLog.packetId, p.id),
          eq(s.packetAccessLog.actorId, ctx.actorId),
          eq(s.packetAccessLog.action, "viewed"),
          gt(s.packetAccessLog.at, new Date(Date.now() - VIEW_LOG_GAP_MS)),
        ),
      )
      .limit(1);
    if (!last)
      await db.transaction(async (tx) => {
        await log(tx, ctx, p.id, "viewed");
        await appendAudit(tx, {
          tenantId: ctx.tenantId,
          householdId: p.householdId,
          actorId: ctx.actorId,
          action: "packet.recipient_viewed",
          subjectType: "packet",
          subjectId: p.id,
          summary: "The named recipient opened the packet in Zeporah.",
          visibility: "sharing",
        });
      });
  }
  const history = await db
    .select()
    .from(s.packetAccessLog)
    .where(
      and(
        eq(s.packetAccessLog.tenantId, ctx.tenantId),
        eq(s.packetAccessLog.packetId, p.id),
        eq(s.packetAccessLog.actorId, ctx.actorId),
      ),
    )
    .orderBy(desc(s.packetAccessLog.at))
    .limit(50);
  const names = await actorNames(db, ctx.tenantId, [receipt?.releasedByActorId ?? null]);
  return {
    id: p.id,
    sender: {
      organization: h?.org ?? "",
      releasedBy: receipt ? (names.get(receipt.releasedByActorId) ?? "") : "",
    },
    recipient: { name: ctx.displayName, organization: p.recipientName },
    purpose: p.purpose,
    access: { from: a.grantedAt, until: a.expiresAt },
    status,
    statusText: STATUS_TEXT[status],
    acknowledgedAt: a.acknowledgedAt,
    // Only while it's active: an expired or withdrawn packet shows what it was, not what it said.
    materials:
      status === "active" ? await materials(db, ctx.tenantId, p.householdId, receipt?.manifest ?? []) : null,
    manifest: (receipt?.manifest ?? []).map((c) => SHARE_CATEGORY_LABELS[c as ShareCategory]),
    history: history.map((x) => ({ id: x.id, action: x.action, at: x.at })),
    hotline: h ? lineForFamilies(h.line, h.backup) : null,
  };
}

async function tellTheCareTeam(
  conn: Conn,
  ctx: ActorContext,
  householdId: string,
  title: string,
  link: string,
) {
  const guides = await careGuidesFor(conn, ctx.tenantId, householdId);
  await notify(conn, {
    tenantId: ctx.tenantId,
    householdId,
    recipients: [
      ...guides.map((g) => g.actorId),
      ...(await staffWithRole(conn, ctx.tenantId, "hospice_ops")),
    ],
    kind: "packet",
    title,
    link,
  });
}

/** "I've received this." Only while active; once. */
export async function acknowledgePacket(db: DB, ctx: ActorContext, packetId: string) {
  const { a, p, status } = await accessFor(db, ctx, packetId);
  if (status !== "active") throw new AccessError("INVALID", "This packet is no longer available.");
  if (a.acknowledgedAt) return;
  await db.transaction(async (tx) => {
    await tx
      .update(s.packetRecipientAccess)
      .set({ acknowledgedAt: new Date() })
      .where(eq(s.packetRecipientAccess.id, a.id));
    await log(tx, ctx, p.id, "acknowledged");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: p.householdId,
      actorId: ctx.actorId,
      action: "packet.recipient_acknowledged",
      subjectType: "packet",
      subjectId: p.id,
      summary: "The named recipient acknowledged receiving the packet.",
      visibility: "sharing",
    });
    await tellTheCareTeam(
      tx,
      ctx,
      p.householdId,
      "A recipient acknowledged a packet",
      `/staff/packets/${p.id}`,
    );
  });
}

export const CLARIFICATION_MAX = 1000;

/** Ask the hospice a question about the packet. It reaches the care team as an escalation. */
export async function requestClarification(
  db: DB,
  ctx: ActorContext,
  input: { packetId: string; question: string },
) {
  const { p, status } = await accessFor(db, ctx, input.packetId);
  if (status !== "active")
    throw new AccessError("INVALID", "This packet is no longer available. Contact the hospice directly.");
  const question = input.question.trim();
  if (!question) throw new AccessError("INVALID", "Write your question.");
  if (question.length > CLARIFICATION_MAX)
    throw new AccessError("INVALID", `Keep it under ${CLARIFICATION_MAX} characters.`);
  await db.transaction(async (tx) => {
    const now = new Date();
    const [e] = await tx
      .insert(s.escalations)
      .values({
        tenantId: ctx.tenantId,
        householdId: p.householdId,
        kind: "packet_clarification",
        sourceType: "packet",
        sourceId: p.id,
        summary: `${ctx.displayName} (${p.recipientName}) asked about the shared packet: ${question}`,
        raisedByActorId: ctx.actorId,
        stateChangedAt: now,
      })
      .returning();
    await log(tx, ctx, p.id, "clarification_requested");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: p.householdId,
      actorId: ctx.actorId,
      action: "packet.recipient_question",
      subjectType: "packet",
      subjectId: p.id,
      summary: "The named recipient asked the care team a question about the packet.",
      visibility: "staff",
      context: { escalationId: e!.id },
    });
    await tellTheCareTeam(
      tx,
      ctx,
      p.householdId,
      "A packet recipient asked a question",
      "/staff/exceptions?view=all&kind=escalation",
    );
  });
}

/* ------------------------------------------------------------------ first-time setup */

async function setupRow(conn: Conn, token: string) {
  if (!token || token.length > 200) return null;
  const [row] = await conn
    .select({ a: s.packetRecipientAccess, actor: s.actors })
    .from(s.packetRecipientAccess)
    .innerJoin(
      s.actors,
      and(
        eq(s.actors.id, s.packetRecipientAccess.recipientActorId),
        eq(s.actors.tenantId, s.packetRecipientAccess.tenantId),
      ),
    )
    .where(
      and(
        eq(s.packetRecipientAccess.setupTokenHash, hashToken(token)),
        isNull(s.packetRecipientAccess.revokedAt),
        gt(s.packetRecipientAccess.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

export const SETUP_UNUSABLE =
  "This link can't be used. It may have been used already, or the packet is no longer available. Ask the hospice that shared it.";

export async function previewRecipientSetup(db: DB, token: string) {
  const row = await setupRow(db, token);
  if (!row) throw new AccessError("OUT_OF_SCOPE", SETUP_UNUSABLE);
  return { name: row.actor.displayName, email: row.actor.email };
}

/** Set a password for a first-time recipient. The link works once. Returns what starts a session. */
export async function completeRecipientSetup(db: DB, input: { token: string; password: string }) {
  const row = await setupRow(db, input.token);
  if (!row) throw new AccessError("OUT_OF_SCOPE", SETUP_UNUSABLE);
  const problem = passwordProblem(input.password);
  if (problem) throw new AccessError("INVALID", problem);
  if (!looksLikeEmail(row.actor.email)) throw new AccessError("INVALID", SETUP_UNUSABLE);
  const hash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const used = await tx
      .update(s.packetRecipientAccess)
      .set({ setupTokenHash: null })
      .where(
        and(
          eq(s.packetRecipientAccess.id, row.a.id),
          eq(s.packetRecipientAccess.setupTokenHash, hashToken(input.token)),
        ),
      )
      .returning({ id: s.packetRecipientAccess.id });
    if (!used.length) throw new AccessError("OUT_OF_SCOPE", SETUP_UNUSABLE);
    const [existing] = await tx.select().from(s.users).where(eq(s.users.email, row.actor.email));
    if (existing)
      throw new AccessError("CONFLICT", "This email already has a Zeporah account. Sign in instead.");
    const [u] = await tx
      .insert(s.users)
      .values({ tenantId: row.a.tenantId, actorId: row.actor.id, email: row.actor.email, passwordHash: hash })
      .returning();
    await appendAudit(tx, {
      tenantId: row.a.tenantId,
      actorId: row.actor.id,
      action: "recipient.account_created",
      subjectType: "actor",
      subjectId: row.actor.id,
      summary: "A packet recipient set up their Zeporah sign-in.",
      visibility: "staff",
    });
    return { tenantId: row.a.tenantId, actorId: row.actor.id, userId: u!.id };
  });
}

/* ------------------------------------------------------------------ staff side */

/** Recipient contact for a packet, set by whoever can draft it, while it can still be released. */
export async function recipientAccessForStaff(conn: Conn, tenantId: string, packetId: string) {
  const rows = await conn
    .select({ a: s.packetRecipientAccess, name: s.actors.displayName })
    .from(s.packetRecipientAccess)
    .innerJoin(
      s.actors,
      and(
        eq(s.actors.id, s.packetRecipientAccess.recipientActorId),
        eq(s.actors.tenantId, s.packetRecipientAccess.tenantId),
      ),
    )
    .where(
      and(eq(s.packetRecipientAccess.tenantId, tenantId), eq(s.packetRecipientAccess.packetId, packetId)),
    )
    .orderBy(desc(s.packetRecipientAccess.grantedAt));
  const log = await conn
    .select()
    .from(s.packetAccessLog)
    .where(and(eq(s.packetAccessLog.tenantId, tenantId), eq(s.packetAccessLog.packetId, packetId)))
    .orderBy(desc(s.packetAccessLog.at))
    .limit(50);
  const [p] = await conn
    .select()
    .from(s.packets)
    .where(and(eq(s.packets.tenantId, tenantId), eq(s.packets.id, packetId)));
  return rows.map(({ a, name }) => {
    const status = statusOfAccess(a, p?.state ?? "");
    return {
      id: a.id,
      name,
      grantedAt: a.grantedAt,
      expiresAt: a.expiresAt,
      status,
      statusText: STATUS_TEXT[status],
      acknowledgedAt: a.acknowledgedAt,
      accountSetUp: !a.setupTokenHash,
      history: log
        .filter((l) => l.actorId === a.recipientActorId)
        .map((l) => ({ id: l.id, action: l.action, at: l.at })),
    };
  });
}

/**
 * An outside recipient's access that has reached its end time (decision 58, plan story A-1). Access
 * already stopped at that time; this records it once (`packet.recipient_access_ended`, actor:
 * System) the first time anyone opens the workspace afterwards.
 */
export async function recordEndedRecipientAccess(db: DB, tenantId: string, now = new Date()) {
  const ended = await db
    .select({ a: s.packetRecipientAccess, p: s.packets })
    .from(s.packetRecipientAccess)
    .innerJoin(
      s.packets,
      and(
        eq(s.packets.id, s.packetRecipientAccess.packetId),
        eq(s.packets.tenantId, s.packetRecipientAccess.tenantId),
      ),
    )
    .where(
      and(
        eq(s.packetRecipientAccess.tenantId, tenantId),
        isNull(s.packetRecipientAccess.revokedAt),
        lte(s.packetRecipientAccess.expiresAt, now),
      ),
    );
  if (!ended.length) return 0;
  // One recorder at a time (two workspace loads at the same moment would otherwise both write it):
  // the check and the write share a transaction holding a lock for this tenant's access endings.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`recipient_access_ended:${tenantId}`}))`);
    const done = await tx
      .select({ subjectId: s.auditEvents.subjectId, at: s.auditEvents.createdAt })
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.tenantId, tenantId),
          eq(s.auditEvents.action, "packet.recipient_access_ended"),
          inArray(
            s.auditEvents.subjectId,
            ended.map(({ p }) => p.id),
          ),
        ),
      );
    let n = 0;
    for (const { a, p } of ended) {
      // Once per grant: an event for this packet after the grant means it's already recorded.
      if (done.some((d) => d.subjectId === p.id && d.at >= a.grantedAt)) continue;
      await appendAudit(tx, {
        tenantId,
        householdId: p.householdId,
        actorId: null,
        action: "packet.recipient_access_ended",
        subjectType: "packet",
        subjectId: p.id,
        summary: `${p.recipientName}'s access ended at its scheduled time.`,
        visibility: "sharing",
        source: "system",
        context: { accessId: a.id, endedAt: a.expiresAt.toISOString() },
      });
      n++;
    }
    return n;
  });
}
