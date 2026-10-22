/**
 * A small, local component set built on native elements so keyboard and screen-reader behavior
 * stays predictable. Color always comes with words — state is never conveyed by color alone.
 */
import { Link, useRouterState, type LinkProps } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  UNDO_SECONDS,
  announce,
  cx,
  dateTime,
  onAnnounce,
  stamp,
  type Denied,
  type Undo,
} from "@/lib/client";

/* ---------------- buttons ---------------- */

type Variant = "primary" | "secondary" | "quiet" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-harbor text-white hover:bg-harbor-strong border-transparent",
  secondary: "bg-surface text-ink border-line-strong hover:bg-sunk",
  quiet: "bg-transparent text-harbor border-transparent hover:bg-harbor-soft",
  danger: "bg-surface text-rose border-rose/40 hover:bg-rose-soft",
};
const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-[0.95rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55";
const small = "min-h-9 px-3 py-1.5 text-sm";

export function Button({
  variant = "primary",
  size,
  className,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" }) {
  return (
    <button
      type="button"
      data-ui="button"
      data-size={size ?? "md"}
      {...p}
      className={cx(base, variants[variant], size === "sm" && small, className)}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  size,
  className,
  children,
  ...p
}: LinkProps & { variant?: Variant; size?: "sm"; className?: string; children: ReactNode }) {
  return (
    <Link
      data-ui="button"
      data-size={size ?? "md"}
      {...p}
      className={cx(base, variants[variant], size === "sm" && small, className)}
    >
      {children}
    </Link>
  );
}

/* ---------------- layout ---------------- */

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold tracking-[0.12em] text-ink-faint uppercase">{eyebrow}</p>
        )}
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {lede && <p className="mt-2 max-w-2xl text-ink-soft">{lede}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  titleId,
  actions,
  tone,
  className,
  children,
  id,
  as: As = "section",
}: {
  id?: string;
  title?: ReactNode;
  titleId?: string;
  actions?: ReactNode;
  tone?: "plain" | "quiet" | "harbor" | "staff" | "ochre" | "rose" | "moss";
  className?: string;
  children: ReactNode;
  as?: "section" | "div" | "article" | "li";
}) {
  const genId = useId();
  const hid = titleId ?? genId;
  const tones = {
    plain: "bg-surface shadow-[var(--shadow-card)]",
    quiet: "bg-sunk border-transparent",
    harbor: "bg-harbor-soft border-harbor/20",
    staff: "bg-staff-soft border-staff/25",
    ochre: "bg-ochre-soft border-ochre/25",
    rose: "bg-rose-soft border-rose/25",
    moss: "bg-moss-soft border-moss/25",
  };
  return (
    <As
      id={id}
      aria-labelledby={title ? hid : undefined}
      data-ui="card"
      className={cx("rise rounded-[var(--radius-card)] border p-5 sm:p-6", tones[tone ?? "plain"], className)}
    >
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          {title && (
            <h2 id={hid} className="text-xl" data-ui="card-title">
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      {children}
    </As>
  );
}

/* ---------------- badges and states ---------------- */

export type Tone = "neutral" | "harbor" | "moss" | "ochre" | "rose" | "staff" | "clay";
const badgeTones: Record<Tone, string> = {
  neutral: "bg-sunk text-ink-soft",
  harbor: "bg-harbor-soft text-harbor-strong",
  moss: "bg-moss-soft text-moss",
  ochre: "bg-ochre-soft text-ochre",
  rose: "bg-rose-soft text-rose",
  staff: "bg-staff-soft text-staff",
  clay: "bg-clay-soft text-clay",
};
export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-ui="badge"
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATE_TONES: Record<string, Tone> = {
  allow: "moss",
  hold: "ochre",
  deny: "rose",
  released: "moss",
  held: "ochre",
  denied: "rose",
  revoked: "rose",
  draft: "neutral",
  active: "moss",
  scheduled: "harbor",
  expired: "ochre",
  workflow_active: "moss",
  review_pending: "ochre",
  conflict: "rose",
  superseded: "neutral",
  withdrawn: "neutral",
  needs_review: "ochre",
  reviewed: "moss",
  not_available: "neutral",
  not_applicable: "neutral",
  open: "ochre",
  acknowledged: "harbor",
  resolved: "moss",
  done: "moss",
  pending: "ochre",
  accepted: "moss",
  declined: "neutral",
  cancelled: "neutral",
  proposed: "ochre",
  confirmed: "moss",
  identity_unresolved: "rose",
  awaiting_confirmation: "ochre",
  awaiting_activation: "harbor",
};
const STATE_LABELS: Record<string, string> = {
  allow: "Allowed",
  hold: "Held",
  deny: "Denied",
  workflow_active: "Workflow active",
  review_pending: "Waiting for review",
  needs_review: "Needs a look",
  not_available: "Not found yet",
  not_applicable: "Doesn't apply",
  conflict: "Conflict — held for review",
  identity_unresolved: "Identity unresolved — held for review",
  awaiting_confirmation: "Waiting for household confirmation",
  awaiting_activation: "Confirmed — waiting for activation",
};
export function StateBadge({ state, label, wrap }: { state: string; label?: string; wrap?: boolean }) {
  return (
    // `wrap`: a long label may break across lines instead of widening its container.
    <Badge
      tone={STATE_TONES[state] ?? "neutral"}
      {...(wrap ? { className: "max-w-full rounded-xl !whitespace-normal" } : {})}
    >
      {label ?? STATE_LABELS[state] ?? state.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}
    </Badge>
  );
}

/** Who can see this — shown next to the content, never only in a tooltip. */
export function Visibility({
  who,
}: {
  who: "household" | "staff" | "protected" | "you" | "sharing" | "vault";
}) {
  // Each label names exactly who can see it (interaction review, item 8). "vault" follows the roles
  // with vault.view; "protected" follows hasProtectedAccess (domain/lifecycle.ts).
  const map = {
    household: ["harbor", "Visible to the household"],
    vault: ["harbor", "Visible to the patient, coordinator and proxy"],
    staff: ["staff", "Care team only — never shown to the family"],
    protected: ["clay", "Only the patient and people with active authority"],
    you: ["neutral", "Only you"],
    sharing: ["harbor", "Visible to household members who can see sharing"],
  } as const;
  const [tone, text] = map[who];
  return (
    <Badge tone={tone}>
      <span aria-hidden>{who === "staff" ? "◆" : "●"}</span> {text}
    </Badge>
  );
}

/* ---------------- forms ---------------- */

export function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string, describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-ink-soft">
          {hint}
        </p>
      )}
      {children(id, hintId)}
      {error && <p className="text-sm text-rose">{error}</p>}
    </div>
  );
}

