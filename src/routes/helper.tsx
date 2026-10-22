import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { completeHelperTask, getHelperView } from "@/functions/family";
import { signOut, whoAmI } from "@/functions/session";
import { isDenied, unwrap, useAction } from "@/lib/client";
import { Button, Card, DeniedView, EmergencyNotice, ErrorText, PageHeader, Stamp } from "@/components/ui";

/**
 * A task-only helper's whole view of Zeporah (founder decision 42): the task they were asked to
 * help with and what they need to do it. No household pages, people, messages or vault.
 */
export const Route = createFileRoute("/helper")({
  beforeLoad: async ({ location }) => {
    if (!(await whoAmI())) throw redirect({ to: "/", search: { next: location.href } });
  },
  loader: async () => {
    const me = await whoAmI();
    if (!me) throw redirect({ to: "/" });
    return unwrap(await getHelperView());
  },
  component: HelperPage,
});

function HelperPage() {
  const v = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const { act, pending, error } = useAction();
  return (
    <div className="min-h-screen bg-paper">
      <header className="flex items-center justify-between border-b bg-surface px-5 py-3">
        <span className="wordmark font-display text-lg">
          Zeporah<span className="text-clay">.</span>
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            await signOut();
            await navigate({ to: "/" });
          }}
        >
          Sign out
        </Button>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-5 py-10">
        {isDenied(v) ? (
          <DeniedView d={v} />
        ) : (
          <>
            <PageHeader
              eyebrow="Helping out"
              title={v.tasks.length ? "What you're helping with" : "Nothing to help with right now"}
              lede="You can see the task you were asked to help with, and nothing else in this household."
            />
            <ErrorText error={error} />
            <ul className="space-y-3">
              {v.tasks.map((t) => (
                <Card as="li" key={t.id}>
                  <h2 className="text-lg">{t.title}</h2>
                  {t.detail && <p className="mt-1 text-ink-soft">{t.detail}</p>}
                  <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
                    {t.askedBy && (
                      <>
                        <dt className="text-ink-soft">Asked by</dt>
                        <dd>{t.askedBy}</dd>
                      </>
                    )}
                    {t.dueAt && (
                      <>
                        <dt className="text-ink-soft">Due</dt>
                        <dd>
                          <Stamp at={t.dueAt} />
                        </dd>
                      </>
                    )}
                    <dt className="text-ink-soft">Your access</dt>
                    <dd>
                      Ends when this is done
                      {t.accessEndsAt ? (
                        <>
                          {" "}
                          or on <Stamp at={t.accessEndsAt} />, whichever comes first
                        </>
                      ) : null}
                      .
                    </dd>
                  </dl>
                  <div className="mt-4">
                    <Button
                      disabled={pending}
                      onClick={async () => {
                        const r = await act(
                          () => completeHelperTask({ data: { id: t.id } }),
                          "Thank you — marked done.",
                        );
                        if (r) await router.invalidate();
                      }}
                    >
                      Mark done<span className="sr-only">: {t.title}</span>
                    </Button>
                  </div>
                  <div className="mt-4">
                    <EmergencyNotice line={t.hotline} />
                  </div>
                </Card>
              ))}
            </ul>
            {!v.tasks.length && (
              <p className="text-ink-soft">
                If you were asked to help with something, it may already be done, or your access may have
                ended.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
