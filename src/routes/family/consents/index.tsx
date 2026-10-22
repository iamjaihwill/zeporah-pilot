import { createFileRoute } from "@tanstack/react-router";
import { getConsentsForMe } from "@/functions/family";
import { isDenied, unwrap } from "@/lib/client";
import { useStableOrder } from "@/lib/stable-order";
import { useHashTarget } from "@/lib/use-hash-target";
import { DeniedView, EmptyState, Notice, PageHeader } from "@/components/ui";
import { ConsentCard } from "@/components/consent-card";

/**
 * Consents that name this person — and nothing else about the household's sharing. This is how
 * someone without the Sharing page (for example a family member) still sees and acts on a consent
 * they're named in.
 */
export const Route = createFileRoute("/family/consents/")({
  loader: async () => unwrap(await getConsentsForMe()),
  component: ConsentsForMe,
});

function ConsentsForMe() {
  const data = Route.useLoaderData();
  // The card someone just acted on stays where it is (item 5).
  const list = useStableOrder(isDenied(data) ? [] : data);
  useHashTarget(); // "Open" from Home lands on the consent it named.
  if (isDenied(data)) return <DeniedView d={data} />;
  return (
    <>
      <PageHeader
        eyebrow="Consents"
        title="Consents that name you"
        lede="Your care team recorded these with you named as the person giving consent. You only see consents that name you here."
      />
      {list.length === 0 ? (
        <EmptyState title="No consents name you">
          If your care team records one, it will appear here.
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {list.map((c) => (
            <ConsentCard key={c.id} c={c} />
          ))}
        </ul>
      )}
      <div className="mt-6">
        <Notice tone="quiet" title="If you can't confirm in the app">
          Confirming in the app needs the patient, or someone with an active authority workflow that allows
          it. If that isn't you, the consent is held and a person on your care team reviews it with you. You
          can still request a correction here.
        </Notice>
      </div>
    </>
  );
}
