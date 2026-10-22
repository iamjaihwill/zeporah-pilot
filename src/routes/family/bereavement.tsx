import { createFileRoute } from "@tanstack/react-router";
import { confirmSurvivingContact, getBereavement, setContactPause } from "@/functions/family";
import { dateOnly, isDenied, unwrap, useAction } from "@/lib/client";
import { Badge, Button, ButtonLink, Card, DeniedView, ErrorText, Notice, PageHeader } from "@/components/ui";

export const Route = createFileRoute("/family/bereavement")({
  loader: async () => unwrap(await getBereavement()),
  component: Bereavement,
});

function Bereavement() {
  const b = Route.useLoaderData();
  const { act, pending, error } = useAction();
  if (isDenied(b)) return <DeniedView d={b} />;
  if (b.lifecycle !== "bereavement" || !b.transition)
    return (
      <>
        <PageHeader
          title="Continuing support"
          lede="This page is used if your household moves to bereavement support. Nothing here applies right now."
        />
        <ButtonLink to="/family">Back to home</ButtonLink>
      </>
    );
  const t = b.transition;
  return (
    <>
      <PageHeader
        eyebrow="Continuing support"
        title="We're still here"
        lede={`Your care team updated your household space on ${t.confirmedAt ? dateOnly(t.confirmedAt) : "a recent date"}. There's nothing you need to do today.`}
      />
      <div className="space-y-6">
        {t.isMe && !t.contactConfirmedAt && (
          <Card tone="harbor" title="Are you the main contact going forward?">
            <p className="text-ink-soft">
              Your care team has you as the person to keep in touch with. Confirming helps them reach the
              right person — it doesn't give you any new legal authority.
            </p>
            <ErrorText error={error} />
            <Button
              className="mt-4"
              disabled={pending}
              onClick={() =>
                act(() => confirmSurvivingContact(), "Thank you. You're confirmed as the main contact.")
              }
            >
              Yes, that's me
            </Button>
          </Card>
        )}
        {t.contactConfirmedAt && (
          <Notice tone="harbor">
            {t.isMe
              ? "You're the main contact for your household."
              : `${t.survivingContact ?? "Someone in your household"} is the main contact for your household.`}
          </Notice>
        )}
        {b.plan && (
          <Card title="What to expect from your care team">
            <p className="text-ink-soft">
              Your care team will check in from time to time over the 13 months after a death. They'll get in
              touch in the way you prefer; you can always tell them if you'd rather not be contacted.
            </p>
            <ol className="mt-3 space-y-1">
              {b.plan.steps.map((st) => (
                <li key={st.label} className="flex items-center gap-2">
                  {st.done ? <Badge tone="moss">Done</Badge> : <Badge tone="neutral">Planned</Badge>}
                  <span>
                    {st.label}
                    {!st.done && <span className="text-ink-soft"> · {st.when}</span>}
                  </span>
                </li>
              ))}
            </ol>
            {b.canPauseContact && (
              <div className="mt-4 rounded-lg bg-sunk p-3" data-testid="contact-pause">
                {b.contactPaused ? (
                  <>
                    <p>You've asked not to be contacted for now. Your care team can see this.</p>
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        act(
                          () => setContactPause({ data: { paused: false } }),
                          "Your care team can get in touch again.",
                        )
                      }
                    >
                      It's okay to get in touch again
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      act(
                        () => setContactPause({ data: { paused: true } }),
                        "Saved. Your care team can see you'd rather not be contacted for now.",
                      )
                    }
                  >
                    I'd rather not be contacted for now
                  </Button>
                )}
              </div>
            )}
            <p className="mt-3 text-sm text-ink-soft">
              Support through Zeporah continues until {dateOnly(b.plan.supportEndsAt)}.
            </p>
          </Card>
        )}
        <Card title="What stays the same">
          <ul className="list-disc space-y-1 pl-5 text-ink-soft">
            <li>Messages and updates with your care team</li>
            <li>Practical tasks — at whatever pace feels right, with no deadlines</li>
            <li>Support preferences and asking the care team for support</li>
            <li>
              Earlier updates, messages and tasks stay where they are, for the people who could already see
              them
            </li>
          </ul>
        </Card>
        <Card title="What changed" tone="quiet">
          <ul className="list-disc space-y-1 pl-5 text-ink-soft">
            <li>{b.patientName}'s care visits have ended.</li>
            <li>
              Some protected information is now more limited, as hospice policy requires. Your care team can
              explain what applies to you.
            </li>
            <li>
              Sharing that was set up for care visits has ended. Nothing new is shared without a new consent.
            </li>
          </ul>
        </Card>
        <div className="flex flex-wrap gap-2">
          <ButtonLink to="/family/tasks" variant="secondary">
            See practical tasks
          </ButtonLink>
          <ButtonLink to="/family/support" variant="secondary">
            Find support
          </ButtonLink>
        </div>
      </div>
    </>
  );
}
