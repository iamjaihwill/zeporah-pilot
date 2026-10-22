import { useState } from "react";
import { PILOT_DISPLAY } from "@/domain/display-config";
import { dateParts } from "@/domain/dates";
import { redirect, useRouter } from "@tanstack/react-router";

type Fail = { ok: false; code: string; message: string; reference?: string };
type Res<T> = { ok: true; data: T } | Fail;

/** A loader-safe refusal: rendered as a calm message instead of crashing the page. */
export type Denied = { denied: true; code: string; message: string; reference?: string };
export const isDenied = (x: unknown): x is Denied => typeof x === "object" && x !== null && "denied" in x;

/** For route loaders: unwrap a server Result. Not signed in → back to the start page. */
export function unwrap<T>(r: Res<T>): T | Denied {
  if (r.ok) return r.data;
  if (r.code === "NOT_AUTHENTICATED") throw redirect({ to: "/" });
  return {
    denied: true,
    code: r.code,
    message: r.message,
    ...(r.reference ? { reference: r.reference } : {}),
  };
}

/* ---------------- screen-reader announcements ---------------- */

/** "done" outcomes are also shown visibly; "problem" outcomes are already shown next to the form. */
export type AnnounceKind = "done" | "problem";
/** A reversible outcome: the toast offers Undo for UNDO_SECONDS (interaction review, item 4). */
export type Undo = { label?: string; run: () => Promise<boolean> };
export const UNDO_SECONDS = 8;
type Listener = (msg: string, kind: AnnounceKind, undo?: Undo) => void;
const listeners = new Set<Listener>();
export function announce(msg: string, kind: AnnounceKind = "done", undo?: Undo) {
  for (const l of listeners) l(msg, kind, undo);
}
export function onAnnounce(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/**
 * Run a server action. On success, every loader on the page re-runs (so counts, badges and
 * timelines stay in step everywhere) and the outcome is announced. On refusal, the safe message
 * is returned for display.
 */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act<T>(
    call: () => Promise<Res<T>>,
    success?: string,
    /** For reversible actions: what Undo does (another server call). */
    undo?: (data: T) => () => Promise<Res<unknown>>,
  ): Promise<{ data: T } | undefined> {
    setPending(true);
    setError(null);
    try {
      const r = await call();
      if (!r.ok) {
        if (r.code === "NOT_AUTHENTICATED") {
          await router.navigate({ to: "/" });
          return undefined;
        }
        setError(r.message);
        announce(r.message, "problem");
        return undefined;
      }
      await router.invalidate();
      if (success)
        announce(
          success,
          "done",
          undo
            ? {
                run: async () => {
                  try {
                    const u = await undo(r.data)();
                    await router.invalidate();
                    if (!u.ok) {
                      announce(u.message, "problem");
                      return false;
                    }
                    return true;
                  } catch {
                    return false;
                  }
                },
              }
            : undefined,
        );
      return { data: r.data };
    } catch {
      const msg = "That didn't go through. Please try again — nothing was changed.";
      setError(msg);
      announce(msg, "problem");
      return undefined;
    } finally {
      setPending(false);
    }
  }
  return { act, pending, error, setError };
}

/* ---------------- dates ---------------- */

/**
 * Dates are rendered on the server and again in the browser, and the two must produce identical
 * text or React throws away and rebuilds the page after it loads. JavaScript engines word dates
 * differently ("Oct 8 at 4:25 PM" in Bun vs "Oct 8, 4:25 PM" in Chrome) and may run in different
 * time zones, so dates are assembled here from numeric parts in the configured display zone
 * (see PILOT_DISPLAY). Every time shown is absolute and never changes after the page loads.
 */
export const PILOT_TIME_ZONE = PILOT_DISPLAY.timeZone;
// The parts are worked out in domain/dates.ts, so the server writes the same text (decision 62).
const parts = dateParts;

/** "Oct 8, 2026" — identical on server and client. */
export function dateOnly(d: Date | string) {
  const p = parts(d);
  return `${p.month} ${p.day}, ${p.year}`;
}

/** "Oct 8, 4:25 PM" — for everyday coordination where the year is obvious. */
export function dateTime(d: Date | string) {
  const p = parts(d);
  return `${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.period}`;
}

/** "Oct 8, 2026, 4:25 PM ET" — the stable absolute form for anything auditable. */
export function stamp(d: Date | string) {
  const p = parts(d);
  return `${p.month} ${p.day}, ${p.year}, ${p.hour}:${p.minute} ${p.period} ${PILOT_DISPLAY.zoneLabel}`;
}

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
