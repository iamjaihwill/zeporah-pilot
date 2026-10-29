/**
 * Controlled sharing: authority evidence (workflow status only — never a legal determination),
 * consent, and minimum-necessary packets. Release always goes through `evaluateRelease`, and the
 * release and its audit event are written in one transaction: if the audit write fails, nothing
 * is released and the answer is a deny.
 */
import { assertMayRemove } from "./retention";
import {
  alertedPackets,
  endRecipientAccess,
  grantRecipientAccess,
  recipientAccessForStaff,
} from "./recipient";
import { REVOCATION_NOTE, releaseNote } from "@/domain/claims";
import { mailChannel } from "../mail";
import { trySendingNow } from "./outbox";
import { usedPreparedDraft } from "./prepared";
import { CORRECTION_CATEGORY_LABELS, type CorrectionCategory } from "@/domain/consent";
import { closeOpenCorrection } from "./corrections";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { looksLikeEmail, normalizeEmail } from "../auth/crypto";
import { devSignInEnabled } from "../auth/dev-gate";
import { reasonLabel } from "@/domain/labels";

/** Plain words for consent fields, in audit summaries people read. */
const CHANGED_WORDS: Record<string, string> = {
  purpose: "why it's shared",
  recipient: "who receives it",
  scope: "what's included",
  start: "the start date",
  expiry: "the end date",
  "revocation terms": "how to withdraw it",
};
import {
  AccessError,
  requireStaffPermission,
  staffScope,
  staffVisibleHouseholds,
  type ActorContext,
} from "../context";
import {
  actorNames,
  careGuidesFor,
  consentWorkflow,
  effectiveAuthority,
  grantorCanSelfConfirm,
  grantorEligibility,
  householdEvidence,
  householdMembers,
  membersWho,
  notify,
  staffWithRole,
} from "./common";
import {
  AUTHORITY_STATUS_NOTE,
  IDENTITY_LINK_BASES,
  IDENTITY_LINK_BASIS_LABELS,
  compareHolders,
  effectiveAuthorityState,
  type IdentityLinkBasis,
} from "@/domain/authority-identity";
import { CONSENT_STAGE_LABELS } from "@/domain/consent";
import { evaluateRelease, type ReleaseDecision, type ReleaseInput } from "@/domain/policy/evaluate-release";
import { REASONS } from "@/domain/policy/reason-codes";
import { can } from "@/domain/permissions";
import {
  AUTHORITY_TYPE_LABELS,
  SHARE_CATEGORIES,
  SHARE_CATEGORY_LABELS,
  type AuthorityState,
  type AuthorityType,
  type ConsentState,
  type LifecycleState,
  type PacketState,
  type ShareCategory,
} from "@/domain/model";

/* ------------------------------------------------------------------ helpers */

/** Households this staff member can see (the shared rule in context.ts). */
async function visibleHouseholdIds(conn: Conn, ctx: ActorContext) {
  return (await staffVisibleHouseholds(conn, ctx)).map((h) => h.id);
}

/**
 * Find a packet for a staff member. A packet in another tenant, or in a household they can't
 * see, is treated exactly like a missing one — and the attempt is audited.
 */
async function packetForStaff(conn: Conn, ctx: ActorContext, packetId: string) {
  if (ctx.kind !== "staff") throw new AccessError("NOT_PERMITTED", "This area is for the hospice care team.");
  const [p] = await conn
    .select()
    .from(s.packets)
    .where(and(eq(s.packets.tenantId, ctx.tenantId), eq(s.packets.id, packetId)));
  if (p && (await visibleHouseholdIds(conn, ctx)).includes(p.householdId)) return p;
  await appendAudit(conn, {
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "access.denied",
    subjectType: "packet",
    subjectId: packetId,
    decision: "deny",
    reasonCode: "OUT_OF_SCOPE",
    summary: "A request for a packet outside this person's scope was refused.",
    visibility: "staff",
  });
  return null;
}

async function releaseInput(
  conn: Conn,
  ctx: ActorContext,
  p: typeof s.packets.$inferSelect,
  now: Date,
): Promise<ReleaseInput> {
  const [h] = await conn
    .select()
    .from(s.households)
    .where(and(eq(s.households.tenantId, p.tenantId), eq(s.households.id, p.householdId)));
  const manifest = await conn
    .select({ c: s.packetManifestItems.category })
    .from(s.packetManifestItems)
    .where(and(eq(s.packetManifestItems.tenantId, p.tenantId), eq(s.packetManifestItems.packetId, p.id)));
  const authority = p.authorityEvidenceId
    ? await effectiveAuthority(conn, p.tenantId, p.authorityEvidenceId)
    : null;
  const [consent] = p.consentId
    ? await conn
        .select()
        .from(s.consents)
        .where(and(eq(s.consents.tenantId, p.tenantId), eq(s.consents.id, p.consentId)))
    : [];
  // The evaluator sees the household's confirmation of the current version, and the state as
  // "active" only when the reviewer's activation is for that same version.
  const wf = consent ? await consentWorkflow(conn, consent, now) : null;
  const consentConfirmed = !!wf?.confirmation;
  const consentState = (
    consent?.state === "active" && consent.activatedVersion !== consent.version ? "draft" : consent?.state
  ) as ConsentState;
  return {
    now,
    actor: { id: ctx.actorId, tenantId: ctx.tenantId, authenticated: true, roles: ctx.staffRoles },
    packet: {
      id: p.id,
      tenantId: p.tenantId,
      householdId: p.householdId,
      state: p.state as PacketState,
      purpose: p.purpose,
      recipientName: p.recipientName,
      manifest: manifest.map((m) => m.c as ShareCategory),
      expiresAt: p.expiresAt,
    },
    household: { tenantId: h!.tenantId, lifecycle: h!.lifecycleState as LifecycleState },
    authority: authority
      ? {
          tenantId: authority.tenantId,
          householdId: authority.householdId,
          state: authority.effectiveState,
          type: authority.authorityType,
        }
      : null,
    consent: consent
      ? {
          tenantId: consent.tenantId,
          householdId: consent.householdId,
          state: consentState,
          purpose: consent.purpose,
          recipientName: consent.recipientName,
          scope: consent.scope as ShareCategory[],
          startsAt: consent.startsAt,
          expiresAt: consent.expiresAt,
          confirmed: consentConfirmed,
          correctionPending: !!wf?.correction,
        }
      : null,
  };
}

/** Reasons that need a person to look, not just a missing field. */
const ESCALATE_ON = new Set([
  "AUTHORITY_CONFLICT",
  "AUTHORITY_REVIEW_PENDING",
  "AUTHORITY_NOT_ACTIVE",
  "AUTHORITY_ENDED_BY_LIFECYCLE",
  "CONSENT_REVOKED",
  "LIFECYCLE_SCOPE_NARROWED",
]);

const outOfScope = (): ReleaseDecision & { receiptId?: string } => ({
  decision: "deny",
  reasonCode: "OUT_OF_SCOPE",
  explanation: REASONS.OUT_OF_SCOPE.explain,
  auditContext: {
    checks: [{ check: "scope", passed: false }],
    packetId: "",
    actorId: null,
    evaluatedAt: new Date().toISOString(),
  },
});

/* ------------------------------------------------------------------ packets */

/** What would happen if release were requested now. Changes nothing and writes no audit event. */
export async function previewRelease(db: DB, ctx: ActorContext, packetId: string) {
  const p = await packetForStaff(db, ctx, packetId);
  if (!p) return outOfScope();
  return evaluateRelease(await releaseInput(db, ctx, p, new Date()));
}

type Deps = { appendAudit: typeof appendAudit };

/**
 * Ask to release a packet. Every outcome — allow, hold or deny — is recorded as an immutable audit
 * event. On allow, the release, receipt and audit event commit together or not at all.
 */
