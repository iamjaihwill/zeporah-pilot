/**
 * Offline tolerance on screen (founder decisions 84–87; brief §14), in both workspaces.
 *
 * - **Decision 85:** while offline, one banner says so, says when what's on screen was loaded, and
 *   always shows the hospice's 24-hour line that's already on the page. When the connection
 *   returns, the banner clears and the page refreshes.
 * - **Decision 86:** a send the page couldn't confirm is settled by asking the server about its
 *   submission ID, on reconnect or after a reload. Nothing is resent here, and the words were
 *   never kept.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { checkSubmissions } from "@/functions/session";
import { dateTime } from "@/lib/client";
import { forgetUncertain, useOnline, useUncertain, type Uncertain } from "@/lib/connection";
import { Button } from "@/components/ui";

/** A send answered too recently may still be on its way: wait this long before asking about it. */
const SETTLE_MS = 5_000;

type Settled = Uncertain & { arrived: boolean };

export function ConnectionStatus({ line }: { line: string | null }) {
  const online = useOnline();
  const router = useRouter();
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  useEffect(() => {
    setLoadedAt(new Date());
    return router.subscribe("onResolved", () => setLoadedAt(new Date()));
  }, [router]);
  // Back online: refresh what's on screen.
  const was = useRef(online);
  useEffect(() => {
    if (online && !was.current) void router.invalidate();
    was.current = online;
  }, [online, router]);
  const uncertain = useUncertain();
  return (
    <>
      {!online && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-ochre/40 bg-ochre-soft p-3"
          data-testid="offline-banner"
        >
          <p className="font-semibold">You're offline.</p>
          <p className="mt-1">
            {loadedAt ? `What you see was loaded at ${dateTime(loadedAt)} and` : "What you see"} may be out of
            date. Changes are paused until you reconnect; nothing is saved or sent in the meantime.
          </p>
          {uncertain.length > 0 && (
            <p className="mt-1">
              {uncertain.length === 1
                ? "One send couldn't be confirmed. We'll check whether it arrived when you're back online."
                : `${uncertain.length} sends couldn't be confirmed. We'll check whether they arrived when you're back online.`}
            </p>
          )}
          <p className="mt-1">
            If someone needs urgent help, call 911 or your hospice's 24-hour line
            {line ? (
              <>
                : <span className="font-semibold">{line}</span>
              </>
            ) : null}
            .
          </p>
        </div>
      )}
      <UncertainSends online={online} pending={uncertain} />
    </>
  );
}

function UncertainSends({ online, pending }: { online: boolean; pending: Uncertain[] }) {
  const router = useRouter();
  const [settled, setSettled] = useState<Settled[]>([]);
  const [tick, setTick] = useState(0);
  const checking = useRef(false);
  // Try again when the window comes back into focus (a failed check leaves the sends unsettled).
  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, []);
  useEffect(() => {
    if (!online || !pending.length || checking.current) return;
    const now = Date.now();
    const ready = pending.filter((p) => now - p.at >= SETTLE_MS);
    if (!ready.length) {
      const wait = Math.max(...pending.map((p) => p.at + SETTLE_MS - now));
      const t = setTimeout(() => setTick((n) => n + 1), wait);
      return () => clearTimeout(t);
    }
    checking.current = true;
    void checkSubmissions({ data: { ids: ready.map((p) => p.id) } })
      .then((r) => {
        // Not answered: the sends stay unsettled until a later check (decision 86).
        if (!r.ok) return;
        const arrived = new Set(r.data.filter((x) => x.arrived).map((x) => x.id));
        setSettled((s) => [...s, ...ready.map((p) => ({ ...p, arrived: arrived.has(p.id) }))]);
        forgetUncertain(ready.map((p) => p.id));
        if (arrived.size) void router.invalidate();
      })
      .catch(() => undefined)
      .finally(() => {
        checking.current = false;
      });
    return undefined;
  }, [online, pending, tick, router]);
  if (!settled.length && !(online && pending.length)) return null;
  return (
    <div className="mb-4 space-y-2" aria-live="polite" data-testid="uncertain-sends">
      {online && pending.length > 0 && (
        <p className="rounded-lg border bg-sunk p-3">Checking whether your last send arrived…</p>
      )}
      {settled.map((s) => {
        const what = s.kind === "message" ? "message" : "request";
        return (
          <div key={s.id} className="rounded-lg border bg-sunk p-3">
            <p>
              {s.arrived
                ? `Your ${what} from ${dateTime(new Date(s.at))} arrived. Nothing more needs doing.`
                : `Your ${what} from ${dateTime(new Date(s.at))} didn't arrive, and it wasn't sent again. If your words are still in the box, send it now; otherwise please write it again.`}
            </p>
            <Button
              variant="quiet"
              size="sm"
              className="mt-1"
              onClick={() => setSettled((all) => all.filter((x) => x.id !== s.id))}
            >
              Dismiss
            </Button>
          </div>
        );
      })}
    </div>
  );
}
