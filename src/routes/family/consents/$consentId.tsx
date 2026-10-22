import { createFileRoute } from "@tanstack/react-router";
import { getConsentForMe } from "@/functions/family";
import { isDenied, unwrap } from "@/lib/client";
import { ButtonLink, DeniedView, PageHeader } from "@/components/ui";
import { ConsentCard } from "@/components/consent-card";

/**
 * The deep link used in notifications. The server checks, on every load, that the signed-in
 * person is the one named in this consent and still in the household — the link itself grants
 * nothing.
 */
export const Route = createFileRoute("/family/consents/$consentId")({
  loader: async ({ params }) => unwrap(await getConsentForMe({ data: { id: params.consentId } })),
  component: ConsentForMe,
});

function ConsentForMe() {
  const c = Route.useLoaderData();
  if (isDenied(c)) return <DeniedView d={c} back={<ButtonLink to="/family">Back to home</ButtonLink>} />;
  return (
    <>
      <PageHeader eyebrow="A consent that names you" title={`Sharing with ${c.recipientName}`} />
      <ul>
        <ConsentCard c={c} />
      </ul>
      <div className="mt-6">
        <ButtonLink to="/family/consents" variant="secondary">
          All consents that name you
        </ButtonLink>
      </div>
    </>
  );
}
