import { useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * Links can point at one item on a page (#task-…, #consent-…, #entry-…). On arrival, scroll that
 * item into view, move focus to it (so keyboard and screen-reader users land there too) and return
 * its id for a highlight (interaction review, items 9 and 17).
 */
export function useHashTarget() {
  const { hash } = useLocation();
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => {
      const el = document.getElementById(hash);
      if (!el) return;
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      // Centred, unless it's taller than most of the screen: then its top (and its name) stays in view.
      el.scrollIntoView({
        block: el.getBoundingClientRect().height > window.innerHeight * 0.7 ? "start" : "center",
      });
      el.focus({ preventScroll: true });
      setTarget(hash);
    }, 50);
    return () => clearTimeout(t);
  }, [hash]);
  return target;
}

/** The highlight ring for the item a link pointed at. */
export const HIGHLIGHT = "ring-2 ring-harbor ring-offset-2 ring-offset-paper";
