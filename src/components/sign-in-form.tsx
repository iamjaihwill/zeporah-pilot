import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { signInWithPassword } from "@/functions/session";
import { Button, ErrorText } from "@/components/ui";
import { announce } from "@/lib/client";
import { LOCK_AFTER_FAILURES, LOCK_MINUTES, safeReturnPath } from "@/domain/sign-in";

/** Where each kind of account lands after signing in. */
export const homeFor = (kind: string) =>
  kind === "family"
    ? ("/family" as const)
    : kind === "recipient"
      ? ("/recipient" as const)
      : ("/staff" as const);

const MailIcon = () => (
  <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
  </svg>
);
const EyeIcon = ({ off }: { off: boolean }) => (
  <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="m4 4 16 16" />}
  </svg>
);
export const SupportIcon = () => (
  <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h8A2.5 2.5 0 0 1 17 6.5v5a2.5 2.5 0 0 1-2.5 2.5H10l-3.5 3v-3h0A2.5 2.5 0 0 1 4 11.5Z" />
    <path d="M17 9h.5A2.5 2.5 0 0 1 20 11.5v4a2.5 2.5 0 0 1-2.5 2.5V20.5L15 18h-3.5" />
  </svg>
);

/** A text field with a leading icon or a trailing control, as one rounded box. */
const fieldBox =
  "flex h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-3.5 focus-within:border-harbor";
// The input keeps a visible focus ring of its own (not only the box's border).
const bareInput =
  "h-9 min-w-0 flex-1 rounded-md bg-transparent px-1 text-base text-ink placeholder:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor";

/**
 * The email-and-password form shared by the family and care-team sign-in pages. Each page passes
 * its audience: the server takes only that kind of account there (no session starts otherwise).
 */
export function SignInForm({
  audience,
  forgot,
  footnote,
  offerRemember = false,
  next,
}: {
  audience: "family" | "staff";
  /** What "forgot password" means on this page. */
  forgot: ReactNode;
  /** Decision 53: "Remember me" (family sign-in only). */
  offerRemember?: boolean;
  footnote: ReactNode;
  /** The page they were trying to reach; used only if it's safe (domain/sign-in.ts). */
  next?: string | undefined;
}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [remember, setRemember] = useState(false);
  const [failures, setFailures] = useState(0);
  const [goTo, setGoTo] = useState<"/" | "/staff-sign-in" | null>(null);
  // Caps Lock is a common cause of failed sign-ins (and lockouts): say so while it's on.
  const checkCaps = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"));
  return (
    <form
      className="space-y-5"
      aria-label="Sign in"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        setGoTo(null);
        const r = await signInWithPassword({ data: { email, password, audience, remember } });
        setPending(false);
        if (!r.ok) {
          setError(r.message);
          setGoTo(r.goTo ?? null);
          if (!r.goTo) setFailures((n) => n + 1);
          announce(r.message, "problem");
          return;
        }
        setPassword("");
        // Back to the page they were trying to reach, if it's theirs to see; otherwise home.
        const back = safeReturnPath(next, r.kind);
        if (back) await navigate({ href: back });
        else await navigate({ to: homeFor(r.kind) });
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="signin-email" className="block font-medium">
          Email
        </label>
        <div className={fieldBox}>
          <span className="text-ink-soft">
            <MailIcon />
          </span>
          <input
            id="signin-email"
            type="email"
            autoComplete="username"
            required
            placeholder="Enter your email"
            className={bareInput}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="signin-password" className="block font-medium">
          Password
        </label>
        <div className={fieldBox}>
          <input
            id="signin-password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="Enter password"
            className={bareInput}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={checkCaps}
            onKeyUp={checkCaps}
            onBlur={() => setCapsLock(false)}
            aria-describedby="signin-caps"
          />
          <button
            type="button"
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            aria-controls="signin-password"
            onClick={() => setShow((v) => !v)}
            className="-mr-1.5 inline-flex size-10 items-center justify-center rounded-lg text-ink-soft hover:bg-sunk hover:text-ink"
          >
            <EyeIcon off={show} />
          </button>
        </div>
        <p id="signin-caps" aria-live="polite" className="min-h-0 text-sm font-medium text-ochre">
          {capsLock ? "Caps Lock is on." : ""}
        </p>
      </div>
      {offerRemember ? (
        <div className="-mt-1 text-sm">
          <div className="flex items-center justify-between gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                aria-describedby="signin-remember-hint"
              />
              Remember me
            </label>
            {forgot}
          </div>
          <p id="signin-remember-hint" className="mt-1 text-ink-soft">
            30 days · not on shared computers
          </p>
        </div>
      ) : (
        <div className="-mt-1 text-sm">{forgot}</div>
      )}
      <ErrorText error={error} />
      {goTo && (
        <p className="-mt-3 text-sm">
          <Link to={goTo} className="font-semibold text-harbor underline underline-offset-2">
            {goTo === "/staff-sign-in" ? "Go to the care-team sign-in" : "Go to the main sign-in"}
          </Link>
        </p>
      )}
      {failures >= 3 && !goTo && (
        <p className="-mt-3 text-sm text-ink-soft">
          After {LOCK_AFTER_FAILURES} failed attempts, sign-in pauses for {LOCK_MINUTES} minutes.
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-12 w-full !rounded-full text-base">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <div className="text-center text-ink-soft">{footnote}</div>
    </form>
  );
}
