/**
 * Correction requests close themselves when the consent they're about changes for another reason:
 * a new version (amended), a withdrawal (withdrawn), or the consent ending (closed). The household
 * is told in plain words; the request's own text never leaves the care team.
 */
import { and, eq, ne } from "drizzle-orm";
import type { Conn } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import type { ActorContext } from "../context";
import { notify } from "./common";

const OUTCOME_WORDS = {
  amended: "the consent was changed, so it needs a new confirmation",
  withdrawn: "the consent was withdrawn",
  closed: "the consent has ended",
} as const;

export async function closeOpenCorrection(
  tx: Conn,
  ctx: ActorContext,
  consentId: string,
  outcome: keyof typeof OUTCOME_WORDS,
) {
  const now = new Date();
  const closed = await tx
    .update(s.consentCorrectionRequests)
    .set({
      status: "resolved",
      outcome,
      resolutionNote: `Closed automatically: ${OUTCOME_WORDS[outcome]}.`,
      resolvedByActorId: ctx.actorId,
      resolvedAt: now,
    })
    .where(
      and(
        eq(s.consentCorrectionRequests.tenantId, ctx.tenantId),
        eq(s.consentCorrectionRequests.consentId, consentId),
        eq(s.consentCorrectionRequests.status, "open"),
      ),
    )
    .returning();
  for (const r of closed) {
    if (r.escalationId)
      await tx
        .update(s.escalations)
        .set({
          status: "resolved",
          resolvedAt: now,
          resolvedByActorId: ctx.actorId,
          resolution: `Closed automatically: ${OUTCOME_WORDS[outcome]}.`,
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
      householdId: r.householdId,
      actorId: ctx.actorId,
      action: "consent.correction_resolved",
      subjectType: "consent",
      subjectId: consentId,
      summary: `A correction request was closed because ${OUTCOME_WORDS[outcome]}.`,
      visibility: "sharing",
      context: { requestId: r.id, outcome },
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: r.householdId,
      recipients: [r.requestedByActorId],
      except: ctx.actorId,
      kind: "consent",
      title: "Your correction request was closed",
      link: `/family/consents/${consentId}`,
    });
  }
  return closed.length;
}