export const inputClass =
  "block w-full min-h-11 rounded-lg border border-field bg-surface px-3 py-2 text-base placeholder:text-ink-faint";

export function ChoiceGroup<T extends string>({
  legend,
  hint,
  name,
  value,
  onChange,
  options,
  required,
}: {
  legend: string;
  hint?: string;
  name: string;
  /** null = nothing chosen yet (no default is pre-selected). */
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
  /** A choice is needed before saving; says so to assistive technology. */
  required?: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">{legend}</legend>
      {hint && <p className="text-sm text-ink-soft">{hint}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
              value === o.value
                ? "border-harbor bg-harbor-soft"
                : "border-line-strong bg-surface hover:bg-sunk",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              required={required}
              onChange={() => onChange(o.value)}
              className="mt-1 size-4 accent-[var(--color-harbor)]"
            />
            <span>
              <span className="block font-medium">{o.label}</span>
              {o.hint && <span className="block text-sm text-ink-soft">{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line-strong bg-surface p-3 hover:bg-sunk">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 accent-[var(--color-harbor)]"
      />
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-sm text-ink-soft">{hint}</span>}
      </span>
    </label>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-rose/30 bg-rose-soft px-3 py-2 text-sm text-rose">
      {error}
    </p>
  );
}

/* ---------------- notices ---------------- */

export function Notice({
  tone = "harbor",
  title,
  children,
  icon,
}: {
  tone?: "harbor" | "ochre" | "rose" | "staff" | "quiet";
  title?: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const tones = {
    harbor: "border-harbor/25 bg-harbor-soft",
    ochre: "border-ochre/30 bg-ochre-soft",
    rose: "border-rose/30 bg-rose-soft",
    staff: "border-staff/30 bg-staff-soft",
    quiet: "border-line bg-sunk",
  };
  return (
    <div className={cx("flex gap-3 rounded-xl border px-4 py-3 text-[0.95rem]", tones[tone])}>
      {icon && (
        <span aria-hidden className="mt-0.5 shrink-0">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-ink-soft [&_a]:text-harbor [&_a]:underline">{children}</div>
      </div>
    </div>
  );
}

/** The one-line form, placed right where someone is about to write (e.g. above a message box). */
export function EmergencyLine({ line }: { line?: string | null }) {
  return (
    <p
      className="flex gap-2 rounded-lg border border-line bg-sunk px-3 py-2 text-sm"
      data-testid="emergency-line"
    >
      <span aria-hidden>☎</span>
      <span>
        <strong className="font-semibold">Not for emergencies</strong> — call 911 or your hospice's 24-hour
        line
        {line ? <>: {line}</> : null}.
      </span>
    </p>
  );
}

/** Standing boundary: Zeporah is not for emergencies. Calm, always visible where it matters. */
export function EmergencyNotice({
  line,
  tone = "quiet",
}: {
  line?: string | null;
  tone?: "quiet" | "harbor";
}) {
  return (
    <Notice tone={tone} title="Not for emergencies" icon="☎">
      If someone needs urgent help, call 911 or your hospice's 24-hour line{line ? <>: {line}</> : null}.
      Messages here are for routine coordination and aren't watched around the clock.
    </Notice>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      <p className="font-display text-xl">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-ink-soft">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** The plain answer when a page is outside what someone's role can see. */
export const ACCESS_DENIED_NOTE =
  "This isn't part of what your role can see. If you think it should be, your care team can help.";

/**
 * A page that couldn't be shown. Two different situations, never mixed:
 * - an unexpected error: one message with one reference, which is also in the server log;
 * - a refusal (not for this role, out of scope, read-only…): what to do, plus the reason code.
 */
export function DeniedView({
  d,
  back,
  generalNote = true,
}: {
  d: Denied;
  back?: ReactNode;
  /** False where the message already says why and where to go (an administrator on a household). */
  generalNote?: boolean;
}) {
  const staff = useRouterState({ select: (s) => s.location.pathname.startsWith("/staff") });
  if (d.code === "ERROR")
    return (
      <div className="max-w-xl" data-testid="unexpected-error">
        <PageHeader title="Something went wrong" />
        <p>
          Something went wrong on our side. Nothing was changed. If it keeps happening, share this reference:{" "}
          <code className="rounded bg-sunk px-1.5 py-0.5 font-semibold">{d.reference ?? "unavailable"}</code>.
        </p>
        {back && <div className="mt-4">{back}</div>}
      </div>
    );
  const access = d.code === "NOT_PERMITTED" || d.code === "OUT_OF_SCOPE";
  const code = <code className="rounded bg-sunk px-1.5 py-0.5">{d.code}</code>;
  return (
    <div className="max-w-xl" data-testid="access-denied">
      <PageHeader
        title={
          d.code === "OUT_OF_SCOPE"
            ? "This isn't available"
            : access
              ? "Not available for your role"
              : "Not available right now"
        }
        lede={d.message}
      />
      {access && generalNote && <p className="mb-2 text-ink-soft">{ACCESS_DENIED_NOTE}</p>}
      {staff ? (
        <p className="mb-4 text-sm text-ink-soft">Reason code: {code}</p>
      ) : (
        <details className="mb-4 text-sm text-ink-soft">
          <summary className="cursor-pointer">Details for your care team</summary>
          <p className="mt-1">Reason code: {code}</p>
        </details>
      )}
      {back}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  to,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  to?: LinkProps["to"];
}) {
  const inner = (
    <>
      <span className="block font-display text-3xl">{value}</span>
      <span className="block text-sm font-medium">{label}</span>
      {hint && <span className="block text-xs text-ink-soft">{hint}</span>}
    </>
  );
  return to ? (
    <Link to={to} className="block rounded-xl border bg-surface p-4 hover:border-harbor">
      {inner}
    </Link>
  ) : (
    <div className="rounded-xl border bg-surface p-4">{inner}</div>
  );
}

/* ---------------- dialogs ---------------- */

/** A focused review step for consequential actions, using the native modal dialog (focus trapped, Esc closes). */
export function ConfirmDialog({
  trigger,
  title,
  children,
  confirmLabel,
  tone = "primary",
  onConfirm,
  disabled,
  error,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  /** Return the action's result: the dialog closes only when it is truthy (the action succeeded). */
  onConfirm: () => Promise<unknown>;
  disabled?: boolean;
  /** Shown inside the dialog, so a refusal stays visible while the dialog is open. */
  error?: string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  return (
    <>
      {trigger(() => ref.current?.showModal())}
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border bg-surface p-6 text-ink shadow-xl"
      >
        <h2 id={titleId} className="text-2xl">
          {title}
        </h2>
        <div className="mt-3 space-y-3 text-ink-soft">{children}</div>
        {error !== undefined && (
          <div className="mt-3">
            <ErrorText error={error} />
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => ref.current?.close()}>
            Go back
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            disabled={busy || disabled}
            onClick={async () => {
              setBusy(true);
              try {
                if (await onConfirm()) ref.current?.close();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}

/* ---------------- live region ---------------- */

/**
 * Polite announcements for screen readers after actions (saved, sent, held, denied…), and the same
 * words shown visibly for completed actions. The visible note sits at the bottom of the screen,
 * clear of the page content, and stays until it's dismissed, replaced, or the person changes page.
 */
export function LiveRegion() {
  const [msg, setMsg] = useState("");
  const [shown, setShown] = useState<{ text: string; undo?: Undo; id: number } | null>(null);
  const [undoLeft, setUndoLeft] = useState(0);
  const [undoing, setUndoing] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const noteRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  useEffect(
    () =>
      onAnnounce((m, kind, undo) => {
        setMsg("");
        setTimeout(() => setMsg(m), 50);
        setShown(kind === "done" ? { text: m, ...(undo ? { undo } : {}), id: Date.now() } : null);
        setUndoLeft(undo ? UNDO_SECONDS : 0);
      }),
    [],
  );
  // A new page clears the note. (A form that returns to its list raises its note after arriving.)
  useEffect(() => {
    setShown(null);
  }, [path]);
  // Undo is offered for a few seconds, then the note stays without it until dismissed.
  useEffect(() => {
    if (!undoLeft) return;
    const t = setTimeout(() => setUndoLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [undoLeft]);
  // Focus never drops to the page body after an action: it goes to Undo, or to the note itself if
  // the control that was used has gone (e.g. a task moved to Done).
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (shown.undo) undoRef.current?.focus();
      else if (lost) noteRef.current?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [shown]);
  // While the note is showing, keep focused elements scrolled clear of it (WCAG 2.4.11).
  useEffect(() => {
    document.documentElement.style.scrollPaddingBottom = shown ? "7rem" : "";
  }, [shown]);
  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live-region">
        {msg}
      </div>
      {shown && (
        // Bottom-right on wider screens, so it doesn't sit over the page's main column; above the
        // bottom tab bar on phones.
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 md:inset-x-auto md:right-4 md:justify-end max-md:[html:has([data-bottom-bar])_&]:bottom-20">
          <div
            ref={noteRef}
            tabIndex={-1}
            className="rise pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border border-moss/30 bg-moss-soft px-4 py-3 text-sm text-ink shadow-xl focus:outline-2 focus:outline-harbor"
            data-testid="status-note"
          >
            <span aria-hidden className="mt-0.5 text-moss">
              ✓
            </span>
            <p className="flex-1">{shown.text}</p>
            {shown.undo && undoLeft > 0 && (
              <button
                ref={undoRef}
                type="button"
                disabled={undoing}
                className="-my-1 min-h-9 rounded-lg px-2 font-semibold text-harbor underline underline-offset-2"
                onClick={async () => {
                  setUndoing(true);
                  const ok = await shown.undo!.run();
                  setUndoing(false);
                  if (ok) announce("Undone.");
                }}
              >
                {/* A static name: a ticking countdown would be re-read while focused. */}
                {shown.undo.label ?? "Undo"}
              </button>
            )}
            <button
              type="button"
              className="-my-1 min-h-9 rounded-lg px-2 text-harbor underline-offset-2 hover:underline"
              onClick={() => setShown(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * An absolute time, identical on the server and in the browser, that never changes after the page
 * loads. Use `full` (year and zone) for anything auditable: consent, authority, packets, the audit
 * timeline, bereavement and escalations.
 */
export function Stamp({ at, full }: { at: Date | string; full?: boolean }) {
  return <time dateTime={new Date(at).toISOString()}>{full ? stamp(at) : dateTime(at)}</time>;
}

/** A plain-language label with its internal code kept as a tooltip (for support and audit work). */
export function Coded({ label, code, className }: { label: string; code: string; className?: string }) {
  return (
    <span title={`Code: ${code}`} data-code={code} className={className}>
      {label}
    </span>
  );
}

/** A small "Details" disclosure holding an internal code, for screens where staff may need to quote it. */
export function CodeDetails({ code }: { code: string }) {
  return (
    <details className="mt-1 text-xs text-ink-soft">
      <summary className="cursor-pointer">Details</summary>
      Reason code: <code>{code}</code>
    </details>
  );
}
