import { StaffPending } from "@/components/staff/pending";
import { DataTable, StaffPageHeader, type Column } from "@/components/staff";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { getAccessLog } from "@/functions/staff";
import { isDenied, stamp, unwrap } from "@/lib/client";
import { Badge, DeniedView, EmptyState, inputClass } from "@/components/ui";

/**
 * Who opened household records (founder decision 71). Privileged reviewers and administrators
 * only; never shown to households. Entries hold no content: who, which view, which household, when.
 */
const search = z.object({
  household: z.string().max(100).optional(),
  who: z.string().max(100).optional(),
  outside: z.boolean().optional(),
});
type Search = z.infer<typeof search>;

export const Route = createFileRoute("/staff/access-log")({
  head: () => ({ meta: [{ title: "Who opened records — Zeporah" }] }),
  validateSearch: search,
  loaderDeps: ({ search: { household, who } }) => ({ household, who }),
  loader: async ({ deps }) =>
    unwrap(
      await getAccessLog({
        data: {
          ...(deps.household ? { householdId: deps.household } : {}),
          ...(deps.who ? { actorId: deps.who } : {}),
        },
      }),
    ),
  component: AccessLog,
  pendingComponent: StaffPending,
});

function AccessLog() {
  const loaded = Route.useLoaderData();
  const sp = Route.useSearch();
  const navigate = useNavigate({ from: "/staff/access-log" });
  const set = (p: Partial<Search>) =>
    void navigate({ search: (s: Search) => ({ ...s, ...p }), replace: true } as never);
  if (isDenied(loaded)) return <DeniedView d={loaded} />;
  type Row = (typeof loaded)[number];
  const rows = sp.outside ? loaded.filter((r) => r.outsideAssignment) : loaded;
  const households = [
    ...new Map(loaded.flatMap((r) => (r.householdId ? [[r.householdId, r.household]] : []))).entries(),
  ];
  const people = [...new Map(loaded.map((r) => [r.actorId, r.who])).entries()];
  const columns: Column<Row>[] = [
    { key: "at", header: "When", cell: (r) => <span className="whitespace-nowrap">{stamp(r.at)}</span> },
    { key: "who", header: "Who", cell: (r) => r.who },
    { key: "view", header: "Opened", cell: (r) => r.view },
    {
      key: "household",
      header: "Household",
      cell: (r) =>
        r.household ?? (
          <span className="text-ink-soft">
            {r.rowCount === null ? "A list" : `A list (${r.rowCount} ${r.rowCount === 1 ? "row" : "rows"})`}
          </span>
        ),
    },
    {
      key: "flag",
      header: "Assignment",
      cell: (r) =>
        r.kind === "list" ? (
          ""
        ) : r.outsideAssignment ? (
          <Badge tone="ochre">Not assigned or covering</Badge>
        ) : (
          <span className="text-ink-soft">Assigned or covering</span>
        ),
    },
  ];
  return (
    <>
      <StaffPageHeader
        title="Who opened records"
        description="Each time someone on staff opened a household's record, at most once per person, household and view every 15 minutes, and each list view they opened. No content is kept."
        actions={
          <Link to="/staff/audit" className="text-[0.8125rem] text-harbor underline underline-offset-2">
            Audit review
          </Link>
        }
      />
      <div
        className="mb-3 flex flex-wrap items-end gap-2 [&_select]:!min-h-8 [&_select]:!py-0.5"
        role="group"
        aria-label="Filter who opened records"
      >
        <label className="text-[0.75rem] text-ink-soft">
          Household
          <select
            className={inputClass + " !w-56"}
            value={sp.household ?? ""}
            onChange={(e) => set({ household: e.target.value || undefined })}
          >
            <option value="">Any household</option>
            {households.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[0.75rem] text-ink-soft">
          Staff member
          <select
            className={inputClass + " !w-48"}
            value={sp.who ?? ""}
            onChange={(e) => set({ who: e.target.value || undefined })}
          >
            <option value="">Anyone</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!sp.outside}
            onChange={(e) => set({ outside: e.target.checked || undefined })}
          />
          Only households they weren't assigned to or covering
        </label>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        caption="Who opened household records"
        empty={<EmptyState title="Nothing recorded for these filters" />}
      />
    </>
  );
}
