import type { ReactNode } from "react";
import { cx } from "@/lib/client";

/**
 * The staff page header (staff rework, section 2): a title, at most one line of description when
 * it's really needed, and right-aligned primary actions. Explanations live in Help, tooltips and
 * empty states, not in paragraphs at the top of every page.
 */
export function StaffPageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h1 className="truncate">{title}</h1>
        {description && <p className="text-[0.8125rem] text-ink-soft">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A one-line note (e.g. "Not clinical triage") with the long explanation in a tooltip. */
export function OneLineNote({ children, more }: { children: ReactNode; more?: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[0.75rem] text-ink-soft">
      <span aria-hidden>ⓘ</span>
      <span>{children}</span>
      {more && (
        <span title={more} className="cursor-help underline decoration-dotted underline-offset-2">
          Why?<span className="sr-only">: {more}</span>
        </span>
      )}
    </p>
  );
}

/** Keyboard hint. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-surface px-1 font-sans text-[0.6875rem] text-ink-soft">
      {children}
    </kbd>
  );
}

/** Skeleton lines while content loads (the existing content stays visible while it refreshes). */
export function Skeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx("space-y-2", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-[var(--s-row,2.5rem)] animate-pulse rounded-md bg-sunk" />
      ))}
    </div>
  );
}

/** A compact panel (the staff card). */
export function Panel({
  title,
  actions,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cx("rounded-[var(--s-radius)] border bg-surface p-[var(--s-pad)]", className)}
      aria-label={typeof title === "string" ? title : undefined}
    >
      {(title || actions) && (
        <div className="mb-[var(--s-gap)] flex items-center justify-between gap-2">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
