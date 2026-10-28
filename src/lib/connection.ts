/**
 * Offline tolerance (founder decisions 84–87; brief §14). Zeporah is offline-tolerant, not
 * offline-first: it notices a lost connection, pauses changes, and settles sends it couldn't
 * confirm. Nothing is queued or sent in the background.
 */
import { useSyncExternalStore } from "react";

/* ---------------- connection ---------------- */

const subscribeOnline = (fn: () => void) => {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
};

/** The browser's view of the connection. The server always renders "online". */
export function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** For code outside React (useAction's guard). */
export const isOffline = () => typeof navigator !== "undefined" && !navigator.onLine;

/** Decision 84: what a paused change says. */
export const OFFLINE_PAUSED =
  "You're offline, so this wasn't sent or saved. It will work again when you reconnect.";

/* ---------------- sends we couldn't confirm (decision 86) ---------------- */

export type UncertainKind = "message" | "request";
/** Only the ID, what kind of send it was and when: never the words (decision 86). */
export type Uncertain = { id: string; kind: UncertainKind; at: number };

const KEY = "zeporah.uncertain-sends";
const listeners = new Set<() => void>();
let cache: Uncertain[] | null = null;

function load(): Uncertain[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as unknown;
    cache = Array.isArray(raw)
      ? raw.filter(
          (x): x is Uncertain =>
            typeof x?.id === "string" &&
            (x.kind === "message" || x.kind === "request") &&
            typeof x.at === "number",
        )
      : [];
  } catch {
    // Storage can be unavailable (private windows, blocked site data): keep it for this page only.
    cache = [];
  }
  return cache;
}

function save(next: Uncertain[]) {
  cache = next;
  try {
    if (next.length) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
  } catch {
    // As above: the page still knows, a reload won't.
  }
  for (const l of listeners) l();
}

export function rememberUncertain(u: { id: string; kind: UncertainKind }) {
  const list = load();
  if (list.some((x) => x.id === u.id)) return;
  save([...list, { ...u, at: Date.now() }].slice(-20));
}

export function forgetUncertain(ids: string[]) {
  const list = load();
  if (list.some((x) => ids.includes(x.id))) save(list.filter((x) => !ids.includes(x.id)));
}

const EMPTY: Uncertain[] = [];
export function useUncertain() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    load,
    () => EMPTY,
  );
}

/** Test hook: forget the in-memory copy so the next read comes from storage. */
export function resetUncertainCache() {
  cache = null;
}
