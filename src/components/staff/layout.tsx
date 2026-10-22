import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/client";

/**
 * For a row that scrolls sideways (tabs on a tablet): fades the edge that has more beyond it, so
 * it's clear there's more, and brings the current item into view. styles.css draws the fade.
 */
export function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      el.dataset["moreRight"] = String(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
      el.dataset["moreLeft"] = String(el.scrollLeft > 1);
    };
    // Scroll only when the current tab is out of view, so the row normally opens at its start
    // (and never part-way through the first tab).
    const cur = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (cur && cur.offsetLeft + cur.offsetWidth > el.clientWidth)
      el.scrollLeft = cur.offsetLeft + cur.offsetWidth - el.clientWidth + 40;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return ref;
}

/**
 * Tabs that are links or buttons (views live in the URL so they can be shared). Rendered as a
 * navigation list with aria-current, which suits view switching better than an ARIA tablist.
 */
export function ViewTabs({
  label,
  items,
  className,
}: {
  label: string;
  items: {
    key: string;
    label: ReactNode;
    count?: number;
    active: boolean;
    render: (cls: string, children: ReactNode) => ReactNode;
  }[];
  className?: string;
}) {
  const ref = useScrollFade<HTMLElement>();
  return (
    <nav
      ref={ref}
      data-scroll-fade
      aria-label={label}
      className={cx("-mx-1 snap-x snap-mandatory scroll-px-1 overflow-x-auto", className)}
    >
      <ul className="flex gap-1 border-b px-1">
        {items.map((t) => {
          const cls = cx(
            "-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-[0.8125rem] whitespace-nowrap",
            t.active
              ? "border-harbor font-semibold text-ink"
              : "border-transparent text-ink-soft hover:text-ink",
          );
          return (
            <li key={t.key} className="snap-start">
              {t.render(
                cls,
                <>
                  {t.label}
                  {t.count !== undefined && (
                    <span className="rounded-full bg-sunk px-1.5 text-[0.6875rem] font-semibold text-ink-soft">
                      {t.count}
                    </span>
                  )}
                </>,
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** True below the breakpoint where the detail panel becomes a drawer. */
export function useNarrow(query = "(max-width: 1199px)") {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

/**
 * A list with a detail panel (staff rework, section 3). Wide screens: list left, detail right
 * (resizable, about 40%). Narrow screens: the detail opens as a full-height drawer. Esc closes it,
 * and focus returns to where it was.
 */
export function SplitPane({
  list,
  detail,
  open,
  onClose,
  detailLabel,
}: {
  list: ReactNode;
  detail: ReactNode;
  open: boolean;
  onClose: () => void;
  detailLabel: string;
}) {
  const narrow = useNarrow();
  const [pct, setPct] = useState(40);
  const wrap = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!narrow) return;
    const d = drawer.current;
    if (!d) return;
    if (open && !d.open) {
      returnTo.current = document.activeElement as HTMLElement;
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open, narrow]);
  const startDrag = (e: React.PointerEvent) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    const move = (ev: PointerEvent) => {
      const right = ((box.right - ev.clientX) / box.width) * 100;
      setPct(Math.min(60, Math.max(28, right)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  };
  if (narrow)
    return (
      <>
        {list}
        <dialog
          ref={drawer}
          aria-label={detailLabel}
          onClose={() => {
            onClose();
            returnTo.current?.focus();
          }}
          className="m-0 ml-auto h-dvh max-h-dvh w-[min(36rem,100vw)] max-w-none border-l bg-paper p-0 text-ink"
        >
          <div className="h-full overflow-y-auto p-4">{open && detail}</div>
        </dialog>
      </>
    );
  return (
    <div ref={wrap} className="flex min-h-0 gap-0">
      <div className="min-w-0 flex-1">{list}</div>
      {open && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the detail panel"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={28}
            aria-valuemax={60}
            tabIndex={0}
            onPointerDown={startDrag}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setPct((p) => Math.min(60, p + 2));
              if (e.key === "ArrowRight") setPct((p) => Math.max(28, p - 2));
            }}
            className="mx-1 w-1.5 shrink-0 cursor-col-resize rounded bg-line hover:bg-harbor/40 focus-visible:bg-harbor/40"
          />
          <aside
            aria-label={detailLabel}
            style={{ width: `${pct}%` }}
            className="sticky top-[3.5rem] max-h-[calc(100dvh-4.5rem)] shrink-0 overflow-y-auto rounded-[var(--s-radius)] border bg-surface p-[var(--s-pad)]"
          >
            {detail}
          </aside>
        </>
      )}
    </div>
  );
}

/**
 * A small popover menu on a native button. Opens with click/Enter/Space; Esc or a click outside
 * closes it and returns focus to the button.
 */
export function Popover({
  label,
  button,
  children,
  align = "right",
  className,
  panelClassName,
}: {
  label: string;
  button: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // Move focus into the panel.
    setTimeout(() => panel.current?.querySelector<HTMLElement>("a, button, input, [tabindex]")?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={cx("relative", className)}>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-2 text-[0.8125rem] text-ink-soft hover:bg-sunk hover:text-ink"
      >
        {button}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="group"
          aria-label={label}
          className={cx(
            "absolute top-full z-50 mt-1 w-72 rounded-[var(--s-radius)] border bg-surface p-2 text-[0.8125rem] shadow-xl",
            align === "right" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
