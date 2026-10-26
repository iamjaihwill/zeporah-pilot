import { z } from "zod";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { getAuthOptions, listPersonas, signIn } from "@/functions/session";
import { Badge, Notice } from "@/components/ui";
import { cx } from "@/lib/client";
import { homeFor } from "@/components/sign-in-form";

/**
 * DEVELOPMENT ONLY: the demo launcher. One page with the two experiences side by side — the
 * consumer family app and the enterprise care-team workspace — so a walkthrough is one click
 * away. `/demo?as=<actorId>` signs straight in as that persona, so each one can be bookmarked.
 * Behind the same gate as persona sign-in (server/auth/dev-gate.ts); empty when it is off.
 */
export const Route = createFileRoute("/demo")({
  head: () => ({ meta: [{ title: "Demo launcher — Zeporah" }] }),
  validateSearch: z.object({ as: z.string().max(100).optional() }),
  loader: async () => ({ personas: await listPersonas(), options: await getAuthOptions() }),
  component: Launcher,
});

type Persona = Awaited<ReturnType<typeof listPersonas>>[number];

const experiences = [
  {
    id: "consumer",
    eyebrow: "Consumer",
    title: "Family app",
    hint: "What a household sees — works on phones and computers.",
    featured: ["fm-daniel", "fm-marisol"],
    match: (p: Persona) => p.kind === "family",
  },
  {
    id: "enterprise",
    eyebrow: "Enterprise",
    title: "Hospice care-team workspace",
    hint: "What Willow Creek staff see — built for desktop and tablet.",
    featured: ["st-dana", "st-maya"],
    match: (p: Persona) => p.kind !== "family",
  },
];

function Launcher() {
  const { personas, options } = Route.useLoaderData();
  const { as } = Route.useSearch();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const started = useRef(false);

  async function go(p: Persona) {
    setBusy(p.actorId);
    const r = await signIn({ data: { actorId: p.actorId, tenantId: p.tenantId } });
    await navigate({ to: homeFor(r.kind) });
  }

  // A bookmarked /demo?as=… link signs in on arrival.
  const target = personas.find((p) => p.actorId === as);
  useEffect(() => {
    if (target && !started.current) {
      started.current = true;
      void go(target);
    }
  }, [target]);

  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-5 py-10">
      <Link to="/" className="font-display text-2xl">
        Zeporah<span className="text-clay">.</span>
      </Link>
      <p className="mt-8 text-sm font-medium tracking-wide text-ink-soft uppercase">Development only</p>
      <h1 className="mt-1 font-display text-4xl">Demo launcher</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">
        Pick an experience and a synthetic person to see it as. Every person and record is made up. Come back
        here any time to switch.
      </p>

      {!options.devSignIn ? (
        <div className="mt-8">
          <Notice tone="quiet" title="Not available">
            The demo launcher exists only on a development server with development sign-in turned on.
          </Notice>
        </div>
      ) : as && !target ? (
        <div className="mt-8">
          <Notice tone="ochre" title="Unknown persona">
            There's no synthetic person called “{as}”. Choose one below.
          </Notice>
        </div>
      ) : null}

      {options.devSignIn && (
        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          {experiences.map((x) => {
            const list = personas.filter(x.match);
            const featured = x.featured.flatMap((id) => list.filter((p) => p.actorId === id));
            const others = list.filter((p) => !x.featured.includes(p.actorId));
            return (
              <section
                key={x.id}
                aria-labelledby={`x-${x.id}`}
                className="rounded-[var(--radius-card)] border bg-surface p-6 shadow-[var(--shadow-card)]"
              >
                <p className="text-sm font-medium tracking-wide text-clay uppercase">{x.eyebrow}</p>
                <h2 id={`x-${x.id}`} className="font-display text-2xl">
                  {x.title}
                </h2>
                <p className="text-ink-soft">{x.hint}</p>
                <ul className="mt-5 grid gap-3">
                  {featured.map((p, i) => (
                    <li key={p.actorId}>
                      <PersonaButton p={p} busy={busy} onGo={go} primary={i === 0} />
                    </li>
                  ))}
                </ul>
                {others.length > 0 && (
                  <details className="mt-5">
                    <summary className="cursor-pointer text-harbor">More people ({others.length})</summary>
                    <ul className="mt-3 grid gap-3">
                      {others.map((p) => (
                        <li key={p.actorId}>
                          <PersonaButton p={p} busy={busy} onGo={go} />
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}

      {options.devSignIn && (
        <p className="mt-10 text-sm text-ink-soft">
          Bookmark a person: <code>/demo?as=fm-daniel</code>, <code>/demo?as=st-dana</code>. Emails go to the{" "}
          <Link to="/dev/mail" className="text-harbor underline underline-offset-2">
            mail sink
          </Link>
          ; reset the data from the{" "}
          <Link to="/" hash="reset" className="text-harbor underline underline-offset-2">
            sign-in page
          </Link>
          .
        </p>
      )}
    </main>
  );
}

function PersonaButton({
  p,
  busy,
  onGo,
  primary,
}: {
  p: Persona;
  busy: string | null;
  onGo: (p: Persona) => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onGo(p)}
      disabled={!!busy}
      aria-label={`Enter as ${p.name}`}
      aria-describedby={`launch-${p.actorId}`}
      className={cx(
        "flex w-full flex-col items-start rounded-[var(--radius-card)] border p-4 text-left hover:border-harbor disabled:opacity-60",
        primary ? "border-harbor bg-harbor-soft/40" : "bg-paper hover:bg-harbor-soft/40",
      )}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="font-display text-lg">{p.name}</span>
        <span aria-hidden className="text-sm font-medium text-harbor">
          {busy === p.actorId ? "Opening…" : "Enter →"}
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
      <span id={`launch-${p.actorId}`} className="mt-2 text-sm text-ink-soft">
        {p.blurb}
      </span>
    </button>
  );
}