export async function requestRelease(
  db: DB,
  ctx: ActorContext,
  packetId: string,
  deps: Deps = { appendAudit },
) {
  const now = new Date();
  // The recipient's sign-in alert, saved with the release and sent after it commits (decision 88).
  let alert: string | null = null;
  try {
    const out = await db.transaction(async (tx) => {
      const p = await packetForStaff(tx, ctx, packetId);
      if (!p) return outOfScope();
      const input = await releaseInput(tx, ctx, p, now);
      const result = evaluateRelease(input);
      // Decision 48c: the alert goes out exactly when a recipient is named and email exists.
      const alerts = !!p.recipientEmail && mailChannel() !== null;
      const event = await deps.appendAudit(tx, {
        tenantId: ctx.tenantId,
        householdId: p.householdId,
        actorId: ctx.actorId,
        action: result.decision === "allow" ? "packet.released" : "packet.release_requested",
        subjectType: "packet",
        subjectId: p.id,
        decision: result.decision,
        reasonCode: result.reasonCode,
        summary:
          result.decision === "allow"
            ? `Release to ${p.recipientName} for: ${p.purpose}. ${releaseNote(alerts)}`
            : `A release was requested and ${result.decision === "hold" ? "held" : "denied"}: ${result.explanation}`,
        visibility: result.decision === "allow" ? "sharing" : "staff",
        context: { ...result.auditContext, manifest: input.packet.manifest },
        at: now,
      });

      if (result.decision === "allow") {
        const opened = await tx
          .update(s.packets)
          .set({ state: "released", lastReasonCode: result.reasonCode, updatedAt: now })
          .where(
            and(
              eq(s.packets.tenantId, ctx.tenantId),
              eq(s.packets.id, p.id),
              or(eq(s.packets.state, "draft"), eq(s.packets.state, "held")),
            ),
          )
          .returning({ id: s.packets.id });
        // Defense in depth: the evaluator already refuses a closed packet, but never write a second receipt.
        if (!opened.length) throw new AccessError("CONFLICT", REASONS.PACKET_NOT_RELEASABLE.explain);
        const [receipt] = await tx
          .insert(s.packetReleaseReceipts)
          .values({
            tenantId: ctx.tenantId,
            packetId: p.id,
            releasedByActorId: ctx.actorId,
            releasedAt: now,
            recipientName: p.recipientName,
            purpose: p.purpose,
            manifest: [...input.packet.manifest],
            expiresAt: p.expiresAt,
            auditEventId: event.id,
          })
          .returning();
        // Decision 45: the named recipient can now read it in Zeporah, read-only, until it expires.
        alert =
          (await grantRecipientAccess(tx, ctx, p, { id: receipt!.id, expiresAt: p.expiresAt }))?.alertId ??
          null;
        const household = await membersWho(tx, ctx.tenantId, p.householdId, input.household.lifecycle, {
          permission: "consent.view",
        });
        await notify(tx, {
          tenantId: ctx.tenantId,
          householdId: p.householdId,
          recipients: household.map((m) => m.actorId),
          kind: "sharing",
          title: "A release was recorded",
          link: "/family/sharing",
        });
        return { ...result, receiptId: receipt!.id };
      }
      if (result.decision === "hold") {
        // Only an open packet becomes "held". A request on a released, revoked or denied packet is
        // recorded but never changes its state — otherwise it could be released a second time.
        await tx
          .update(s.packets)
          .set({ state: "held", lastReasonCode: result.reasonCode, updatedAt: now })
          .where(
            and(
              eq(s.packets.tenantId, ctx.tenantId),
              eq(s.packets.id, p.id),
              or(eq(s.packets.state, "draft"), eq(s.packets.state, "held")),
            ),
          );
        if (ESCALATE_ON.has(result.reasonCode)) {
          const open = await tx
            .select({ id: s.escalations.id })
            .from(s.escalations)
            .where(
              and(
                eq(s.escalations.tenantId, ctx.tenantId),
                eq(s.escalations.sourceType, "packet"),
                eq(s.escalations.sourceId, p.id),
                ne(s.escalations.status, "resolved"),
              ),
            );
          if (!open.length) {
            await tx.insert(s.escalations).values({
              tenantId: ctx.tenantId,
              householdId: p.householdId,
              kind: "policy_hold",
              sourceType: "packet",
              sourceId: p.id,
              summary: `Release to ${p.recipientName} is on hold (${reasonLabel(result.reasonCode).toLowerCase()}). A person needs to review it.`,
            });
            await notify(tx, {
              tenantId: ctx.tenantId,
              householdId: p.householdId,
              recipients: await staffWithRole(tx, ctx.tenantId, "privileged_reviewer"),
              kind: "escalation",
              title: "A sharing hold needs a person to review it",
              link: "/staff/exceptions?view=all&kind=escalation",
            });
          }
        }
      }
      if (result.decision === "deny" && result.reasonCode === "HOUSEHOLD_CLOSED") {
        await tx
          .update(s.packets)
          .set({ state: "denied", lastReasonCode: result.reasonCode, updatedAt: now })
          .where(and(eq(s.packets.tenantId, ctx.tenantId), eq(s.packets.id, p.id)));
      }
      return result;
    });
    await trySendingNow(db, [alert]);
    return out;
  } catch (e) {
    if (e instanceof AccessError) throw e;
    // Gate 10: no audit event, no release. Nothing above was committed.
    return {
      decision: "deny" as const,
      reasonCode: "AUDIT_UNAVAILABLE" as const,
      explanation: REASONS.AUDIT_UNAVAILABLE.explain,
      auditContext: {
        checks: [{ check: "audit", passed: false }],
        packetId,
        actorId: ctx.actorId,
        evaluatedAt: now.toISOString(),
      },
    };
  }
}

export async function listPackets(db: DB, ctx: ActorContext) {
  if (ctx.kind !== "staff") throw new AccessError("NOT_PERMITTED", "This area is for the hospice care team.");
  const ids = await visibleHouseholdIds(db, ctx);
  if (!ids.length) return [];
  const rows = await db
    .select()
    .from(s.packets)
    .where(and(eq(s.packets.tenantId, ctx.tenantId), inArray(s.packets.householdId, ids)))
    .orderBy(desc(s.packets.updatedAt));
  const hh = await db
    .select({ id: s.households.id, name: s.households.displayName })
    .from(s.households)
    .where(eq(s.households.tenantId, ctx.tenantId));
  const now = new Date();
  const receipts = rows.length
    ? await db
        .select({ packetId: s.packetReleaseReceipts.packetId, at: s.packetReleaseReceipts.releasedAt })
        .from(s.packetReleaseReceipts)
        .where(
          and(
            eq(s.packetReleaseReceipts.tenantId, ctx.tenantId),
            inArray(
              s.packetReleaseReceipts.packetId,
              rows.map((r) => r.id),
            ),
          ),
        )
    : [];
  // What each named recipient has done in their portal (decision 45), for staff: the latest of
  // asked a question, acknowledged or opened. Only the recipient's own actions are counted.
  const ids2 = rows.map((r) => r.id);
  const access = ids2.length
    ? await db
        .select()
        .from(s.packetRecipientAccess)
        .where(
          and(
            eq(s.packetRecipientAccess.tenantId, ctx.tenantId),
            inArray(s.packetRecipientAccess.packetId, ids2),
          ),
        )
    : [];
  const accessLog = ids2.length
    ? await db
        .select()
        .from(s.packetAccessLog)
        .where(and(eq(s.packetAccessLog.tenantId, ctx.tenantId), inArray(s.packetAccessLog.packetId, ids2)))
        .orderBy(desc(s.packetAccessLog.at))
    : [];
  const recipientProgress = (packetId: string) => {
    const a = access.filter((x) => x.packetId === packetId);
    if (!a.length) return null;
    const mine = accessLog.filter(
      (l) => l.packetId === packetId && a.some((x) => x.recipientActorId === l.actorId),
    );
    if (mine[0]?.action === "clarification_requested") return "Asked a question";
    if (a.some((x) => x.acknowledgedAt) || mine.some((l) => l.action === "acknowledged"))
      return "Acknowledged";
    if (mine.some((l) => l.action === "viewed")) return "Opened";
    return "Not opened yet";
  };
  const SOON_MS = 7 * 24 * 3_600_000;
  const list = await Promise.all(
    rows.map(async (p) => {
      const input = await releaseInput(db, ctx, p, now);
      const preview = evaluateRelease(input);
      // The packet's own checks, whoever is looking: the same evaluation for a role that may
      // release. Shown in the list so a care guide sees "ready" or "held because…" rather than
      // "your role can't release" on every row. Never used to release anything.
      const packetCheck = evaluateRelease({
        ...input,
        actor: { ...input.actor, roles: ["hospice_ops"] },
      });
      const released = receipts
        .filter((r) => r.packetId === p.id)
        .map((r) => r.at)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        /** Past its expiry: shown as expired and listed last, whatever its state. */
        expired: p.expiresAt.getTime() <= now.getTime(),
        releasedAt: released ?? null,
        id: p.id,
        householdId: p.householdId,
        household: hh.find((x) => x.id === p.householdId)?.name ?? "",
        purpose: p.purpose,
        recipientName: p.recipientName,
        state: p.state,
        expiresAt: p.expiresAt,
        updatedAt: p.updatedAt,
        preview: {
          decision: preview.decision,
          reasonCode: preview.reasonCode,
          explanation: preview.explanation,
        },
        packetCheck: { decision: packetCheck.decision, reasonCode: packetCheck.reasonCode },
        canRelease: can(ctx.staffRoles, "packet.release"),
        /** The categories it carries (minimum-necessary), as labels. */
        manifest: input.packet.manifest.map((c) => SHARE_CATEGORY_LABELS[c]),
        /** Not yet released and ending within 7 days: a flag, not a countdown (times stay absolute). */
        endsSoon:
          ["draft", "held", "denied"].includes(p.state) &&
          p.expiresAt.getTime() > now.getTime() &&
          p.expiresAt.getTime() - now.getTime() <= SOON_MS,
        recipient: recipientProgress(p.id),
      };
    }),
  );
  return list.sort((a, b) => Number(a.expired) - Number(b.expired));
}

