import { StaffPending } from "@/components/staff/pending";
import { DataTable, StaffPageHeader, type Column } from "@/components/staff";
import { Link, createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { searchHouseholds } from "@/functions/staff";
import { isDenied, stamp, unwrap } from "@/lib/client";
import { DeniedView, EmptyState, StateBadge, inputClass } from "@/components/ui";
import { LIFECYCLE_LABELS } from "@/domain/lifecycle";
import type { LifecycleState } from "@/domain/model";

const STAGES = ["enrolled", "active_hospice", "bereavement", "closed"] as const;
const NOT_ASSIGNED = "none";

const search = z.object({
  q: z.string().optional(),
  stage: z.enum(STAGES).optional(),
  // A care guide's name, or "none" for households with no care guide.
  guide: z.string().max(100).optional(),
  sort: z.enum(["name", "open", "activity"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});
type Search = z.infer<typeof search>;

export const Route = createFileRoute("/staff/households/")({
  validateSearch: search,
  loaderDeps: ({ search }) => ({ q: search.q ?? "" }),
  loader: async ({ deps }) => unwrap(await searchHouseholds({ data: { q: deps.q } })),
  component: Households,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

const staffLayout = getRouteApi("/staff");

function Households() {
  const list = Route.useLoaderData();
  const { me } = staffLayout.useLoaderData();
  const onlyCareGuide = me.roleCodes.length > 0 && me.roleCodes.every((r) => r === "care_guide");
  // Operations assign care guides (the household's care-team section).
  const canAssign = me.roleCodes.includes("hospice_ops");
  const sp = Route.useSearch();
  const { q = "", stage, guide } = sp;
  const sortKey = sp.sort ?? "name";
  const dir = sp.dir ?? "asc";
  const [text, setText] = useState(q);
  const navigate = useNavigate({ from: "/staff/households/" });
  const set = (p: Partial<Search>) =>
    void navigate({ search: (s: Search) => ({ ...s, ...p }), replace: true } as never);
  // Filter as you type (the address keeps the words, so the view can be shared or reloaded).
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => set({ q: text || undefined }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, q]);
  const all = isDenied(list) ? [] : list;
  type Row = (typeof all)[number];
  const guides = useMemo(() => [...new Set(all.flatMap((h) => h.careGuides))].sort(), [all]);
  const rows = all
    .filter((h) => !stage || h.lifecycle === stage)
    .filter((h) =>
      !guide ? true : guide === NOT_ASSIGNED ? h.careGuides.length === 0 : h.careGuides.includes(guide),
    )
    .sort((a, b) => {
      const c =
        sortKey === "open"
          ? a.openItems - b.openItems
          : sortKey === "activity"
            ? (a.lastActivity ? new Date(a.lastActivity).getTime() : 0) -
              (b.lastActivity ? new Date(b.lastActivity).getTime() : 0)
            : a.name.localeCompare(b.name);
      return dir === "asc" ? c : -c;
    });
  if (isDenied(list)) return <DeniedView d={list} />;

  const cols: Column<Row & { id: string }>[] = [
    {
      key: "name",
      header: "Household",
      sort: "name",
      className: "w-full max-w-0 min-w-40",
      cell: (h) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-ink">{h.name}</span>
          {/* Below wide screens the patient sits under the household instead of its own column. */}
          <span className="block truncate text-[0.75rem] text-ink-soft xl:hidden">{h.patientName}</span>
        </span>
      ),
    },
    {
      key: "patient",
      header: "Patient",
      className: "whitespace-nowrap",
      hideBelow: "xl",
      cell: (h) => h.patientName,
    },
    {
      key: "stage",
      header: "Stage",
      className: "whitespace-nowrap",
      cell: (h) => (
        <StateBadge
          state={h.lifecycle === "active_hospice" ? "active" : h.lifecycle}
          label={h.lifecycleLabel}
        />
      ),
    },
    {
      key: "guide",
      header: "Care guide",
      className: "whitespace-nowrap",
      cell: (h) =>
        h.careGuides.length ? (
          h.careGuides.join(", ")
        ) : (
          <span className="inline-flex items-center gap-2">
            <span
              data-unassigned
              className="rounded-full border border-ochre/30 bg-ochre-soft px-2 text-[0.75rem] font-semibold text-ochre"
            >
              ! Not assigned
            </span>
            {canAssign && (
              <Link
                to="/staff/households/$householdId"
                params={{ householdId: h.id }}
                search={{ tab: "overview" }}
                hash="care-team"
                className="text-[0.8125rem] text-harbor underline"
              >
                Assign<span className="sr-only"> a care guide to {h.name}</span>
              </Link>
            )}
          </span>
        ),
    },
    {
      key: "open",
      header: (
        <span title="Open items for this household in your queue (what you can see and act on)">
          In your queue
        </span>
      ),
      sort: "open",
      className: "whitespace-nowrap text-right tabular-nums",
      cell: (h) =>
        h.openItems ? (
          <Link
            to="/staff/exceptions"
            search={{ household: h.id }}
            className="text-harbor underline-offset-2 hover:underline"
          >
            {h.openItems}
            <span className="sr-only"> in your queue for {h.name}</span>
          </Link>
        ) : (
          <span className="text-ink-soft">0</span>
        ),
    },
    {
      key: "activity",
      header: "Last activity",
      sort: "activity",
      className: "whitespace-nowrap",
      hideBelow: "xl",
      cell: (h) => <span className="text-ink-soft">{h.lastActivity ? stamp(h.lastActivity) : "—"}</span>,
    },
  ];
  const filtered = !!(q || stage || guide);
  return (
    <>
      <StaffPageHeader title="Households" />
      <form
        role="search"
        className="mb-2 flex flex-wrap items-end gap-2 [&_select]:!min-h-8 [&_select]:!py-0.5"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: text || undefined });
        }}
      >
        <label className="text-[0.75rem] text-ink-soft">
          Find a household
          <input
            type="search"
            placeholder="Household, patient or family member"
            className={inputClass + " !min-h-8 !w-72 !py-0.5"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="text-[0.75rem] text-ink-soft">
          Stage
          <select
            className={inputClass + " !w-48"}
            value={stage ?? ""}
            onChange={(e) => set({ stage: (e.target.value || undefined) as Search["stage"] })}
          >
            <option value="">Any stage</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {LIFECYCLE_LABELS[s as LifecycleState]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[0.75rem] text-ink-soft">
          Care guide
          <select
            className={inputClass + " !w-44"}
            value={guide ?? ""}
            onChange={(e) => set({ guide: e.target.value || undefined })}
          >
            <option value="">Anyone</option>
            <option value={NOT_ASSIGNED}>Not assigned</option>
            {guides.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
      </form>
      {all.length > 0 && (
        <p className="mb-2 text-[0.8125rem] text-ink-soft" aria-live="polite" data-testid="household-count">
          {filtered
            ? `${rows.length} of ${all.length} household${all.length === 1 ? "" : "s"} match${q ? ` “${q}”` : ""}`
            : `${all.length} household${all.length === 1 ? "" : "s"}`}
        </p>
      )}
      {all.length === 0 && !q && onlyCareGuide ? (
        <EmptyState title="You aren't assigned to any households yet">
          Hospice operations assigns households to care guides. Once you're assigned, they'll appear here.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="No households match">Try another name, or clear the filters.</EmptyState>
      ) : (
        <DataTable
          rows={rows}
          columns={cols}
          caption="Households"
          sort={{ key: sortKey, dir }}
          onSort={(k) =>
            set({ sort: k as Search["sort"], dir: sortKey === k && dir === "asc" ? "desc" : "asc" })
          }
          onActivate={(h) =>
            void navigate({
              to: "/staff/households/$householdId",
              params: { householdId: h.id },
              search: { tab: "overview" },
            })
          }
          openLabel={(h) => `Open ${h.name}`}
        />
      )}
    </>
  );
}
