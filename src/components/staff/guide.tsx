import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { updateGuide } from "@/functions/staff-shell";
import { announce, cx } from "@/lib/client";
import { Button } from "@/components/ui";
import { START_TOUR_EVENT, TOURS, guideRole, startTour } from "@/domain/staff-guide";

/**
 * The care-team tour (first-time guide, 2026-10-21). A modal dialog that points at real parts of
 * the workspace one step at a time: Back / Next / Skip, Esc to close, focus kept inside. It starts
 * only when someone asks (the welcome card, the checklist, or Help), never on its own. Finishing or
 * skipping is remembered so the welcome card goes away.
 */
export function GuideTour({ roles }: { roles: readonly string[] }) {
  const steps = TOURS[guideRole(roles)];
  const [i, setI] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [box, setBox] = useState<DOMRect | null>(null);

  useEffect(() => {
    const start = () => setI(0);
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, []);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (i !== null && !d.open) d.showModal();
    if (i === null && d.open) d.close();
  }, [i]);
  // Find the step's target, bring it into view, and measure it (again when the window changes).
  useLayoutEffect(() => {
    if (i === null) return;
    const sel = steps[i]?.target;
    // The first match that's on screen: the sidebar on wide screens, the bottom bar on phones.
    const el = sel
      ? ([...document.querySelectorAll<HTMLElement>(sel)].find((x) => x.getClientRects().length > 0) ?? null)
      : null;
    if (!el) return setBox(null);
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const measure = () => setBox(el.getBoundingClientRect());
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [i, steps]);
  useEffect(() => {
    if (i !== null) document.getElementById("tour-title")?.focus();
  }, [i]);

  const finish = async (how: "done" | "skipped") => {
    setI(null);
    await updateGuide({ data: { tourDone: true } });
    announce(
      how === "done"
        ? "Tour finished. You can take it again from Help."
        : "Tour closed. You can take it from Help any time.",
    );
    void router.invalidate();
  };
  const step = i === null ? null : steps[i]!;
  // The card sits beside its target: right of sidebar items, below the top bar's buttons.
  const pad = 8;
  const card: React.CSSProperties = !box
    ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
    : box.left < 300 && box.width < 400
      ? {
          left: Math.min(box.right + 16, window.innerWidth - 360),
          top: Math.max(16, Math.min(box.top - 8, window.innerHeight - 260)),
        }
      : { left: Math.max(16, Math.min(box.right - 340, window.innerWidth - 360)), top: box.bottom + 14 };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-transparent"
      onCancel={(e) => {
        e.preventDefault();
        void finish("skipped");
      }}
    >
      {step && (
        <>
          {/* The dimmed page, with a clear window around the step's target. */}
          {box ? (
            <div
              aria-hidden
              className="pointer-events-none fixed rounded-xl ring-2 ring-harbor"
              style={{
                left: box.left - pad,
                top: box.top - pad,
                width: box.width + pad * 2,
                height: box.height + pad * 2,
                boxShadow: "0 0 0 9999px oklch(0.2 0.01 265 / 0.45)",
              }}
            />
          ) : (
            <div aria-hidden className="fixed inset-0 bg-[oklch(0.2_0.01_265/0.45)]" />
          )}
          <div
            className="fixed w-[min(21rem,calc(100vw-2rem))] rounded-2xl border bg-surface p-5 shadow-xl"
            style={card}
            data-testid="tour-card"
          >
            <p className="text-[0.75rem] font-medium text-ink-soft">
              Step {i! + 1} of {steps.length}
            </p>
            <h2 id="tour-title" tabIndex={-1} className="mt-1 text-[1.125rem] outline-none">
              {step.title}
            </h2>
            <p id="tour-body" className="mt-1.5 text-[0.875rem] text-ink-soft">
              {step.body}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" variant="quiet" onClick={() => void finish("skipped")}>
                Skip tour
              </Button>
              <span className="ml-auto flex gap-2">
                {i! > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => setI(i! - 1)}>
                    Back
                  </Button>
                )}
                {i! < steps.length - 1 ? (
                  <Button size="sm" onClick={() => setI(i! + 1)}>
                    Next
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void finish("done")}>
                    Finish
                  </Button>
                )}
              </span>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}

type Guide = {
  showWelcome: boolean;
  showChecklist: boolean;
  checklist: {
    key: string;
    label: string;
    to: string;
    search: Record<string, string> | null;
    done: boolean;
  }[];
};

/**
 * "Getting started" on the landing page, for people new to this hospice: a welcome card offering
 * the tour, then a checklist whose items tick off from what they've actually done.
 */
export function GettingStarted({ guide }: { guide: Guide }) {
  const router = useRouter();
  const [hiding, setHiding] = useState(false);
  if (!guide.showChecklist) return null;
  const done = guide.checklist.filter((c) => c.done).length;
  const hide = async () => {
    setHiding(true);
    await updateGuide({ data: { hideChecklist: true } });
    announce("Getting started is hidden. The tour is still in Help.");
    await router.invalidate();
  };
  return (
    <section
      aria-labelledby="getting-started"
      className="mb-5 rounded-[var(--s-radius)] border bg-surface p-[calc(var(--s-pad)*1.25)]"
      data-testid="getting-started"
    >
      {guide.showWelcome && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-harbor-soft px-4 py-3">
          <p className="min-w-0 flex-1">
            <strong className="block text-ink">Welcome to Zeporah</strong>
            <span className="text-[0.875rem] text-ink-soft">
              New here? A one-minute tour shows where things are.
            </span>
          </p>
          <Button size="sm" onClick={startTour}>
            Start the tour
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={hiding}
            onClick={async () => {
              // Puts the welcome card away; the checklist (with the tour on it) stays.
              await updateGuide({ data: { dismissWelcome: true } });
              await router.invalidate();
            }}
          >
            Not now
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="getting-started">Getting started</h2>
        <span className="text-[0.8125rem] text-ink-soft" data-testid="getting-started-progress">
          {done} of {guide.checklist.length} done
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunk"
        role="progressbar"
        aria-label="Getting started"
        aria-valuemin={0}
        aria-valuemax={guide.checklist.length}
        aria-valuenow={done}
      >
        <div
          className="h-full rounded-full bg-harbor"
          style={{ width: `${(done / guide.checklist.length) * 100}%` }}
        />
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {guide.checklist.map((c) => (
          <li
            key={c.key}
            className={cx(
              "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[0.875rem]",
              c.done && "bg-sunk text-ink-soft",
            )}
          >
            <span
              aria-hidden
              className={cx(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-bold",
                c.done ? "border-moss bg-moss text-white" : "border-line-strong",
              )}
            >
              {c.done ? "✓" : ""}
            </span>
            <span className="sr-only">{c.done ? "Done: " : "To do: "}</span>
            {c.done ? (
              <span className="line-through decoration-ink-soft/60">{c.label}</span>
            ) : c.key === "tour" ? (
              <button
                type="button"
                className="text-left text-harbor underline-offset-2 hover:underline"
                onClick={startTour}
              >
                {c.label}
              </button>
            ) : (
              <Link
                {...({ to: c.to, ...(c.search ? { search: c.search } : {}) } as { to: "/staff" })}
                className="text-harbor underline-offset-2 hover:underline"
              >
                {c.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 text-right">
        <Button size="sm" variant="quiet" disabled={hiding} onClick={() => void hide()}>
          {done === guide.checklist.length ? "All done — hide this" : "Hide getting started"}
        </Button>
      </div>
    </section>
  );
}
