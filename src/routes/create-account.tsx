import { Link, createFileRoute } from "@tanstack/react-router";
import { ButtonLink, Card, EmergencyNotice, PageHeader } from "@/components/ui";
import { AppFooter } from "@/components/footer";

/**
 * "Create account" from the family sign-in (founder decision 52). There's no self sign-up:
 * accounts come from an invitation link, so this page explains how to get one.
 */
export const Route = createFileRoute("/create-account")({ component: CreateAccount });

function CreateAccount() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
      <p className="font-display text-3xl">
        Zeporah<span className="text-clay">.</span>
      </p>
      <PageHeader
        eyebrow="Create account"
        title="You join Zeporah through an invitation"
        lede="Accounts are created from an invitation link, so the right people see the right household — and nobody else."
      />
      <Card>
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <strong>Ask for an invitation.</strong> In a household already using Zeporah, the coordinator or
            the patient can invite family members and helpers. If your household isn't set up yet, ask your
            hospice care team.
          </li>
          <li>
            <strong>Open the link you're sent.</strong> It works once, only with the email address it names,
            and expires after 7 days.
          </li>
          <li>
            <strong>Choose a password.</strong> That's your account. Next time, sign in with that email and
            password.
          </li>
        </ol>
        <p className="mt-4 text-ink-soft">Can't find your invite? Ask your care guide to resend it.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink to="/">Back to sign in</ButtonLink>
        </div>
      </Card>
      <p className="mt-6 text-ink-soft">
        Hospice staff join through an invitation from their hospice too.{" "}
        <Link to="/staff-sign-in" className="text-harbor underline underline-offset-2">
          Care-team sign-in
        </Link>
      </p>
      <div className="mt-8">
        <EmergencyNotice tone="harbor" />
      </div>
      <AppFooter />
    </main>
  );
}
