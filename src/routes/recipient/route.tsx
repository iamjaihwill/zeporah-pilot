import { Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { signOut, whoAmI } from "@/functions/session";
import { Button } from "@/components/ui";

/**
 * The packet recipient's area (founder decision 45). Signed-in recipients only; the setup page
 * (a one-time link for first-time recipients) is the one page that works before sign-in.
 */
export const Route = createFileRoute("/recipient")({
  beforeLoad: async ({ location }) => {
    if (location.pathname.startsWith("/recipient/setup/")) return;
    const me = await whoAmI();
    if (!me) throw redirect({ to: "/", search: { next: location.href } });
    if (me.kind === "staff") throw redirect({ to: "/staff" });
    if (me.kind === "family") throw redirect({ to: "/family" });
  },
  component: RecipientLayout,
});

function RecipientLayout() {
  const navigate = useNavigate();
  return (
    // data-recipient: the print stylesheet hides packet contents (see styles.css).
    <div className="min-h-screen bg-paper" data-recipient>
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
      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-5 py-10">
        <Outlet />
      </main>
    </div>
  );
}
