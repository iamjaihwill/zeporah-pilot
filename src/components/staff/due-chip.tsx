import { cx } from "@/lib/client";

/** Whether a due date has passed or falls today (pilot time zone). */
export function dueOf(dueAt: Date | string | null | undefined, now = new Date()): "overdue" | "today" | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (d.getTime() < now.getTime()) return "overdue";
  const day = (x: Date) => x.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  return day(d) === day(now) ? "today" : null;
}

/** "Overdue" or "Due today", with an icon so colour is never the only signal. Nothing otherwise. */
export function DueChip({ due, className }: { due: "overdue" | "today" | null; className?: string }) {
  if (!due) return null;
  return (
    <span
      data-due={due}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-px text-[0.75rem] leading-5 font-semibold whitespace-nowrap",
        due === "overdue"
          ? "border-rose/30 bg-rose-soft text-rose"
          : "border-ochre/30 bg-ochre-soft text-ochre",
        className,
      )}
    >
      <span aria-hidden>{due === "overdue" ? "!" : "◷"}</span>
      {due === "overdue" ? "Overdue" : "Due today"}
    </span>
  );
}
