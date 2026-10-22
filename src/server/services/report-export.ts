/**
 * Exporting a report as CSV (founder decision 57): the tab and period on screen, as section, label
 * and value rows — counts and durations only. Staff are named only in the workforce report, as on
 * screen; never patients, families, households or record content. Operations only (who can open
 * Reports). The file opens with a confidentiality line, who made it, when, and what it covers, and
 * every export is recorded in the audit log.
 */
import type { DB } from "../db/client";
import { appendAudit } from "../audit";
import { AccessError, requireStaffPermission, type ActorContext } from "../context";
import { cell } from "./audit-review";
import { operationsReport, reportSet, trendsReport } from "./reports";
import { bucketLabel } from "@/domain/report-buckets";
import { reasonLabel } from "@/domain/labels";
import { QUEUE_LABELS } from "@/domain/queue";
import { ROLE_LABELS, type RoleCode } from "@/domain/model";

export const REPORT_KEYS = [
  "overview",
  "households",
  "work",
  "exceptions",
  "bereavement",
  "workforce",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];
export const REPORT_TITLES: Record<ReportKey, string> = {
  overview: "Executive overview",
  households: "Households and caseload",
  work: "Open work and aging",
  exceptions: "Sharing exceptions",
  bereavement: "Bereavement follow-up",
  workforce: "Workforce and workload",
};
export const REPORT_EXPORT_NOTICE =
  "Confidential: Zeporah report export. Store and share it only under your hospice's records policy.";
const PERIODS = [7, 30, 90];

type Row = [section: string, label: string, value: string | number | null];