export async function getPacket(db: DB, ctx: ActorContext, packetId: string) {
  const p = await packetForStaff(db, ctx, packetId);
  if (!p) throw new AccessError("OUT_OF_SCOPE", REASONS.OUT_OF_SCOPE.explain);
  const input = await releaseInput(db, ctx, p, new Date());
  const preview = evaluateRelease(input);
  const [h] = await db
    .select()
    .from(s.households)
    .where(and(eq(s.households.tenantId, ctx.tenantId), eq(s.households.id, p.householdId)));
  const authority = p.authorityEvidenceId
    ? await effectiveAuthority(db, ctx.tenantId, p.authorityEvidenceId)
    : null;
  const [consent] = p.consentId
    ? await db
        .select()
        .from(s.consents)
        .where(and(eq(s.consents.tenantId, ctx.tenantId), eq(s.consents.id, p.consentId)))
    : [];
  const consentStageNow = consent ? (await consentWorkflow(db, consent)).stage : "needs_review";
  const receipts = await db
    .select()
    .from(s.packetReleaseReceipts)
    .where(
      and(eq(s.packetReleaseReceipts.tenantId, ctx.tenantId), eq(s.packetReleaseReceipts.packetId, p.id)),
    )
    .orderBy(desc(s.packetReleaseReceipts.releasedAt));
  const events = await db
    .select()
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.tenantId, ctx.tenantId),
        eq(s.auditEvents.subjectType, "packet"),
        eq(s.auditEvents.subjectId, p.id),
      ),
    )
    .orderBy(desc(s.auditEvents.seq));
  const names = await actorNames(db, ctx.tenantId, [
    ...events.map((e) => e.actorId),
    ...receipts.map((r) => r.releasedByActorId),
    p.createdByActorId,
  ]);
  const consents = await db
    .select()
    .from(s.consents)
    .where(and(eq(s.consents.tenantId, ctx.tenantId), eq(s.consents.householdId, p.householdId)));
  const evidence = await db
    .select()
    .from(s.authorityEvidence)
    .where(
      and(eq(s.authorityEvidence.tenantId, ctx.tenantId), eq(s.authorityEvidence.householdId, p.householdId)),
    );
  return {
    packet: { ...p, createdBy: names.get(p.createdByActorId) ?? "" },
    household: { id: h!.id, name: h!.displayName, lifecycle: h!.lifecycleState as LifecycleState },
    manifest: input.packet.manifest.map((c) => ({ category: c, label: SHARE_CATEGORY_LABELS[c] })),
    allCategories: SHARE_CATEGORIES.map((c) => ({ category: c, label: SHARE_CATEGORY_LABELS[c] })),
    authority: authority
      ? {
          id: authority.id,
          holderName: authority.holderName,
          type: AUTHORITY_TYPE_LABELS[authority.authorityType],
          state: authority.effectiveState,
        }
      : null,
    consent: consent
      ? {
          id: consent.id,
          purpose: consent.purpose,
          recipientName: consent.recipientName,
          scope: (consent.scope as ShareCategory[]).map((c) => SHARE_CATEGORY_LABELS[c]),
          state: consentStageNow,
          stageLabel: CONSENT_STAGE_LABELS[consentStageNow],
          version: consent.version,
          expiresAt: consent.expiresAt,
        }
      : null,
    preview,
    canRelease: can(ctx.staffRoles, "packet.release"),
    canDraft: can(ctx.staffRoles, "packet.draft"),
    canRevoke: can(ctx.staffRoles, "packet.revoke"),
    recipientAccess: await recipientAccessForStaff(db, ctx.tenantId, p.id),
    releaseNote: releaseNote((await alertedPackets(db, ctx.tenantId, [p.id])).has(p.id)),
    receipts: receipts.map((r) => ({ ...r, releasedBy: names.get(r.releasedByActorId) ?? "" })),
    events: events.map((e) => ({
      id: e.id,
      at: e.createdAt,
      actor: e.actorId ? (names.get(e.actorId) ?? "") : "System",
      action: e.action,
      decision: e.decision,
      reasonCode: e.reasonCode,
      summary: e.summary,
    })),
    options: {
      consents: consents.map((c) => ({
        id: c.id,
        label: `${c.recipientName} — ${c.purpose} (version ${c.version}, ${c.state})`,
      })),
      authority: evidence.map((e) => ({
        id: e.id,
        label: `${e.holderName} — ${AUTHORITY_TYPE_LABELS[e.authorityType as AuthorityType]} (${e.state})`,
      })),
    },
  };
}

export async function setManifest(
  db: DB,
  ctx: ActorContext,
  input: { packetId: string; categories: ShareCategory[] },
) {
  const p = await packetForStaff(db, ctx, input.packetId);
  if (!p) throw new AccessError("OUT_OF_SCOPE", REASONS.OUT_OF_SCOPE.explain);
  await staffScope(db, ctx, p.householdId, "packet.draft");
  if (p.state !== "draft" && p.state !== "held")
    throw new AccessError("INVALID", "Only a draft or held packet can be changed.");
  const cats = [...new Set(input.categories)].filter((c) =>
    (SHARE_CATEGORIES as readonly string[]).includes(c),
  );
  await db.transaction(async (tx) => {
    await assertMayRemove(tx, {
      tenantId: ctx.tenantId,
      householdId: p.householdId,
      table: "packet_manifest_items",
      purpose: "correction",
    });
    await tx
      .delete(s.packetManifestItems)
      .where(and(eq(s.packetManifestItems.tenantId, ctx.tenantId), eq(s.packetManifestItems.packetId, p.id)));
    if (cats.length)
      await tx
        .insert(s.packetManifestItems)
        .values(cats.map((category) => ({ tenantId: ctx.tenantId, packetId: p.id, category })));
    await tx
      .update(s.packets)
      .set({ updatedAt: new Date() })
      .where(and(eq(s.packets.tenantId, ctx.tenantId), eq(s.packets.id, p.id)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: p.householdId,
      actorId: ctx.actorId,
      action: "packet.manifest_changed",
      subjectType: "packet",
      subjectId: p.id,
      summary: `The packet's contents were set to ${cats.length} categor${cats.length === 1 ? "y" : "ies"}.`,
      visibility: "staff",
      context: { categories: cats },
    });
  });
}

export type NewPacket = {
  householdId: string;
  purpose: string;
  recipientName: string;
  consentId: string | null;
  authorityEvidenceId: string | null;
  expiresAt: Date;
  categories: ShareCategory[];
  /** The person started from the prepared manifest suggestion (decision 58, workstream 5). */
  prepared?: boolean | undefined;
};

export async function createPacket(db: DB, ctx: ActorContext, input: NewPacket) {
  const scope = await staffScope(db, ctx, input.householdId, "packet.draft");
  const prepared = await usedPreparedDraft(db, ctx, scope.householdId, input.prepared);
  // Links must belong to the same household; the composite keys also refuse other tenants.
  const sameHousehold = async (table: typeof s.consents | typeof s.authorityEvidence, id: string | null) =>
    !id ||
    (
      await db
        .select({ id: table.id })
        .from(table)
        .where(
          and(eq(table.tenantId, ctx.tenantId), eq(table.id, id), eq(table.householdId, scope.householdId)),
        )
    ).length === 1;
  if (
    !(await sameHousehold(s.consents, input.consentId)) ||
    !(await sameHousehold(s.authorityEvidence, input.authorityEvidenceId))
  )
    throw new AccessError("INVALID", "Consent and authority must belong to this household.");
  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(s.packets)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        purpose: input.purpose.trim(),
        recipientName: input.recipientName.trim(),
        consentId: input.consentId,
        authorityEvidenceId: input.authorityEvidenceId,
        expiresAt: input.expiresAt,
        createdByActorId: ctx.actorId,
      })
      .returning();
    const cats = [...new Set(input.categories)];
    if (cats.length)
      await tx
        .insert(s.packetManifestItems)
        .values(cats.map((category) => ({ tenantId: ctx.tenantId, packetId: p!.id, category })));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "packet.drafted",
      subjectType: "packet",
      subjectId: p!.id,
      summary: "A sharing packet was drafted for review.",
      visibility: "staff",
      context: { categories: cats },
      ...(prepared ? { prepared: true } : {}),
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: await staffWithRole(tx, ctx.tenantId, "hospice_ops"),
      kind: "packet",
      title: "A packet is ready for a release check",
      link: `/staff/packets/${p!.id}`,
    });
    return p!;
  });
}

/**
 * The named person at the recipient who'll read a released packet in Zeporah (decision 45). Set
 * by whoever drafts packets, only while it can still be released. Audit-logged.
 */
export async function setPacketRecipientContact(
  db: DB,
  ctx: ActorContext,
  input: { packetId: string; name: string; email: string },
) {
  const p = await packetForStaff(db, ctx, input.packetId);
  if (!p) throw new AccessError("OUT_OF_SCOPE", REASONS.OUT_OF_SCOPE.explain);
  await staffScope(db, ctx, p.householdId, "packet.draft");
  if (p.state !== "draft" && p.state !== "held")
    throw new AccessError("INVALID", "The recipient can only change before release.");
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name || name.length > 120) throw new AccessError("INVALID", "Add the recipient's name.");
  if (!looksLikeEmail(email)) throw new AccessError("INVALID", "Enter the recipient's email address.");
  await db.transaction(async (tx) => {
    await tx
      .update(s.packets)
      .set({ recipientContactName: name, recipientEmail: email, updatedAt: new Date() })
      .where(and(eq(s.packets.tenantId, ctx.tenantId), eq(s.packets.id, p.id)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: p.householdId,
      actorId: ctx.actorId,
      action: "packet.recipient_contact_set",
      subjectType: "packet",
      subjectId: p.id,
      summary: `The person who will read this packet at ${p.recipientName} was set.`,
      visibility: "staff",
      context: { before: p.recipientEmail ?? null, after: email },
    });
  });
}

