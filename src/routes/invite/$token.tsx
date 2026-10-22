import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { acceptInvitation, getInvitation } from "@/functions/session";
import { ButtonLink, Button, ErrorText, Field, inputClass } from "@/components/ui";
import { AppFooter } from "@/components/footer";
import { announce } from "@/lib/client";

/**
 * Accepting an invitation. The page shows only the hospice, the role, who invited them and the
 * email that will be used; anything wrong with the link gets one generic message. The request
 * sends just the token, a display name and a password — the household or organization and the
 * role come from the stored invitation.
 */
export const Route = createFileRoute("/invite/$token")({
  loader: async ({ params }) => getInvitation({ data: { token: params.token } }),
  head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
  component: Accept,
});

function Accept() {
  const r = Route.useLoaderData();
  const { token } = Route.useParams();
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-xl px-5 py-10 sm:py-14">
      <p className="font-display text-2xl">
        Zeporah<span className="text-clay">.</span>
      </p>
      {r.ok ? (
        <AcceptForm token={token} invitation={r.invitation} />
      ) : (
        <>
          <h1 className="mt-8 text-3xl">This invitation can't be used</h1>
          <p className="mt-3 text-ink-soft">{r.message}</p>
          <ButtonLink className="mt-6" to="/" variant="secondary">
            Go to sign in
          </ButtonLink>
        </>
      )}
      <AppFooter />
    </main>
  );
}

type Preview = Extract<Awaited<ReturnType<typeof getInvitation>>, { ok: true }>["invitation"];

function AcceptForm({ token, invitation: i }: { token: string; invitation: Preview }) {
  const navigate = useNavigate();
  const [name, setName] = useState(i.inviteeName);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const creating = !i.hasAccount;
  return (
    <>
      <h1 className="mt-8 text-3xl">Join {i.organization} on Zeporah</h1>
      <p className="mt-3 text-ink-soft">
        {i.invitedBy ? `${i.invitedBy} invited you` : "You've been invited"} to join as{" "}
        <strong>
          {i.kind === "staff" ? `a ${i.role.toLowerCase()}` : `a ${i.role.toLowerCase()} in a household`}
        </strong>
        .{i.kind === "family" ? " You'll see the household's name once you've joined." : ""}
      </p>
      <form
        className="mt-6 space-y-4"
        aria-label={creating ? "Create your account" : "Sign in to accept"}
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (creating && password !== confirm) {
            setError("The two passwords don't match.");
            announce("The two passwords don't match.", "problem");
            return;
          }
          setPending(true);
          const r = await acceptInvitation({ data: { token, displayName: name, password } });
          setPending(false);
          if (!r.ok) {
            setError(r.message);
            announce(r.message, "problem");
            return;
          }
          announce("You've joined. Welcome to Zeporah.");
          await navigate({ to: r.kind === "family" ? "/family" : "/staff" });
        }}
      >
        <Field label="Email" hint="Your invitation is for this email address. It can't be changed here.">
          {(id, d) => (
            <input
              id={id}
              aria-describedby={d}
              type="email"
              autoComplete="username"
              readOnly
              className={inputClass}
              value={i.email}
            />
          )}
        </Field>
        {creating ? (
          <>
            <Field label="Your name" hint="How others in Zeporah will see you.">
              {(id, d) => (
                <input
                  id={id}
                  aria-describedby={d}
                  required
                  maxLength={120}
                  autoComplete="name"
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Create a password"
              hint="At least 12 characters. Don't reuse a password from another account."
            >
              {(id, d) => (
                <input
                  id={id}
                  aria-describedby={d}
                  type="password"
                  required
                  minLength={12}
                  maxLength={200}
                  autoComplete="new-password"
                  className={inputClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Field label="Confirm the password">
              {(id) => (
                <input
                  id={id}
                  type="password"
                  required
                  autoComplete="new-password"
                  className={inputClass}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
            </Field>
          </>
        ) : (
          <Field
            label="Your password"
            hint="You already have a Zeporah account with this email. Sign in to accept."
          >
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                type="password"
                required
                autoComplete="current-password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
        )}
        <ErrorText error={error} />
        <Button type="submit" disabled={pending}>
          {pending ? "Joining…" : creating ? "Create account and join" : "Sign in and join"}
        </Button>
      </form>
    </>
  );
}
