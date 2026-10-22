import { StaffPending } from "@/components/staff/pending";
import { DataTable, StaffPageHeader, StatusChip, ViewTabs, type Column } from "@/components/staff";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { getSharingRegister } from "@/functions/staff";
import { dateOnly, isDenied, unwrap } from "@/lib/client";
import { Badge, DeniedView, EmptyState, inputClass } from "@/components/ui";
import { statusOf } from "@/domain/status";

/**
 * Every consent in the households you can see, in one place. The same visibility as each
 * household's Sharing tab: operations and reviewers see their whole hospice, care guides their
 * assigned households.
 */
const VIEWS = [
  ["all", "All"],
  ["action", "Needs a person"],
  ["correction", "Correction requested"],
  ["active", "Active"],
  ["ending", "Ending soon"],
  ["closed", "Withdrawn or ended"],
] as const;
type View = (typeof VIEWS)[number][0];

const search = z.object({
  view: z.enum(["all", "action", "correction", "active", "ending", "closed"]).optional(),
  household: z.string().max(100).optional(),
  q: z.string().max(100).optional(),
});
type Search = z.infer<typeof search>;

export const Route = createFileRoute("/staff/sharing/")({
  validateSearch: search,
  loader: async () => unwrap(await getSharingRegister()),
  component: Register,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

/**
 * "All" puts what needs a person first (or has a correction open), then active consents by the
 * soonest end, then ones waiting or scheduled, and ended or withdrawn ones last.
 */
const rank = (r: { needsAction: boolean; stage: string }) =>
  r.needsAction ? 0 : r.stage === "active" ? 1 : r.stage === "revoked" || r.stage === "expired" ? 3 : 2;

function Register() {
  const rows = Route.useLoaderData();
  const sp = Route.useSearch();
  const { view = "all", household, q = "" } = sp;
  const navigate = useNavigate({ from: "/staff/sharing/" });
  const set = (p: Partial<Search>) =>
    void navigate({ search: (s: Search) => ({ ...s, ...p }), replace: true } as never);
  const [text, setText] = useState(q);
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => set({ q: text || undefined }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, q]);
  if (isDenied(rows)) return <DeniedView d={rows} />;
  type Row = (typeof rows)[number];
  const now = Date.now();
  const needle = q.trim().toLowerCase();
  const scoped = rows.filter(
    (r) =>
      (!household || r.householdId === household) &&
      (!needle || r.recipientName.toLowerCase().includes(needle) || r.purpose.toLowerCase().includes(needle)),
  );
  const pick = (v: View) =>
    scoped.filter((r) =>
      v === "action"
        ? r.needsAction
        : v === "correction"
          ? r.correctionOpen
          : v === "active"
            ? r.stage === "active" || r.stage === "scheduled"
            : v === "ending"
              ? r.endingSoon
              : v === "closed"
                ? r.stage === "revoked" || r.stage === "expired"
                : true,
    );
  const list = pick(view).sort(
    (a, b) => rank(a) - rank(b) || new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime(),
  );
  const label = VIEWS.find(([v]) => v === view)![1];
  const households = [...new Map(rows.map((r) => [r.householdId, r.household])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const cols: Column<Row>[] = [
    {
      key: "who",
      header: "Recipient and purpose",
      className: "w-full max-w-0 min-w-40",
      cell: (r) => (
        <span className="block min-w-0">
          {/* Two lines on tablets rather than cut short; one line on wide screens. */}
          <span className="block font-medium text-ink max-xl:line-clamp-2 xl:truncate">
            {r.recipientName}
          </span>
          <span className="block truncate text-[0.75rem] text-ink-soft">
            {r.purpose}
            {/* Only when it has been changed: version 1 is every consent's first. */}
            {r.version > 1 && ` · amended (version ${r.version})`}
            {/* Below wide screens the household joins this line instead of its own column. */}
            <span className="xl:hidden"> · {r.household}</span>
          </span>
        </span>
      ),
    },
    {
      key: "household",
      header: "Household",
      className: "whitespace-nowrap",
      hideBelow: "xl",
      cell: (r) => r.household,
    },
    {
      key: "stage",
      header: "Where it is",
      className: "whitespace-nowrap",
      cell: (r) => (
        // A short chip; the full wording (what has to happen next) is in the tooltip and on the
        // consent's own page.
        <span className="inline-flex items-center gap-1" title={r.stageLabel}>
          <StatusChip domain="consent" value={r.stage} />
          {r.correctionOpen && <Badge tone="ochre">Correction requested</Badge>}
          {/* The fuller wording, for screen readers, only where it adds to the chip. */}
          {r.stageLabel !== statusOf("consent", r.stage).label && (
            <span className="sr-only">{r.stageLabel}</span>
          )}
        </span>
      ),
    },
    {
      key: "ends",
      header: "Ends",
      className: "whitespace-nowrap",
      cell: (r) => {
        const past = new Date(r.expiresAt).getTime() <= now;
        return (
          <span className={past ? "text-ink-soft" : undefined}>
            {past ? "Ended " : ""}
            {dateOnly(r.expiresAt)}
            {r.endingSoon && <span className="block text-[0.75rem] text-ink-soft">Ending soon</span>}
          </span>
        );
      },
    },
    {
      key: "packets",
      header: "Packets",
      className: "whitespace-nowrap",
      hideBelow: "lg",
      cell: (r) =>
        r.packets.length ? (
          <span className="inline-flex flex-col items-start gap-1">
            {r.packets.map((p) => (
              <Link
                key={p.id}
                to="/staff/packets/$packetId"
                params={{ packetId: p.id }}
                aria-label={`Open the packet (${p.state}) for ${r.recipientName}`}
              >
                <StatusChip domain="packet" value={p.state} />
              </Link>
            ))}
          </span>
        ) : (
          <span className="text-ink-soft">No packets</span>
        ),
    },
  ];
  return (
    <>
      <StaffPageHeader title="Sharing register" />
      <ViewTabs
        label="Filter consents"
        className="mb-3"
        items={VIEWS.map(([v, l]) => ({
          key: v,
          label: l,
          count: pick(v).length,
          active: view === v,
          render: (cls, children) => (
            <Link
              to="/staff/sharing"
              search={{ ...sp, view: v === "all" ? undefined : v }}
              className={cls}
              aria-current={view === v ? "page" : undefined}
            >
              {children}
            </Link>
          ),
        }))}
      />
      <form
        role="search"
        className="mb-2 flex flex-wrap items-end gap-2 [&_select]:!min-h-8 [&_select]:!py-0.5"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: text || undefined });
        }}
      >
        <label className="text-[0.75rem] text-ink-soft">
          Find a recipient
          <input
            type="search"
            placeholder="Recipient or purpose"
            className={inputClass + " !min-h-8 !w-64 !py-0.5"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="text-[0.75rem] text-ink-soft">
          Household
          <select
            className={inputClass + " !w-48"}
            value={household ?? ""}
            onChange={(e) => set({ household: e.target.value || undefined })}
          >
            <option value="">All households</option>
            {households.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </form>
      {list.length === 0 ? (
        <EmptyState title={`Nothing under "${label}"`}>Try another view, or clear the filters.</EmptyState>
      ) : (
        <DataTable
          rows={list}
          columns={cols}
          caption={
            view === "all"
              ? "Consents: needing a person first, then active by soonest end, ended last"
              : `Consents: ${label}`
          }
          onActivate={(r) => void navigate({ to: "/staff/sharing/$consentId", params: { consentId: r.id } })}
          openLabel={(r) => `Open the consent for ${r.recipientName}, ${r.household}`}
        />
      )}
    </>
  );
}
