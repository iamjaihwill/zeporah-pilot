import { StaffPending } from "@/components/staff/pending";
import { StaffPageHeader } from "@/components/staff";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { getBereavementWorkload } from "@/functions/staff";
import { cx, dateOnly, isDenied, unwrap } from "@/lib/client";
import { Badge, Card, DeniedView, EmptyState, Stamp } from "@/components/ui";

/**
 * Bereavement follow-up across the households you can see: what's due, and who it's with. One row
 * per household (its next check-in, the rest of its plan behind it), so the page stays short as
 * households are added. Households that asked for no contact for now are listed apart.
 */
const NO_GUIDE = "No care guide";
export const Route = createFileRoute("/staff/bereavement")({
  validateSearch: z.object({ guide: z.string().max(100).optional() }),
  loader: async () => unwrap(await getBereavementWorkload()),
  component: Workload,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

const ORDER = ["earlier", "this_week", "this_month", "later"] as const;

function Workload() {
  const w = Route.useLoaderData();
  const { guide } = Route.useSearch();
  const [showLater, setShowLater] = useState(false);
  if (isDenied(w)) return <DeniedView d={w} />;
  type Entry = (typeof w.byHousehold)[number];
  const forGuide = (e: Entry) =>
    !guide || (guide === NO_GUIDE ? e.next.careGuides.length === 0 : e.next.careGuides.includes(guide));
  const entries = w.byHousehold.filter(forGuide);
  const paused = entries.filter((e) => e.next.paused);
  const active = entries.filter((e) => !e.next.paused);
  return (
    <>
      <StaffPageHeader title="Bereavement follow-up" />
      {w.open.length === 0 ? (
        <EmptyState title="No check-ins waiting">
          When a household moves to bereavement support, its 13-month plan appears here.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <div className="space-y-6">
            {guide && (
              <p className="text-[0.8125rem] text-ink-soft">
                Showing {guide === NO_GUIDE ? "households with no care guide" : guide}'s households ·{" "}
                <Link to="/staff/bereavement" className="text-harbor underline">
                  Show everyone's
                </Link>
              </p>
            )}
            {paused.length > 0 && (
              <section aria-labelledby="w-paused">
                <h2 id="w-paused" className="mb-2 text-xl">
                  Contact paused <span className="text-ink-soft">({paused.length})</span>
                </h2>
                <p className="mb-2 text-sm text-ink-soft">
                  The family asked not to be contacted for now. Don't reach out until they say so.
                </p>
                <HouseholdList entries={paused} />
              </section>
            )}
            {ORDER.map((k) => {
              const items = active.filter((e) => e.next.window === k);
              if (!items.length) return null;
              const collapsed = k === "later" && !showLater;
              return (
                <section key={k} aria-labelledby={`w-${k}`}>
                  <h2 id={`w-${k}`} className="mb-2 flex items-center gap-2 text-xl">
                    {w.windows[k]} <span className="text-ink-soft">({items.length})</span>
                    {k === "earlier" && <Badge tone="rose">Overdue</Badge>}
                  </h2>
                  {collapsed ? (
                    <button
                      type="button"
                      className="text-sm text-harbor underline"
                      aria-expanded={false}
                      onClick={() => setShowLater(true)}
                    >
                      Show {items.length} household{items.length === 1 ? "" : "s"} with check-ins later
                    </button>
                  ) : (
                    <HouseholdList entries={items} overdue={k === "earlier"} />
                  )}
                </section>
              );
            })}
          </div>
          <aside>
            <Card title="Due within a month, by care guide" tone="quiet">
              {w.byGuide.length ? (
                <ul className="space-y-1 text-sm">
                  {w.byGuide.map((g) => (
                    <li key={g.name} className="flex justify-between gap-2">
                      {/* Choosing a name shows only their households. */}
                      <Link
                        to="/staff/bereavement"
                        search={guide === g.name ? {} : { guide: g.name }}
                        aria-current={guide === g.name ? "true" : undefined}
                        className={cx(
                          "underline-offset-2 hover:underline",
                          g.name === NO_GUIDE ? "font-semibold text-ochre" : "text-harbor",
                          guide === g.name && "font-semibold",
                        )}
                      >
                        {g.name === NO_GUIDE ? "! No care guide" : g.name}
                      </Link>
                      <span>{g.n}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-soft">Nothing due within a month.</p>
              )}
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}

function HouseholdList({
  entries,
  overdue = false,
}: {
  entries: {
    householdId: string;
    household: string;
    next: {
      id: string;
      label: string;
      dueOn: Date;
      careGuides: string[];
      declined: boolean;
      paused: { since: Date | null; by: string | null } | null;
    };
    more: { id: string; label: string; dueOn: Date }[];
  }[];
  overdue?: boolean;
}) {
  const { canAssign } = Route.useLoaderData() as { canAssign: boolean };
  return (
    <ul className="divide-y rounded-[var(--radius-card)] border bg-surface">
      {entries.map((e) => (
        <li key={e.householdId} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
          <span className="min-w-0">
            <Link
              to="/staff/households/$householdId"
              params={{ householdId: e.householdId }}
              search={{ tab: "overview" }}
              hash={`checkin-${e.next.id}`}
              className="font-medium text-harbor underline-offset-2 hover:underline"
            >
              {e.household}
            </Link>{" "}
            · {e.next.label}
            <span className="block text-sm text-ink-soft">
              {overdue && <Badge tone="rose">Overdue</Badge>} Due around {dateOnly(e.next.dueOn)} ·{" "}
              {e.next.careGuides.length ? (
                e.next.careGuides.join(", ")
              ) : (
                <span className="font-semibold text-ochre">
                  No care guide assigned
                  {canAssign && (
                    <>
                      {" "}
                      ·{" "}
                      <Link
                        to="/staff/households/$householdId"
                        params={{ householdId: e.householdId }}
                        search={{ tab: "overview" }}
                        hash="care-team"
                        className="font-normal text-harbor underline"
                      >
                        Assign
                      </Link>
                    </>
                  )}
                </span>
              )}
            </span>
            {e.more.length > 0 && (
              <details className="mt-1 text-sm">
                <summary className="cursor-pointer text-ink-soft">{e.more.length} more planned</summary>
                <ul className="mt-1 space-y-0.5 pl-4 text-ink-soft">
                  {e.more.map((m) => (
                    <li key={m.id}>
                      {m.label} · around {dateOnly(m.dueOn)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </span>
          <span className="flex flex-col items-end gap-1">
            {e.next.paused && (
              <Badge tone="ochre">
                Contact paused
                {e.next.paused.by ? ` by ${e.next.paused.by}` : ""}
                {e.next.paused.since ? (
                  <>
                    {" "}
                    · <Stamp at={e.next.paused.since} />
                  </>
                ) : null}
              </Badge>
            )}
            {e.next.declined && <Badge tone="ochre">Asked not to be contacted</Badge>}
          </span>
        </li>
      ))}
    </ul>
  );
}
