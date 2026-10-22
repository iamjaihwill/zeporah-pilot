import { Link, createFileRoute } from "@tanstack/react-router";
import { getRecipientPackets } from "@/functions/recipient";
import { isDenied, unwrap } from "@/lib/client";
import { Badge, Card, DeniedView, EmptyState, PageHeader, Stamp } from "@/components/ui";

export const Route = createFileRoute("/recipient/")({
  loader: async () => unwrap(await getRecipientPackets()),
  component: RecipientHome,
});

function RecipientHome() {
  const v = Route.useLoaderData();
  if (isDenied(v)) return <DeniedView d={v} />;
  return (
    <>
      <PageHeader
        eyebrow="Shared with you"
        title="Packets shared with you"
        lede="Read-only. Each one is shared for a stated purpose, with you only, until a set date."
      />
      {v.packets.length === 0 ? (
        <EmptyState title="Nothing shared with you right now">
          When a hospice shares a packet with you, it will appear here.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {v.packets.map((p) => (
            <Card as="li" key={p.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg">
                    <Link
                      to="/recipient/packets/$packetId"
                      params={{ packetId: p.id }}
                      className="text-harbor underline-offset-2 hover:underline"
                    >
                      {p.purpose}
                    </Link>
                  </h2>
                  <p className="text-sm text-ink-soft">
                    From {p.from} · for {p.recipientName}
                  </p>
                </div>
                <Badge tone={p.status === "active" ? "moss" : "neutral"}>{p.statusText}</Badge>
              </div>
              <p className="mt-2 text-sm">
                {p.status === "active" ? "Available until " : "Was available until "}
                <Stamp at={p.expiresAt} full />
                {p.acknowledged && " · You acknowledged it"}
              </p>
            </Card>
          ))}
        </ul>
      )}
    </>
  );
}
