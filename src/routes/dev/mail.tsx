import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { listDevMail, sendDueNoticesNow } from "@/functions/dev";
import { getAuthOptions } from "@/functions/session";
import { Button, EmptyState, Notice, PageHeader, Stamp } from "@/components/ui";
import { announce } from "@/lib/client";

/**
 * DEVELOPMENT ONLY: the mail sink. Every email Zeporah would send is kept here instead of being
 * delivered (founder decisions 18, 23 and 27). There is no email provider.
 */
export const Route = createFileRoute("/dev/mail")({
  head: () => ({ meta: [{ title: "Development mail sink — Zeporah" }] }),
  loader: async () => {
    const { devSignIn } = await getAuthOptions();
    return devSignIn ? { mail: await listDevMail() } : { mail: null };
  },
  component: Mail,
});

function Mail() {
  const { mail } = Route.useLoaderData();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-5 py-10">
      <Link to="/" className="font-display text-2xl">
        Zeporah<span className="text-clay">.</span>
      </Link>
      <div className="mt-8">
        <PageHeader
          eyebrow="Development only"
          title="Mail sink"
          lede="Emails Zeporah would send, kept here instead of being delivered. Nothing leaves this computer."
        />
      </div>
      {!mail ? (
        <Notice tone="quiet" title="Not available">
          The mail sink exists only on a development server with development sign-in turned on.
        </Notice>
      ) : (
        <>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              const r = await sendDueNoticesNow();
              setPending(false);
              announce(r.sent === 1 ? "1 email notice was sent." : `${r.sent} email notices were sent.`);
              await router.invalidate();
            }}
          >
            Send due email notices now
          </Button>
          <p className="mt-2 text-sm text-ink-soft">The server also checks once a minute.</p>
          {mail.length === 0 ? (
            <div className="mt-6">
              <EmptyState title="No email yet" />
            </div>
          ) : (
            <ul className="mt-6 space-y-3" aria-label="Emails, newest first">
              {mail.map((m) => (
                <li key={m.id} className="rounded-xl border bg-surface p-4" data-testid="dev-mail">
                  <p className="text-sm text-ink-soft">
                    From {m.fromName} · To {m.toEmail} · <Stamp at={m.createdAt} full />
                  </p>
                  <h2 className="mt-1 font-sans text-base font-semibold">{m.subject}</h2>
                  <p className="mt-1">{m.body}</p>
                  <p className="mt-2">
                    <a href={m.link} className="text-harbor underline-offset-2 hover:underline">
                      {m.kind === "password_reset" ? "Open the reset link" : "Open Zeporah"}
                    </a>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
