import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { cancelInvitation, finishContactsStep, finishVaultStep, getOnboarding } from "@/functions/family";
import { isDenied, unwrap, useAction, cx } from "@/lib/client";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DeniedView,
  ErrorText,
  Notice,
  PageHeader,
  StateBadge,
} from "@/components/ui";
import { CommunicationForm, DEFAULT_PREFS, InviteForm, PreferencesForm } from "@/components/forms";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/domain/model";

export const Route = createFileRoute("/family/onboarding")({
  validateSearch: z.object({ step: z.enum(ONBOARDING_STEPS).optional() }),
  loader: async () => unwrap(await getOnboarding()),
  component: Onboarding,
});

const INTRO: Record<OnboardingStep, { title: string; lede: string }> = {
  preferences: {
    title: "Make Zeporah easier to use",
    lede: "Choose a language, text size and how you'd like to be reached. You can change these later.",
  },
  trusted_contacts: {
    title: "Who else should be part of this?",
    lede: "Invite people you trust. Each person sees only what their role allows — you can review exactly what before anyone is added.",
  },
  communication: {
    title: "How should we keep you posted?",
    lede: "Choose how often you hear about updates. This also turns on messages with your care guide.",
  },
  vault_review: {
    title: "Your starter vault",
    lede: "These are common items families keep track of. Mark what you know — where something is kept, or that it doesn't apply. Zeporah never stores the documents.",
  },
};

function Onboarding() {
  const data = Route.useLoaderData();
  const { step: asked } = Route.useSearch();
  const navigate = useNavigate();
  const { act, pending, error } = useAction();
  if (isDenied(data)) return <DeniedView d={data} />;
  if (!data.canComplete)
    return (
      <>
        <PageHeader
          title="Setup"
          lede="Your household coordinator sets up the household space. You'll see everything that's shared with you as it's ready."
        />
        <ButtonLink to="/family">Back to home</ButtonLink>
      </>
    );
  const step: OnboardingStep = asked ?? data.next ?? "vault_review";
  const idx = ONBOARDING_STEPS.indexOf(step);
  const go = (s: OnboardingStep | null) =>
    s ? navigate({ to: "/family/onboarding", search: { step: s } }) : navigate({ to: "/family" });
  const nextAfter = (s: OnboardingStep) => ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(s) + 1] ?? null;
  const prefs = { ...DEFAULT_PREFS, ...data.prefDefaults, ...(data.prefs ?? {}) };

  return (
    <>
      <PageHeader
        eyebrow={`Setup · step ${idx + 1} of 4`}
        title={INTRO[step].title}
        lede={INTRO[step].lede}
      />
      <nav aria-label="Setup steps" className="mb-8">
        <ol className="grid gap-2 sm:grid-cols-4">
          {data.steps.map((s, i) => (
            <li key={s.step}>
              <Link
                to="/family/onboarding"
                search={{ step: s.step }}
                aria-current={s.step === step ? "step" : undefined}
                className={cx(
                  "flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  s.step === step ? "border-harbor bg-harbor-soft font-semibold" : "bg-surface",
                )}
              >
                <span aria-hidden className={s.done ? "text-moss" : "text-ink-faint"}>
                  {s.done ? "✓" : i + 1}
                </span>
                {s.label}
                <span className="sr-only">{s.done ? " (done)" : " (not done yet)"}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {data.complete && (
        <div className="mb-6">
          <Notice tone="harbor" title="Setup is done">
            Everything is turned on. You can still change any of these.{" "}
            <Link to="/family">Go to your household home</Link>
          </Notice>
        </div>
      )}

      {step === "preferences" && (
        <div className="mb-6">
          <Notice tone="quiet" title="What Zeporah is for">
            <p>
              A shared space between your household and your hospice care team: updates, tasks, messages with
              your care guide, a record of which papers exist and where, and any sharing outside your
              household — each person seeing only what their role allows.
            </p>
            <p className="mt-2">
              It isn't a medical record, a place to store documents, a meal or visitor calendar, or a way to
              reach someone in an emergency. If your family already uses another app to organize meals or keep
              friends updated, keep using it — Zeporah is for working with your care team.
            </p>
          </Notice>
        </div>
      )}
      {step === "preferences" && (
        <Card>
          <PreferencesForm
            initial={prefs}
            submitLabel="Save and continue"
            onSaved={() => go("trusted_contacts")}
            email={data.email}
          />
        </Card>
      )}

      {step === "trusted_contacts" && (
        <div className="space-y-6">
          <Card title="Already part of your household">
            <ul className="space-y-2">
              {data.members.map((m) => (
                <li key={m.name}>
                  <span className="font-medium">{m.name}</span>{" "}
                  <span className="text-ink-soft">· {m.roles.join(", ")}</span>
                </li>
              ))}
            </ul>
            {data.invitations.length > 0 && (
              <>
                <h3 className="mt-5 mb-2 font-sans text-sm font-semibold tracking-wide text-ink-soft uppercase">
                  Invitations
                </h3>
                <ul className="space-y-2">
                  {data.invitations.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{i.name}</span>
                      <span className="text-ink-soft">· {i.role}</span>
                      <StateBadge state={i.status} />
                      {i.status === "pending" && (
                        <Button
                          size="sm"
                          variant="quiet"
                          disabled={pending}
                          onClick={() =>
                            act(
                              () => cancelInvitation({ data: { id: i.id } }),
                              `The invitation to ${i.name} was cancelled.`,
                            )
                          }
                        >
                          Cancel
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-ink-soft">
                  Zeporah doesn't send invitations itself. Each one gives you a one-time link to share with
                  the person.
                </p>
              </>
            )}
          </Card>
          <InviteForm />
          <ErrorText error={error} />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              onClick={async () =>
                (await act(() => finishContactsStep(), "Trusted contacts step done.")) &&
                go(nextAfter("trusted_contacts"))
              }
            >
              {data.invitations.length ? "Continue" : "Continue without inviting anyone"}
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={async () =>
                (await act(() => finishContactsStep(), "You can invite people later from People.")) &&
                go(nextAfter("trusted_contacts"))
              }
            >
              I'll do this later
            </Button>
          </div>
        </div>
      )}

      {step === "communication" && (
        <Card>
          <CommunicationForm
            initial={prefs}
            submitLabel="Save and continue"
            onSaved={() => go("vault_review")}
            email={data.email}
          />
        </Card>
      )}

      {step === "vault_review" && (
        <div className="space-y-6">
          <Card title="Starter items">
            <ul className="divide-y">
              {data.starterVault.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{v.title}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <StateBadge state={v.status} />
                      {v.sensitivity === "protected" && <Badge tone="clay">Protected</Badge>}
                    </div>
                  </div>
                  <ButtonLink
                    to="/family/vault/$itemId"
                    params={{ itemId: v.id }}
                    search={{ from: "onboarding" }}
                    variant="secondary"
                    size="sm"
                  >
                    {v.status === "needs_review" ? "Review" : "Change"}
                  </ButtonLink>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-ink-soft">
              You don't need to finish every item now. Anything you leave stays here for later.
            </p>
          </Card>
          <ErrorText error={error} />
          <Button
            disabled={pending}
            onClick={async () => (await act(() => finishVaultStep(), "Setup is complete.")) && go(null)}
          >
            Finish setup
          </Button>
        </div>
      )}
    </>
  );
}
