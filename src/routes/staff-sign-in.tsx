import { z } from "zod";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getAuthOptions, whoAmI } from "@/functions/session";
import { ButtonLink, Card } from "@/components/ui";
import { AppFooter } from "@/components/footer";
import { SignInForm, SupportIcon, homeFor } from "@/components/sign-in-form";

/**
 * The care-team sign-in (the enterprise entry point). Hospice staff only: family accounts are
 * pointed to the main sign-in page and no session starts (services/auth.ts). Staff passwords are
 * reset by a new invitation from an administrator (decisions 9 and 27), not by email.
 */
export const Route = createFileRoute("/staff-sign-in")({
  // ?next=: the page someone was sent here from (checked before use: domain/sign-in.ts).
  validateSearch: z.object({ next: z.string().max(500).optional() }),
  loader: async () => ({ me: await whoAmI(), options: await getAuthOptions() }),
  component: StaffSignIn,
});

const INSIDE = [
  "Coordination queue and escalations",
  "Household records and care-team tasks",
  "Consent, authority and packet release",
  "Team, coverage, settings and reports",
];

function StaffSignIn() {
  const { me, options } = Route.useLoaderData();
  const { next } = Route.useSearch();
  return (
    // Enterprise layout (founder decision 55): the care-team photo fills the page behind a centred
    // sign-in card. Distinct from the family page's split layout.
    <main
      id="main"
      tabIndex={-1}
      className="relative isolate min-h-[calc(100vh-2.25rem)] bg-harbor-strong flex flex-col"
    >
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
        <img
          src="/images/sign-in-care-team.jpg"
          srcSet="/images/sign-in-care-team-1024.jpg 1024w, /images/sign-in-care-team.jpg 1400w"
          sizes="100vw"
          alt=""
          decoding="async"
          className="size-full object-cover object-[50%_35%] mix-blend-luminosity"
        />
        <div className="absolute inset-0 bg-harbor-strong/70" />
        {/* A darker band on the left so the description doesn't sit on top of the people. */}
        <div className="absolute inset-y-0 left-0 hidden w-[55%] bg-gradient-to-r from-harbor-strong via-harbor-strong/85 to-transparent lg:block" />
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-8 sm:py-12 lg:flex-row lg:items-start lg:justify-between lg:py-20">
        <section aria-labelledby="workspace" className="text-paper lg:max-w-md lg:pt-8">
          <p className="font-display text-4xl">
            Zeporah<span className="text-clay-soft">.</span>
          </p>
          <p id="workspace" className="mt-1 text-sm tracking-wide uppercase opacity-85">
            Care-team workspace
          </p>
          <ul className="mt-8 hidden space-y-3 text-paper lg:block">
            {INSIDE.map((x) => (
              <li key={x} className="flex gap-3">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-clay-soft" />
                {x}
              </li>
            ))}
          </ul>
          <p className="mt-8 hidden text-sm text-paper lg:block">
            Workflow coordination for hospice teams. Not a clinical record, and not monitored for emergencies.
          </p>
        </section>

        <div className="w-full rounded-2xl bg-paper p-6 shadow-xl sm:p-8 lg:max-w-[28rem]">
          <h1 className="text-2xl">Sign in to your workspace</h1>
          <p className="mt-1 text-ink-soft">
            For hospice staff. Use the email your hospice invited you with.
          </p>
          {me ? (
            <Card className="mt-6" tone="harbor">
              <p>
                You're signed in as <strong>{me.name}</strong>.
              </p>
              <div className="mt-3">
                <ButtonLink to={homeFor(me.kind)}>Continue</ButtonLink>
              </div>
            </Card>
          ) : (
            <div className="mt-6">
              <SignInForm
                audience="staff"
                next={next}
                forgot={
                  // The same "Forgot password?" link as the family page; it opens the staff path
                  // (a new invitation, decisions 9 and 27) instead of an email reset.
                  <details className="group text-right">
                    <summary className="cursor-pointer list-none text-harbor underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                      Forgot password?
                    </summary>
                    <p className="mt-2 text-left text-ink-soft">
                      Ask your hospice administrator or hospice operations for a new invitation link.
                    </p>
                  </details>
                }
                footnote={
                  <p>
                    Family member, helper or packet recipient?{" "}
                    <Link to="/" className="whitespace-nowrap text-harbor underline underline-offset-2">
                      Sign in here
                    </Link>
                  </p>
                }
              />
            </div>
          )}
          <p className="mt-5 text-center">
            <Link
              to="/info/$page"
              params={{ page: "support" }}
              className="inline-flex items-center gap-2 text-harbor underline-offset-2 hover:underline"
            >
              <SupportIcon />
              Get support
            </Link>
          </p>
        </div>
      </div>
      {/* The footer sits on the page, not in the card, so the card holds only the sign-in. */}
      <div className="px-5 pb-6">
        <AppFooter onDark />
        {options.devSignIn && (
          <p className="mt-3 text-center text-sm">
            <Link to="/" hash="dev-staff" className="text-paper underline underline-offset-2">
              Development only: sign in as a synthetic care-team persona
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
