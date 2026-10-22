/**
 * Sharing register: every consent in the households a staff member can already see, in one place,
 * and the full history of one consent. It only gathers what each household's Sharing tab already
 * shows — the same visibility rule, nothing wider — so operations and reviewers see their whole
 * hospice and a care guide sees their assigned households.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { AccessError, staffScope, staffVisibleHouseholds, type ActorContext } from "../context";
import { actorNames, consentWorkflow } from "./common";
import { CONSENT_STAGE_LABELS, CORRECTION_CATEGORY_LABELS, type ConsentStage } from "@/domain/consent";
import { SHARE_CATEGORY_LABELS, type ShareCategory } from "@/domain/model";

/** Expiring within this many days counts as "ending soon". */
export const ENDING_SOON_DAYS = 14;

/** Stages where a person on the care team has the next step. */
const NEEDS_ACTION: ConsentStage[] = ["needs_review", "awaiting_activation"];

export async function sharingRegister(db: DB, ctx: ActorContext, now = new Date()) {
  if (ctx.kind !== "staff") throw new AccessError("NOT_PERMITTED", "This area is for the hospice care team.");
  const households = await staffVisibleHouseholds(db, ctx);
  if (!households.length) return [];
  const ids = households.map((h) => h.id);
  const rows = await db
    .select()
    .from(s.consents)
    .where(and(eq(s.consents.tenantId, ctx.tenantId), inArray(s.consents.householdId, ids)))
    .orderBy(asc(s.consents.expiresAt));
  const packets = rows.length
    ? await db
        .select({ id: s.packets.id, consentId: s.packets.consentId, state: s.packets.state })
        .from(s.packets)
        .where(
          and(
            eq(s.packets.tenantId, ctx.tenantId),
            inArray(
              s.packets.consentId,
              rows.map((r) => r.id),
            ),
          ),
        )
    : [];
  const name = new Map(households.map((h) => [h.id, h.displayName]));
  const soon = now.getTime() + ENDING_SOON_DAYS * 86_400_000;
  const out = [];
  for (const c of rows) {
    const wf = await consentWorkflow(db, c, now);
    const live = wf.stage !== "revoked" && wf.stage !== "expired";
    out.push({
      id: c.id,
      householdId: c.householdId,
      household: name.get(c.householdId) ?? "",
      recipientName: c.recipientName,
      purpose: c.purpose,
      grantedByName: c.grantedByName,
      version: c.version,
      stage: wf.stage,
      stageLabel: CONSENT_STAGE_LABELS[wf.stage],
      expiresAt: c.expiresAt,
      correctionOpen: !!wf.correction,
      needsAction: live && (NEEDS_ACTION.includes(wf.stage) || !!wf.correction),
      endingSoon: live && c.expiresAt.getTime() <= soon && c.expiresAt.getTime() > now.getTime(),
      packets: packets.filter((p) => p.consentId === c.id).map((p) => ({ id: p.id, state: p.state })),
    });
  }
  return out;
}

/**
 * One consent's terms and history: every recorded step from the audit chain (recorded, changed,
 * confirmed, corrections, activated, withdrawn), the confirmations per version, and its packets.
 * The same refusal as a missing consent if it's outside the person's households.
 */
export async function consentHistory(db: DB, ctx: ActorContext, consentId: string) {
  if (ctx.kind !== "staff") throw new AccessError("NOT_PERMITTED", "This area is for the hospice care team.");
  const [c] = await db
    .select()
    .from(s.consents)
    .where(and(eq(s.consents.tenantId, ctx.tenantId), eq(s.consents.id, consentId)));
  if (!c) throw new AccessError("OUT_OF_SCOPE", "That consent isn't available.");
  const scope = await staffScope(db, ctx, c.householdId, "staff.household.view");
  const wf = await consentWorkflow(db, c);
  const events = await db
    .select()
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.tenantId, ctx.tenantId),
        eq(s.auditEvents.subjectType, "consent"),
        eq(s.auditEvents.subjectId, c.id),
      ),
    )
    .orderBy(desc(s.auditEvents.seq));
  const corrections = await db
    .select()
    .from(s.consentCorrectionRequests)
    .where(
      and(
        eq(s.consentCorrectionRequests.tenantId, ctx.tenantId),
        eq(s.consentCorrectionRequests.consentId, c.id),
      ),
    )
    .orderBy(desc(s.consentCorrectionRequests.createdAt));
  const confirmations = await db
    .select()
    .from(s.consentConfirmations)
    .where(and(eq(s.consentConfirmations.tenantId, ctx.tenantId), eq(s.consentConfirmations.consentId, c.id)))
    .orderBy(desc(s.consentConfirmations.consentVersion));
  const packets = await db
    .select()
    .from(s.packets)
    .where(and(eq(s.packets.tenantId, ctx.tenantId), eq(s.packets.consentId, c.id)));
  // Corrections are recorded against the consent itself, so they're already in this history.
  const all = events;
  const names = await actorNames(db, ctx.tenantId, [
    ...all.map((e) => e.actorId),
    ...confirmations.map((x) => x.actorId),
    c.recordedByActorId,
    c.activatedByActorId,
    c.revokedByActorId,
  ]);
  return {
    consent: {
      id: c.id,
      householdId: scope.householdId,
      household: scope.householdName,
      recipientName: c.recipientName,
      purpose: c.purpose,
      grantedByName: c.grantedByName,
      scopeLabels: (c.scope as ShareCategory[]).map((k) => SHARE_CATEGORY_LABELS[k]),
      startsAt: c.startsAt,
      expiresAt: c.expiresAt,
      version: c.version,
      stage: wf.stage,
      stageLabel: CONSENT_STAGE_LABELS[wf.stage],
      revocationPath: c.revocationPath,
      revokeReason: c.revokeReason,
    },
    history: all.map((e) => ({
      id: e.id,
      at: e.createdAt,
      action: e.action,
      by: e.actorId ? (names.get(e.actorId) ?? "") : "System",
      summary: e.summary,
      version: (e.context as { version?: number }).version ?? null,
      changed: ((e.context as { changed?: string[] }).changed ?? []) as string[],
    })),
    confirmations: confirmations.map((x) => ({
      version: x.consentVersion,
      at: x.confirmedAt,
      by: names.get(x.actorId) ?? "",
      method: x.method,
    })),
    corrections: corrections.map((r) => ({
      id: r.id,
      at: r.createdAt,
      version: r.consentVersion,
      status: r.status,
      outcome: r.outcome,
      categories: (r.categories as string[]).map(
        (k) => CORRECTION_CATEGORY_LABELS[k as keyof typeof CORRECTION_CATEGORY_LABELS] ?? k,
      ),
    })),
    packets: packets.map((p) => ({
      id: p.id,
      state: p.state,
      lastReasonCode: p.lastReasonCode,
    })),
  };
}
