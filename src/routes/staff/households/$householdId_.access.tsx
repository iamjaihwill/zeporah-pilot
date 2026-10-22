import { Link, createFileRoute } from "@tanstack/react-router";
import { StaffPending } from "@/components/staff/pending";
import { StaffPageHeader } from "@/components/staff";
import { ButtonLink, DeniedView } from "@/components/ui";
import { BackFromHousehold, useOpensHouseholds } from "@/components/staff/back-from-household";
import { getHouseholdAccessMap } from "@/functions/staff";
import { cx, isDenied, stamp, unwrap } from "@/lib/client";

/**
 * "Who can see what" for one household (decision 58; spec section 2.5). Generated from the access
 * rules the app enforces, never written by hand. Each cell opens to say why. Time-limited access
 * (cover, helpers, outside recipients) shows its exact end. Administrators can't open it.
 */
export const Route = createFileRoute("/staff/households/$householdId_/access")({
  loader: async ({ params }) =>
    unwrap(await getHouseholdAccessMap({ data: { householdId: params.householdId } })),
  component: AccessMap,
  pendingComponent: StaffPending,
});

type Data = Exclude<ReturnType<typeof Route.useLoaderData>, { denied: true }>;
type Row = Data["rows"][number];
type Cell = Row["cells"][keyof Row["cells"]];

const GROUPS = [
  ["household", "Household"],
  ["care_team", "Care team"],
  ["hospice", "Hospice roles"],
] as const;

function AccessMap() {
  const d = Route.useLoaderData();
  const { householdId } = Route.useParams();
  const opensHouseholds = useOpensHouseholds();
  if (isDenied(d)) return <DeniedView d={d} back={<BackFromHousehold />} generalNote={opensHouseholds} />;
  const back = (
    <Link
      to="/staff/households/$householdId"
      params={{ householdId }}
      search={{ tab: "overview" }}
      className="text-[0.8125rem] text-harbor underline"
    >
      Back to {d.household.name}
    </Link>
  );
  return (
    <>
      <StaffPageHeader
        title="Who can see what"
        description={`${d.household.name}. Generated from the access rules at ${stamp(d.generatedAt)}; open a cell to see why.`}
        actions={back}
      />
      {/* Desktop: one grid. */}
      <div className="max-lg:hidden">
        <table className="w-full table-fixed border-collapse rounded-[var(--s-radius)] border bg-surface text-[0.8125rem]">
          <caption className="sr-only">Who can see each kind of information about this household</caption>
          <thead className="bg-sunk text-left text-[0.75rem] text-ink-soft">
            <tr>
              <th scope="col" className="w-48 border-b px-2.5 py-2 font-semibold">
                Who
              </th>
              {d.columns.map((c) => (
                <th key={c.key} scope="col" className="border-b px-2 py-2 font-semibold">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          {GROUPS.map(([g, label]) => {
            const rows = d.rows.filter((r) => r.group === g);
            if (!rows.length) return null;
            return (
              <tbody key={g}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={d.columns.length + 1}
                    className="border-b bg-paper px-2.5 py-1 text-left text-[0.6875rem] font-semibold tracking-wide text-ink-soft uppercase"
                  >
                    {label}
                  </th>
                </tr>
                {rows.map((r) => (
                  <tr key={r.key} className="align-top" data-testid={`access-row-${r.key}`}>
                    <th scope="row" className="border-b px-2.5 py-2 text-left font-normal">
                      <Who r={r} />
                    </th>
                    {d.columns.map((c) => (
                      <td key={c.key} className="border-b px-2 py-2">
                        <CellView c={r.cells[c.key]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      {/* iPad and phones: one card per person, the same cells as a list. */}
      <ul className="space-y-3 lg:hidden">
        {d.rows.map((r) => (
          <li key={r.key} className="rounded-[var(--s-radius)] border bg-surface p-3 text-[0.8125rem]">
            <Who r={r} />
            <dl className="mt-2 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
              {d.columns.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-ink-soft">{c.label}</dt>
                  <dd>
                    <CellView c={r.cells[c.key]} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <section aria-labelledby="outside" className="mt-6">
        <h2 id="outside" className="text-xl">
          Outside recipients
        </h2>
        {d.outside.length === 0 ? (
          <p className="mt-1 text-ink-soft">No one outside the household can read anything right now.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-[0.8125rem]">
            {d.outside.map((x) => (
              <li key={x.key} className="rounded-[var(--s-radius)] border bg-surface p-3">
                <span className="font-medium">{x.who}</span>, {x.organization}
                <span className="block">
                  Reads “{x.purpose}”, read-only: {x.includes.join(", ") || "nothing listed"}.
                </span>
                <span className="block text-ink-soft">
                  Until {stamp(x.until)}. Nothing else about the household; no download, print or forwarding.
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="mt-6 text-[0.75rem] text-ink-faint">
        Generated from the access rules, never written by hand. It shows who can see each kind of information,
        not the information itself.
      </p>
    </>
  );
}

function Who({ r }: { r: Row }) {
  return (
    <>
      <span className="block font-medium">{r.who}</span>
      <span className="block text-[0.75rem] text-ink-soft">{r.basis}</span>
      {r.until && (
        <span className="mt-0.5 inline-block rounded-md border border-ochre/30 bg-ochre-soft px-1.5 text-[0.6875rem] font-semibold text-ochre">
          {r.from
            ? `Temporary from ${stamp(r.from)} until ${stamp(r.until)}`
            : `Temporary until ${stamp(r.until)}`}
        </span>
      )}
    </>
  );
}

/** The cell's answer, opening to say why. */
function CellView({ c }: { c: Cell }) {
  return (
    <details className="group">
      <summary
        className={cx(
          "inline-flex min-h-6 min-w-6 cursor-pointer list-none items-center rounded px-1 marker:hidden",
          c.level === "yes"
            ? "font-semibold text-moss"
            : c.level === "some"
              ? "font-semibold text-ochre"
              : "text-ink-soft",
        )}
      >
        {c.text}
        <span className="sr-only">. Why?</span>
      </summary>
      <p className="mt-1 text-[0.75rem] text-ink-soft">{c.why}</p>
    </details>
  );
}
