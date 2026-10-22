import { StaffPending } from "@/components/staff/pending";
import { StaffPageHeader } from "@/components/staff";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getConsentHistory } from "@/functions/staff";
import { isDenied, unwrap } from "@/lib/client";
import { Badge, Card, DeniedView, PageHeader, Stamp, Coded } from "@/components/ui";
import { reasonLabel } from "@/domain/labels";
import { actionLabel } from "@/domain/queue";

/** One consent's terms and its full recorded history, newest first. Read-only. */
export const Route = createFileRoute("/staff/sharing/$consentId")({
  loader: async ({ params }) => unwrap(await getConsentHistory({ data: { consentId: params.consentId } })),
  component: History,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

function History() {
  const d = Route.useLoaderData();
  if (isDenied(d)) return <DeniedView d={d} />;
  const c = d.consent;
  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/staff/sharing" className="text-harbor underline-offset-2 hover:underline">
          ← Sharing register
        </Link>
      </p>
      <StaffPageHeader
        title={`Consent to share with ${c.recipientName}`}
        description={`${c.household} · ${c.stageLabel} · version ${c.version}`}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Current terms" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="font-medium">Purpose</dt>
              <dd className="text-ink-soft">{c.purpose}</dd>
            </div>
            <div>
              <dt className="font-medium">Named as giving consent</dt>
              <dd className="text-ink-soft">{c.grantedByName}</dd>
            </div>
            <div>
              <dt className="font-medium">What can be shared</dt>
              <dd className="text-ink-soft">{c.scopeLabels.join(", ")}</dd>
            </div>
            <div>
              <dt className="font-medium">From – to</dt>
              <dd className="text-ink-soft">
                <Stamp at={c.startsAt} /> – <Stamp at={c.expiresAt} />
              </dd>
            </div>
            <div>
              <dt className="font-medium">How to withdraw</dt>
              <dd className="text-ink-soft">{c.revocationPath}</dd>
            </div>
            {c.revokeReason && (
              <div>
                <dt className="font-medium">Withdrawal note (staff only)</dt>
                <dd className="text-ink-soft">{c.revokeReason}</dd>
              </div>
            )}
          </dl>
          <Link
            to="/staff/households/$householdId"
            params={{ householdId: c.householdId }}
            search={{ tab: "sharing" }}
            className="mt-4 inline-block text-sm text-harbor underline"
          >
            Act on it from the household's Sharing tab
          </Link>
        </Card>
        <Card title="History" className="lg:col-span-2">
          {d.history.length === 0 ? (
            <p className="text-ink-soft">No recorded steps.</p>
          ) : (
            <ol className="space-y-3">
              {d.history.map((h) => (
                <li key={h.id} className="border-l-2 border-line-strong pl-3">
                  <p>
                    <span className="font-medium">{h.by}</span> {actionLabel(h.action)}
                    {h.version ? <> · version {h.version}</> : null}
                    {h.changed.length > 0 && <> · changed {h.changed.join(", ")}</>}
                  </p>
                  <p className="text-sm text-ink-soft">
                    <Stamp at={h.at} full />
                  </p>
                  <p className="text-sm text-ink-soft">{h.summary}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title="Confirmations">
          {d.confirmations.length ? (
            <ul className="space-y-2 text-sm">
              {d.confirmations.map((x) => (
                <li key={x.version}>
                  Version {x.version}: {x.by}, <Stamp at={x.at} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-soft">Not confirmed yet.</p>
          )}
        </Card>
        <Card title="Correction requests">
          {d.corrections.length ? (
            <ul className="space-y-2 text-sm">
              {d.corrections.map((r) => (
                <li key={r.id}>
                  Version {r.version} · {r.categories.join(", ")} ·{" "}
                  <Badge tone={r.status === "open" ? "ochre" : "neutral"}>
                    {r.status === "open" ? "Open" : r.outcome ? `Closed: ${r.outcome}` : r.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-soft">None.</p>
          )}
        </Card>
        <Card title="Packets under this consent">
          {d.packets.length ? (
            <ul className="space-y-2 text-sm">
              {d.packets.map((p) => (
                <li key={p.id}>
                  <Link
                    to="/staff/packets/$packetId"
                    params={{ packetId: p.id }}
                    className="text-harbor underline-offset-2 hover:underline"
                  >
                    {p.id}
                  </Link>{" "}
                  · {p.state}
                  {p.lastReasonCode ? (
                    <>
                      {" "}
                      · <Coded label={reasonLabel(p.lastReasonCode)} code={p.lastReasonCode} />
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-soft">None.</p>
          )}
        </Card>
      </div>
    </>
  );
}