export async function reportExport(
  db: DB,
  ctx: ActorContext,
  input: { report: ReportKey; days: number },
  now = new Date(),
) {
  requireStaffPermission(ctx, "staff.lifecycle.manage");
  // Operations, who open Reports: administrators hold the permission above but do no household
  // work (decision 39), so they don't get Reports or its exports.
  requireStaffPermission(ctx, "staff.household.view");
  if (!REPORT_KEYS.includes(input.report)) throw new AccessError("INVALID", "Choose a report.");
  if (!PERIODS.includes(input.days)) throw new AccessError("INVALID", "Choose 7, 30 or 90 days.");
  const [r, t, x] = await Promise.all([
    operationsReport(db, ctx, now),
    trendsReport(db, ctx, { days: input.days }, now),
    reportSet(db, ctx, now),
  ]);
  const per = t.bucket === "day" ? "day" : "week";
  const series = (section: string, points: { start: Date; end: Date; v: number | null }[]): Row[] =>
    points.map((p) => [section, bucketLabel(p, t.bucketDays), p.v]);
  const tile = (label: string, v: { value: number | null; previous: number | null }): Row[] => [
    ["Summary", label, v.value],
    ["Summary", `${label} (previous ${t.days} days)`, v.previous],
  ];
  const rows: Row[] = [];
  const add = (section: string, items: { label: string; n: number | null }[]) =>
    rows.push(...items.map((i): Row => [section, i.label, i.n]));
  switch (input.report) {
    case "overview":
      rows.push(
        ...tile("Escalations raised", t.tiles.escalationsRaised),
        ...tile("Median hours to resolve", t.tiles.medianHoursToResolve),
        ...tile("Consents activated", t.tiles.consentsActivated),
        ...tile("Median hours to activate", t.tiles.medianHoursToActivate),
        ...tile("Households waiting for a reply", t.tiles.messagesWaitingNow),
      );
      add("Households", [
        ...r.households.byStage.map((s) => ({ label: s.stage, n: s.n })),
        { label: "Without a care guide", n: r.households.uncovered },
      ]);
      add("Open work", [
        { label: "In the coordination queue", n: x.openWork.total },
        { label: "Escalations with no owner", n: x.openWork.unownedEscalations },
        { label: "Overdue tasks", n: x.openWork.overdueTasks.household + x.openWork.overdueTasks.careTeam },
      ]);
      add("Sharing exceptions", [
        { label: "Consents needing action", n: x.exceptions.consentsNeedingAction },
        { label: "Open correction requests", n: x.exceptions.correctionsOpen },
        { label: "Packets held or denied", n: x.exceptions.packetsHeldOrDenied.reduce((a, b) => a + b.n, 0) },
      ]);
      add("Bereavement follow-up", [
        { label: "Check-ins overdue", n: x.bereavement.overdue },
        { label: "Due this week", n: x.bereavement.thisWeek },
        { label: "Contact paused", n: x.bereavement.contactPaused },
      ]);
      rows.push(
        ...series(
          `Escalations raised, per ${per}`,
          t.escalationVolume.map((b) => ({ ...b, v: b.n })),
        ),
        ...series(
          `Households waiting for a reply, end of each ${per}`,
          t.messagesWaiting.map((b) => ({ ...b, v: b.n })),
        ),
      );
      break;
    case "households":
      add(
        "Households by stage",
        r.households.byStage.map((s) => ({ label: s.stage, n: s.n })),
      );
      add("Households by stage", [{ label: "Without a care guide (not closed)", n: r.households.uncovered }]);
      add(
        "Households per care guide",
        r.caseload.map((c) => ({ label: c.name, n: c.n })),
      );
      rows.push(
        ...series(
          `Households waiting for a reply, end of each ${per}`,
          t.messagesWaiting.map((b) => ({ ...b, v: b.n })),
        ),
      );
      break;
    case "work":
      add(
        "Open work by age",
        x.openWork.aging.map((a) => ({ label: a.label, n: a.n })),
      );
      add("Needs attention", [
        { label: "Escalations with no owner", n: x.openWork.unownedEscalations },
        { label: "Household tasks overdue", n: x.openWork.overdueTasks.household },
        { label: "Care-team tasks overdue", n: x.openWork.overdueTasks.careTeam },
        { label: "Care-team tasks with no one assigned", n: x.openWork.unassignedCareTeamTasks },
      ]);
      add(
        "Coordination queue",
        r.queue.map((q) => ({ label: QUEUE_LABELS[q.kind as keyof typeof QUEUE_LABELS] ?? q.kind, n: q.n })),
      );
      rows.push(
        ...series(
          `Median hours to resolve, per ${per}`,
          t.timeToResolve.map((b) => ({ ...b, v: b.hours })),
        ),
      );
      break;
    case "exceptions":
      add("Consents", [
        ...r.consents.map((c) => ({ label: c.stage, n: c.n })),
        { label: "Needing action", n: x.exceptions.consentsNeedingAction },
        { label: "Ending within a week", n: x.exceptions.consentsExpiringThisWeek },
      ]);
      add("Corrections", [{ label: "Open correction requests", n: x.exceptions.correctionsOpen }]);
      add("Packet releases held or denied", [
        ...x.exceptions.packetsHeldOrDenied.map((p) => ({ label: reasonLabel(p.reason), n: p.n })),
        { label: "Released, ending within a week", n: x.exceptions.packetsExpiringThisWeek },
      ]);
      add("Access, last 30 days", [
        { label: "Requests refused (out of scope)", n: r.access.refusedLast30Days },
        { label: "Failed sign-ins", n: r.access.failedSignInsLast30Days },
        { label: "Sign-in pauses", n: r.access.lockoutsLast30Days },
      ]);
      break;
    case "bereavement":
      add("Check-ins", [
        { label: "Households in bereavement support", n: x.bereavement.households },
        { label: "Overdue", n: x.bereavement.overdue },
        { label: "Due this week", n: x.bereavement.thisWeek },
        { label: "Due this month", n: x.bereavement.thisMonth },
        { label: "Recorded in the last 30 days", n: r.bereavement.recordedLast30Days },
        { label: "Households who paused contact", n: x.bereavement.contactPaused },
        { label: "Households who declined contact", n: x.bereavement.declined },
      ]);
      add(
        "Due within a month, per care guide",
        x.bereavement.byGuide.map((g) => ({ label: g.name, n: g.n })),
      );
      break;
    case "workforce":
      for (const g of x.workforce.guides)
        rows.push(
          ["Care guides", `${g.name}: households`, g.households],
          ["Care guides", `${g.name}: escalations owned`, g.escalations],
        );
      add("Coverage", [
        { label: "Households without a care guide", n: x.workforce.uncovered },
        ...x.workforce.byRole.map((b) => ({
          label: `Active: ${ROLE_LABELS[b.role as RoleCode] ?? b.role}`,
          n: b.n,
        })),
        { label: "Former staff", n: x.workforce.former },
      ]);
      break;
  }
  const title = REPORT_TITLES[input.report];
  const date = now.toISOString().slice(0, 10);
  const csv = [
    cell(REPORT_EXPORT_NOTICE),
    cell(`Exported by ${ctx.displayName} at ${now.toISOString()}`),
    cell(`Report: ${title}; last ${t.days} days; as of ${r.asOf.toISOString()}`),
    "",
    "section,label,value",
    ...rows.map(([s, l, v]) => [cell(s), cell(l), cell(v === null ? "" : String(v))].join(",")),
  ].join("\r\n");
  await appendAudit(db, {
    tenantId: ctx.tenantId,
    householdId: null,
    actorId: ctx.actorId,
    action: "report.exported",
    subjectType: "report",
    subjectId: input.report,
    summary: `A report was exported: ${title}, last ${t.days} days.`,
    visibility: "staff",
    context: { report: input.report, days: t.days, rows: rows.length },
  });
  return { csv, filename: `zeporah-report-${input.report}-${date}-last-${t.days}-days.csv` };
}
