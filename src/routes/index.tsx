import { z } from "zod";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  getAuthOptions,
  listPersonas,
  resetSyntheticData,
  signIn,
  signOut,
  whoAmI,
} from "@/functions/session";
import { Badge, Button, ButtonLink, Card, ConfirmDialog, EmergencyNotice, ErrorText } from "@/components/ui";
import { announce, cx } from "@/lib/client";
import { AppFooter } from "@/components/footer";
import { SignInForm, SupportIcon, homeFor } from "@/components/sign-in-form";
import { safeReturnPath } from "@/domain/sign-in";
import { SEED_SNAPSHOTS, SEED_SNAPSHOT_LABELS, type SeedSnapshot } from "@/fixtures/demo-week";

export const Route = createFileRoute("/")({
  // ?next=: the page someone was sent here from (checked before use: domain/sign-in.ts).
  validateSearch: z.object({ next: z.string().max(500).optional() }),
  loader: async () => ({
    personas: await listPersonas(),
    options: await getAuthOptions(),
    me: await whoAmI(),
  }),
  component: Start,
});

const PhoneIcon = () => (
  <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </svg>
);

/**
 * Portrait tablets (768–1023px) get the same photograph as a short tinted banner with a curved
 * lower edge; phones keep the form alone, and wider screens show the side panel. Decorative only.
 */
function Banner() {
  return (
    <div aria-hidden className="relative hidden h-64 overflow-hidden bg-harbor-strong md:block lg:hidden">
      <img
        src="/images/sign-in-couple-1024.jpg"
        alt=""
        // Lazy: a hidden image (phones) is never fetched.
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover object-[50%_18%] mix-blend-luminosity"
      />
      <div className="absolute inset-0 bg-harbor-strong/45" />
      <svg
        viewBox="0 0 800 60"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-0 h-10 w-full"
      >
        <path d="M0 60 L 0 30 C 200 0, 420 55, 800 20 L 800 60 Z" fill="var(--color-paper)" />
      </svg>
    </div>
  );
}

/**
 * The left-hand panel: a licensed photograph (founder decision 50; see
 * public/images/sign-in-couple.LICENSE.md) under a soft tint, with a curved edge. Decorative only.
 */
function Visual() {
  return (
    <div aria-hidden className="relative hidden overflow-hidden bg-harbor-strong lg:block">
      <img
        src="/images/sign-in-couple.jpg"
        alt=""
        // Lazy: a hidden image (phones, portrait tablets) is never fetched.
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover object-[50%_40%] mix-blend-luminosity"
      />
      {/* A tint in the brand colour, as in the mock-up, so the photo stays calm behind the text. */}
      <div className="absolute inset-0 bg-harbor-strong/45" />
      <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-harbor-strong/80 to-transparent" />
      {/* The curved edge into the sign-in column. */}
      <svg viewBox="0 0 80 900" preserveAspectRatio="none" className="absolute inset-y-0 right-0 h-full w-20">
        <path
          d="M80 0 L 30 0 C 70 220, 0 420, 40 640 C 60 760, 20 840, 30 900 L 80 900 Z"
          fill="var(--color-paper)"
        />
      </svg>
      <p className="absolute top-10 left-10 max-w-xs font-display text-2xl leading-snug text-paper">
        Clear next steps for hospice teams and the families they care for.
      </p>
    </div>
  );
}

