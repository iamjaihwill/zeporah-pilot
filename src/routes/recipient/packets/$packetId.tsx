import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { acknowledgePacket, getRecipientPacket, requestClarification } from "@/functions/recipient";
import { isDenied, unwrap, useAction } from "@/lib/client";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DeniedView,
  EmergencyNotice,
  ErrorText,
  Field,
  Notice,
  PageHeader,
  Stamp,
  inputClass,
} from "@/components/ui";

/**
 * One shared packet, read-only (founder decision 45): sender, recipient, purpose, what's included,
 * the access period, its status and the recipient's own access history. Zeporah offers no
 * download, print or forward; the page says what it can't prevent.
 */
export const Route = createFileRoute("/recipient/packets/$packetId")({
  loader: async ({ params }) => unwrap(await getRecipientPacket({ data: { packetId: params.packetId } })),
  component: RecipientPacket,
});

const DID: Record<string, string> = {
  viewed: "You opened it",
  acknowledged: "You acknowledged receiving it",
  clarification_requested: "You asked the hospice a question",
};

function RecipientPacket() {
  const v = Route.useLoaderData();
  const router = useRouter();
  const { act, pending, error } = useAction();
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState(false);
  if (isDenied(v))
    return <DeniedView d={v} back={<ButtonLink to="/recipient">Back to your packets</ButtonLink>} />;
  const active = v.status === "active";
  return (
    <>
      <PageHeader eyebrow="Shared packet" title={v.purpose} />
      <Card>
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
          <dt className="text-ink-soft">From</dt>
          <dd>
            {v.sender.organization}
            {v.sender.releasedBy && (
              <span className="text-ink-soft"> · released by {v.sender.releasedBy}</span>
            )}
          </dd>
          <dt className="text-ink-soft">For</dt>
          <dd>
            {v.recipient.name}, {v.recipient.organization}
          </dd>
          <dt className="text-ink-soft">Purpose</dt>
          <dd>{v.purpose}</dd>
          <dt className="text-ink-soft">Access</dt>
          <dd>
            <Stamp at={v.access.from} full /> to <Stamp at={v.access.until} full />
          </dd>
          <dt className="text-ink-soft">Status</dt>
          <dd>
            <Badge tone={active ? "moss" : "neutral"}>{v.statusText}</Badge>
          </dd>
        </dl>
      </Card>

      <section aria-labelledby="materials" className="mt-6" data-packet-contents>
        <h2 id="materials" className="mb-2 text-xl">
          What's included
        </h2>
        {v.materials ? (
          <div className="space-y-3">
            {v.materials.map((m) => (
              <Card key={m.category} title={m.label}>
                <ul className="list-disc space-y-1 pl-5">
                  {m.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        ) : (
          <Notice tone="quiet" title="No longer available">
            <p>This packet included: {v.manifest.join("; ")}. Its contents can't be opened any more.</p>
          </Notice>
        )}
      </section>

      <Notice tone="quiet" title="For your use only">
        <p>
          This was shared with you for the purpose above, until the date above. Zeporah doesn't offer a
          download, print copy or forwarding, and printing this page shows nothing. It can't stop a screenshot
          — please don't take one or pass this on.
        </p>
      </Notice>

      {active && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card title="Received it?">
            {v.acknowledgedAt ? (
              <p>
                You acknowledged it <Stamp at={v.acknowledgedAt} />.
              </p>
            ) : (
              <Button
                disabled={pending}
                onClick={async () => {
                  const r = await act(
                    () => acknowledgePacket({ data: { packetId: v.id } }),
                    "Thank you — the hospice can see you received it.",
                  );
                  if (r) await router.invalidate();
                }}
              >
                Acknowledge receipt
              </Button>
            )}
          </Card>
          <Card title="A question about it?">
            {asked ? (
              <p>Your question went to the hospice care team. They'll follow up with you.</p>
            ) : (
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await act(
                    () => requestClarification({ data: { packetId: v.id, question } }),
                    "Your question went to the hospice care team.",
                  );
                  if (r) {
                    setAsked(true);
                    setQuestion("");
                    await router.invalidate();
                  }
                }}
              >
                <Field label="Your question" hint="It goes to the hospice care team, not to the family.">
                  {(id, d) => (
                    <textarea
                      id={id}
                      aria-describedby={d}
                      rows={3}
                      maxLength={1000}
                      required
                      className={inputClass}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                    />
                  )}
                </Field>
                <Button type="submit" variant="secondary" disabled={pending || !question.trim()}>
                  Ask the hospice
                </Button>
              </form>
            )}
          </Card>
        </div>
      )}
      <ErrorText error={error} />

      <Card className="mt-6" title="Access history">
        {v.history.length ? (
          <ol className="space-y-1 text-sm">
            {v.history.map((h) => (
              <li key={h.id}>
                <Stamp at={h.at} full /> · {DID[h.action] ?? h.action}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-ink-soft">Nothing yet.</p>
        )}
      </Card>
      <div className="mt-6">
        <EmergencyNotice line={v.hotline} />
      </div>
    </>
  );
}
