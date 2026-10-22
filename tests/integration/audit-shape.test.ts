import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import { appendAudit, verifyAuditChain } from "@/server/audit";
import { reportExport } from "@/server/services/report-export";
import { auditReview } from "@/server/services/audit-review";
import * as s from "@/server/db/schema";

/** The approved audit shape (decision 58, plan story F-1): role at the time, source, reason, approval. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  t = await freshDb();
});
afterEach(async () => {
  await t.close();
});

async function last(action: string) {
  const [e] = await t.db
    .select()
    .from(s.auditEvents)
    .where(eq(s.auditEvents.action, action))
    .orderBy(desc(s.auditEvents.seq))
    .limit(1);
  return e!;
}

describe("audit shape", () => {
  it("records a staff member's roles at the time and the source, from an ordinary action", async () => {
    await reportExport(t.db, await t.as("st-dana"), { report: "overview", days: 30 });
    expect((await last("report.exported")).context).toMatchObject({
      actorRoles: ["hospice_ops"],
      source: "staff",
    });
  });

  it("records a family member's role in that household", async () => {
    await appendAudit(t.db, {
      tenantId: "t-willow",
      householdId: "hh-okafor",
      actorId: "fm-ada",
      action: "test.family_event",
      subjectType: "household",
      summary: "Synthetic test event.",
      visibility: "staff",
    });
    expect((await last("test.family_event")).context).toMatchObject({
      actorRoles: ["proxy"],
      source: "family",
    });
  });

  it("marks events with no actor as system, and keeps given reason, before/after, approval and prepared", async () => {
    await appendAudit(t.db, {
      tenantId: "t-willow",
      householdId: "hh-okafor",
      actorId: "st-priya",
      action: "test.sensitive",
      subjectType: "consent",
      subjectId: "cs-okafor-equipment",
      summary: "Synthetic test event.",
      visibility: "staff",
      reason: "Synthetic reason.",
      before: { until: "2026-11-01" },
      after: { until: "2026-11-15" },
      approval: { requestedBy: "st-maya", approvedBy: "st-priya" },
      prepared: true,
    });
    expect((await last("test.sensitive")).context).toMatchObject({
      actorRoles: ["privileged_reviewer"],
      source: "staff",
      reason: "Synthetic reason.",
      before: { until: "2026-11-01" },
      after: { until: "2026-11-15" },
      approval: { requestedBy: "st-maya", approvedBy: "st-priya" },
      prepared: true,
    });
    await appendAudit(t.db, {
      tenantId: "t-willow",
      action: "test.system",
      subjectType: "household",
      summary: "Synthetic test event.",
      visibility: "staff",
      source: "rule",
    });
    const sys = (await last("test.system")).context;
    expect(sys).toMatchObject({ source: "rule" });
    expect(sys).not.toHaveProperty("actorRoles");
  });

  it("shows role at the time, source, reason and approval in Audit review; older events say current role", async () => {
    await appendAudit(t.db, {
      tenantId: "t-willow",
      householdId: "hh-okafor",
      actorId: "st-priya",
      action: "consent.activated",
      subjectType: "consent",
      subjectId: "cs-okafor-equipment",
      summary: "Synthetic test event.",
      visibility: "staff",
      reason: "Synthetic reason.",
      approval: { requestedBy: "st-maya", approvedBy: "st-priya" },
      prepared: true,
    });
    // No roles recorded: as an event written before the approved shape.
    await appendAudit(t.db, {
      tenantId: "t-willow",
      householdId: "hh-okafor",
      actorId: "st-maya",
      action: "note.added",
      subjectType: "household",
      summary: "Synthetic older event.",
      visibility: "staff",
      actorRoles: [],
    });
    const r = await auditReview(t.db, await t.as("st-dana"), { householdId: "hh-okafor", days: 1 });
    const [older, activated] = [r.events[0]!, r.events[1]!];
    expect(activated).toMatchObject({
      role: "Authority/consent reviewer",
      roleRecorded: true,
      source: "staff",
      reason: "Synthetic reason.",
      approval: { requestedBy: "Maya Chen", approvedBy: "Priya Raman" },
      prepared: true,
    });
    expect(older).toMatchObject({ role: "Care guide", roleRecorded: false });
  });

  it("keeps the integrity chain intact", async () => {
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });
});
