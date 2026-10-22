import { createFileRoute } from "@tanstack/react-router";
import { getHouseholdConsents } from "@/functions/family";
import { dateOnly, isDenied, unwrap } from "@/lib/client";
import { useStableOrder } from "@/lib/stable-order";
import { useHashTarget } from "@/lib/use-hash-target";
import { DeniedView, EmptyState, Notice, PageHeader, Visibility } from "@/components/ui";
import { ConsentCard } from "@/components/consent-card";

export const Route = createFileRoute("/family/sharing")({
  loader: async () => unwrap(await getHouseholdConsents()),
  component: Sharing,
});

function Sharing() {
  const data = Route.useLoaderData();
  // The card someone just acted on stays where it is (item 5).
  const list = useStableOrder(isDenied(data) ? [] : data);
  useHashTarget(); // "Open" from Home lands on the consent it named.
  if (isDenied(data)) return <DeniedView d={data} />;
  return (
    <>
      <PageHeader
        eyebrow="Sharing"
        title="What's shared outside your household"
        lede="Each consent names who receives information, what exactly, why, and until when. Only the information listed is shared — nothing else."
      >
        <div className="mt-3">
          <Visibility who="sharing" />
        </div>
      </PageHeader>
      {list.length === 0 ? (
        <EmptyState title="Nothing is shared">
          Your household's information stays with your household and care team.
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {list.map((c) => (
            <ConsentCard
              key={c.id}
              c={c}
              extra={
                c.releases.length > 0 && (
                  <p className="mt-3 text-sm text-ink-soft">
                    Recorded as released {c.releases.length} time{c.releases.length > 1 ? "s" : ""}, most
                    recently {dateOnly(c.releases[0]!.at)}. {c.releases[0]!.note}
                  </p>
                )
              }
            />
          ))}
        </ul>
      )}
      <div className="mt-6">
        <Notice tone="quiet" title="How sharing works">
          A care-team member records the consent, the person named confirms it, and a different reviewer
          activates it. If something about a consent isn't right, anyone who can see it can request a
          correction; nothing is shared under it until the care team resolves that. Only the listed
          information can be released, every release is recorded, and Zeporah never sends anything outside the
          app.
        </Notice>
      </div>
    </>
  );
}
