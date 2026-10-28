import { useRef, useState } from "react";
import { PILOT_DISPLAY } from "@/domain/display-config";
import { dateParts } from "@/domain/dates";
import { newSubmissionId } from "@/domain/submission";
import { redirect, useRouter } from "@tanstack/react-router";
import {
  forgetUncertain,
  isOffline,
  OFFLINE_PAUSED,
  rememberUncertain,
  useOnline,
  type UncertainKind,
} from "@/lib/connection";

type Fail = { ok: false; code: string; message: string; reference?: string };
export type Res<T> = { ok: true; data: T } | Fail;

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
 * Decision 84, for the few changes made without `useAction`: true (and said aloud) when offline,
 * so the caller stops before sending anything.
 */
export function pausedOffline() {
  if (!isOffline()) return false;
  announce(OFFLINE_PAUSED, "problem");
  return true;
}

/**
 * Run a server action. On success, every loader on the page re-runs (so counts, badges and
 * timelines stay in step everywhere) and the outcome is announced. On refusal, the safe message
 * is returned for display.
 */
export function useAction() {
  const router = useRouter();
  // Decision 84: while offline every change is paused, so buttons that use `pending` are unavailable.
  const online = useOnline();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act<T>(
    call: () => Promise<Res<T>>,
    success?: string,
    /** For reversible actions: what Undo does (another server call). */
    undo?: (data: T) => () => Promise<Res<unknown>>,
    /**
     * For sends that are safe to retry (useSubmission): what to say when no reply came back. The
     * send may have arrived, so the usual "nothing was changed" would be wrong.
     */
    unconfirmed?: string | UnconfirmedSend,
  ): Promise<{ data: T } | undefined> {
    const track = typeof unconfirmed === "object" ? unconfirmed.track : undefined;
    // Decision 84: nothing is sent, saved or queued while offline.
    if (isOffline()) {
      setError(OFFLINE_PAUSED);
      announce(OFFLINE_PAUSED, "problem");
      return undefined;
    }
    setPending(true);
    setError(null);
    try {
      const r = await call();
      // Any answer from the server settles the send, whether it was accepted or refused.
      if (track) forgetUncertain([track.id]);
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
      // Decision 86: remember only the send's ID, so the page can ask later whether it arrived.
      if (track) rememberUncertain(track);
      const msg =
        (typeof unconfirmed === "object" ? unconfirmed.message : unconfirmed) ??
        "That didn't go through. Please try again — nothing was changed.";
      setError(msg);
      announce(msg, "problem");
      return undefined;
    } finally {
      setPending(false);
    }
  }
  // `pending` disables buttons (while sending, and while offline); `sending` is for "Sending…" labels.
  return { act, pending: pending || !online, sending: pending, error, setError };
}

/** When a send got no reply: it may have arrived, and sending again is safe. */
export const UNCONFIRMED_SEND =
  "We couldn't confirm this was sent. Check your connection and send it again: it won't arrive twice.";

export type UnconfirmedSend = { message: string; track: { id: string; kind: UncertainKind } };
/**
 * For `act`'s unconfirmed argument on a send with a submission ID: the same wording, and the page
 * checks whether it arrived when the connection returns or the page is reloaded (decision 86).
 */
export const unconfirmedSend = (kind: UncertainKind, submissionId: string): UnconfirmedSend => ({
  message: UNCONFIRMED_SEND,
  track: { id: submissionId, kind },
});

/**
 * One submission ID per send (brief reconciliation increment 3). The same content keeps its ID
 * until the server confirms it, so sending again after a lost reply can't make a second copy;
 * new content, or `done()` after a confirmed send, starts a new ID.
 */
export function useSubmission() {
  const current = useRef<{ key: string; id: string } | null>(null);
  return {
    idFor(key: string) {
      if (current.current?.key !== key) current.current = { key, id: newSubmissionId() };
      return current.current.id;
    },
    done() {
      current.current = null;
    },
  };
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
