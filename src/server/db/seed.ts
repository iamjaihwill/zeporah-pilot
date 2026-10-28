import { and, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { DB } from "./client";
import * as s from "./schema";
import { appendAudit, type AuditInput } from "../audit";
import { buildFixtures, SEED } from "@/fixtures/synthetic";
import { applyDemoWeek, type SeedSnapshot } from "@/fixtures/demo-week";
import {
  EXTERNAL_ROLES,
  HOUSEHOLD_ROLES,
  ROLE_EXPLANATIONS,
  ROLE_LABELS,
  STAFF_ROLES,
  type RoleCode,
} from "@/domain/model";

/**
 * Load the synthetic dataset into an empty database. Deterministic apart from times, which are
 * relative to `now`. A demo snapshot (decision 58) adds the Okafor demo week on top.
 */
export async function seed(db: DB, now = new Date(), snapshot: SeedSnapshot = "standard") {
  const f = buildFixtures(now);
  if (snapshot !== "standard") applyDemoWeek(f, now, snapshot);
  await db.transaction(async (tx) => {
    const put = async <T extends PgTable>(table: T, rows: Record<string, unknown>[]) => {
      if (rows.length) await tx.insert(table).values(rows as T["$inferInsert"][]);
    };
    const scope = (r: RoleCode) =>
      (HOUSEHOLD_ROLES as readonly string[]).includes(r)
        ? "household"
        : (STAFF_ROLES as readonly string[]).includes(r)
          ? "organization"
          : "external";
    // Migrations insert roles added later (0018), so the reference rows are upserted here.
    for (const code of [...HOUSEHOLD_ROLES, ...STAFF_ROLES, ...EXTERNAL_ROLES]) {
      const row = {
        code,
        scope: scope(code) as "household" | "organization" | "external",
        label: ROLE_LABELS[code],
        description: ROLE_EXPLANATIONS[code],
      };
      await tx.insert(s.roles).values(row).onConflictDoUpdate({ target: s.roles.code, set: row });
    }
    await put(s.tenants, f.tenants);
    await put(s.organizations, f.organizations);
    await put(s.actors, f.actors);
    await put(s.messageExpectations, f.messageExpectations);
    await put(s.households, f.households);
    await put(s.memberships, f.memberships);
    await put(s.contactLineChanges, f.contactLineChanges);
    await put(s.preferences, f.preferences);
    await put(s.onboardingSteps, f.onboardingSteps);
    await put(s.supportPreferences, f.supportPreferences);
    await put(s.careCoordinationRecords, f.careCoordinationRecords);
    await put(s.vaultItems, f.vaultItems);
    await put(s.tasks, f.tasks);
    await put(s.familyUpdates, f.familyUpdates);
    await put(s.acknowledgements, f.acknowledgements);
    await put(s.staffNotes, f.staffNotes);
    await put(s.messageThreads, f.messageThreads);
    await put(s.messages, f.messages);
    await put(s.notifications, f.notifications);
    await put(s.authorityEvidence, f.authorityEvidence);
    await put(s.authorityEvidenceVersions, f.authorityEvidenceVersions);
    await put(s.authorityIdentityLinks, f.authorityIdentityLinks);
    await put(s.authorityReviews, f.authorityReviews);
    await put(s.consents, f.consents);
    await put(s.consentConfirmations, f.consentConfirmations);
    await put(s.consentCorrectionRequests, f.consentCorrectionRequests);
    await put(s.packets, f.packets);
    await put(s.packetManifestItems, f.packetManifestItems);
    await put(s.bereavementTransitions, f.bereavementTransitions);
    await put(s.bereavementContacts, f.bereavementContacts);
    await put(s.escalations, f.escalations);
    await put(s.staffAbsences, f.staffAbsences);
    await put(s.handoffs, f.handoffs);
    await put(s.partnerEvents, f.partnerEvents);
    await put(s.exceptionClaims, f.exceptionClaims);
    await put(s.packetAccessLog, f.packetAccessLog);

    for (const tenantId of Object.values(SEED.tenants)) {
      await appendAudit(tx, {
        tenantId,
        action: "system.seeded",
        subjectType: "tenant",
        subjectId: tenantId,
        summary: "Synthetic development data was loaded.",
        visibility: "staff",
        context: { snapshot },
        at: new Date(now.getTime() - 90 * 86_400_000),
      });
    }
    for (const { at, e } of f.history) await appendAudit(tx, { ...(e as unknown as AuditInput), at });

    for (const r of f.packetReleaseReceipts) {
      const [ev] = await tx
        .select({ id: s.auditEvents.id })
        .from(s.auditEvents)
        .where(
          and(
            eq(s.auditEvents.subjectId, r["packetId"] as string),
            eq(s.auditEvents.action, "packet.released"),
          ),
        );
      await put(s.packetReleaseReceipts, [{ ...r, auditEventId: ev!.id }]);
    }
    await put(s.packetRecipientAccess, f.packetRecipientAccess);
  });
}