export async function revokePacket(db: DB, ctx: ActorContext, input: { packetId: string; reason: string }) {
  const p = await packetForStaff(db, ctx, input.packetId);
  if (!p) throw new AccessError("OUT_OF_SCOPE", REASONS.OUT_OF_SCOPE.explain);
  await staffScope(db, ctx, p.householdId, "packet.revoke");
  if (p.state === "revoked") throw new AccessError("INVALID", "This packet is already revoked.");
  await db.transaction(async (tx) => {
    await tx
      .update(s.packets)
      .set({ state: "revoked", updatedAt: new Date() })
      .where(
        and(eq(s.packets.tenantId, ctx.tenantId), eq(s.packets.id, p.id), eq(s.packets.state, "released")),
      )
      .returning({ id: s.packets.id })
      .then((r) => {
        if (!r.length) throw new AccessError("CONFLICT", "This release was already revoked.");
      });
    await endRecipientAccess(tx, ctx.tenantId, p.id);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: p.householdId,
      actorId: ctx.actorId,
      action: "packet.revoked",
      subjectType: "packet",
      subjectId: p.id,
      summary: `Release to ${p.recipientName} revoked. ${REVOCATION_NOTE}`,
      visibility: "sharing",
      context: { reason: input.reason },
    });
  });
}

export type PolicyRow = {
  label: string;
  decision: string;
  reasonCode: string;
  explanation: string;
  /** "runtime": what the running app returns for this request. "evaluator": the pure check alone. */
  source: "runtime" | "evaluator";
  note?: string;
};

/**
 * The policy scenario board: every packet this person can see, evaluated as if they asked now,
 * plus two constructed requests. Constructed rows show the RUNTIME result — the same value
 * requestRelease returns — and, where it differs, the evaluator-only result clearly labelled.
 * Nothing here touches another tenant's data or writes an audit event.
 */
/**
 * Policy scenarios is a testing tool: available on development servers (the same gate as persona
 * sign-in) or to hospice operations. Everyone else is refused, matching the navigation.
 */
export async function policyScenarios(db: DB, ctx: ActorContext) {
  if (ctx.kind !== "staff" || !(devSignInEnabled() || ctx.staffRoles.includes("hospice_ops")))
    throw new AccessError("NOT_PERMITTED", "Your role doesn't include this page.");
  const packets = await listPackets(db, ctx);
  const okafor = packets.find((p) => p.id === "pk-okafor-respite");
  const constructed: PolicyRow[] = [];
  if (okafor) {
    const [row] = await db
      .select()
      .from(s.packets)
      .where(and(eq(s.packets.tenantId, ctx.tenantId), eq(s.packets.id, okafor.id)));
    const base = await releaseInput(db, ctx, row!, new Date());
    // At runtime a request from another tenant never reaches the evaluator: the packet lookup is
    // tenant-scoped, finds nothing, and requestRelease returns outOfScope().
    const runtime = outOfScope();
    const evaluatorOnly = evaluateRelease({ ...base, actor: { ...base.actor, tenantId: "t-cedar" } });
    const guide = evaluateRelease({ ...base, actor: { ...base.actor, roles: ["care_guide"] } });
    constructed.push(
      {
        label: "Someone at Cedar Valley Hospice asks to release the Okafor respite packet",
        decision: runtime.decision,
        reasonCode: runtime.reasonCode,
        explanation: runtime.explanation,
        source: "runtime",
      },
      {
        label: "Same request, evaluator-only simulation",
        decision: evaluatorOnly.decision,
        reasonCode: evaluatorOnly.reasonCode,
        explanation: evaluatorOnly.explanation,
        source: "evaluator",
        note: "Defense in depth only. At runtime this request is stopped earlier with OUT_OF_SCOPE, because the packet isn't found in the requester's organization.",
      },
      {
        label: "A care guide asks to release the Okafor respite packet",
        decision: guide.decision,
        reasonCode: guide.reasonCode,
        explanation: guide.explanation,
        source: "runtime",
      },
    );
  }
  return { packets, constructed };
}

/* ------------------------------------------------------------------ authority evidence */

export async function listAuthority(db: DB, ctx: ActorContext, householdId: string) {
  const scope = await staffScope(db, ctx, householdId, "staff.household.view");
  const ev = await householdEvidence(db, ctx.tenantId, scope.householdId);
  ev.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const ids = ev.map((e) => e.id);
  const versions = ids.length
    ? await db
        .select()
        .from(s.authorityEvidenceVersions)
        .where(
          and(
            eq(s.authorityEvidenceVersions.tenantId, ctx.tenantId),
            inArray(s.authorityEvidenceVersions.evidenceId, ids),
          ),
        )
        .orderBy(s.authorityEvidenceVersions.versionNo)
    : [];
  const reviews = ids.length
    ? await db
        .select()
        .from(s.authorityReviews)
        .where(
          and(eq(s.authorityReviews.tenantId, ctx.tenantId), inArray(s.authorityReviews.evidenceId, ids)),
        )
        .orderBy(desc(s.authorityReviews.createdAt))
    : [];
  const links = ids.length
    ? await db
        .select()
        .from(s.authorityIdentityLinks)
        .where(
          and(
            eq(s.authorityIdentityLinks.tenantId, ctx.tenantId),
            inArray(s.authorityIdentityLinks.evidenceId, ids),
          ),
        )
        .orderBy(desc(s.authorityIdentityLinks.linkedAt))
    : [];
  const members = await householdMembers(db, ctx.tenantId, scope.householdId);
  const names = await actorNames(db, ctx.tenantId, [
    ...versions.map((v) => v.submittedByActorId),
    ...reviews.map((r) => r.reviewerActorId),
    ...links.flatMap((l) => [l.actorId, l.linkedByActorId]),
    ...ev.map((e) => e.holderActorId),
  ]);
  return {
    evidence: ev.map((e) => ({
      id: e.id,
      holderName: e.holderName,
      holderActorId: e.holderActorId,
      linkedPerson: e.holderActorId ? (names.get(e.holderActorId) ?? null) : null,
      type: e.authorityType as AuthorityType,
      typeLabel: AUTHORITY_TYPE_LABELS[e.authorityType as AuthorityType],
      state: e.state as AuthorityState,
      effectiveState: effectiveAuthorityState(e, ev),
      versions: versions
        .filter((v) => v.evidenceId === e.id)
        .map((v) => ({
          ...v,
          current: v.id === e.currentVersionId,
          submittedBy: names.get(v.submittedByActorId) ?? "",
        })),
      reviews: reviews
        .filter((r) => r.evidenceId === e.id)
        .map((r) => ({ ...r, reviewer: names.get(r.reviewerActorId) ?? "" })),
      links: links
        .filter((l) => l.evidenceId === e.id)
        .map((l) => ({
          id: l.id,
          person: names.get(l.actorId) ?? "",
          basis: l.basis,
          basisLabel: IDENTITY_LINK_BASIS_LABELS[l.basis],
          note: l.note,
          linkedBy: names.get(l.linkedByActorId) ?? "",
          linkedAt: l.linkedAt,
          superseded: !!l.supersededAt,
        })),
    })),
    members: members.map((m) => ({ actorId: m.actorId, name: m.name })),
    canReview: can(ctx.staffRoles, "authority.review"),
    canSubmit: can(ctx.staffRoles, "authority.submit"),
  };
}

export async function reviewQueue(db: DB, ctx: ActorContext) {
  requireStaffPermission(ctx, "authority.review");
  const rows = await db
    .select({ e: s.authorityEvidence, household: s.households.displayName })
    .from(s.authorityEvidence)
    .innerJoin(
      s.households,
      and(
        eq(s.households.id, s.authorityEvidence.householdId),
        eq(s.households.tenantId, s.authorityEvidence.tenantId),
      ),
    )
    .where(eq(s.authorityEvidence.tenantId, ctx.tenantId))
    .orderBy(s.authorityEvidence.updatedAt);
  const byHousehold = new Map<string, (typeof rows)[number]["e"][]>();
  for (const r of rows) byHousehold.set(r.e.householdId, [...(byHousehold.get(r.e.householdId) ?? []), r.e]);
  const authority = rows
    .map((r) => ({ r, eff: effectiveAuthorityState(r.e, byHousehold.get(r.e.householdId) ?? []) }))
    .filter(({ eff }) => eff === "review_pending" || eff === "conflict" || eff === "identity_unresolved")
    .map(({ r, eff }) => ({
      id: r.e.id,
      householdId: r.e.householdId,
      household: r.household,
      holderName: r.e.holderName,
      type: AUTHORITY_TYPE_LABELS[r.e.authorityType as AuthorityType],
      state: eff,
      updatedAt: r.e.updatedAt,
    }));
  const drafts = await db
    .select({ c: s.consents, household: s.households.displayName })
    .from(s.consents)
    .innerJoin(
      s.households,
      and(eq(s.households.id, s.consents.householdId), eq(s.households.tenantId, s.consents.tenantId)),
    )
    .where(and(eq(s.consents.tenantId, ctx.tenantId), eq(s.consents.state, "draft")));
  const consents = [];
  for (const d of drafts) {
    const wf = await consentWorkflow(db, d.c);
    consents.push({
      id: d.c.id,
      householdId: d.c.householdId,
      household: d.household,
      purpose: d.c.purpose,
      recipientName: d.c.recipientName,
      createdAt: d.c.createdAt,
      stage: wf.stage,
      stageLabel: CONSENT_STAGE_LABELS[wf.stage],
      canActivate:
        wf.stage === "awaiting_activation" &&
        d.c.recordedByActorId !== ctx.actorId &&
        can(ctx.staffRoles, "consent.activate"),
      recordedByMe: d.c.recordedByActorId === ctx.actorId,
    });
  }
  return { authority, consents };
}

