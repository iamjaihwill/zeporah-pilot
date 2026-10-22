import { StaffPending } from "@/components/staff/pending";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { exportReportCsv, getOperationsReport, getReportSet, getTrendsReport } from "@/functions/staff";
import { cx, isDenied, unwrap, useAction } from "@/lib/client";
import { Button, ConfirmDialog, DeniedView, Stamp } from "@/components/ui";
import { bucketLabel } from "@/domain/report-buckets";
import { Panel, StaffPageHeader, ViewTabs } from "@/components/staff";
import { reasonLabel } from "@/domain/labels";
import { ROLE_LABELS, type RoleCode } from "@/domain/model";
import { BarList, ColumnChart, LineChart, StatTile } from "@/components/staff/charts";
import { QUEUE_LABELS } from "@/domain/queue";

/**
 * Reports (hospice operations; staff rework, section 6): a date range first, tiles with the change
 * against the previous period, and a few single-series charts. Counts and durations only — never
 * people, households or record content.
 */
export const Route = createFileRoute("/staff/reports")({
  validateSearch: z.object({
    days: z.coerce.number().int().optional(),
    report: z.enum(["overview", "households", "work", "exceptions", "bereavement", "workforce"]).optional(),
  }),
  loaderDeps: ({ search }) => ({ days: [7, 30, 90].includes(search.days ?? 0) ? search.days : undefined }),
  loader: async ({ deps }) => {
    const set = await getReportSet();
    // Without a range in the address, the hospice's default report view (decision 39).
    const days = deps.days ?? (set.ok ? set.data.defaults.defaultDays : 30);
    const [snapshot, trends] = await Promise.all([
      getOperationsReport(),
      getTrendsReport({ data: { days } }),
    ]);
    return { snapshot: unwrap(snapshot), trends: unwrap(trends), set: unwrap(set) };
  },
  component: Reports,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

const md = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(
    new Date(d),
  );

/** Founder decision 41: the initial report set. */
const REPORTS = [
  ["overview", "Overview", "Executive overview"],
  ["households", "Households", "Households and caseload"],
  ["work", "Open work", "Open work and aging"],
  ["exceptions", "Sharing", "Sharing exceptions"],
  ["bereavement", "Bereavement", "Bereavement follow-up"],
  ["workforce", "Workforce", "Workforce and workload"],
] as const;
type ReportKey = (typeof REPORTS)[number][0];

/** Where each count comes from: the list it summarises, already filtered (the viewer can open it). */
type To = { to: string; search?: Record<string, string> };
const TO = {
  queue: { to: "/staff/exceptions", search: { view: "all" } },
  unassigned: { to: "/staff/exceptions", search: { view: "all", kind: "escalation", who: "unassigned" } },
  due: { to: "/staff/exceptions", search: { view: "due" } },
  messages: { to: "/staff/exceptions", search: { view: "all", kind: "message" } },
  escalations: { to: "/staff/exceptions", search: { view: "all", kind: "escalation" } },
  noGuide: { to: "/staff/households", search: { guide: "none" } },
  stage: (s: string) => ({ to: "/staff/households", search: { stage: s } }),
  sharingAction: { to: "/staff/sharing", search: { view: "action" } },
  corrections: { to: "/staff/sharing", search: { view: "correction" } },
  consentsActive: { to: "/staff/sharing", search: { view: "active" } },
  consentsEnding: { to: "/staff/sharing", search: { view: "ending" } },
  packets: { to: "/staff/packets" },
  packetsReleased: { to: "/staff/packets", search: { tab: "released" } },
  bereavement: { to: "/staff/bereavement" },
  access: { to: "/staff/audit", search: { category: "access" } },
  preparedAudit: (days: string) => ({ to: "/staff/audit", search: { source: "prepared", days } }),
  team: { to: "/staff/team" },
} satisfies Record<string, To | ((s: string) => To)>;
const STAGE_KEYS: Record<string, string> = {
  "Getting started": "enrolled",
  "Receiving hospice care": "active_hospice",
  "Bereavement support": "bereavement",
  Closed: "closed",
};

function Reports() {
  const { snapshot: r, trends: t, set: x } = Route.useLoaderData();
  const search = Route.useSearch();
  const days = search.days;
  const report = search.report ?? (isDenied(x) ? "overview" : x.defaults.defaultReport);
  if (isDenied(r)) return <DeniedView d={r} />;
  if (isDenied(t)) return <DeniedView d={t} />;
  if (isDenied(x)) return <DeniedView d={x} />;
  const per = t.bucket === "day" ? "day" : "week";
  return (
    <>
      <StaffPageHeader
        title="Reports"
        description="Workflow counts for this hospice. Never patients, families or records; staff are named only in the workforce report."
      />
      <ViewTabs
        label="Reports"
        className="mb-3"
        items={REPORTS.map(([key, label, full]) => ({
          key,
          label,
          active: report === key,
          render: (cls, children) => (
            <Link
              to="/staff/reports"
              search={{ report: key, ...(days ? { days } : {}) }}
              aria-current={report === key ? "page" : undefined}
              className={cls}
              title={full}
            >
              {children}
            </Link>
          ),
        }))}
      />
      {/* Filters: one row, date range first; everything below follows it. */}
      <nav aria-label="Date range" className="mb-3 flex flex-wrap items-center gap-1">
        {[7, 30, 90].map((d) => (
          <Link
            key={d}
            to="/staff/reports"
            search={{ days: d, report }}
            aria-current={t.days === d ? "page" : undefined}
            className={cx(
              "rounded-md border px-2.5 py-1 text-[0.8125rem]",
              t.days === d
                ? "border-harbor bg-harbor-soft font-semibold"
                : "bg-surface text-ink-soft hover:text-ink",
            )}
          >
            {t.days === d && <span aria-hidden>✓ </span>}Last {d} days
          </Link>
        ))}
        <span className="ml-2 text-[0.75rem] text-ink-soft">
          {md(t.from)} – {md(t.to)} · as of <Stamp at={r.asOf} full />
        </span>
        <span className="ml-auto">
          <ExportReport report={report as ReportKey} days={t.days} />
        </span>
      </nav>
      <h2 className="mb-3 text-xl">{REPORTS.find(([k]) => k === report)?.[2]}</h2>

      {report === "overview" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
            <StatTile
              label="Escalations raised"
              link={TO.escalations}
              {...t.tiles.escalationsRaised}
              upIsGood={null}
              days={t.days}
            />
            <StatTile
              label="Median time to resolve"
              {...t.tiles.medianHoursToResolve}
              unit="h"
              upIsGood={false}
              days={t.days}
            />
            <StatTile
              label="Consents activated"
              link={TO.consentsActive}
              {...t.tiles.consentsActivated}
              upIsGood={null}
              days={t.days}
            />
            <StatTile
              label="Median time to activate"
              {...t.tiles.medianHoursToActivate}
              unit="h"
              upIsGood={false}
              days={t.days}
            />
            <StatTile
              label="Households waiting for a reply"
              link={TO.messages}
              {...t.tiles.messagesWaitingNow}
              upIsGood={false}
              days={t.days}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Counts
              title="Households"
              rows={[
                ...r.households.byStage.map((s) => ({
                  label: s.stage,
                  n: s.n,
                  ...(STAGE_KEYS[s.stage] ? { to: TO.stage(STAGE_KEYS[s.stage]!) } : {}),
                })),
                { label: "Without a care guide", n: r.households.uncovered, to: TO.noGuide },
              ]}
            />
            <Counts
              title="Open work"
              rows={[
                { label: "In the coordination queue", n: x.openWork.total, to: TO.queue },
                { label: "Escalations with no owner", n: x.openWork.unownedEscalations, to: TO.unassigned },
                {
                  label: "Overdue tasks",
                  n: x.openWork.overdueTasks.household + x.openWork.overdueTasks.careTeam,
                  to: TO.due,
                },
              ]}
            />
            <Counts
              title="Sharing exceptions"
              rows={[
                {
                  label: "Consents needing action",
                  n: x.exceptions.consentsNeedingAction,
                  to: TO.sharingAction,
                },
                { label: "Open correction requests", n: x.exceptions.correctionsOpen, to: TO.corrections },
                {
                  label: "Packets held or denied",
                  n: x.exceptions.packetsHeldOrDenied.reduce((a, b) => a + b.n, 0),
                  to: TO.packets,
                },
              ]}
            />
            <Counts
              title="Prepared with Copilot"
              rows={[
                {
                  label: "Catch me up opened",
                  n: t.prepared.summaries,
                  to: TO.preparedAudit(String(t.days)),
                },
                {
                  label: "Prepared replies sent",
                  n: t.prepared.replies,
                  to: TO.preparedAudit(String(t.days)),
                },
                {
                  label: "Prepared handoff notes used",
                  n: t.prepared.handoffNotes,
                  to: TO.preparedAudit(String(t.days)),
                },
                {
                  label: "Prepared packet contents used",
                  n: t.prepared.packetContents,
                  to: TO.preparedAudit(String(t.days)),
                },
              ]}
            />
            <Counts
              title="Bereavement follow-up"
              rows={[
                { label: "Check-ins overdue", n: x.bereavement.overdue, to: TO.bereavement },
                { label: "Due this week", n: x.bereavement.thisWeek, to: TO.bereavement },
                { label: "Contact paused", n: x.bereavement.contactPaused, to: TO.bereavement },
              ]}
            />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel title={`Escalations raised, per ${per}`}>
              <ColumnChart
                title={`Escalations raised per ${per}`}
                points={t.escalationVolume.map((b) => ({ label: bucketLabel(b, t.bucketDays), value: b.n }))}
                empty={`No escalations were raised in the last ${t.days} days.`}
              />
            </Panel>
            <Panel title="Households waiting for a reply">
              <LineChart
                title={`Households with a family message and no care-team reply, at the end of each ${per}`}
                points={t.messagesWaiting.map((b) => ({ label: bucketLabel(b, t.bucketDays), value: b.n }))}
              />
            </Panel>
          </div>
        </>
      )}

      {report === "households" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Households by stage">
            <BarList
              title="Households by stage"
              points={r.households.byStage.map((s) => ({ label: s.stage, value: s.n }))}
            />
            <p className="mt-2 text-[0.75rem] text-ink-soft">
              {r.households.uncovered} without a care guide (not closed).
            </p>
          </Panel>
          <Panel title="Care-guide caseload">
            <BarList
              title="Households per care guide"
              points={r.caseload.map((c) => ({ label: c.name, value: c.n }))}
            />
          </Panel>
          <Panel title="Households waiting for a reply">
            <LineChart
              title={`Households with a family message and no care-team reply, at the end of each ${per}`}
              points={t.messagesWaiting.map((b) => ({ label: bucketLabel(b, t.bucketDays), value: b.n }))}
            />
          </Panel>
        </div>
      )}

      {report === "work" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Open work by age">
            <BarList
              title="Open coordination items by how long they've waited"
              points={x.openWork.aging.map((a) => ({ label: a.label, value: a.n }))}
            />
          </Panel>
          <Counts
            title="Needs attention"
            rows={[
              { label: "Escalations with no owner", n: x.openWork.unownedEscalations, to: TO.unassigned },
              { label: "Household tasks overdue", n: x.openWork.overdueTasks.household, to: TO.due },
              { label: "Care-team tasks overdue", n: x.openWork.overdueTasks.careTeam, to: TO.due },
              { label: "Care-team tasks with no one assigned", n: x.openWork.unassignedCareTeamTasks },
            ]}
          />
          <Counts
            title="Coordination queue"
            rows={r.queue.map((q) => ({
              label: QUEUE_LABELS[q.kind as keyof typeof QUEUE_LABELS] ?? q.kind,
              n: q.n,
              to: { to: "/staff/exceptions", search: { view: "all", kind: q.kind } },
            }))}
          />
          <Panel title={`Median time to resolve, per ${per}`}>
            <LineChart
              title={`Median hours to resolve an escalation, per ${per}`}
              unit="h"
              points={t.timeToResolve.map((b) => ({ label: bucketLabel(b, t.bucketDays), value: b.hours }))}
              empty={`No escalations were resolved in the last ${t.days} days.`}
            />
          </Panel>
        </div>
      )}

      {report === "exceptions" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Counts
            title="Consents"
            rows={[
              ...r.consents.map((c) => ({ label: c.stage, n: c.n })),
              { label: "Needing action", n: x.exceptions.consentsNeedingAction, to: TO.sharingAction },
              {
                label: "Ending within a week",
                n: x.exceptions.consentsExpiringThisWeek,
                to: TO.consentsEnding,
              },
            ]}
          />
          <Counts
            title="Corrections"
            rows={[
              { label: "Open correction requests", n: x.exceptions.correctionsOpen, to: TO.corrections },
            ]}
          />
          <Counts
            title="Packet releases held or denied"
            rows={[
              ...x.exceptions.packetsHeldOrDenied.map((p) => ({
                label: reasonLabel(p.reason),
                n: p.n,
                to: TO.packets,
              })),
              {
                label: "Released, ending within a week",
                n: x.exceptions.packetsExpiringThisWeek,
                to: TO.packetsReleased,
              },
            ]}
          />
          <Counts
            title="Access, last 30 days"
            rows={[
              { label: "Requests refused (out of scope)", n: r.access.refusedLast30Days, to: TO.access },
              { label: "Failed sign-ins", n: r.access.failedSignInsLast30Days, to: TO.access },
              { label: "Sign-in pauses", n: r.access.lockoutsLast30Days, to: TO.access },
            ]}
          />
        </div>
      )}

      {report === "bereavement" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Counts
            title="Check-ins"
            rows={[
              {
                label: "Households in bereavement support",
                n: x.bereavement.households,
                to: TO.stage("bereavement"),
              },
              { label: "Overdue", n: x.bereavement.overdue, to: TO.bereavement },
              { label: "Due this week", n: x.bereavement.thisWeek, to: TO.bereavement },
              { label: "Due this month", n: x.bereavement.thisMonth, to: TO.bereavement },
              { label: "Recorded in the last 30 days", n: r.bereavement.recordedLast30Days },
              { label: "Households who paused contact", n: x.bereavement.contactPaused },
              { label: "Households who declined contact", n: x.bereavement.declined },
            ]}
          />
          <Panel title="Due within a month, per care guide">
            <BarList
              title="Bereavement check-ins due within a month, per care guide"
              points={x.bereavement.byGuide.map((g) => ({ label: g.name, value: g.n }))}
            />
          </Panel>
        </div>
      )}

      {report === "workforce" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Care guides">
            <table className="w-full text-left text-[0.8125rem]">
              <caption className="sr-only">Each care guide's households and open escalations</caption>
              <thead className="text-ink-soft">
                <tr>
                  <th scope="col" className="py-1 font-semibold">
                    Care guide
                  </th>
                  <th scope="col" className="py-1 text-right font-semibold">
                    Households
                  </th>
                  <th scope="col" className="py-1 text-right font-semibold">
                    Escalations owned
                  </th>
                </tr>
              </thead>
              <tbody>
                {x.workforce.guides.map((g) => (
                  <tr key={g.name} className="border-t">
                    <td className="py-1">{g.name}</td>
                    <td className="py-1 text-right tabular-nums">{g.households}</td>
                    <td className="py-1 text-right tabular-nums">{g.escalations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Counts
            title="Coverage"
            rows={[
              { label: "Households without a care guide", n: x.workforce.uncovered, to: TO.noGuide },
              ...x.workforce.byRole.map((b) => ({
                label: `Active: ${ROLE_LABELS[b.role as RoleCode] ?? b.role}`,
                n: b.n,
              })),
              { label: "Former staff", n: x.workforce.former },
            ]}
          />
        </div>
      )}
    </>
  );
}

function Counts({ title, rows }: { title: string; rows: { label: string; n: number; to?: To }[] }) {
  return (
    <Panel title={title}>
      {rows.length ? (
        <dl className="space-y-0.5 text-[0.8125rem]">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-3">
              <dt className="text-ink-soft">{r.label}</dt>
              <dd className="font-medium tabular-nums">
                {r.to ? (
                  // The list this number summarises.
                  <Link
                    {...(r.to as { to: "/staff" })}
                    // At least 24×24, so a single digit is still an easy target.
                    className="inline-flex min-h-6 min-w-6 items-center justify-end text-harbor underline-offset-2 hover:underline"
                  >
                    {r.n}
                    <span className="sr-only"> — show {r.label.toLowerCase()}</span>
                  </Link>
                ) : (
                  r.n
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-ink-soft">None.</p>
      )}
    </Panel>
  );
}

/**
 * Export the report on screen as CSV (founder decision 57): counts and durations only, staff named
 * only in the workforce report. Confirmed first (as decision 29f); the server records every export.
 */
function ExportReport({ report, days }: { report: ReportKey; days: number }) {
  const { act, pending, error } = useAction();
  return (
    <ConfirmDialog
      title="Export this report?"
      confirmLabel="Download CSV"
      error={error}
      disabled={pending}
      trigger={(open) => (
        <Button variant="secondary" size="sm" disabled={pending} onClick={open}>
          {pending ? "Preparing…" : "Export CSV"}
        </Button>
      )}
      onConfirm={() =>
        act(async () => {
          const r = await exportReportCsv({ data: { report, days } });
          if (r.ok) {
            const url = URL.createObjectURL(new Blob([r.data.csv], { type: "text/csv;charset=utf-8" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = r.data.filename;
            a.click();
            URL.revokeObjectURL(url);
          }
          return r;
        }, "The CSV was downloaded. The export is recorded in the audit log.")
      }
    >
      <p>
        The file has this report for the period shown, as counts and durations: each row's section, label and
        value. It never names patients, families or households
        {report === "workforce" ? "; care guides are named, as on screen" : ""}.
      </p>
      <p>
        <strong className="text-ink">It's confidential.</strong> Store and share it only under your hospice's
        records policy. Once downloaded, Zeporah can't control or recall it.
      </p>
      <p>Your name and this export are recorded in the audit log, and the file says who made it.</p>
    </ConfirmDialog>
  );
}