function Start() {
  const { personas, options, me } = Route.useLoaderData();
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SeedSnapshot>("standard");
  const groups = [
    {
      title: "Household members",
      anchor: "dev-family",
      hint: "The family app — works on phones and computers.",
      list: personas.filter((p) => p.kind === "family"),
      cols: "sm:grid-cols-2",
    },
    {
      title: "Willow Creek care team",
      anchor: "dev-staff",
      hint: "The staff workspace — built for desktop and tablet.",
      list: personas.filter((p) => p.kind === "staff" && p.tenantId === "t-willow"),
      cols: "sm:grid-cols-2",
    },
    {
      title: "Outside recipients",
      anchor: "dev-recipients",
      hint: "Someone a hospice shares a packet with — reads it in Zeporah, read-only.",
      list: personas.filter((p) => p.kind === "recipient"),
      cols: "sm:grid-cols-2",
    },
    {
      title: "A different hospice",
      anchor: "dev-other-hospice",
      hint: "Used to check that one hospice can never see another's households.",
      list: personas.filter((p) => p.tenantId !== "t-willow" && p.kind !== "recipient"),
      cols: "sm:grid-cols-2",
    },
  ];

  async function go(actorId: string, tenantId: string) {
    setBusy(actorId);
    const r = await signIn({ data: { actorId, tenantId } });
    const back = safeReturnPath(next, r.kind);
    if (back) await navigate({ href: back });
    else await navigate({ to: homeFor(r.kind) });
  }

  const signInBlock = (
    <div className="mx-auto w-full max-w-[26rem]">
      {/* As in the reference mock-up: the wordmark and tagline lead; the page's heading is "Sign in". */}
      <div className="text-center">
        <h1 className="font-display text-5xl tracking-tight">
          Zeporah<span className="text-clay">.</span>
          <span className="sr-only"> Sign in</span>
        </h1>
        <p className="mt-2 text-lg text-harbor-strong">Hospice coordination, in one clear place</p>
      </div>
      {me ? (
        <Card className="mt-6" tone="harbor">
          <p>
            You're signed in as <strong>{me.name}</strong> ({me.roles.join(", ")}).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink to={homeFor(me.kind)}>Continue</ButtonLink>
            <Button
              variant="secondary"
              onClick={async () => {
                await signOut();
                announce("Signed out.");
                await router.invalidate();
              }}
            >
              Sign out
            </Button>
          </div>
        </Card>
      ) : (
        <div className="mt-8">
          <SignInForm
            audience="family"
            next={next}
            offerRemember
            forgot={
              <Link to="/forgot-password" className="text-harbor underline underline-offset-2">
                Forgot password?
              </Link>
            }
            footnote={
              <>
                {/* Decision 54, right under the button so it's read before signing in. */}
                <p className="-mt-1 text-sm">
                  By signing in, you agree to the{" "}
                  <Link
                    to="/info/$page"
                    params={{ page: "terms" }}
                    className="text-harbor underline underline-offset-2"
                  >
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link
                    to="/info/$page"
                    params={{ page: "privacy" }}
                    className="text-harbor underline underline-offset-2"
                  >
                    Privacy Policy
                  </Link>
                  .
                </p>
                {/* Decision 19: the "Not for emergencies" notice, kept above the fold, right under Sign in. */}
                <div className="mt-5 mb-6 text-left text-ink">
                  <EmergencyNotice tone="harbor" />
                </div>
                <p className="text-ink">
                  Don't have an account?{" "}
                  <Link
                    to="/create-account"
                    className="font-semibold text-harbor underline underline-offset-2"
                  >
                    Create account
                  </Link>
                </p>
                <p className="mt-1 text-sm">Can't find your invite? Ask your care guide to resend it.</p>
                {/* Decision 51: no store badges until an app is published; plain text, not a button. */}
                <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-ink-soft">
                  <PhoneIcon />
                  iPhone and Android apps are on the way
                </p>
                <p className="mt-3 text-sm">
                  Hospice staff?{" "}
                  <Link to="/staff-sign-in" className="text-harbor underline underline-offset-2">
                    Care-team sign-in
                  </Link>
                </p>
              </>
            }
          />
        </div>
      )}
      <p className="mt-6 text-center">
        <Link
          to="/info/$page"
          params={{ page: "support" }}
          className="inline-flex items-center gap-2 text-harbor underline-offset-2 hover:underline"
        >
          <SupportIcon />
          Get support
        </Link>
      </p>
      <AppFooter compact />
      {/* Shown signed in too: a walkthrough switches persona many times (demo rehearsal, S-2). */}
      {options.devSignIn && (
        <p className="mt-4 text-center text-sm">
          Development only: jump to synthetic personas ↓{" "}
          <span className="inline-flex flex-wrap justify-center gap-x-3">
            <a
              href="#dev-family"
              className="inline-flex min-h-6 items-center text-harbor underline-offset-2 hover:underline"
            >
              Household
            </a>
            <a
              href="#dev-staff"
              className="inline-flex min-h-6 items-center text-harbor underline-offset-2 hover:underline"
            >
              Care team
            </a>
            <a
              href="#dev-recipients"
              className="inline-flex min-h-6 items-center text-harbor underline-offset-2 hover:underline"
            >
              Recipients
            </a>
          </span>
        </p>
      )}
    </div>
  );

  return (
    <main id="main" tabIndex={-1}>
      <div className="grid min-h-[calc(100vh-2.25rem)] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Visual />
        <div className="flex flex-col">
          <Banner />
          <div className="flex flex-1 flex-col justify-center px-5 py-10 sm:py-14 md:max-lg:pt-8">
            {signInBlock}
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-5">
        {options.devSignIn && (
          <div className="border-t pt-10">
            <section aria-labelledby="dev-personas">
              <h2 id="dev-personas" className="text-2xl">
                Development only: sign in as a synthetic persona
              </h2>
              <p className="mt-1 text-ink-soft">
                This shortcut exists only on this development server (it's turned on with
                ZEPORAH_DEV_SIGN_IN=1) so the synthetic walkthrough doesn't need real accounts. Persona
                sessions have no password.
              </p>
              {groups.map((g) => (
                <section
                  key={g.title}
                  id={g.anchor}
                  className="mt-8 scroll-mt-4"
                  aria-labelledby={`g-${g.title}`}
                >
                  <h3 id={`g-${g.title}`} className="text-xl">
                    {g.title}
                  </h3>
                  <p className="text-ink-soft">{g.hint}</p>
                  <ul className={cx("mt-4 grid gap-3", g.cols)}>
                    {g.list.map((p) => (
                      <li key={p.actorId}>
                        <button
                          type="button"
                          onClick={() => go(p.actorId, p.tenantId)}
                          disabled={!!busy}
                          className="group flex h-full w-full flex-col items-start rounded-[var(--radius-card)] border bg-surface p-4 text-left shadow-[var(--shadow-card)] hover:border-harbor hover:bg-harbor-soft/40 disabled:opacity-60"
                          aria-label={`Sign in as ${p.name}`}
                          aria-describedby={`persona-${p.actorId}`}
                        >
                          <span className="flex w-full items-start justify-between gap-2">
                            <span className="font-display text-lg">{p.name}</span>
                            <span aria-hidden className="text-sm font-medium text-harbor">
                              Sign in →
                            </span>
                          </span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            {p.roles.map((r) => (
                              <Badge key={r} tone="harbor">
                                {r}
                              </Badge>
                            ))}
                            {p.tenantId !== "t-willow" && <Badge tone="neutral">{p.tenant}</Badge>}
                          </span>
                          <span id={`persona-${p.actorId}`} className="mt-2 text-sm text-ink-soft">
                            {p.blurb}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </section>

            <section className="mt-12 border-t pt-6" aria-labelledby="mail-sink">
              <h2 id="mail-sink" className="text-xl">
                Mail sink
              </h2>
              <p className="mt-1 text-ink-soft">
                Development only. Email notices and password-reset links are kept here instead of being sent.{" "}
                <Link to="/dev/mail" className="text-harbor underline underline-offset-2">
                  Open the mail sink
                </Link>
              </p>
            </section>

            <section className="mt-8 border-t pt-6" aria-labelledby="reset">
              <h2 id="reset" className="text-xl">
                Reset synthetic data
              </h2>
              <p className="mt-1 text-ink-soft">
                Development only. Resets the local development database to the current synthetic seed and
                signs everyone out. Never use it against a non-synthetic environment.
              </p>
              <div className="mt-3">
                <ConfirmDialog
                  title="Reset synthetic data?"
                  confirmLabel="Reset synthetic data"
                  tone="danger"
                  disabled={busy === "reset"}
                  trigger={(open) => (
                    <Button variant="danger" onClick={open} disabled={busy === "reset"}>
                      {busy === "reset" ? "Resetting…" : "Reset synthetic data…"}
                    </Button>
                  )}
                  onConfirm={async () => {
                    setBusy("reset");
                    await resetSyntheticData({ data: { snapshot } });
                    setBusy(null);
                    announce("Synthetic data was reset.");
                    await router.invalidate();
                    return true;
                  }}
                >
                  <p>
                    This deletes everything in the local development database — including anything created
                    during a walkthrough — reloads the synthetic seed, and signs everyone out. It can't be
                    undone.
                  </p>
                  <fieldset className="mt-3 space-y-1">
                    <legend className="font-medium">Load</legend>
                    {SEED_SNAPSHOTS.map((k) => (
                      <label key={k} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="snapshot"
                          value={k}
                          checked={snapshot === k}
                          onChange={() => setSnapshot(k)}
                        />
                        {SEED_SNAPSHOT_LABELS[k]}
                      </label>
                    ))}
                  </fieldset>
                </ConfirmDialog>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
