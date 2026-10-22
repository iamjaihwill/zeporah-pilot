import { Skeleton } from "./page";

/** Shown while a staff page loads for the first time (refreshes keep the current content). */
export function StaffPending() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-4 h-7 w-48 animate-pulse rounded bg-sunk" />
      <span className="sr-only">Loading…</span>
      <Skeleton rows={8} />
    </div>
  );
}
