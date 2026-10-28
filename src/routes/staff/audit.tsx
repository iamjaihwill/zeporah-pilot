import { StaffPending } from "@/components/staff/pending";
import { SplitPane, StaffPageHeader } from "@/components/staff";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { z } from "zod";
import { exportAuditCsv, getAuditReview } from "@/functions/staff";
import { cx, dateOnly, isDenied, stamp, unwrap, useAction } from "@/lib/client";
import { Button, Coded, ConfirmDialog, DeniedView, EmptyState, Notice, inputClass } from "@/components/ui";
import { DECISION_LABELS, reasonLabel, auditLabel } from "@/domain/labels";
import { AUDIT_SOURCE_LABELS, PREPARED_LABEL, type AuditSource } from "@/domain/audit-shape";
import { ShapeBadges, recordLink } from "@/components/staff/audit-bits";
import { PILOT_DISPLAY } from "@/domain/display-config";

/** Organization-wide audit review (operations and reviewers). Read-only. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_FILTERS = [
  "staff",
  "family",
  "recipient",
  "partner_simulated",
  "system",
  "rule",
  "prepared",
  "approval",
] as const;
const SOURCE_FILTER_LABELS: Record<(typeof SOURCE_FILTERS)[number], string> = {
  ...AUDIT_SOURCE_LABELS,
  prepared: PREPARED_LABEL,
  approval: "Two-person approvals",
};
const search = z.object({
  category: z.enum(["access", "people", "sharing", "care"]).optional(),
  householdId: z.string().optional(),
  days: z.coerce.number().optional(),
  // A calendar range instead of `days` (whole days in the hospice's time zone).
  from: z.string().regex(DATE).optional(),
  to: z.string().regex(DATE).optional(),
  // Who did it: an id, safe in the URL. (Free-text search is never put in the URL — see below.)
  actorId: z.string().max(100).optional(),
  // Where events came from, prepared content, or two-person approvals (decision 58).
  source: z.enum(SOURCE_FILTERS).optional(),
  // The event open in the side panel.
  sel: z.string().max(100).optional(),
});
type Search = z.infer<typeof search>;

export const Route = createFileRoute("/staff/audit")({
  validateSearch: search,
  loaderDeps: ({ search: { sel: _sel, ...rest } }) => rest,
  loader: async ({ deps }) => unwrap(await getAuditReview({ data: deps })),
  component: Audit,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

const PERIODS = [
  ["1", "Last 24 hours"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["365", "Last 12 months"],
  ["range", "Choose dates…"],
] as const;

/** The calendar day an event falls on, in the hospice's time zone (for the day headings). */
const dayKey = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-CA", { timeZone: PILOT_DISPLAY.timeZone });
const timeOf = (d: Date | string) =>
  new Date(d).toLocaleTimeString("en-US", {
    timeZone: PILOT_DISPLAY.timeZone,
    hour: "numeric",
    minute: "2-digit",
  });

