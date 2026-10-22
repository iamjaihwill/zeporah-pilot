import { createFileRoute } from "@tanstack/react-router";
import { StaffPageHeader, StatusChip, Panel } from "@/components/staff";
import { STATUS, type StatusDomain } from "@/domain/status";
import { useHashTarget } from "@/lib/use-hash-target";

/**
 * Short in-app explanations (staff rework, section 2). The longer wording that used to sit at the
 * top of each page lives here, behind the Help menu, so working screens stay compact.
 */
export const Route = createFileRoute("/staff/help")({ component: Help });

const DOMAINS: [StatusDomain, string][] = [
  ["escalation", "Escalations"],
  ["consent", "Consents"],
  ["authority", "Authority records"],
  ["packet", "Packets"],
  ["task", "Tasks"],
  ["household", "Households"],
  ["invitation", "Invitations"],
  ["transition", "Bereavement transitions"],
  ["correction", "Consent corrections"],
];

function Help() {
  useHashTarget();
  return (
    <>
      <StaffPageHeader title="Help" description="What the statuses mean, and the rules behind them." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel id="statuses" title="What each status means" className="lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-3">
            {DOMAINS.map(([d, l]) => (
              <section key={d} aria-label={l}>
                <h3 className="mb-1">{l}</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {Object.keys(STATUS[d]).map((v) => (
                    <li key={v}>
                      <StatusChip domain={d} value={v} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Panel>
        <Panel id="queue" title="How the queue is ordered">
          <p>
            High priority first, then normal, then routine; within each, whatever has waited longest. Waiting
            counts from the item's last change of state. Every row says why it has its priority, who owns it,
            what last happened and what to do next.
          </p>
        </Panel>
        <Panel id="triage" title="Not clinical triage">
          <p>
            Priority is a workflow ordering aid. It isn't clinical urgency, triage or a medical priority.
            Clinical concerns follow the hospice's own procedures, and families are told to use the 24-hour
            line for anything urgent.
          </p>
        </Panel>
        <Panel id="consent" title="Consent: record, confirm, activate">
          <p>
            A care-team member records the consent, the named household person confirms that exact version,
            and a different reviewer activates it. Any change to the purpose, recipient, scope, dates or
            withdrawal terms starts again at confirmation. A correction request holds activation and release
            until it's resolved.
          </p>
        </Panel>
        <Panel id="release" title="Releasing a packet">
          <p>
            Release runs the policy check at that moment: active consent, authority, scope and dates. Only the
            listed categories are released, every release is recorded with a receipt, and nothing is delivered
            outside Zeporah. Releases are never done in bulk.
          </p>
        </Panel>
        <Panel id="authority" title="Workflow state, not a legal determination">
          <p>
            Authority records hold metadata, versions and reviewer decisions only. Zeporah never decides who
            has legal authority; conflicts are held for a person to review with the family.
          </p>
        </Panel>
      </div>
    </>
  );
}
