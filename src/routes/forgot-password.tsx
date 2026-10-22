import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { getAuthOptions, requestPasswordReset } from "@/functions/session";
import { AppFooter } from "@/components/footer";
import { Button, ErrorText, Field, Notice, inputClass } from "@/components/ui";
import { announce } from "@/lib/client";

/**
 * "Forgot password?" Family accounts can get a single-use reset link by email (founder decision
 * 27) where a mail channel exists. The care team's new invitation link is always the fallback, and
 * the only path for proxies and care-team accounts (decision 9) — or anyone where email isn't
 * available (decision 20's guidance).
 */
export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot your password? — Zeporah" }] }),
  loader: async () => getAuthOptions(),
  component: Forgot,
});

function Forgot() {
  const { passwordReset } = Route.useLoaderData();
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-[30rem] px-5 py-10 sm:py-14">
      <Link to="/" className="font-display text-2xl">
        Zeporah<span className="text-clay">.</span>
      </Link>
      <h1 className="mt-10 text-3xl">Forgot your password?</h1>
      {passwordReset ? <ResetRequest /> : null}
      {passwordReset && <h2 className="mt-10 text-xl">Or ask your care team</h2>}
      <p className="mt-4">
        Ask your care guide, or your household's coordinator, to send you a new invitation link. Opening it
        lets you set a new password and keeps your account and everything in it.
      </p>
      <div className="mt-6">
        {passwordReset ? (
          <Notice tone="quiet" title="Who can use the email link">
            Household members can. Proxies and care-team members get a new invitation link from their care
            team instead.
          </Notice>
        ) : (
          <Notice tone="quiet" title="Why there's no reset email">
            Zeporah doesn't send email here, so it can't send a reset link. Your care team can help straight
            away.
          </Notice>
        )}
      </div>
      <p className="mt-8">
        <Link to="/" className="text-harbor underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      </p>
      <AppFooter />
    </main>
  );
}

function ResetRequest() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (done)
    return (
      <div className="mt-6" role="status">
        <Notice tone="quiet" title="Check your email">
          {done}
        </Notice>
      </div>
    );
  return (
    <form
      className="mt-6 space-y-4"
      aria-label="Email me a reset link"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await requestPasswordReset({ data: { email } });
        setPending(false);
        if (!r.ok) {
          setError(r.message);
          announce(r.message, "problem");
          return;
        }
        setDone(r.message ?? "");
        announce(r.message ?? "");
      }}
    >
      <p>
        Enter the email you sign in with. If it belongs to a household account, a reset link is sent to it.
      </p>
      <Field label="Email">
        {(id) => (
          <input
            id={id}
            type="email"
            autoComplete="username"
            required
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>
      <ErrorText error={error} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Email me a reset link"}
      </Button>
    </form>
  );
}
