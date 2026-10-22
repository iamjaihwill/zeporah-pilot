import { StaffPending } from "@/components/staff/pending";
import { StaffPageHeader } from "@/components/staff";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getPolicyScenarios } from "@/functions/staff";
import { isDenied, unwrap } from "@/lib/client";
import { Badge, Card, DeniedView, Notice, PageHeader, StateBadge } from "@/components/ui";

export const Route = createFileRoute("/staff/policy")({
  loader: async () => unwrap(await getPolicyScenarios()),
  component: Policy,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

function Policy() {
  const s = Route.useLoaderData();
  if (isDenied(s)) return <DeniedView d={s} />;
  return (
    <>
      <StaffPageHeader
        title="Policy scenarios"
        description="Each packet evaluated as if release were requested now, with your role. Changes nothing."
      />
      <div className="mb-6">
        <Notice tone="quiet" title="Ten gates, no fallback">
          Correct tenant · authenticated person · permitted role · named purpose · named recipient · non-empty
          minimum-necessary scope · active authority workflow whose holder identity is resolved · consent that
          the named person confirmed and a different reviewer activated, unexpired and not withdrawn · future
          expiry · an audit event recorded with the release. Anything less is held or denied.
        </Notice>
      </div>
      <div className="relative overflow-x-auto rounded-[var(--radius-card)] border bg-surface">
        <table className="w-full min-w-[60rem] text-left text-sm">
          <caption className="sr-only">Packets and their release decisions</caption>
          <thead className="border-b bg-sunk text-xs tracking-wide text-ink-soft uppercase">
            <tr>
              <th className="px-3 py-2" scope="col">
                Scenario
              </th>
              <th className="px-3 py-2" scope="col">
                Decision
              </th>
              <th className="px-3 py-2" scope="col">
                Reason code
              </th>
              <th className="px-3 py-2" scope="col">
                What a person would be told
              </th>
              <th className="px-3 py-2" scope="col">
                Source
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {s.packets.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2">
                  <Link
                    to="/staff/packets/$packetId"
                    params={{ packetId: p.id }}
                    className="font-medium text-harbor underline-offset-2 hover:underline"
                  >
                    {p.household}: {p.recipientName || "no recipient"}
                  </Link>
                  <span className="block text-ink-soft">State: {p.state}</span>
                </td>
                <td className="px-3 py-2">
                  <StateBadge state={p.preview.decision} />
                </td>
                <td className="px-3 py-2">
                  <code>{p.preview.reasonCode}</code>
                </td>
                <td className="px-3 py-2 text-ink-soft">{p.preview.explanation}</td>
                <td className="px-3 py-2">
                  <Badge tone="harbor">Runtime</Badge>
                </td>
              </tr>
            ))}
            {s.constructed.map((c) => (
              <tr key={c.label} className="bg-sunk/50">
                <td className="px-3 py-2">{c.label}</td>
                <td className="px-3 py-2">
                  <StateBadge state={c.decision} />
                </td>
                <td className="px-3 py-2">
                  <code>{c.reasonCode}</code>
                </td>
                <td className="px-3 py-2 text-ink-soft">
                  {c.explanation}
                  {c.note && <span className="mt-1 block text-xs text-ink">{c.note}</span>}
                </td>
                <td className="px-3 py-2">
                  {c.source === "runtime" ? (
                    <Badge tone="harbor">Runtime</Badge>
                  ) : (
                    <Badge tone="neutral">Evaluator only — not what the app returns</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-ink-soft">
        <strong>Runtime</strong> rows show what Zeporah returns for that request.{" "}
        <strong>Evaluator only</strong> rows run the pure release check directly, to show a defense-in-depth
        gate that the app normally never reaches.
      </p>
      <Card className="mt-6" tone="quiet" title="Deny or hold?">
        <p className="text-ink-soft">
          <strong>Deny</strong> means the person asking is wrong for this request — another organization, not
          signed in, or a role that can't release. <strong>Hold</strong> means the workflow isn't ready and a
          person can fix it: review authority, renew consent, correct the manifest, or set a new expiry. Holds
          that need judgment open an escalation.
        </p>
      </Card>
    </>
  );
}