export type EvidenceInput = {
  householdId: string;
  evidenceId?: string | undefined;
  holderName: string;
  holderActorId?: string | null | undefined;
  authorityType: AuthorityType;
  documentLabel: string;
  effectiveDate?: string | undefined;
  note?: string | undefined;
};

async function openIdentityReview(
  tx: Conn,
  ctx: ActorContext,
  householdId: string,
  evidenceId: string,
  summary: string,
) {
  const open = await tx
    .select({ id: s.escalations.id })
    .from(s.escalations)
    .where(
      and(
        eq(s.escalations.tenantId, ctx.tenantId),
        eq(s.escalations.householdId, householdId),
        eq(s.escalations.kind, "identity_review"),
        eq(s.escalations.sourceId, evidenceId),
        ne(s.escalations.status, "resolved"),
      ),
    );
  if (open.length) return;
  await tx.insert(s.escalations).values({
    tenantId: ctx.tenantId,
    householdId,
    kind: "identity_review",
    sourceType: "authority_evidence",
    sourceId: evidenceId,
    summary,
  });
  await appendAudit(tx, {
    tenantId: ctx.tenantId,
    householdId,
    actorId: ctx.actorId,
    action: "authority.identity_review_opened",
    subjectType: "authority_evidence",
    subjectId: evidenceId,
    decision: "hold",
    reasonCode: "AUTHORITY_IDENTITY_UNRESOLVED",
    summary: "An authority record isn't linked to a verified household person; it is held for a reviewer.",
    visibility: "staff",
  });
}

/** Mark records of one type in conflict when they are linked to different people; never by name. */
async function markConflicts(tx: Conn, ctx: ActorContext, householdId: string, evidenceId: string) {
  const all = await householdEvidence(tx, ctx.tenantId, householdId);
  const me = all.find((e) => e.id === evidenceId)!;
  const different = all.filter(
    (e) =>
      e.id !== me.id &&
      e.authorityType === me.authorityType &&
      ["workflow_active", "review_pending", "conflict"].includes(e.state) &&
      compareHolders(me, e) === "different",
  );
  if (!different.length) return false;
  await tx
    .update(s.authorityEvidence)
    .set({ state: "conflict", updatedAt: new Date() })
    .where(
      and(
        eq(s.authorityEvidence.tenantId, ctx.tenantId),
        inArray(s.authorityEvidence.id, [me.id, ...different.map((r) => r.id)]),
      ),
    );
  await tx.insert(s.escalations).values({
    tenantId: ctx.tenantId,
    householdId,
    kind: "authority_conflict",
    sourceType: "authority_evidence",
    sourceId: me.id,
    summary:
      "Authority records of the same type are linked to different people. Sharing that depends on them is held until a person reviews them with the family.",
    ownerActorId: null,
  });
  await appendAudit(tx, {
    tenantId: ctx.tenantId,
    householdId,
    actorId: ctx.actorId,
    action: "authority.conflict_detected",
    subjectType: "authority_evidence",
    subjectId: me.id,
    decision: "hold",
    reasonCode: "AUTHORITY_CONFLICT",
    summary: "Authority records linked to different people were detected and held for human review.",
    visibility: "staff",
  });
  return true;
}

/** Close identity-review escalations for a household once no record of that type is unresolved. */
async function closeResolvedIdentityReviews(tx: Conn, ctx: ActorContext, householdId: string) {
  const all = await householdEvidence(tx, ctx.tenantId, householdId);
  const unresolved = all.some((e) => effectiveAuthorityState(e, all) === "identity_unresolved");
  if (unresolved) return;
  const closed = await tx
    .update(s.escalations)
    .set({
      status: "resolved",
      resolvedAt: new Date(),
      resolvedByActorId: ctx.actorId,
      resolution:
        "Identity question cleared by a reviewer's link (a workflow association, not a legal determination).",
    })
    .where(
      and(
        eq(s.escalations.tenantId, ctx.tenantId),
        eq(s.escalations.householdId, householdId),
        eq(s.escalations.kind, "identity_review"),
        ne(s.escalations.status, "resolved"),
      ),
    )
    .returning();
  for (const e of closed)
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId,
      actorId: ctx.actorId,
      action: "escalation.resolved",
      subjectType: "escalation",
      subjectId: e.id,
      summary: "An authority identity question was cleared by a reviewer's link.",
      visibility: "staff",
    });
}

/**
 * Record authority evidence metadata (or a new version of existing evidence). A named holder must
 * be an active household member; the link is recorded with basis "submitted evidence". Records
 * linked to different people of the same type go to conflict. A record not linked to a verified
 * person opens an identity review and holds release — nothing is inferred from names.
 */
export async function submitEvidence(db: DB, ctx: ActorContext, input: EvidenceInput) {
  const scope = await staffScope(db, ctx, input.householdId, "authority.submit");
  if (
    input.holderActorId &&
    !(await householdMembers(db, ctx.tenantId, scope.householdId)).some(
      (m) => m.actorId === input.holderActorId,
    )
  )
    throw new AccessError("INVALID", "The person named must be a current member of this household.");
  return db.transaction(async (tx) => {
    let evidenceId = input.evidenceId;
    let versionNo = 1;
    let previous: string | null = null;
    if (evidenceId) {
      const [e] = await tx
        .select()
        .from(s.authorityEvidence)
        .where(
          and(
            eq(s.authorityEvidence.tenantId, ctx.tenantId),
            eq(s.authorityEvidence.householdId, scope.householdId),
            eq(s.authorityEvidence.id, evidenceId),
          ),
        );
      if (!e) throw new AccessError("OUT_OF_SCOPE", "That record isn't available.");
      const [last] = await tx
        .select()
        .from(s.authorityEvidenceVersions)
        .where(
          and(
            eq(s.authorityEvidenceVersions.tenantId, ctx.tenantId),
            eq(s.authorityEvidenceVersions.evidenceId, e.id),
          ),
        )
        .orderBy(desc(s.authorityEvidenceVersions.versionNo))
        .limit(1);
      versionNo = (last?.versionNo ?? 0) + 1;
      previous = last?.id ?? null;
    } else {
      const [e] = await tx
        .insert(s.authorityEvidence)
        .values({
          tenantId: ctx.tenantId,
          householdId: scope.householdId,
          holderName: input.holderName.trim(),
          holderActorId: input.holderActorId ?? null,
          authorityType: input.authorityType,
          state: "review_pending",
        })
        .returning();
      evidenceId = e!.id;
      if (input.holderActorId)
        await tx.insert(s.authorityIdentityLinks).values({
          tenantId: ctx.tenantId,
          evidenceId,
          actorId: input.holderActorId,
          basis: "submitted_evidence",
          linkedByActorId: ctx.actorId,
        });
    }
    const [v] = await tx
      .insert(s.authorityEvidenceVersions)
      .values({
        tenantId: ctx.tenantId,
        evidenceId,
        versionNo,
        previousVersionId: previous,
        documentLabel: input.documentLabel.trim(),
        effectiveDate: input.effectiveDate || null,
        submittedByActorId: ctx.actorId,
        note: input.note?.trim() ?? "",
      })
      .returning();
    await tx
      .update(s.authorityEvidence)
      .set({ currentVersionId: v!.id, state: "review_pending", updatedAt: new Date() })
      .where(and(eq(s.authorityEvidence.tenantId, ctx.tenantId), eq(s.authorityEvidence.id, evidenceId)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "authority.submitted",
      subjectType: "authority_evidence",
      subjectId: evidenceId,
      summary: `Authority evidence metadata was recorded for review (version ${versionNo}). ${AUTHORITY_STATUS_NOTE}`,
      visibility: "staff",
    });
    const conflict = await markConflicts(tx, ctx, scope.householdId, evidenceId);
    const all = await householdEvidence(tx, ctx.tenantId, scope.householdId);
    const me = all.find((e) => e.id === evidenceId)!;
    const identityOpen = !conflict && effectiveAuthorityState(me, all) === "identity_unresolved";
    if (identityOpen)
      await openIdentityReview(
        tx,
        ctx,
        scope.householdId,
        evidenceId,
        "An authority record can't be compared with others of its type because it isn't linked to a verified household person. A reviewer must link it (a workflow association, not a legal determination). Activation and sharing are held.",
      );
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: await staffWithRole(tx, ctx.tenantId, "privileged_reviewer"),
      kind: "authority",
      title: conflict
        ? "Conflicting authority evidence needs review"
        : identityOpen
          ? "An authority record needs an identity review"
          : "Authority evidence is waiting for review",
      link: "/staff/reviews",
    });
    return { evidenceId, conflict, identityReview: identityOpen };
  });
}

/**
 * A reviewer links an authority record to a verified household person, stating the basis. The
 * previous link (if any) is kept and marked superseded — never overwritten. Conflicts and identity
 * reviews are recomputed. A link is a workflow association, not a legal determination; it never
 * activates anything by itself.
 */
