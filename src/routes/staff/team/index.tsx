import { StaffPending } from "@/components/staff/pending";
import { StaffPageHeader } from "@/components/staff";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getHospiceDetails, getRoster, getStaffInvitations } from "@/functions/staff";
import { cx, isDenied, unwrap } from "@/lib/client";
import { Badge, Card, DeniedView, EmptyState, Notice, PageHeader, Stamp, StateBadge } from "@/components/ui";
import { AssignCareGuide, EndAssignment, ReassignAssignment } from "@/components/assignments";
import { StaffInvites } from "@/components/staff/staff-invites";
import { PlannedAbsences } from "@/components/staff/coverage";
import { getCoverageBoard } from "@/functions/staff-shell";

/**
 * Team & coverage (hospice operations): who covers which households, which households have no
 * care guide, and any assignment still held by someone who is no longer an active care guide.
 */
export const Route = createFileRoute("/staff/team/")({
  loader: async () => {
    const [roster, invites, details, coverage] = await Promise.all([
      getRoster(),
      getStaffInvitations(),
      getHospiceDetails(),
      getCoverageBoard(),
    ]);
    return {
      ...unwrap(roster),
      // Planned absences and cover (decision 58, workstream 3): operations and administrators.
      coverage: coverage.ok ? coverage.data : null,
      // Invitations live here too (and in Hospice settings): operations invite care guides only.
      invites: invites.ok ? invites.data : null,
      canInviteAnyRole: details.ok ? details.data.canEdit : false,
    };
  },
  component: Team,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

function HouseholdLink({ id, name }: { id: string; name: string }) {
  // Administrators manage coverage without opening household records (decision 39).
  const r = Route.useLoaderData();
  if (!isDenied(r) && !r.canOpenHouseholds) return <span className="font-medium">{name}</span>;
  return (
    <Link
      to="/staff/households/$householdId"
      params={{ householdId: id }}
      search={{ tab: "overview" }}
      className="font-medium text-harbor underline-offset-2 hover:underline"
    >
      {name}
    </Link>
  );
}

function PersonLink({ id, name }: { id: string; name: string }) {
  return (
    <Link
      to="/staff/team/$actorId"
      params={{ actorId: id }}
      className="text-harbor underline-offset-2 hover:underline"
    >
      {name}
    </Link>
  );
}

function Team() {
  const r = Route.useLoaderData();
  if (isDenied(r)) return <DeniedView d={r} />;
  // One scale for every bar, including households without a care guide.
  const max = Math.max(1, r.uncovered.length, ...r.guides.map((x) => x.count));
  const eligible = r.guides.map((g) => ({ actorId: g.actorId, name: g.name, caseload: g.count }));
  return (
    <>
      <StaffPageHeader title="Team & coverage" />
      {r.coverage && <PlannedAbsences board={r.coverage} />}
      <section aria-labelledby="uncovered" className="mb-8">
        <h2 id="uncovered" className="mb-3 flex items-center gap-2 text-2xl">
          Households without a care guide
          <Badge tone={r.uncovered.length ? "ochre" : "neutral"}>{r.uncovered.length}</Badge>
        </h2>
        {r.uncovered.length === 0 ? (
          <EmptyState title="Every household has a care guide" />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {r.uncovered.map((h) => (
              <li key={h.id}>
                <Card>
                  <p className="flex flex-wrap items-center justify-between gap-2">
                    <HouseholdLink id={h.id} name={h.name} />
                    <StateBadge
                      state={h.lifecycle === "active_hospice" ? "active" : h.lifecycle}
                      label={h.lifecycleLabel}
                    />
                  </p>
                  <div className="mt-3">
                    {eligible.length ? (
                      <AssignCareGuide
                        householdId={h.id}
                        household={h.name}
                        eligible={eligible}
                        caseloadWarnAt={r.defaults.caseloadWarnAt}
                      />
                    ) : (
                      <p className="text-sm text-ink-soft">There are no active care guides to assign yet.</p>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {r.ineligible.length > 0 && (
        <section aria-labelledby="ineligible" className="mb-8">
          <h2 id="ineligible" className="mb-3 text-2xl">
            Assignments to review
          </h2>
          <Notice tone="ochre" title="Held by someone who isn't an active care guide here">
            These people no longer have the care-guide role at this hospice, so they can't see these
            households. End each assignment, or reassign the household.
          </Notice>
          <ul className="mt-3 space-y-2">
            {r.ineligible.map((a) => (
              <li
                key={a.membershipId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-surface p-3"
              >
                <span>
                  {a.guideName} · <HouseholdLink id={a.household.id} name={a.household.name} />
                </span>
                <span className="flex flex-wrap gap-2">
                  <ReassignAssignment
                    membershipId={a.membershipId}
                    name={a.guideName}
                    household={a.household.name}
                    others={eligible}
                    handOverByDefault={r.defaults.handOverByDefault}
                    caseloadWarnAt={r.defaults.caseloadWarnAt}
                  />
                  <EndAssignment
                    membershipId={a.membershipId}
                    name={a.guideName}
                    household={a.household.name}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* One table: each care guide's load, then the households they cover (actions as text). */}
      <section aria-labelledby="guides" className="mb-8">
        <h2 id="guides" className="mb-3 text-2xl">
          Care guides
        </h2>
        {r.guides.length === 0 ? (
          <EmptyState title="No active care guides">
            Invite care guides below. They'll appear here once they've joined.
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-[var(--s-radius)] border bg-surface">
            <table className="w-full border-separate border-spacing-0 text-left text-[0.8125rem]">
              <caption className="sr-only">
                Care guides: households, open escalations and overdue care-team tasks
              </caption>
              <thead className="bg-sunk text-[0.75rem] text-ink-soft">
                <tr>
                  <th scope="col" className="h-8 border-b px-3 font-semibold">
                    Care guide
                  </th>
                  <th scope="col" className="h-8 w-full border-b px-3 font-semibold">
                    Households
                  </th>
                  <th
                    scope="col"
                    className="h-8 border-b px-3 text-right font-semibold whitespace-nowrap max-sm:hidden"
                  >
                    Open escalations
                  </th>
                  <th
                    scope="col"
                    className="h-8 border-b px-3 text-right font-semibold whitespace-nowrap max-sm:hidden"
                  >
                    Overdue tasks
                  </th>
                </tr>
              </thead>
              {r.guides.map((g) => (
                <tbody key={g.actorId}>
                  <tr>
                    <th
                      scope="row"
                      className="border-t px-3 pt-2.5 pb-1 text-left font-semibold sm:whitespace-nowrap"
                    >
                      <PersonLink id={g.actorId} name={g.name} />
                    </th>
                    <td className="border-t px-3 pt-2.5 pb-1">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 min-w-16 flex-1 rounded-sm bg-sunk" aria-hidden>
                          <span
                            className="block h-2.5 rounded-sm bg-harbor"
                            style={{ width: `${(g.count / max) * 100}%` }}
                          />
                        </span>
                        <span className="whitespace-nowrap">
                          {g.count === 1 ? "1 household" : `${g.count} households`}
                        </span>
                      </span>
                      {/* On phones the two number columns are hidden; their numbers sit here. */}
                      <span className="block text-[0.75rem] text-ink-soft sm:hidden">
                        {g.escalations} open escalation{g.escalations === 1 ? "" : "s"} · {g.overdueTasks}{" "}
                        overdue task{g.overdueTasks === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="border-t px-3 pt-2.5 pb-1 text-right tabular-nums max-sm:hidden">
                      {g.escalations}
                    </td>
                    <td
                      className={cx(
                        "border-t px-3 pt-2.5 pb-1 text-right tabular-nums max-sm:hidden",
                        g.overdueTasks > 0 && "font-semibold text-rose",
                      )}
                    >
                      {g.overdueTasks}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-3 pb-2.5 max-sm:px-1.5">
                      {g.households.length === 0 ? (
                        <p className="text-ink-soft">Not assigned to any households yet.</p>
                      ) : (
                        <ul className="divide-y rounded-md border border-line/60">
                          {g.households.map((h) => (
                            <li
                              key={h.membershipId}
                              className="flex flex-wrap items-center justify-between gap-x-2 px-2.5 py-1"
                            >
                              <span>
                                <HouseholdLink id={h.id} name={h.name} />{" "}
                                <span className="text-ink-soft">· {h.lifecycleLabel}</span>
                              </span>
                              {h.lifecycle !== "closed" && (
                                <span className="flex gap-1">
                                  <ReassignAssignment
                                    quiet
                                    membershipId={h.membershipId}
                                    name={g.name}
                                    household={h.name}
                                    others={eligible.filter((e) => e.actorId !== g.actorId)}
                                    handOverByDefault={r.defaults.handOverByDefault}
                                    caseloadWarnAt={r.defaults.caseloadWarnAt}
                                  />
                                  <EndAssignment
                                    quiet
                                    membershipId={h.membershipId}
                                    name={g.name}
                                    household={h.name}
                                  />
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="orgwide">
        <h2 id="orgwide" className="mb-3 text-2xl">
          Organization-wide by role
        </h2>
        <p className="mb-3 text-ink-soft">
          These staff aren't assigned to households; their role covers the whole hospice.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {r.organizationWide.map((p) => (
            <li key={p.actorId} className="rounded-xl border bg-surface p-3">
              <span className="font-medium">
                <PersonLink id={p.actorId} name={p.name} />
              </span>{" "}
              <span className="text-sm text-ink-soft">· {p.roles.join(", ")}</span>
            </li>
          ))}
        </ul>
      </section>

      {r.invites && (
        <div className="mt-8">
          <StaffInvites compact list={r.invites} canInviteAnyRole={r.canInviteAnyRole} />
        </div>
      )}

      <section aria-labelledby="former" className="mt-8">
        <h2 id="former" className="mb-3 text-2xl">
          Former staff
        </h2>
        {r.former.length === 0 ? (
          <p className="text-ink-soft">No one has been deactivated.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {r.former.map((p) => (
              <li key={p.actorId} className="rounded-xl border bg-surface p-3">
                <PersonLink id={p.actorId} name={p.name} />{" "}
                <span className="text-sm text-ink-soft">
                  · deactivated <Stamp at={p.deactivatedAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
