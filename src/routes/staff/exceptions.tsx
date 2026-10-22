import { StaffPending } from "@/components/staff/pending";
import { Link, createFileRoute, getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { getQueue, updateEscalation } from "@/functions/staff";
import {
  bulkAssignExceptions,
  bulkEscalations,
  deleteQueueView,
  getAssignableOwners,
  getResolvedExceptions,
  saveQueueView,
  takeException,
} from "@/functions/staff-shell";
import { announce, cx, isDenied, stamp, unwrap } from "@/lib/client";
import { Button, ConfirmDialog, DeniedView, inputClass } from "@/components/ui";
import {
  DataTable,
  OneLineNote,
  SplitPane,
  StaffPageHeader,
  ViewTabs,
  type Column,
  DueChip,
  QueueNextCell,
  QueueStatusCell,
  WaitingCell,
} from "@/components/staff";
import { can, type Permission } from "@/domain/permissions";
import type { RoleCode } from "@/domain/model";
import { QueueDetailPanel } from "@/components/staff/queue-detail";
import { typing } from "@/components/staff/shell";
import {
  CATEGORY_LABELS,
  EXCEPTION_CATEGORIES,
  PRIORITIES,
  PRIORITY_LABELS,
  QUEUE_KINDS,
  QUEUE_LABELS,
  dueFirst,
  type ExceptionCategory,
  type QueueRow,
} from "@/domain/queue";

/**
 * Exceptions (decision 58; spec section 3): one list of what needs attention, replacing the queue
 * and the escalations page. Each row has a category, urgency, owner, age, due-by, next step and
 * "Why this is here". Filters, sort, the view and the selected item live in the URL (IDs and view
 * names only); search words never do. Rows never move under the cursor: after an action a row
 * updates in place, and the list re-sorts only on an explicit refresh or when the panel closes.
 */
const VIEW_KEYS = [
  "mine",
  "unowned",
  "family",
  "partner",
  "releases",
  "consent",
  "handoffs",
  "bereavement",
  "due",
  "resolved",
  "all",
] as const;
/** The queue's old view names, from saved links and bookmarks. */
const OLD_VIEWS: Record<string, (typeof VIEW_KEYS)[number]> = {
  unassigned: "unowned",
  consents: "consent",
  authority: "consent",
  messages: "family",
};
/** Age bands for the bottleneck table: how long each item has been open. */
const AGE_BANDS = ["day", "days", "longer"] as const;
type AgeBand = (typeof AGE_BANDS)[number];
const AGE_BAND_LABELS: Record<AgeBand, string> = {
  day: "Under 1 day",
  days: "1–3 days",
  longer: "Over 3 days",
};
const ageBand = (r: QueueRow, now: number): AgeBand => {
  const days = (now - r.since.getTime()) / 86_400_000;
  return days < 1 ? "day" : days <= 3 ? "days" : "longer";
};
const search = z.object({
  view: z.preprocess((v) => (typeof v === "string" ? (OLD_VIEWS[v] ?? v) : v), z.enum(VIEW_KEYS).optional()),
  category: z.enum(EXCEPTION_CATEGORIES).optional(),
  kind: z.enum(QUEUE_KINDS).optional(),
  who: z.enum(["mine", "unassigned"]).optional(),
  household: z.string().max(100).optional(),
  priority: z.enum(PRIORITIES).optional(),
  // How long it has been open, from the bottleneck table (direction refinement D-3).
  age: z.enum(AGE_BANDS).optional(),
  sort: z.enum(["priority", "waiting", "household", "kind"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  sel: z.string().max(200).optional(),
});
type Search = z.infer<typeof search>;

export const Route = createFileRoute("/staff/exceptions")({
  validateSearch: search,
  loaderDeps: ({ search }) => ({ resolved: search.view === "resolved" }),
  loader: async ({ deps }) => ({
    rows: unwrap(await getQueue()),
    resolved: deps.resolved ? unwrap(await getResolvedExceptions()) : null,
  }),
  component: Queue,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

const staffApi = getRouteApi("/staff");

/**
 * Built-in views. `due` is overdue and due-today work (it adds a view; priority rules are
 * unchanged). Views a role can't act on are left out (`needs`), as on My work.
 */
const inCats =
  (...cs: ExceptionCategory[]) =>
  (r: QueueRow) =>
    cs.includes(r.category);
const VIEWS: {
  key: (typeof VIEW_KEYS)[number];
  label: string;
  filter: Partial<Search>;
  test?: (r: QueueRow) => boolean;
  needs?: Permission;
}[] = [
  // The default view comes first, so the tab row opens at its start on narrower screens.
  { key: "all", label: "All", filter: {} },
  { key: "mine", label: "Needs you now", filter: { who: "mine" } },
  { key: "unowned", label: "No owner", filter: { who: "unassigned" } },
  {
    key: "family",
    label: "Waiting on family",
    filter: {},
    test: (r) => r.waitingOn === "family" || ["family_contact", "unread_update"].includes(r.category),
  },
  {
    key: "partner",
    label: "Waiting on partner",
    filter: {},
    test: (r) => r.waitingOn === "partner" || r.category === "partner_waiting",
  },
  {
    key: "releases",
    label: "Releases in flight",
    filter: {},
    test: inCats("release_incomplete"),
    needs: "packet.release",
  },
  {
    key: "consent",
    label: "Consent & access",
    filter: {},
    test: inCats("missing_consent", "consent_held", "access_ending"),
  },
  {
    key: "handoffs",
    label: "Handoffs",
    filter: {},
    test: inCats("stalled_handoff", "coverage_gap"),
    needs: "staff.assignment.manage",
  },
  { key: "bereavement", label: "Bereavement", filter: {}, test: inCats("checkin_due") },
  { key: "due", label: "Due", filter: {}, test: (r) => r.due !== null },
  { key: "resolved", label: "Resolved (14 d)", filter: {} },
];

const RANK = { high: 0, normal: 1, routine: 2 } as const;

function Queue() {
  const loaded = Route.useLoaderData();
  const data = loaded.rows;
  const sp = Route.useSearch();
  const navigate = useNavigate({ from: "/staff/exceptions" });
  const router = useRouter();
  const { me, savedViews } = staffApi.useLoaderData();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Rows changed in place since the list was ordered (e.g. taken), shown without moving them.
  const [local, setLocal] = useState<Record<string, Partial<QueueRow>>>({});
  const [pendingTake, setPendingTake] = useState<string | null>(null);
  const rows: QueueRow[] = isDenied(data) ? [] : data;
  // One clock for the age bands, so counts and the list agree while the page is open.
  const [now] = useState(() => Date.now());

  // The effective filters: a built-in view's filter, overridden by explicit filters.
  const view = VIEWS.find((v) => v.key === (sp.view ?? "all"))!;
  const f = {
    ...view.filter,
    ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== undefined)),
  } as Search;
  const set = (patch: Partial<Search>) =>
    void navigate({ search: (p: Search) => ({ ...p, ...patch }), replace: true } as never);

  const filtered = rows.filter(
    (r) =>
      (!view.test || view.test(r)) &&
      (!f.kind || r.kind === f.kind) &&
      (!f.category || r.category === f.category) &&
      (!f.who || (f.who === "mine" ? r.mine : r.ownerIds.length === 0)) &&
      (!f.household || r.householdId === f.household) &&
      (!f.priority || r.priority === f.priority) &&
      (!f.age || ageBand(r, now) === f.age),
  );
  const sortKey = f.sort ?? "priority";
  const dir = f.dir ?? "asc";
  const sorted = useMemo(() => {
    const out = [...filtered];
    const cmp = (a: QueueRow, b: QueueRow) =>
      sortKey === "waiting"
        ? a.since.getTime() - b.since.getTime()
        : sortKey === "household"
          ? a.household.localeCompare(b.household)
          : sortKey === "kind"
            ? CATEGORY_LABELS[a.category].localeCompare(CATEGORY_LABELS[b.category])
            : view.key === "due"
              ? dueFirst(a, b)
              : RANK[a.priority] - RANK[b.priority] || a.since.getTime() - b.since.getTime();
    out.sort((a, b) => (dir === "asc" ? cmp(a, b) : -cmp(a, b)));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.map((r) => r.id).join(), sortKey, dir, view.key]);

  // Stability: freeze the order of the rows on screen; new rows wait behind a refresh pill.
  const order = useRef<string[] | null>(null);
  const orderKey = `${view.key}|${sortKey}|${dir}|${f.kind}|${f.category}|${f.who}|${f.household}|${f.priority}|${f.age}`;
  const lastKey = useRef(orderKey);
  if (order.current === null || lastKey.current !== orderKey) {
    order.current = sorted.map((r) => r.id);
    lastKey.current = orderKey;
  }
  const fresh = sorted.filter((r) => !order.current!.includes(r.id));
  const shown = order.current
    .map((id) => sorted.find((r) => r.id === id))
    .filter((r): r is QueueRow => !!r)
    .map((r) => ({ ...r, ...local[r.id] }));
  const refreshOrder = () => {
    order.current = sorted.map((r) => r.id);
    setLocal({});
    void router.invalidate();
  };

  const active = shown.find((r) => r.id === sp.sel) ?? null;
  const open = (r: QueueRow | null) => set({ sel: r?.id });
  const close = () => {
    set({ sel: undefined });
    // Closing the panel is a natural point to re-sort.
    order.current = sorted.map((r) => r.id);
    setLocal({});
  };

  const take = async (r: QueueRow) => {
    if (!r.subjectId || pendingTake) return;
    // Optimistic and debounced: the row says "You own this" at once, and can't be taken twice.
    setPendingTake(r.id);
    setLocal((l) => ({
      ...l,
      [r.id]: {
        owner: me.name,
        ownerIds: [me.actorId],
        mine: true,
        action: null,
        status: { domain: "escalation", value: "acknowledged" },
        state: "Owned — in progress",
        next: "Open it for the next step",
      },
    }));
    const res = await updateEscalation({ data: { id: r.subjectId, action: "take" } });
    setPendingTake(null);
    if (!res.ok) {
      setLocal((l) => {
        const { [r.id]: _gone, ...rest } = l;
        return rest;
      });
      announce(res.message, "problem");
      return;
    }
    announce("You own this now.");
    void router.invalidate();
    document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(r.id)}"] button`)?.focus();
  };

  // Keyboard (never while typing): J/K or arrows move, Enter opens, Esc closes, T takes, R replies, A assigns.
  const activeIndex = shown.findIndex((r) => r.id === sp.sel);
  const kb = useRef({ shown, activeIndex, active });
  kb.current = { shown, activeIndex, active };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      const { shown, activeIndex, active } = kb.current;
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = shown[Math.min(shown.length - 1, activeIndex + 1)];
        if (next) open(next);
      } else if (k === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = shown[Math.max(0, activeIndex - 1)];
        if (prev) open(prev);
      } else if (e.key === "Enter" && active) {
        e.preventDefault();
        document.getElementById("detail-title")?.focus();
      } else if (e.key === "Escape" && active) {
        e.preventDefault();
        close();
      } else if (k === "t" && active?.action?.type === "take") {
        e.preventDefault();
        void take(active);
      } else if (k === "r" && active?.kind === "message") {
        e.preventDefault();
        document.getElementById("detail-reply")?.focus();
      } else if (k === "a" && active?.assignable) {
        e.preventDefault();
        document.querySelector<HTMLSelectElement>('[aria-label="Assign to"]')?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (isDenied(data)) return <DeniedView d={data} />;

  const households = [...new Map(rows.map((r) => [r.householdId, r.household])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const count = (filter: Partial<Search>, test?: (r: QueueRow) => boolean) =>
    rows.filter(
      (r) =>
        (!test || test(r)) &&
        (!filter.kind || r.kind === filter.kind) &&
        (!filter.who || (filter.who === "mine" ? r.mine : r.ownerIds.length === 0)),
    ).length;
  const canAssign = me.roleCodes.includes("hospice_ops");
  const roles = me.roleCodes as RoleCode[];
  const views = VIEWS.filter((v) => !v.needs || can(roles, v.needs) || (sp.view ?? "all") === v.key);

  const columns: Column<QueueRow>[] = [
    {
      key: "status",
      header: "Status",
      cell: (r) => <QueueStatusCell r={r} />,
      // As narrow as its chips, so the item keeps the room.
      className: "w-px whitespace-nowrap",
    },
    {
      key: "item",
      header: "Item",
      // The title opens the row: the status cell can be empty ("Open" is for screen readers only).
      opens: true,
      sort: "kind",
      // Takes the leftover width and truncates, so rows don't grow when the screen narrows.
      className: "w-full max-w-0 min-w-40",
      cell: (r) => (
        // Two lines when comfortable; one line in compact density (see styles.css, .q-item).
        <span className="q-item block min-w-0">
          <span className="block truncate font-medium text-ink">
            {r.due && <DueChip due={r.due} className="mr-1.5 align-middle" />}
            {r.summary}
            <span className="q-inline font-normal text-ink-soft"> · {r.household}</span>
          </span>
          <span className="q-second block truncate text-[0.75rem] text-ink-soft">
            {/* Below wide screens the owner takes the type's place here, leaving room for the next step. */}
            <span className="max-xl:hidden">{CATEGORY_LABELS[r.category]} · </span>
            {r.household}
            <span className="xl:hidden"> · {r.owner ?? "Unassigned"}</span>
          </span>
        </span>
      ),
    },
    {
      key: "priority",
      header: "Urgency",
      sort: "priority",
      cell: (r) => (
        <span
          title={`${r.priorityReason}. A workflow ordering aid, not clinical triage.`}
          className={cx("whitespace-nowrap", r.priority === "high" && "font-semibold text-rose")}
        >
          {PRIORITY_LABELS[r.priority]}
        </span>
      ),
      hideBelow: "md",
    },
    {
      key: "owner",
      header: "Owner",
      cell: (r) => r.owner ?? <span className="text-ink-soft italic">Unassigned</span>,
      className: "whitespace-nowrap",
      hideBelow: "xl",
    },
    {
      key: "next",
      header: "Next step",
      // Two lines at most (one in compact density); the full step is in the tooltip and the panel.
      // "Take ownership" is a button here, always visible (not only on hover).
      cell: (r) => <QueueNextCell r={r} take={(x) => void take(x)} pending={pendingTake} />,
      hideBelow: "lg",
    },
    {
      key: "dueBy",
      header: "Due by",
      cell: (r) =>
        r.dueBy ? (
          <time dateTime={new Date(r.dueBy).toISOString()} className="whitespace-nowrap text-ink-soft">
            {new Date(r.dueBy).getTime() < Date.now() ? "Passed" : stamp(r.dueBy)}
          </time>
        ) : (
          <span className="text-ink-soft">—</span>
        ),
      hideBelow: "xl",
    },
    {
      key: "waiting",
      header: "Waiting",
      sort: "waiting",
      cell: (r) => (
        <WaitingCell
          r={r}
          title={
            r.lastAction
              ? `Since ${stamp(r.since)} — ${r.lastAction.actor} ${r.lastAction.did}`
              : `Since ${stamp(r.since)}`
          }
        />
      ),
    },
  ];

  const selectable = (r: QueueRow) => (r.assignable && !!r.subjectId) || r.claimable;
  const selectedRows = shown.filter((r) => selected.has(r.id) && selectable(r));

  const list = (
    <div className="space-y-2">
      {canAssign && view.key === "all" && <Bottlenecks rows={rows} now={now} />}
      <div
        className="flex flex-wrap items-end gap-2 [&_select]:!min-h-8 [&_select]:!py-0.5"
        role="group"
        aria-label="Filters"
      >
        <label className="text-[0.75rem] text-ink-soft">
          Category
          <select
            className={inputClass + " !w-44"}
            value={f.category ?? ""}
            onChange={(e) =>
              set({
                category: (e.target.value || undefined) as Search["category"],
                kind: undefined,
                view: "all",
              })
            }
          >
            <option value="">All categories</option>
            {EXCEPTION_CATEGORIES.map((k) => (
              <option key={k} value={k}>
                {CATEGORY_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        {f.kind && (
          <button
            type="button"
            className="min-h-8 rounded-full border px-2.5 text-[0.75rem]"
            onClick={() => set({ kind: undefined })}
          >
            Only {QUEUE_LABELS[f.kind].toLowerCase()}s · <span className="underline">Show all</span>
          </button>
        )}
        {f.age && (
          <button
            type="button"
            className="min-h-8 rounded-full border px-2.5 text-[0.75rem]"
            onClick={() => set({ age: undefined })}
          >
            Open {AGE_BAND_LABELS[f.age].toLowerCase()} · <span className="underline">Show all</span>
          </button>
        )}
        <label className="text-[0.75rem] text-ink-soft">
          Owner
          <select
            className={inputClass + " !w-28"}
            value={f.who ?? ""}
            onChange={(e) => set({ who: (e.target.value || undefined) as Search["who"], view: "all" })}
          >
            <option value="">Anyone</option>
            <option value="mine">Me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
        <label className="text-[0.75rem] text-ink-soft">
          Household
          <select
            className={inputClass + " !w-40"}
            value={f.household ?? ""}
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
        <label className="text-[0.75rem] text-ink-soft">
          Urgency
          <select
            className={inputClass + " !w-28"}
            value={f.priority ?? ""}
            onChange={(e) => set({ priority: (e.target.value || undefined) as Search["priority"] })}
          >
            <option value="">Any</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <SaveView search={sp} />
        {fresh.length > 0 && (
          <button
            type="button"
            onClick={refreshOrder}
            className="ml-auto rounded-full border border-harbor/40 bg-harbor-soft px-3 py-1 text-[0.75rem] font-semibold text-harbor-strong"
          >
            List updated — refresh ({fresh.length} new)
          </button>
        )}
      </div>

      {selectedRows.length > 0 && (
        <BulkBar
          rows={selectedRows}
          canAssign={canAssign}
          onDone={() => {
            setSelected(new Set());
            refreshOrder();
          }}
        />
      )}

      <DataTable
        rows={shown}
        // With the panel open, the list keeps what's needed to choose; actions are in the panel.
        columns={active ? columns.filter((c) => ["status", "item", "waiting"].includes(c.key)) : columns}
        caption={`Exceptions: ${view.label}`}
        sort={{ key: sortKey, dir }}
        onSort={(k) =>
          set({ sort: k as Search["sort"], dir: sortKey === k && dir === "asc" ? "desc" : "asc" })
        }
        selectable={selectable}
        selectAllLabel="Select all (tasks are assigned on Care-team tasks)"
        selected={selected}
        onToggle={(id) =>
          setSelected((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          })
        }
        onToggleAll={(ids, on) => setSelected(on ? new Set(ids) : new Set())}
        activeId={sp.sel}
        onActivate={open}
        openLabel={(r) => `Open ${r.summary}, ${r.household}`}
        rowActions={
          active
            ? undefined
            : (r) =>
                // On wide screens "Take ownership" is in the Next step column; narrower, it's here.
                r.action?.type === "take" ? (
                  <span className="lg:hidden">
                    <QueueNextCell r={r} take={(x) => void take(x)} pending={pendingTake} />
                  </span>
                ) : r.mine && r.kind === "escalation" ? (
                  <span className="text-[0.75rem] font-semibold text-harbor">You own this</span>
                ) : r.action ? (
                  <Button size="sm" variant="secondary" data-row-action onClick={() => open(r)}>
                    {r.action.label}
                    <span className="sr-only">: {r.summary}</span>
                  </Button>
                ) : null
        }
        empty={
          <span>
            {{
              mine: "Nothing needs you right now.",
              unowned: "Everything has an owner.",
              family: "Nothing is waiting on a family.",
              partner: "Nothing is waiting on an outside organization.",
              releases: "No releases in flight.",
              consent: "Nothing about consent or access needs attention.",
              handoffs: "No stalled handoffs or coverage gaps.",
              bereavement: "No bereavement check-ins are due.",
              due: "Nothing is overdue or due today.",
              resolved: "",
              all: "Nothing is open.",
            }[view.key] || "No exceptions match these filters."}{" "}
            {(f.category || f.household || f.priority || f.kind || f.age) && "Try clearing the filters."}
          </span>
        }
        maxHeight="calc(100dvh - 15rem)"
      />
    </div>
  );

  return (
    <>
      <StaffPageHeader
        title="Exceptions"
        actions={
          <OneLineNote more="Urgency orders the work; it isn't clinical urgency, triage or a medical priority.">
            Workflow urgency, not clinical triage
          </OneLineNote>
        }
      />
      <ViewTabs
        label="Exception views"
        className="mb-3"
        items={[
          ...views.map((v) => ({
            key: v.key,
            label: v.label,
            // Resolved items aren't in the open list; that tab shows its own list without a count.
            ...(v.key === "resolved" ? {} : { count: count(v.filter, v.test) }),
            active: (sp.view ?? "all") === v.key && !savedViews.some((s) => matches(sp, s.search)),
            render: (cls: string, children: React.ReactNode) => (
              <Link
                to="/staff/exceptions"
                search={{ view: v.key }}
                className={cls}
                aria-current={(sp.view ?? "all") === v.key ? "page" : undefined}
              >
                {children}
              </Link>
            ),
          })),
          ...savedViews.map((s) => ({
            key: `saved-${s.name}`,
            label: s.name,
            active: matches(sp, s.search),
            render: (cls: string, children: React.ReactNode) => (
              <span className="inline-flex items-center">
                <Link to="/staff/exceptions" search={s.search as Search} className={cls}>
                  {children}
                </Link>
                <button
                  type="button"
                  aria-label={`Delete the saved view ${s.name}`}
                  className="px-1 text-ink-soft hover:text-rose"
                  onClick={async () => {
                    await deleteQueueView({ data: { name: s.name } });
                    await router.invalidate();
                  }}
                >
                  ×
                </button>
              </span>
            ),
          })),
        ]}
      />
      <SplitPane
        list={
          view.key === "resolved" ? (
            <ResolvedList items={loaded.resolved && !isDenied(loaded.resolved) ? loaded.resolved : []} />
          ) : (
            list
          )
        }
        open={!!active}
        onClose={close}
        detailLabel="Item details"
        detail={
          active && (
            <QueueDetailPanel
              key={active.id}
              item={active}
              canAssign={canAssign}
              onClose={close}
              onChanged={() => void router.invalidate()}
            />
          )
        }
      />
    </>
  );
}

const matches = (sp: Search, s: Record<string, string>) =>
  Object.keys(s).length > 0 &&
  Object.entries(s).every(([k, v]) => (sp as Record<string, unknown>)[k] === v) &&
  Object.entries(sp).every(([k, v]) => k === "sel" || v === undefined || s[k] === v);

function SaveView({ search }: { search: Search }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
        Save view…
      </Button>
    );
  return (
    <form
      className="flex items-end gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const { sel: _sel, ...rest } = search;
        const s = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Record<
          string,
          string
        >;
        const r = await saveQueueView({ data: { name, search: s } });
        if (!r.ok) return announce(r.message, "problem");
        announce(`Saved the view “${name}”.`);
        setOpen(false);
        setName("");
        await router.invalidate();
      }}
    >
      <label className="text-[0.75rem] text-ink-soft">
        View name
        <input
          autoFocus
          className={inputClass + " !w-40"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          required
        />
      </label>
      <Button type="submit" size="sm">
        Save
      </Button>
      <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}

/**
 * Bulk take or assign: the confirmation lists the items. Assigning needs a reason, which only staff
 * see (decision 40's pattern). Nothing is resolved, dismissed, activated or released in bulk.
 * Escalations keep their own owners; rule-derived exceptions are claimed (decision 58).
 */
function BulkBar({ rows, canAssign, onDone }: { rows: QueueRow[]; canAssign: boolean; onDone: () => void }) {
  const [owners, setOwners] = useState<{ actorId: string; name: string }[] | null>(null);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const esc = rows.filter((r) => r.assignable && r.subjectId);
  const claimed = rows.filter((r) => r.claimable);
  const run = async (action: "take" | "assign") => {
    setBusy(true);
    const out: { ok: boolean; message?: string }[] = [];
    if (esc.length) {
      const r = await bulkEscalations({
        data: {
          ids: esc.map((x) => x.subjectId!),
          action,
          ...(action === "assign" ? { toActorId: to } : {}),
        },
      });
      if (r.ok) out.push(...r.data);
      else out.push(...esc.map(() => ({ ok: false, message: r.message })));
    }
    if (claimed.length) {
      if (action === "assign") {
        const r = await bulkAssignExceptions({
          data: { keys: claimed.map((x) => x.id), toActorId: to, reason },
        });
        if (r.ok) out.push(...r.data);
        else out.push(...claimed.map(() => ({ ok: false, message: r.message })));
      } else
        for (const x of claimed) {
          const r = await takeException({ data: { key: x.id } });
          out.push(r.ok ? { ok: true } : { ok: false, message: r.message });
        }
    }
    setBusy(false);
    const failed = out.filter((x) => !x.ok);
    announce(
      failed.length
        ? `${out.length - failed.length} done; ${failed.length} couldn't be: ${failed[0]!.message}`
        : action === "take"
          ? `You own ${out.length} item${out.length === 1 ? "" : "s"} now.`
          : `Assigned ${out.length} item${out.length === 1 ? "" : "s"}.`,
      failed.length ? "problem" : "done",
    );
    onDone();
    return true;
  };
  const list = (
    <ul className="mt-2 list-disc pl-5 text-ink">
      {rows.map((r) => (
        <li key={r.id}>
          {CATEGORY_LABELS[r.category]}: {r.summary} — {r.household}
        </li>
      ))}
    </ul>
  );
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[var(--s-radius)] border border-harbor/30 bg-harbor-soft px-3 py-2"
      role="region"
      aria-label="Bulk actions"
    >
      <span className="font-semibold">{rows.length} selected</span>
      <ConfirmDialog
        title={`Take ownership of ${rows.length} item${rows.length === 1 ? "" : "s"}?`}
        confirmLabel="Take ownership"
        disabled={busy}
        trigger={(o) => (
          <Button size="sm" onClick={o} disabled={busy}>
            Take ownership
          </Button>
        )}
        onConfirm={() => run("take")}
      >
        <p>You'll own:</p>
        {list}
      </ConfirmDialog>
      {canAssign && (
        <>
          <select
            aria-label="Assign selected to"
            className={inputClass + " !w-44"}
            value={to}
            onFocus={async () => {
              if (owners) return;
              const r = await getAssignableOwners();
              setOwners(r.ok ? r.data : []);
            }}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">Assign to…</option>
            {owners?.map((o) => (
              <option key={o.actorId} value={o.actorId}>
                {o.name}
              </option>
            ))}
          </select>
          <ConfirmDialog
            title={`Assign ${rows.length} item${rows.length === 1 ? "" : "s"} to ${owners?.find((o) => o.actorId === to)?.name ?? "…"}?`}
            confirmLabel="Assign"
            disabled={busy || !to}
            trigger={(o) => (
              <Button size="sm" variant="secondary" onClick={o} disabled={busy || !to}>
                Assign…
              </Button>
            )}
            onConfirm={() => (reason.trim() ? run("assign") : Promise.resolve(false))}
          >
            <p>They'll own these, see them in Needs you now, and be told:</p>
            {list}
            <label className="block text-ink">
              <span className="font-medium">Reason</span>
              <span className="block text-[0.75rem] text-ink-soft">Required. Only staff will see it.</span>
              <textarea
                className={inputClass + " mt-1 w-full"}
                rows={2}
                maxLength={280}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </ConfirmDialog>
        </>
      )}
    </div>
  );
}

/**
 * Resolved in the last 14 days: what resolved each one, who and when, each linked to the recorded
 * event that closed it (direction refinement D-5).
 */
function ResolvedList({
  items,
}: {
  items: {
    id: string;
    household: string;
    householdId: string;
    how: string;
    by: string;
    at: Date;
    summary: string;
    reason: string | null;
  }[];
}) {
  if (!items.length)
    return (
      <p className="rounded-[var(--s-radius)] border bg-surface px-4 py-6 text-ink-soft">
        Nothing was resolved in the last 14 days.
      </p>
    );
  return (
    <ol
      aria-label="Resolved in the last 14 days, newest first"
      className="divide-y rounded-[var(--s-radius)] border bg-surface"
    >
      {items.map((x) => (
        <li key={x.id} className="px-3 py-2 text-[0.8125rem]">
          <span className="font-medium">{x.how}</span> · {x.household}
          <span className="block text-ink-soft">{x.summary}</span>
          {x.reason && <span className="block text-ink-soft">Reason: {x.reason}</span>}
          <span className="block text-[0.75rem] text-ink-soft">
            {x.by} · {stamp(x.at)} ·{" "}
            <Link
              to="/staff/audit"
              search={{ householdId: x.householdId, days: 30, sel: x.id }}
              className="inline-flex min-h-6 items-center text-harbor underline"
            >
              Show the record of it
              <span className="sr-only">
                : {x.how}, {x.household}
              </span>
            </Link>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Where work is waiting (direction refinement D-3): open items by category and age, counts only, for
 * operations. Built from the rows already on this page, so it shows nothing the list doesn't; each
 * count opens that part of the list.
 */
function Bottlenecks({ rows, now }: { rows: QueueRow[]; now: number }) {
  const cats = EXCEPTION_CATEGORIES.filter((c) => rows.some((r) => r.category === c));
  const n = (c: ExceptionCategory, b?: AgeBand) =>
    rows.filter((r) => r.category === c && (!b || ageBand(r, now) === b)).length;
  // The table is only in the page while it's open, so the list stays the page's only table.
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="rounded-[var(--s-radius)] border bg-surface text-[0.8125rem]"
      data-testid="bottlenecks"
      onToggle={(e) => setOpened(e.currentTarget.open)}
    >
      <summary className="flex min-h-9 cursor-pointer items-center px-3 font-medium">
        Where work is waiting
        <span className="ml-2 font-normal text-ink-soft">
          {rows.length} open in {cats.length} {cats.length === 1 ? "category" : "categories"}
        </span>
      </summary>
      {opened && (
        <div className="overflow-x-auto border-t">
          <table className="w-full tabular-nums">
            <caption className="sr-only">Open items by category and how long they've been open</caption>
            <thead className="bg-sunk text-[0.75rem] text-ink-soft">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">
                  Category
                </th>
                {AGE_BANDS.map((b) => (
                  <th key={b} scope="col" className="px-3 py-1.5 text-right font-medium whitespace-nowrap">
                    {AGE_BAND_LABELS[b]}
                  </th>
                ))}
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c} className="border-t">
                  <th scope="row" className="px-3 py-1 text-left font-normal">
                    {CATEGORY_LABELS[c]}
                  </th>
                  {[...AGE_BANDS, undefined].map((b) => {
                    const k = n(c, b);
                    return (
                      <td key={b ?? "total"} className={cx("px-3 py-1 text-right", !b && "font-semibold")}>
                        {k === 0 ? (
                          <span className="text-ink-soft">0</span>
                        ) : (
                          <Link
                            to="/staff/exceptions"
                            search={{ view: "all", category: c, ...(b ? { age: b } : {}) }}
                            className="inline-flex min-h-6 min-w-6 items-center justify-end text-harbor underline-offset-2 hover:underline"
                          >
                            {k}
                            <span className="sr-only">
                              {" "}
                              — show {CATEGORY_LABELS[c].toLowerCase()}
                              {b ? `, open ${AGE_BAND_LABELS[b].toLowerCase()}` : ""}
                            </span>
                          </Link>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