export async function linkEvidenceHolder(
  db: DB,
  ctx: ActorContext,
  input: { evidenceId: string; actorId: string; basis: IdentityLinkBasis; note: string },
) {
  requireStaffPermission(ctx, "authority.review");
  if (!IDENTITY_LINK_BASES.includes(input.basis))
    throw new AccessError("INVALID", "Choose the basis for this link.");
  if (input.basis === "reviewer_documented" && !input.note.trim())
    throw new AccessError("INVALID", "Describe the documented basis for this link.");
  const [e] = await db
    .select()
    .from(s.authorityEvidence)
    .where(and(eq(s.authorityEvidence.tenantId, ctx.tenantId), eq(s.authorityEvidence.id, input.evidenceId)));
  if (!e) throw new AccessError("OUT_OF_SCOPE", "That record isn't available.");
  const scope = await staffScope(db, ctx, e.householdId, "authority.review");
  if (!(await householdMembers(db, ctx.tenantId, scope.householdId)).some((m) => m.actorId === input.actorId))
    throw new AccessError("INVALID", "Link only to a current member of this household.");
  if (e.holderActorId === input.actorId)
    throw new AccessError("INVALID", "This record is already linked to that person.");
  return db.transaction(async (tx) => {
    const [link] = await tx
      .insert(s.authorityIdentityLinks)
      .values({
        tenantId: ctx.tenantId,
        evidenceId: e.id,
        actorId: input.actorId,
        basis: input.basis,
        note: input.note.trim(),
        linkedByActorId: ctx.actorId,
      })
      .returning();
    const superseded = await tx
      .update(s.authorityIdentityLinks)
      .set({ supersededAt: new Date(), supersededByLinkId: link!.id })
      .where(
        and(
          eq(s.authorityIdentityLinks.tenantId, ctx.tenantId),
          eq(s.authorityIdentityLinks.evidenceId, e.id),
          ne(s.authorityIdentityLinks.id, link!.id),
          isNull(s.authorityIdentityLinks.supersededAt),
        ),
      )
      .returning({ id: s.authorityIdentityLinks.id });
    await tx
      .update(s.authorityEvidence)
      .set({ holderActorId: input.actorId, updatedAt: new Date() })
      .where(and(eq(s.authorityEvidence.tenantId, ctx.tenantId), eq(s.authorityEvidence.id, e.id)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "authority.identity_linked",
      subjectType: "authority_evidence",
      subjectId: e.id,
      summary: `A reviewer linked an authority record to a household person (basis: ${IDENTITY_LINK_BASIS_LABELS[input.basis]}). This is a workflow association, not a legal determination.`,
      visibility: "staff",
      context: {
        linkId: link!.id,
        basis: input.basis,
        note: input.note.trim(),
        supersededLinks: superseded.map((x) => x.id),
      },
    });
    const conflict = await markConflicts(tx, ctx, scope.householdId, e.id);
    await closeResolvedIdentityReviews(tx, ctx, scope.householdId);
    return { linkId: link!.id, conflict };
  });
}

const OUTCOME_STATE = {
  workflow_active: "workflow_active",
  conflict: "conflict",
  needs_more_information: "review_pending",
  withdrawn: "withdrawn",
} as const;

/**
 * A reviewer records a workflow decision on the current version. Marking a record active is
 * refused while its identity is unresolved, or while another record of the same type linked to a
 * different person is still active or in conflict. Zeporah never picks between people.
 */
export async function reviewEvidence(
  db: DB,
  ctx: ActorContext,
  input: { evidenceId: string; outcome: keyof typeof OUTCOME_STATE; rationale: string },
) {
  requireStaffPermission(ctx, "authority.review");
  if (!input.rationale.trim())
    throw new AccessError("INVALID", "Add a short rationale. It's kept with the review.");
  const [e] = await db
    .select()
    .from(s.authorityEvidence)
    .where(and(eq(s.authorityEvidence.tenantId, ctx.tenantId), eq(s.authorityEvidence.id, input.evidenceId)));
  if (!e) throw new AccessError("OUT_OF_SCOPE", "That record isn't available.");
  const scope = await staffScope(db, ctx, e.householdId, "authority.review");
  return db.transaction(async (tx) => {
    const all = await householdEvidence(tx, ctx.tenantId, scope.householdId);
    if (input.outcome === "workflow_active") {
      const me = all.find((x) => x.id === e.id)!;
      const rivals = all.filter(
        (r) =>
          r.id !== e.id &&
          r.authorityType === e.authorityType &&
          ["workflow_active", "conflict", "review_pending"].includes(r.state),
      );
      if (!me.holderActorId || rivals.some((r) => compareHolders(me, r) === "unknown"))
        throw new AccessError(
          "CONFLICT",
          "This record's identity is unresolved. Link it, and any record of the same type, to a verified household person first.",
        );
      if (rivals.some((r) => r.state !== "review_pending" && compareHolders(me, r) === "different"))
        throw new AccessError(
          "CONFLICT",
          "Another record of this type is linked to a different person. Withdraw or supersede it first — Zeporah doesn't choose between them.",
        );
    }
    await tx.insert(s.authorityReviews).values({
      tenantId: ctx.tenantId,
      evidenceId: e.id,
      versionId: e.currentVersionId ?? "",
      reviewerActorId: ctx.actorId,
      outcome: input.outcome,
      rationale: input.rationale.trim(),
    });
    const state = OUTCOME_STATE[input.outcome];
    await tx
      .update(s.authorityEvidence)
      .set({ state, updatedAt: new Date() })
      .where(and(eq(s.authorityEvidence.tenantId, ctx.tenantId), eq(s.authorityEvidence.id, e.id)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "authority.reviewed",
      subjectType: "authority_evidence",
      subjectId: e.id,
      decision: state === "workflow_active" ? "allow" : "hold",
      reasonCode:
        state === "conflict"
          ? "AUTHORITY_CONFLICT"
          : state === "review_pending"
            ? "AUTHORITY_REVIEW_PENDING"
            : state === "withdrawn"
              ? "AUTHORITY_NOT_ACTIVE"
              : null,
      summary: `A reviewer recorded “${input.outcome.replace(/_/g, " ")}” for ${e.holderName}'s ${AUTHORITY_TYPE_LABELS[e.authorityType as AuthorityType].toLowerCase()} record. ${AUTHORITY_STATUS_NOTE}`,
      visibility: "staff",
      context: { rationale: input.rationale.trim() },
    });
    // When no record of this type is left in conflict, the conflict escalation can close.
    const still = await tx
      .select({ id: s.authorityEvidence.id })
      .from(s.authorityEvidence)
      .where(
        and(
          eq(s.authorityEvidence.tenantId, ctx.tenantId),
          eq(s.authorityEvidence.householdId, scope.householdId),
          eq(s.authorityEvidence.authorityType, e.authorityType),
          eq(s.authorityEvidence.state, "conflict"),
        ),
      );
    if (!still.length) {
      const closed = await tx
        .update(s.escalations)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolvedByActorId: ctx.actorId,
          resolution: "Conflict cleared by an authority/consent reviewer.",
        })
        .where(
          and(
            eq(s.escalations.tenantId, ctx.tenantId),
            eq(s.escalations.householdId, scope.householdId),
            eq(s.escalations.kind, "authority_conflict"),
            ne(s.escalations.status, "resolved"),
          ),
        )
        .returning();
      if (closed.length)
        await appendAudit(tx, {
          tenantId: ctx.tenantId,
          householdId: scope.householdId,
          actorId: ctx.actorId,
          action: "escalation.resolved",
          subjectType: "escalation",
          subjectId: closed[0]!.id,
          summary: "An authority conflict was cleared by a reviewer.",
          visibility: "staff",
        });
    }
    await closeResolvedIdentityReviews(tx, ctx, scope.householdId);
    const guides = await careGuidesFor(tx, ctx.tenantId, scope.householdId);
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: guides.map((g) => g.actorId),
      kind: "authority",
      title: "An authority review was recorded",
      link: `/staff/households/${scope.householdId}?tab=sharing`,
    });
    return { state };
  });
}

/* ------------------------------------------------------------------ consent (staff) */

