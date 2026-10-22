import { Button } from "@/components/ui";
import { DEFAULT_NEXT, type QueueRow } from "@/domain/queue";
import { StatusChip } from "./status-chip";

/**
 * Cells shared by My work and the queue, so an item reads the same on both. Statuses and next steps
 * that every row of a kind shares ("Open", "Complete the task") are left for screen readers only, so
 * the rows that differ stand out.
 */
export function QueueStatusCell({ r }: { r: QueueRow }) {
  return r.status.domain === "task" && r.status.value === "open" ? (
    <span className="sr-only">Open</span>
  ) : (
    <StatusChip domain={r.status.domain} value={r.status.value} />
  );
}

/** The next step, or the "Take ownership" button when that is the step and the viewer may take it. */
export function QueueNextCell({
  r,
  take,
  pending,
}: {
  r: QueueRow;
  take: (r: QueueRow) => void;
  pending: string | null;
}) {
  if (r.action?.type === "take")
    return (
      <Button
        size="sm"
        variant="secondary"
        className="whitespace-nowrap"
        data-row-action
        disabled={pending !== null}
        onClick={() => take(r)}
      >
        {pending === r.id ? "Taking…" : "Take ownership"}
        <span className="sr-only">
          : {r.summary}, {r.household}
        </span>
      </Button>
    );
  if (r.next === DEFAULT_NEXT[r.kind]) return <span className="sr-only">{r.next}</span>;
  return (
    <span className="q-next block w-36 text-ink-soft xl:w-44" title={r.next}>
      {r.next}
    </span>
  );
}

/** "4 d" on screen, "4 days" for screen readers. */
export function WaitingCell({ r, title }: { r: QueueRow; title?: string | undefined }) {
  return (
    <span title={title ?? r.age} className="whitespace-nowrap">
      <span aria-hidden>{r.ageShort}</span>
      <span className="sr-only">{r.age}</span>
    </span>
  );
}
