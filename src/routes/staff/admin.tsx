import { Link, createFileRoute } from "@tanstack/react-router";
import { StaffPending } from "@/components/staff/pending";
import { GettingStarted } from "@/components/staff/guide";
import { getGuide } from "@/functions/staff-shell";
import { withGuide } from "@/lib/guide";
import { Panel, StaffPageHeader } from "@/components/staff";
import { getAdminOverview } from "@/functions/staff";
import { isDenied, unwrap } from "@/lib/client";
import { DeniedView, Stamp } from "@/components/ui";
import { auditLabel } from "@/domain/labels";

/**
 * The administrator's overview (founder decision 39): the team at a glance, invitations waiting,
 * and the latest changes to roles, accounts and settings. Organization-level only.
 */
export const Route = createFileRoute("/staff/admin")({
  loader: async () => withGuide(unwrap(await getAdminOverview()), await getGuide()),
  component: Admin,
  pendingComponent: StaffPending,
});

function Admin() {
  const d = Route.useLoaderData();
  if (isDenied(d)) return <DeniedView d={d} />;
  return (
    <>
      <StaffPageHeader title="Administration" description="People, access and settings for this hospice." />
      {"guide" in d && d.guide && <GettingStarted guide={d.guide} />}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Team">
          <p className="text-3xl font-semibold tabular-nums">{d.active}</p>
          <p className="text-ink-soft">active staff</p>
          <dl className="mt-3 space-y-0.5 text-[0.8125rem]">
            {d.byRole.map((r) => (
              <div key={r.role} className="flex justify-between gap-3">
                <dt className="text-ink-soft">{r.label}</dt>
                <dd className="font-medium tabular-nums">{r.n}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3">
              <dt className="text-ink-soft">Former staff</dt>
              <dd className="font-medium tabular-nums">{d.former}</dd>
            </div>
          </dl>
          <Link to="/staff/team" className="mt-3 inline-block text-harbor underline underline-offset-2">
            Team &amp; coverage
          </Link>
        </Panel>
        <Panel title={`Invitations waiting (${d.invites.length})`}>
          {d.invites.length ? (
            <ul className="space-y-1.5 text-[0.8125rem]">
              {d.invites.map((i) => (
                <li key={i.id}>
                  <span className="font-medium">{i.name}</span> · {i.role}
                  <span className="block text-ink-soft">
                    Link expires <Stamp at={i.expiresAt} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-soft">None waiting.</p>
          )}
          <Link
            to="/staff/settings"
            search={{ section: "invitations" }}
            className="mt-3 inline-block text-harbor underline underline-offset-2"
          >
            Invite someone
          </Link>
        </Panel>
        <Panel title="Settings">
          <ul className="space-y-1.5">
            <li>
              <Link
                to="/staff/settings"
                search={{ section: "organization" }}
                className="text-harbor underline underline-offset-2"
              >
                Organization details
              </Link>
            </li>
            <li>
              <Link
                to="/staff/settings"
                search={{ section: "controls" }}
                className="text-harbor underline underline-offset-2"
              >
                Access limits and retention
              </Link>
            </li>
            <li>
              <Link
                to="/staff/settings"
                search={{ section: "workflow" }}
                className="text-harbor underline underline-offset-2"
              >
                Workflow settings
              </Link>
            </li>
            <li>
              <Link to="/staff/audit" className="text-harbor underline underline-offset-2">
                Audit review
              </Link>
            </li>
          </ul>
        </Panel>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Coverage">
          <p className="text-3xl font-semibold tabular-nums">{d.coverage.withoutGuide}</p>
          <p className="text-ink-soft">of {d.coverage.households} households without a care guide</p>
          <p className="mt-2 text-[0.8125rem] text-ink-soft">
            {d.coverage.away
              ? `${d.coverage.away} care guide${d.coverage.away === 1 ? "" : "s"} away now or soon.`
              : "No care guides away now or soon."}
          </p>
          <Link to="/staff/team" className="mt-3 inline-block text-harbor underline underline-offset-2">
            Team &amp; coverage
          </Link>
        </Panel>
        <Panel title="Audit integrity">
          {d.integrity.ok ? (
            <p data-testid="admin-integrity">
              <span className="font-semibold text-moss">Verified</span>
              <span className="block text-[0.8125rem] text-ink-soft">
                {d.integrity.count} events, each linked to the one before it.
              </span>
            </p>
          ) : (
            <p data-testid="admin-integrity" className="font-semibold text-rose">
              The audit chain didn't verify. Report this to the security lead.
            </p>
          )}
          <Link to="/staff/audit" className="mt-3 inline-block text-harbor underline underline-offset-2">
            Audit review
          </Link>
        </Panel>
      </div>
      <Panel title="Recent changes to people, access and settings" className="mt-4">
        {d.recent.length ? (
          <ol className="divide-y text-[0.8125rem]">
            {d.recent.map((r) => (
              <li key={r.id} className="py-1.5">
                <span className="font-medium">{auditLabel(r.action)}</span> · {r.by} · <Stamp at={r.at} />
                <span className="block text-ink-soft">{r.summary}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-ink-soft">Nothing yet.</p>
        )}
      </Panel>
    </>
  );
}