export async function listConsents(db: DB, ctx: ActorContext, householdId: string) {
  const scope = await staffScope(db, ctx, householdId, "staff.household.view");
  const rows = await db
    .select()
    .from(s.consents)
    .where(and(eq(s.consents.tenantId, ctx.tenantId), eq(s.consents.householdId, scope.householdId)))
    .orderBy(desc(s.consents.createdAt));
  const names = await actorNames(
    db,
    ctx.tenantId,
    rows.flatMap((c) => [c.recordedByActorId, c.activatedByActorId]),
  );
  const members = await householdMembers(db, ctx.tenantId, scope.householdId);
  const eligibility = new Map<string, { canConfirm: boolean; reason: string | null }>();
  for (const m of members)
    eligibility.set(m.actorId, await grantorEligibility(db, ctx.tenantId, scope.householdId, m.actorId));
  const out = [];
  for (const c of rows) {
    const wf = await consentWorkflow(db, c);
    const corr = wf.correction;
    const requester = corr
      ? (await actorNames(db, ctx.tenantId, [corr.requestedByActorId])).get(corr.requestedByActorId)
      : null;
    out.push({
      ...c,
      stage: wf.stage,
      stageLabel: CONSENT_STAGE_LABELS[wf.stage],
      confirmation: wf.confirmation,
      recordedBy: names.get(c.recordedByActorId) ?? "",
      activatedBy: c.activatedByActorId ? (names.get(c.activatedByActorId) ?? "") : null,
      scopeLabels: (c.scope as ShareCategory[]).map((k) => SHARE_CATEGORY_LABELS[k]),
      /** Open correction request. `detail` is the person's own words: care team only. */
      correction: corr
        ? {
            id: corr.id,
            at: corr.createdAt,
            requestedBy: requester ?? "",
            categories: (corr.categories as CorrectionCategory[]).map(
              (k) => CORRECTION_CATEGORY_LABELS[k] ?? k,
            ),
            detail: corr.detail,
            version: corr.consentVersion,
          }
        : null,
      grantorEligibility: c.grantedByActorId
        ? (eligibility.get(c.grantedByActorId) ?? {
            canConfirm: false,
            reason: "They aren't a current member of this household.",
          })
        : null,
      activateBlockedReason: corr
        ? "A correction was requested. Change the terms, withdraw the consent, or dismiss the request with an explanation."
        : wf.stage === "awaiting_confirmation"
          ? "Waiting for the named person to confirm this version."
          : wf.stage === "needs_review"
            ? "Held: the named person can't confirm in the app under the current workflow. A person must review it; it can't be confirmed on their behalf."
            : wf.stage !== "awaiting_activation"
              ? null
              : c.recordedByActorId === ctx.actorId
                ? "You recorded this consent, so a different reviewer must activate it."
                : !can(ctx.staffRoles, "consent.activate")
                  ? "Your role can't activate consent."
                  : null,
    });
  }
  return {
    consents: out,
    grantorOptions: members.map((m) => ({
      actorId: m.actorId,
      name: m.name,
      ...(eligibility.get(m.actorId) ?? { canConfirm: false, reason: null }),
    })),
    canResolveCorrections: can(ctx.staffRoles, "consent.record"),
    canRecord: can(ctx.staffRoles, "consent.record"),
    canActivate: can(ctx.staffRoles, "consent.activate"),
    canRevoke: can(ctx.staffRoles, "consent.revoke_on_request"),
  };
}

export type ConsentInput = {
  householdId: string;
  grantedByActorId: string;
  purpose: string;
  recipientName: string;
  scope: ShareCategory[];
  startsAt: Date;
  expiresAt: Date;
  revocationPath: string;
};

function validateConsentTerms(input: Omit<ConsentInput, "householdId" | "grantedByActorId">) {
  const cats = [...new Set(input.scope)];
  if (!input.purpose.trim() || !input.recipientName.trim())
    throw new AccessError("INVALID", "A consent needs a purpose and a named recipient.");
  if (!cats.length) throw new AccessError("INVALID", "A consent needs at least one category of information.");
  if (input.expiresAt <= input.startsAt)
    throw new AccessError("INVALID", "The end date must be after the start date.");
  if (!input.revocationPath.trim())
    throw new AccessError("INVALID", "Say how the person can withdraw this consent.");
  return cats;
}

/** Hold a consent the named person can't confirm in the app, and ask a person to review it. */
async function routeConsentToReview(
  tx: Conn,
  ctx: ActorContext,
  householdId: string,
  consentId: string,
  version: number,
) {
  const open = await tx
    .select({ id: s.escalations.id })
    .from(s.escalations)
    .where(
      and(
        eq(s.escalations.tenantId, ctx.tenantId),
        eq(s.escalations.kind, "consent_review"),
        eq(s.escalations.sourceId, consentId),
        ne(s.escalations.status, "resolved"),
      ),
    );
  if (open.length) return;
  await tx.insert(s.escalations).values({
    tenantId: ctx.tenantId,
    householdId,
    kind: "consent_review",
    sourceType: "consent",
    sourceId: consentId,
    summary: `The person named as giving consent (version ${version}) can't confirm it in the app under the current workflow. It is held; a person on the care team must review it. It is never confirmed automatically.`,
  });
  await notify(tx, {
    tenantId: ctx.tenantId,
    householdId,
    recipients: await staffWithRole(tx, ctx.tenantId, "privileged_reviewer"),
    kind: "consent",
    title: "A consent is held for human review",
    link: "/staff/exceptions?view=all&kind=escalation",
  });
}

/**
 * Stage 1: record a proposed consent. The named grantor must be a current household member. If
 * they can't confirm in the app (only the patient while active, or someone with an applicable,
 * active authority workflow can), the consent is held and routed to human review.
 */
export async function recordConsent(db: DB, ctx: ActorContext, input: ConsentInput) {
  const scope = await staffScope(db, ctx, input.householdId, "consent.record");
  const cats = validateConsentTerms(input);
  const grantor = (await householdMembers(db, ctx.tenantId, scope.householdId)).find(
    (m) => m.actorId === input.grantedByActorId,
  );
  if (!grantor)
    throw new AccessError("INVALID", "The person giving consent must be a current member of this household.");
  const canConfirm = await grantorCanSelfConfirm(db, ctx.tenantId, scope.householdId, grantor.actorId);
  return db.transaction(async (tx) => {
    const [c] = await tx
      .insert(s.consents)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        grantedByName: grantor.name,
        grantedByActorId: grantor.actorId,
        recordedByActorId: ctx.actorId,
        purpose: input.purpose.trim(),
        recipientName: input.recipientName.trim(),
        scope: cats,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        state: "draft",
        revocationPath: input.revocationPath.trim(),
        version: 1,
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "consent.recorded",
      subjectType: "consent",
      subjectId: c!.id,
      summary: `A consent to share with ${c!.recipientName} was set up. It needs ${grantor.name} to confirm it, then a care-team reviewer to approve it.`,
      visibility: "sharing",
      context: { version: 1, grantor: grantor.actorId, grantorCanConfirm: canConfirm },
    });
    if (canConfirm)
      await notify(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        recipients: [grantor.actorId],
        kind: "consent",
        title: "A sharing consent is waiting for your confirmation",
        link: `/family/consents/${c!.id}`,
      });
    else {
      await routeConsentToReview(tx, ctx, scope.householdId, c!.id, 1);
      // Never leave the named person unaware: they can see what names them and ask for a correction.
      await notify(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        recipients: [grantor.actorId],
        kind: "consent",
        title: "A sharing consent names you",
        link: `/family/consents/${c!.id}`,
      });
    }
    return c!;
  });
}

/**
 * Any material change (purpose, recipient, scope, dates, revocation terms) creates a new version,
 * invalidates the earlier confirmation and activation, returns the consent to draft, and holds
 * packets that rely on it. The person making the change counts as the recorder of the new version.
 */
export async function amendConsent(
  db: DB,
  ctx: ActorContext,
  input: Omit<ConsentInput, "householdId" | "grantedByActorId"> & { consentId: string },
) {
  const [c] = await db
    .select()
    .from(s.consents)
    .where(and(eq(s.consents.tenantId, ctx.tenantId), eq(s.consents.id, input.consentId)));
  if (!c) throw new AccessError("OUT_OF_SCOPE", "That consent isn't available.");
  const scope = await staffScope(db, ctx, c.householdId, "consent.record");
  if (c.state === "revoked")
    throw new AccessError("INVALID", "A withdrawn consent can't be changed. Record a new one.");
  const cats = validateConsentTerms(input);
  const changed: string[] = [];
  if (input.purpose.trim() !== c.purpose) changed.push("purpose");
  if (input.recipientName.trim() !== c.recipientName) changed.push("recipient");
  if ([...cats].sort().join() !== [...(c.scope as string[])].sort().join()) changed.push("scope");
  if (input.startsAt.getTime() !== c.startsAt.getTime()) changed.push("start");
  if (input.expiresAt.getTime() !== c.expiresAt.getTime()) changed.push("expiry");
  if (input.revocationPath.trim() !== c.revocationPath) changed.push("revocation terms");
  if (!changed.length) throw new AccessError("INVALID", "Nothing changed.");
  // What each changed field was before, so the household sees "old → new", not just a field name.
  const previous: Record<string, string | string[]> = {};
  for (const f of changed)
    previous[f] =
      f === "purpose"
        ? c.purpose
        : f === "recipient"
          ? c.recipientName
          : f === "scope"
            ? (c.scope as string[])
            : f === "start"
              ? c.startsAt.toISOString()
              : f === "expiry"
                ? c.expiresAt.toISOString()
                : c.revocationPath;
  const version = c.version + 1;
  const canConfirm = await grantorCanSelfConfirm(db, ctx.tenantId, scope.householdId, c.grantedByActorId);
  await db.transaction(async (tx) => {
    await tx
      .update(s.consents)
      .set({
        purpose: input.purpose.trim(),
        recipientName: input.recipientName.trim(),
        scope: cats,
        startsAt: input.startsAt,
        expiresAt: input.expiresAt,
        revocationPath: input.revocationPath.trim(),
        version,
        state: "draft",
        activatedVersion: null,
        activatedAt: null,
        activatedByActorId: null,
        recordedByActorId: ctx.actorId,
      })
      .where(and(eq(s.consents.tenantId, ctx.tenantId), eq(s.consents.id, c.id)));
    const held = await tx
      .update(s.packets)
      .set({ state: "held", lastReasonCode: "CONSENT_NOT_CONFIRMED", updatedAt: new Date() })
      .where(
        and(
          eq(s.packets.tenantId, ctx.tenantId),
          eq(s.packets.consentId, c.id),
          or(eq(s.packets.state, "draft"), eq(s.packets.state, "held")),
        ),
      )
      .returning({ id: s.packets.id });
    await closeOpenCorrection(tx, ctx, c.id, "amended");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "consent.amended",
      subjectType: "consent",
      subjectId: c.id,
      decision: "hold",
      reasonCode: "CONSENT_NOT_CONFIRMED",
      summary: `The consent to share with ${input.recipientName.trim()} changed: ${changed.map((f) => CHANGED_WORDS[f] ?? f).join(", ")}. It needs confirming again before anything more is shared.`,
      visibility: "sharing",
      context: { version, previousVersion: c.version, changed, previous, heldPackets: held.map((p) => p.id) },
      before: previous,
    });
    if (canConfirm && c.grantedByActorId)
      await notify(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        recipients: [c.grantedByActorId],
        kind: "consent",
        title: "A sharing consent changed and needs your confirmation",
        link: `/family/consents/${c.id}`,
      });
    else {
      await routeConsentToReview(tx, ctx, scope.householdId, c.id, version);
      if (c.grantedByActorId)
        await notify(tx, {
          tenantId: ctx.tenantId,
          householdId: scope.householdId,
          recipients: [c.grantedByActorId],
          kind: "consent",
          title: "A sharing consent that names you changed",
          link: `/family/consents/${c.id}`,
        });
    }
  });
}

