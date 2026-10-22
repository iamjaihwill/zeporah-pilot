import { createContext, useContext } from "react";
import { statusOf, type StatusDomain, type Tone } from "@/domain/status";
import { cx } from "@/lib/client";
import type { OrgSettings } from "@/domain/org-settings";

/**
 * The hospice's wording for non-sensitive statuses (decision 39): task and escalation only.
 * Consent, authority, packet and household statuses always use the standard wording.
 */
export const StatusLabelsContext = createContext<OrgSettings["statusLabels"]>({ task: {}, escalation: {} });

const TONES: Record<Tone, string> = {
  neutral: "bg-sunk text-ink-soft border-line",
  info: "bg-harbor-soft text-harbor-strong border-harbor/20",
  success: "bg-moss-soft text-moss border-moss/25",
  warning: "bg-ochre-soft text-ochre border-ochre/30",
  danger: "bg-rose-soft text-rose border-rose/30",
};
const ICON: Record<string, string> = { dot: "●", check: "✓", alert: "!", clock: "◷", lock: "—" };

/**
 * The one way the staff workspace shows a status (staff rework, section 4): a label from the
 * status map, its tone, and an icon so color is never the only signal. The stored code is kept in
 * a tooltip for audit and debugging, never as the visible text.
 */
export function StatusChip({
  domain,
  value,
  className,
}: {
  domain: StatusDomain;
  value: string;
  className?: string;
}) {
  const overrides = useContext(StatusLabelsContext);
  const base = statusOf(domain, value);
  const custom =
    domain === "task" || domain === "escalation"
      ? (overrides[domain] as Record<string, string | undefined>)[value]
      : undefined;
  const s = custom ? { ...base, label: custom } : base;
  return (
    <span
      title={`Status code: ${value}`}
      data-status={`${domain}:${value}`}
      className={cx(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-px text-[0.75rem] leading-5 font-semibold",
        // Short labels stay on one line; a long one (a held consent's reason) wraps rather than
        // pushing the page sideways on a tablet.
        s.label.length > 32 ? "rounded-xl text-left whitespace-normal" : "whitespace-nowrap",
        TONES[s.tone],
        className,
      )}
    >
      {s.icon && (
        <span aria-hidden className="text-[0.7rem]">
          {ICON[s.icon]}
        </span>
      )}
      <span className="truncate">{s.label}</span>
    </span>
  );
}
