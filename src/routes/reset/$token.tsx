import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { checkResetLink, completePasswordReset } from "@/functions/session";
import { AppFooter } from "@/components/footer";
import { Button, ErrorText, Field, Notice, inputClass } from "@/components/ui";
import { announce } from "@/lib/client";

/** Set a new password from an emailed reset link (founder decision 27). Single use, 30 minutes. */
export const Route = createFileRoute("/reset/$token")({
  head: () => ({ meta: [{ title: "Choose a new password — Zeporah" }] }),
  loader: async ({ params }) => checkResetLink({ data: { token: params.token } }),
  component: Reset,
});

function Reset() {
  const link = Route.useLoaderData();
  const { token } = Route.useParams();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-[30rem] px-5 py-10 sm:py-14">
      <Link to="/" className="font-display text-2xl">
        Zeporah<span className="text-clay">.</span>
      </Link>
      <h1 className="mt-10 text-3xl">Choose a new password</h1>
      {!link.ok ? (
        <div className="mt-6 space-y-4">
          <Notice tone="quiet" title="This link can't be used">
            {link.message}
          </Notice>
          <p>
            <Link to="/forgot-password" className="text-harbor underline-offset-2 hover:underline">
              Ask for a new link
            </Link>
          </p>
        </div>
      ) : done ? (
        <div className="mt-6 space-y-4" role="status">
          <Notice tone="quiet" title="Your password was changed">
            You've been signed out everywhere, including on other devices. Sign in with your new password.
          </Notice>
          <p>
            <Link to="/" className="text-harbor underline-offset-2 hover:underline">
              Go to sign in
            </Link>
          </p>
        </div>
      ) : (
        <form
          className="mt-6 space-y-4"
          aria-label="Choose a new password"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setError(null);
            const r = await completePasswordReset({ data: { token, password } });
            setPending(false);
            if (!r.ok) {
              setError(r.message);
              announce(r.message, "problem");
              return;
            }
            setPassword("");
            setDone(true);
            announce("Your password was changed. Sign in with your new password.");
          }}
        >
          <p>This signs you out on every device. Then you can sign in with the new password.</p>
          <Field label="New password" hint="At least 12 characters.">
            {(id, d) => (
              <div className="flex items-stretch gap-2">
                <input
                  id={id}
                  aria-describedby={d}
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  className={inputClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  variant="secondary"
                  aria-pressed={show}
                  aria-controls={id}
                  onClick={() => setShow((v) => !v)}
                  className="shrink-0"
                >
                  {show ? "Hide" : "Show"}
                  <span className="sr-only"> password</span>
                </Button>
              </div>
            )}
          </Field>
          <ErrorText error={error} />
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Save new password"}
          </Button>
        </form>
      )}
      <AppFooter />
    </main>
  );
}