/** Stage 3: a reviewer who did not record this version activates it, once the household has confirmed it. */
export async function activateConsent(db: DB, ctx: ActorContext, consentId: string) {
  requireStaffPermission(ctx, "consent.activate");
  const [c] = await db
    .select()
    .from(s.consents)
    .where(and(eq(s.consents.tenantId, ctx.tenantId), eq(s.consents.id, consentId)));
  if (!c) throw new AccessError("OUT_OF_SCOPE", "That consent isn't available.");
  const scope = await staffScope(db, ctx, c.householdId, "consent.activate");
  if (c.state !== "draft")
    throw new AccessError("INVALID", "Only a consent waiting for activation can be activated.");
  if (c.recordedByActorId === ctx.actorId)
    throw new AccessError(
      "NOT_PERMITTED",
      "You recorded this consent, so a different reviewer must activate it.",
    );
  if (c.expiresAt <= new Date()) throw new AccessError("INVALID", "This consent's window has already ended.");
  const wf = await consentWorkflow(db, c);
  if (wf.stage !== "awaiting_activation")
    throw new AccessError(
      "INVALID",
      "The household hasn't confirmed this version yet, so it can't be activated.",
    );
  if (wf.correction)
    throw new AccessError(
      "INVALID",
      "A correction was requested for this consent. Change the terms, withdraw it, or dismiss the request with an explanation before activating.",
    );
  await db.transaction(async (tx) => {
    const changed = await tx
      .update(s.consents)
      .set({
        state: "active",
        activatedAt: new Date(),
        activatedByActorId: ctx.actorId,
        activatedVersion: c.version,
      })
      .where(
        and(
          eq(s.consents.tenantId, ctx.tenantId),
          eq(s.consents.id, c.id),
          eq(s.consents.state, "draft"),
          eq(s.consents.version, c.version),
        ),
      )
      .returning({ id: s.consents.id });
    // Someone else activated or changed it a moment ago; nothing is written twice.
    if (!changed.length)
      throw new AccessError(
        "CONFLICT",
        "This consent was just activated or changed by someone else. Refresh to see it.",
      );
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "consent.activated",
      subjectType: "consent",
      subjectId: c.id,
      summary: `The consent to share with ${c.recipientName} is now active.`,
      visibility: "sharing",
      context: { version: c.version, confirmationId: wf.confirmation!.id, recordedBy: c.recordedByActorId },
      // Two people (decision 58's audit shape): who recorded it, and the different reviewer who activated it.
      approval: { requestedBy: c.recordedByActorId, approvedBy: ctx.actorId },
    });
    const members = await membersWho(tx, ctx.tenantId, scope.householdId, scope.lifecycle, {
      permission: "consent.view",
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: members.map((m) => m.actorId),
      kind: "consent",
      title: "A sharing consent is now active",
      link: "/family/sharing",
    });
  });
}

/** Staff can withdraw a consent on the household's request; the reason is kept. */
export async function revokeConsentOnRequest(
  db: DB,
  ctx: ActorContext,
  input: { consentId: string; reason: string },
) {
  requireStaffPermission(ctx, "consent.revoke_on_request");
  if (!input.reason.trim()) throw new AccessError("INVALID", "Say who asked for this and why.");
  const [c] = await db
    .select()
    .from(s.consents)
    .where(and(eq(s.consents.tenantId, ctx.tenantId), eq(s.consents.id, input.consentId)));
  if (!c) throw new AccessError("OUT_OF_SCOPE", "That consent isn't available.");
  const scope = await staffScope(db, ctx, c.householdId, "consent.revoke_on_request");
  if (c.state === "revoked") throw new AccessError("INVALID", "This consent is already withdrawn.");
  await db.transaction(async (tx) => {
    await tx
      .update(s.consents)
      .set({
        state: "revoked",
        revokedAt: new Date(),
        revokedByActorId: ctx.actorId,
        revokeReason: input.reason.trim(),
      })
      .where(
        and(eq(s.consents.tenantId, ctx.tenantId), eq(s.consents.id, c.id), ne(s.consents.state, "revoked")),
      )
      .returning({ id: s.consents.id })
      .then((r) => {
        if (!r.length) throw new AccessError("CONFLICT", "This consent was already withdrawn.");
      });
    await closeOpenCorrection(tx, ctx, c.id, "withdrawn");
    await tx
      .update(s.packets)
      .set({ state: "held", lastReasonCode: "CONSENT_REVOKED", updatedAt: new Date() })
      .where(
        and(
          eq(s.packets.tenantId, ctx.tenantId),
          eq(s.packets.consentId, c.id),
          or(eq(s.packets.state, "draft"), eq(s.packets.state, "held")),
        ),
      );
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "consent.revoked",
      subjectType: "consent",
      subjectId: c.id,
      decision: "hold",
      reasonCode: "CONSENT_REVOKED",
      summary: `Consent to share with ${c.recipientName} was withdrawn at the household's request. ${REVOCATION_NOTE}`,
      visibility: "sharing",
      context: { reason: input.reason.trim() },
    });
    const members = await membersWho(tx, ctx.tenantId, scope.householdId, scope.lifecycle, {
      permission: "consent.view",
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: members.map((m) => m.actorId),
      kind: "consent",
      title: "A sharing choice changed",
      link: "/family/sharing",
    });
  });
}

/**
 * A person on the care team reviewed a correction request and decided no change is needed. The
 * explanation is required and is shown to the person who asked; the consent and its stage are
 * unchanged, so a consent waiting for confirmation can now be confirmed.
 */
export async function dismissConsentCorrection(
  db: DB,
  ctx: ActorContext,
  input: { requestId: string; explanation: string },
) {
  requireStaffPermission(ctx, "consent.record");
  const explanation = input.explanation.trim();
  if (!explanation)
    throw new AccessError("INVALID", "Give the reason no change is needed. It stays with the care team.");
  const [r] = await db
    .select()
    .from(s.consentCorrectionRequests)
    .where(
      and(
        eq(s.consentCorrectionRequests.tenantId, ctx.tenantId),
        eq(s.consentCorrectionRequests.id, input.requestId),
      ),
    );
  if (!r) throw new AccessError("OUT_OF_SCOPE", "That request isn't available.");
  const scope = await staffScope(db, ctx, r.householdId, "consent.record");
  await db.transaction(async (tx) => {
    const done = await tx
      .update(s.consentCorrectionRequests)
      .set({
        status: "resolved",
        outcome: "dismissed",
        resolutionNote: explanation.slice(0, 1000),
        resolvedByActorId: ctx.actorId,
        resolvedAt: new Date(),
      })
      .where(and(eq(s.consentCorrectionRequests.id, r.id), eq(s.consentCorrectionRequests.status, "open")))
      .returning({ id: s.consentCorrectionRequests.id });
    if (!done.length) throw new AccessError("CONFLICT", "This request was already resolved or cancelled.");
    if (r.escalationId)
      await tx
        .update(s.escalations)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolvedByActorId: ctx.actorId,
          resolution: explanation.slice(0, 1000),
        })
        .where(
          and(
            eq(s.escalations.tenantId, ctx.tenantId),
            eq(s.escalations.id, r.escalationId),
            ne(s.escalations.status, "resolved"),
          ),
        );
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "consent.correction_dismissed",
      subjectType: "consent",
      subjectId: r.consentId,
      summary:
        "A person on the care team reviewed a correction request and made no change. They gave an explanation.",
      visibility: "sharing",
      context: { requestId: r.id },
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: [r.requestedByActorId],
      kind: "consent",
      title: "Your care team reviewed your correction request",
      link: `/family/consents/${r.consentId}`,
    });
  });
}
