import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import appCss from "../styles.css?url";
import { LiveRegion } from "@/components/ui";
import { SystemNotice } from "@/components/system-notice";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Zeporah — synthetic pilot prototype" },
      {
        name: "description",
        content: "Hospice coordination pilot prototype. Development environment with synthetic data only.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: Shell,
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="mx-auto max-w-xl px-5 py-16">
      <h1 className="text-3xl">This page isn't here</h1>
      <p className="mt-2 text-ink-soft">The link may be old. Nothing has been changed.</p>
      <Link to="/" className="mt-6 inline-block text-harbor underline">
        Go to the start page
      </Link>
    </main>
  ),
  errorComponent: ({ error }) => <UnexpectedError error={error} />,
});

/** Marks the page as interactive (used by end-to-end tests so they never click before React is ready). */
function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset["hydrated"] = "true";
  }, []);
  return null;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only z-50 rounded-lg bg-harbor px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to main content
        </a>
        <div
          role="note"
          className="border-b border-ochre/30 bg-ochre-soft px-4 py-1.5 text-center text-xs text-ochre sm:text-sm"
        >
          <strong>Synthetic pilot prototype</strong> · development environment · every person and record here
          is made up · not for real patient information or emergencies
        </div>
        <SystemNotice />
        {children}
        <LiveRegion />
        <HydrationMarker />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * A page that crashed while rendering. One message and one reference: the same reference is
 * written to the console (and the server's output when it happens during server rendering) with
 * the error, which is never shown on screen (it can quote internal details).
 */
function UnexpectedError({ error }: { error: unknown }) {
  // Derived from the error, so server and browser render the same reference (no hydration mismatch).
  const text = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  const reference = (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        ref: reference,
        type: error instanceof Error ? error.name : "Error",
        message: (error instanceof Error ? error.message : String(error))
          .replace(/\nparams:[\s\S]*$/, "")
          .slice(0, 500),
      }),
    );
  }, [error, reference]);
  return (
    <main id="main" className="mx-auto max-w-xl px-5 py-16" data-testid="unexpected-error">
      <h1 className="text-3xl">Something went wrong</h1>
      <p className="mt-2">
        Something went wrong on our side. Nothing was changed. If it keeps happening, share this reference:{" "}
        <code className="rounded bg-sunk px-1.5 py-0.5 font-semibold">{reference}</code>.
      </p>
      <Link to="/" className="mt-6 inline-block text-harbor underline">
        Go to the start page
      </Link>
    </main>
  );
}
