import { Link, createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { StaffPending } from "@/components/staff/pending";
import { DataTable, DueChip, StaffPageHeader, ViewTabs, dueOf, type Column } from "@/components/staff";
import { bulkAssignTasks, getCoverageTasks, previewBulkTaskAssign } from "@/functions/staff";
import { isDenied, unwrap, useAction } from "@/lib/client";
import { Button, ConfirmDialog, DeniedView, ErrorText, Field, Stamp, inputClass } from "@/components/ui";

/**
 * Care-team tasks across the households a care guide covers, and bulk assign or reassign (founder
 * decision 40): preview first, then a reason and explicit confirmation. The server checks
 * coverage and eligibility for every task, whatever this page sends.
 */
const search = z.object({
  tab: z.enum(["open", "done"]).optional(),
  who: z.enum(["mine", "unassigned"]).optional(),
  household: z.string().max(100).optional(),
});
type Search = z.infer<typeof search>;

export const Route = createFileRoute("/staff/tasks")({
  validateSearch: search,
  loader: async () => unwrap(await getCoverageTasks()),
  component: CareTeamTasks,
  pendingComponent: StaffPending,
});

const staffApi = getRouteApi("/staff");

type Row = {
  id: string;
  title: string;
  householdId: string;
  household: string;
  assigneeActorId: string | null;
  dueAt: Date | null;
  assignee: string | null;
  eligible: string[];
};
type Preview = {
  to: { name: string };
  items: {
    id: string;
    title: string;
    household: string;
    from: string | null;
    unchanged: boolean;
    dueAt: Date | null;
    dueImpact: "none" | "overdue" | "soon" | "later";
  }[];
  changing: number;
  overdue: number;
  dueSoon: number;
};

const IMPACT: Record<Preview["items"][number]["dueImpact"], string> = {
  none: "No due date",
  overdue: "Already overdue",
  soon: "Due within 2 days",
  later: "Due later",
};

type Done = {
  id: string;
  title: string;
  householdId: string;
  household: string;
  status: "done" | "closed";
  by: string | null;
  at: Date;
  closedReason: string | null;
};

/** The task's own row on its household's Tasks tab (scrolled to and highlighted there). */
function TaskLink({ r }: { r: { id: string; title: string; householdId: string } }) {
  return (
    <Link
      to="/staff/households/$householdId"
      params={{ householdId: r.householdId }}
      search={{ tab: "tasks" }}
      hash={`task-${r.id}`}
      className="font-medium text-ink hover:underline"
    >
      {r.title}
    </Link>
  );
}
function HouseholdLink({ r }: { r: { householdId: string; household: string } }) {
  return (
    <Link
      to="/staff/households/$householdId"
      params={{ householdId: r.householdId }}
      className="whitespace-nowrap hover:underline"
    >
      {r.household}
    </Link>
  );
}

function CareTeamTasks() {
  const d = Route.useLoaderData();
  const sp = Route.useSearch();
  const { tab = "open", who, household } = sp;
  const navigate = useNavigate({ from: "/staff/tasks" });
  const { me } = staffApi.useLoaderData();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  if (isDenied(d)) return <DeniedView d={d} />;
  const data = d as unknown as {
    tasks: Row[];
    guides: { actorId: string; name: string }[];
    done: Done[];
  };
  const set = (p: Partial<Search>) =>
    void navigate({ search: (s: Search) => ({ ...s, ...p }), replace: true } as never);
  const households = [
    ...new Map([...data.tasks, ...data.done].map((r) => [r.householdId, r.household])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const open = data.tasks.filter(
    (r) =>
      (!household || r.householdId === household) &&
      (!who || (who === "mine" ? r.assigneeActorId === me.actorId : !r.assigneeActorId)),
  );
  const done = data.done.filter((r) => !household || r.householdId === household);
  const cols: Column<Row>[] = [
    {
      key: "title",
      header: "Task",
      cell: (r) => <TaskLink r={r} />,
      className: "w-full max-w-0 min-w-40",
    },
    {
      key: "household",
      header: "Household",
      cell: (r) => <HouseholdLink r={r} />,
    },
    {
      key: "assignee",
      header: "Assigned to",
      cell: (r) => r.assignee ?? <span className="text-ink-soft italic">Unassigned</span>,
      className: "whitespace-nowrap",
    },
    {
      key: "due",
      header: "Due",
      // The chip first, so "Overdue" and "Due today" line up whatever the date's length.
      cell: (r) =>
        r.dueAt ? (
          <span className="inline-flex items-center gap-2">
            {dueOf(r.dueAt) && <DueChip due={dueOf(r.dueAt)} />}
            <Stamp at={r.dueAt} />
          </span>
        ) : (
          <span className="text-ink-soft">No due date</span>
        ),
      className: "whitespace-nowrap",
    },
  ];
  const doneCols: Column<Done>[] = [
    { key: "title", header: "Task", cell: (r) => <TaskLink r={r} />, className: "w-full max-w-0 min-w-40" },
    { key: "household", header: "Household", cell: (r) => <HouseholdLink r={r} /> },
    {
      key: "outcome",
      header: "Outcome",
      className: "whitespace-nowrap",
      cell: (r) =>
        r.status === "done" ? (
          <span>Done{r.by ? ` by ${r.by}` : ""}</span>
        ) : (
          <span title={r.closedReason ?? undefined}>
            Closed — not needed{r.closedReason ? `: ${r.closedReason}` : ""}
          </span>
        ),
    },
    { key: "at", header: "When", className: "whitespace-nowrap", cell: (r) => <Stamp at={r.at} /> },
  ];
  const chosen = open.filter((t) => selected.has(t.id));
  // Only guides who cover every chosen task's household can take them all.
  const targets = data.guides.filter((g) => chosen.every((t) => t.eligible.includes(g.actorId)));
  return (
    <>
      <StaffPageHeader
        title="Care-team tasks"
        description="Open care-team tasks in the households you cover."
      />
      <ViewTabs
        label="Task views"
        className="mb-3"
        items={(["open", "done"] as const).map((k) => ({
          key: k,
          label: k === "open" ? "Open" : "Done recently",
          count: k === "open" ? data.tasks.length : data.done.length,
          active: tab === k,
          render: (cls, children) => (
            <Link
              to="/staff/tasks"
              search={{ ...sp, tab: k }}
              className={cls}
              aria-current={tab === k ? "page" : undefined}
            >
              {children}
            </Link>
          ),
        }))}
      />
      <div
        className="mb-2 flex flex-wrap items-end gap-2 [&_select]:!min-h-8 [&_select]:!py-0.5"
        role="group"
        aria-label="Filters"
      >
        {tab === "open" && (
          <label className="text-[0.75rem] text-ink-soft">
            Assigned to
            <select
              className={inputClass + " !w-32"}
              value={who ?? ""}
              onChange={(e) => set({ who: (e.target.value || undefined) as Search["who"] })}
            >
              <option value="">Everyone</option>
              <option value="mine">Me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </label>
        )}
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
      </div>
      {tab === "done" ? (
        done.length === 0 ? (
          <p className="rounded-[var(--s-radius)] border bg-surface px-4 py-6 text-ink-soft">
            Nothing was completed or closed in the last 14 days.
          </p>
        ) : (
          <DataTable
            rows={done}
            columns={doneCols}
            caption="Care-team tasks completed or closed in the last 14 days, most recent first"
          />
        )
      ) : open.length === 0 ? (
        <p className="rounded-[var(--s-radius)] border bg-surface px-4 py-6 text-ink-soft">
          {data.tasks.length
            ? "No open tasks match these filters."
            : "No open care-team tasks in your households."}
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="Bulk actions">
            <span className="text-[0.8125rem] text-ink-soft" aria-live="polite">
              {chosen.length ? `${chosen.length} selected` : "Select tasks to assign them in one step."}
            </span>
            {chosen.length > 0 && (
              <BulkAssign
                ids={chosen.map((t) => t.id)}
                targets={targets}
                onDone={() => setSelected(new Set())}
              />
            )}
          </div>
          <DataTable
            rows={open}
            columns={cols}
            caption="Open care-team tasks in your households, soonest due first"
            selectAllLabel="Select all tasks"
            openLabel={(r) => `Open ${r.title}, ${r.household}`}
            selectable={() => true}
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
          />
        </>
      )}
    </>
  );
}

function BulkAssign({
  ids,
  targets,
  onDone,
}: {
  ids: string[];
  targets: { actorId: string; name: string }[];
  onDone: () => void;
}) {
  const [to, setTo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const { act, pending, error } = useAction();
  if (!targets.length)
    return (
      <span className="text-[0.8125rem] text-ink-soft">
        No one covers all of these households. Choose tasks from fewer households.
      </span>
    );
  return (
    <ConfirmDialog
      title={
        preview
          ? `Assign ${preview.changing} task${preview.changing === 1 ? "" : "s"} to ${preview.to.name}?`
          : "Assign tasks"
      }
      confirmLabel="Assign"
      disabled={pending || !preview || preview.changing === 0 || !reason.trim()}
      error={error ?? loadError}
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Assign to…
        </Button>
      )}
      onConfirm={async () => {
        const r = await act(
          () => bulkAssignTasks({ data: { taskIds: ids, toActorId: to, reason, confirmed: true } }),
          "Tasks assigned.",
        );
        if (r) onDone();
        return r;
      }}
    >
      <Field label="Assign to" hint="Care guides who cover every household you chose.">
        {(id, d) => (
          <select
            id={id}
            aria-describedby={d}
            className={inputClass}
            value={to}
            onChange={async (e) => {
              setTo(e.target.value);
              setPreview(null);
              setLoadError(null);
              if (!e.target.value) return;
              const r = await previewBulkTaskAssign({ data: { taskIds: ids, toActorId: e.target.value } });
              if (r.ok) setPreview(r.data as Preview);
              else setLoadError(r.message);
            }}
          >
            <option value="">Choose a care guide</option>
            {targets.map((g) => (
              <option key={g.actorId} value={g.actorId}>
                {g.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {preview && (
        <div data-testid="bulk-task-preview">
          <p className="mt-3 font-medium">What changes</p>
          <ul className="mt-1 space-y-1 text-sm">
            {preview.items.map((i) => (
              <li key={i.id}>
                <span className="font-medium">{i.title}</span> · {i.household}
                <span className="block text-ink-soft">
                  {i.unchanged
                    ? `Already with ${preview.to.name}; no change`
                    : `${i.from ? `From ${i.from}` : "Unassigned"} · ${IMPACT[i.dueImpact]}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            Due dates stay as they are.
            {preview.overdue > 0 && ` ${preview.overdue} already overdue.`}
            {preview.dueSoon > 0 && ` ${preview.dueSoon} due within 2 days.`}
          </p>
          <Field label="Reason" hint="Required. Only staff will see it.">
            {(id, d) => (
              <textarea
                id={id}
                aria-describedby={d}
                rows={2}
                maxLength={500}
                className={inputClass}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </div>
      )}
      <ErrorText error={null} />
    </ConfirmDialog>
  );
}