function Audit() {
  const loaded = Route.useLoaderData();
  const navigate = useNavigate({ from: "/staff/audit" });
  const current = Route.useSearch();
  // Filters apply as soon as they change (they live in the address, like the other staff pages).
  const set = (p: Partial<Search>) =>
    void navigate({ search: (s: Search) => ({ ...s, ...p, sel: undefined }) } as never);
  // 50 rows at a time: the full list made the page several screens long.
  const PAGE = 50;
  const [shownRows, setShownRows] = useState(PAGE);
  useEffect(() => setShownRows(PAGE), [loaded]);
  // Free-text search stays in this page (never in the URL, where it could carry personal details):
  // the words go to the server in the call itself, and results replace the list. It re-runs when
  // the other filters change.
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState<typeof loaded | null>(null);
  const filters = {
    ...(current.category ? { category: current.category } : {}),
    ...(current.householdId ? { householdId: current.householdId } : {}),
    ...(current.actorId ? { actorId: current.actorId } : {}),
    ...(current.source ? { source: current.source } : {}),
    ...(current.from && current.to ? { from: current.from, to: current.to } : { days: current.days ?? 30 }),
  };
  const runSearch = async (words: string) => {
    if (!words.trim()) return setSearched(null);
    setSearched(unwrap(await getAuditReview({ data: { ...filters, q: words } })));
  };
  useEffect(() => {
    if (q.trim()) void runSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  const [ranging, setRanging] = useState(!!current.from);
  const [range, setRange] = useState({ from: current.from ?? "", to: current.to ?? "" });
  const d = searched ?? loaded;
  if (isDenied(d)) return <DeniedView d={d} />;
  type Ev = (typeof d.events)[number];
  const shown = d.events.slice(0, shownRows);
  const active = d.events.find((e) => e.id === current.sel) ?? null;
  const open = (e: Ev | null) =>
    void navigate({ search: (s: Search) => ({ ...s, sel: e?.id }), replace: true } as never);
  const period = current.from && current.to ? "range" : String(current.days ?? 30);
  const periodText = d.range
    ? `from ${d.range.from} to ${d.range.to}`
    : `in the ${PERIODS.find(([v]) => v === String(d.days))?.[1].toLowerCase() ?? `last ${d.days} days`}`;

  const list = (
    <>
      {d.events.length === 0 ? (
        <EmptyState title="No events match">Try a longer period or another kind of event.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-[var(--s-radius)] border bg-surface">
          <table className="w-full border-separate border-spacing-0 text-left text-[0.8125rem]">
            <caption className="sr-only">Audit events, newest first, grouped by day</caption>
            <thead className="sticky top-0 z-10 bg-sunk text-[0.75rem] text-ink-soft">
              <tr>
                <th scope="col" className="h-8 w-20 border-b px-2.5 font-semibold">
                  Time
                </th>
                <th scope="col" className="h-8 w-36 border-b px-2.5 font-semibold max-lg:hidden">
                  Who
                </th>
                <th scope="col" className="h-8 w-full border-b px-2.5 font-semibold">
                  Event
                </th>
                <th
                  scope="col"
                  className={cx("h-8 w-44 border-b px-2.5 font-semibold max-xl:hidden", active && "hidden")}
                >
                  Household
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e, i) => {
                const day = dayKey(e.at);
                const newDay = i === 0 || dayKey(shown[i - 1]!.at) !== day;
                const isActive = e.id === current.sel;
                return (
                  <Fragment key={e.id}>
                    {newDay && (
                      <tr>
                        <th
                          scope="rowgroup"
                          colSpan={4}
                          className="border-b bg-paper px-2.5 py-1 text-[0.75rem] font-semibold text-ink"
                        >
                          {day === dayKey(new Date()) ? `Today · ${dateOnly(e.at)}` : dateOnly(e.at)}
                        </th>
                      </tr>
                    )}
                    <tr
                      data-row-id={e.id}
                      onClick={(ev) => {
                        if ((ev.target as HTMLElement).closest("button, a")) return;
                        open(e);
                      }}
                      className={cx(
                        "cursor-pointer align-top",
                        isActive ? "bg-harbor-soft" : "hover:bg-sunk/70",
                      )}
                    >
                      <td className="border-b px-2.5 py-1.5 whitespace-nowrap text-ink-soft">
                        {/* The full time, with year and zone, is in the tooltip and the export. */}
                        <time dateTime={new Date(e.at).toISOString()} title={stamp(e.at)}>
                          {timeOf(e.at)}
                        </time>
                      </td>
                      <td className="border-b px-2.5 py-1.5 max-lg:hidden">
                        <span className="block whitespace-nowrap">{e.by}</span>
                        {e.role && (
                          <span className="block text-[0.75rem] text-ink-soft">
                            {e.role}
                            {!e.roleRecorded && " (current role)"}
                          </span>
                        )}
                      </td>
                      <td className="border-b px-2.5 py-1.5">
                        <button
                          type="button"
                          className="w-full text-left"
                          aria-label={`Open ${auditLabel(e.action)}, ${stamp(e.at)}`}
                          aria-current={isActive ? "true" : undefined}
                          onClick={() => open(e)}
                        >
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <Coded
                              className="font-medium text-ink"
                              label={auditLabel(e.action)}
                              code={e.action}
                            />
                            {e.decision && (
                              <span
                                className={cx(
                                  "rounded-full border px-1.5 text-[0.6875rem] font-semibold",
                                  e.decision === "allow"
                                    ? "border-moss/30 bg-moss-soft text-moss"
                                    : "border-ochre/30 bg-ochre-soft text-ochre",
                                )}
                              >
                                {DECISION_LABELS[e.decision] ?? e.decision}
                                {e.reasonCode ? ` · ${reasonLabel(e.reasonCode)}` : ""}
                              </span>
                            )}
                            <ShapeBadges e={e} />
                          </span>
                          <span className="block text-ink-soft">{e.summary}</span>
                          {/* Below the widths that show them, who and which household join this line. */}
                          <span className="block text-[0.75rem] text-ink-soft xl:hidden">
                            <span className="lg:hidden">{e.by}</span>
                            {e.household && (
                              <span className={cx(active ? "" : "xl:hidden")}>
                                <span className="lg:hidden"> · </span>
                                {e.household}
                              </span>
                            )}
                          </span>
                        </button>
                      </td>
                      <td className={cx("truncate border-b px-2.5 py-1.5 max-xl:hidden", active && "hidden")}>
                        {e.household ?? <span className="text-ink-soft">—</span>}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {d.events.length > shownRows && (
            <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-sm">
              <span className="text-ink-soft" aria-live="polite">
                Showing {shownRows} of {d.events.length}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setShownRows((n) => n + PAGE)}>
                Show {Math.min(PAGE, d.events.length - shownRows)} more
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      <StaffPageHeader
        title="Audit review"
        description={
          <>
            Append-only. Summaries never include message or note text.
            {d.canSeeAccessLog && (
              <>
                {" "}
                <Link to="/staff/access-log" className="text-harbor underline underline-offset-2">
                  Who opened records
                </Link>
              </>
            )}
          </>
        }
        actions={
          d.integrity.ok ? (
            // One line while it passes; the full warning below if it ever doesn't.
            <span className="text-[0.8125rem] text-moss" data-testid="integrity-line">
              <span aria-hidden>✓ </span>Audit chain verified · {d.integrity.checked} events across the
              hospice · just now
            </span>
          ) : undefined
        }
      />
      {!d.integrity.ok && (
        <div className="mb-4">
          <Notice tone="rose" title="Integrity check didn't pass">
            {d.integrity.message}
          </Notice>
        </div>
      )}
      <div
        className="mb-3 flex flex-wrap items-end gap-2 [&_select]:!min-h-8 [&_select]:!py-0.5"
        role="group"
        aria-label="Filter the audit log"
      >
        <label className="text-[0.75rem] text-ink-soft">
          Kind of event
          <select
            className={inputClass + " !w-52"}
            value={current.category ?? ""}
            onChange={(e) => set({ category: (e.target.value || undefined) as Search["category"] })}
          >
            <option value="">All kinds</option>
            {d.categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[0.75rem] text-ink-soft">
          Household
          <select
            className={inputClass + " !w-48"}
            value={current.householdId ?? ""}
            onChange={(e) => set({ householdId: e.target.value || undefined })}
          >
            <option value="">All you can see</option>
            {d.households.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[0.75rem] text-ink-soft">
          Who
          <select
            className={inputClass + " !w-40"}
            value={current.actorId ?? ""}
            onChange={(e) => set({ actorId: e.target.value || undefined })}
          >
            <option value="">Anyone</option>
            {d.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[0.75rem] text-ink-soft">
          Source
          <select
            className={inputClass + " !w-44"}
            value={current.source ?? ""}
            onChange={(e) => set({ source: (e.target.value || undefined) as Search["source"] })}
          >
            <option value="">Any source</option>
            {SOURCE_FILTERS.map((k) => (
              <option key={k} value={k}>
                {SOURCE_FILTER_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[0.75rem] text-ink-soft">
          Period
          <select
            className={inputClass + " !w-40"}
            value={ranging ? "range" : period}
            onChange={(e) => {
              if (e.target.value === "range") return setRanging(true);
              setRanging(false);
              set({ days: Number(e.target.value), from: undefined, to: undefined });
            }}
          >
            {PERIODS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {ranging && (
          <form
            className="flex items-end gap-2"
            aria-label="Choose dates"
            onSubmit={(e) => {
              e.preventDefault();
              if (range.from && range.to) set({ from: range.from, to: range.to, days: undefined });
            }}
          >
            <label className="text-[0.75rem] text-ink-soft">
              From
              <input
                type="date"
                required
                className={inputClass + " !min-h-8 !w-40 !py-0.5"}
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
              />
            </label>
            <label className="text-[0.75rem] text-ink-soft">
              To
              <input
                type="date"
                required
                className={inputClass + " !min-h-8 !w-40 !py-0.5"}
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
              />
            </label>
            <Button type="submit" size="sm">
              Show
            </Button>
          </form>
        )}
        <form
          role="search"
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(q);
          }}
        >
          <label className="text-[0.75rem] text-ink-soft">
            Search summaries
            <input
              type="search"
              className={inputClass + " !min-h-8 !w-52 !py-0.5"}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (!e.target.value) setSearched(null);
              }}
              maxLength={80}
            />
          </label>
          <Button type="submit" size="sm" variant="secondary">
            Search
          </Button>
        </form>
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft" aria-live="polite">
          {d.total === 1 ? "1 event" : `${d.total} events`} {periodText}
          {d.truncated ? " — showing the newest 300. Narrow the filters to see older ones." : "."}
        </p>
        {d.canExport && (
          <ExportButton
            tooLong={d.days > 90}
            filter={{
              ...(d.category ? { category: d.category } : {}),
              ...(d.householdId ? { householdId: d.householdId } : {}),
              ...(d.actorId ? { actorId: d.actorId } : {}),
              ...(d.source ? { source: d.source } : {}),
              ...(d.q ? { q: d.q } : {}),
              ...(d.range ? { from: d.range.from, to: d.range.to } : { days: d.days }),
            }}
          />
        )}
      </div>
      <SplitPane
        list={list}
        open={!!active}
        onClose={() => open(null)}
        detailLabel="Event details"
        detail={active && <EventDetail e={active} onClose={() => open(null)} />}
      />
    </>
  );
}

function EventDetail({
  e,
  onClose,
}: {
  e: {
    at: Date;
    action: string;
    by: string;
    household: string | null;
    householdId: string | null;
    summary: string;
    decision: string | null;
    reasonCode: string | null;
    subjectType: string;
    subjectId: string | null;
    role: string | null;
    roleRecorded: boolean;
    source: AuditSource | null;
    reason: string | null;
    approval: { requestedBy: string; approvedBy: string } | null;
    prepared: boolean;
  };
  onClose: () => void;
}) {
  const link = recordLink(e);
  return (
    <div className="space-y-3" data-testid="detail-panel">
      <div className="flex items-start justify-between gap-2">
        <h2 id="detail-title" tabIndex={-1} className="outline-none">
          {auditLabel(e.action)}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-[0.75rem] text-ink-soft hover:bg-sunk"
        >
          Close<span className="sr-only"> the event details</span>
        </button>
      </div>
      <p>{e.summary}</p>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-[0.8125rem]">
        <dt className="text-ink-soft">When</dt>
        <dd>{stamp(e.at)}</dd>
        <dt className="text-ink-soft">Who</dt>
        <dd>{e.by}</dd>
        {e.role && (
          <>
            <dt className="text-ink-soft">Role</dt>
            <dd>
              {e.role}
              {!e.roleRecorded && (
                <span className="block text-ink-soft">Current role: this event didn't record one</span>
              )}
            </dd>
          </>
        )}
        {e.source && (
          <>
            <dt className="text-ink-soft">Source</dt>
            <dd>
              {AUDIT_SOURCE_LABELS[e.source]}
              {e.prepared && (
                <span className="block text-ink-soft">
                  {PREPARED_LABEL}, accepted by {e.by}
                </span>
              )}
            </dd>
          </>
        )}
        {e.reason && (
          <>
            <dt className="text-ink-soft">Reason</dt>
            <dd>{e.reason}</dd>
          </>
        )}
        {e.approval && (
          <>
            <dt className="text-ink-soft">Approval</dt>
            <dd>
              Requested by {e.approval.requestedBy}
              <span className="block">Approved by {e.approval.approvedBy}</span>
            </dd>
          </>
        )}
        <dt className="text-ink-soft">Household</dt>
        <dd>{e.household ?? "Not tied to a household"}</dd>
        {e.decision && (
          <>
            <dt className="text-ink-soft">Decision</dt>
            <dd>
              {DECISION_LABELS[e.decision] ?? e.decision}
              {e.reasonCode && <span className="block text-ink-soft">{reasonLabel(e.reasonCode)}</span>}
            </dd>
          </>
        )}
        <dt className="text-ink-soft">Event code</dt>
        <dd>
          <code>{e.action}</code>
          {e.reasonCode && (
            <>
              {" "}
              · <code>{e.reasonCode}</code>
            </>
          )}
        </dd>
      </dl>
      {link && (
        <p className="border-t pt-2">
          <Link {...(link as { to: "/staff" })} className="text-harbor underline">
            Open the record
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * Download the events shown by the current filters as CSV (founder decision 28): event code, the
 * app's plain-language label, who, household, time and decision — never message or note text.
 * The download is recorded in the audit log. Exports cover at most 90 days.
 */
function ExportButton({
  filter,
  tooLong,
}: {
  filter: {
    category?: "access" | "people" | "sharing" | "care";
    householdId?: string;
    actorId?: string;
    q?: string;
    days?: number;
    from?: string;
    to?: string;
  };
  tooLong: boolean;
}) {
  const { act, pending, sending, error } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      {/* Decision 29f: say what the file is and how to handle it before it's made. */}
      <ConfirmDialog
        title="Export this audit log?"
        confirmLabel="Download CSV"
        error={error}
        disabled={pending}
        trigger={(open) => (
          <Button variant="secondary" size="sm" disabled={pending || tooLong} onClick={open}>
            {sending ? "Preparing…" : "Export CSV"}
          </Button>
        )}
        onConfirm={() =>
          act(async () => {
            const r = await exportAuditCsv({ data: filter });
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
          The file lists the events shown by your current filters: when, the event and its plain-language
          label, who, which household and the decision. It never includes message or note text.
        </p>
        <p>
          <strong className="text-ink">It's confidential.</strong> Store and share it only under your
          hospice's records policy. Once downloaded, Zeporah can't control or recall it.
        </p>
        <p>Your name and this export are recorded in the audit log, and the file says who made it.</p>
      </ConfirmDialog>
      {error && <p className="text-sm text-rose">{error}</p>}
      <p className="text-xs text-ink-soft">
        {tooLong
          ? "Exports cover at most 90 days. Choose a shorter period to export."
          : "Uses the filters shown. No message or note text."}
      </p>
    </div>
  );
}
