/** What every prepared draft says it used: they're fixed examples, not generated from the record. */
const SYNTHETIC_USED = "Nothing from the record. It's a fixed synthetic example written for this demo.";

/**
 * A synthetic prepared draft for a demo moment (decision 58, workstream 5). Always labelled; the
 * person chooses to use it, can edit it, and sends it themselves. It says what it used, what it
 * suggests and what the person would be approving (direction refinement D-4).
 */
export function PreparedDraft({
  label,
  text,
  suggests,
  approve,
  onUse,
}: {
  label: string;
  text: string;
  /** What the draft is, in a few words ("A reply to the household"). */
  suggests: string;
  /** What using it commits the person to, and what it doesn't. */
  approve: string;
  onUse: () => void;
}) {
  return (
    <div
      className="rounded-[var(--s-radius)] border border-harbor/30 bg-harbor-soft/60 p-3 text-[0.8125rem]"
      data-testid="prepared-draft"
    >
      <p className="text-[0.6875rem] font-semibold tracking-wide text-harbor uppercase">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-ink">{text}</p>
      <EvidenceLines used={SYNTHETIC_USED} suggests={suggests} approve={approve} />
      <button
        type="button"
        onClick={onUse}
        className="mt-2 min-h-7 rounded-[var(--s-radius)] border bg-surface px-2.5 text-[0.75rem] font-medium hover:bg-sunk"
      >
        Use this draft
      </button>
    </div>
  );
}

/** The same three lines on every prepared item: what it used, what it suggests, what you approve. */
export function EvidenceLines({
  used,
  suggests,
  approve,
}: {
  used: string;
  suggests: string;
  approve: string;
}) {
  return (
    <dl
      className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-0.5 text-[0.75rem]"
      data-testid="prepared-evidence"
    >
      <dt className="text-ink-soft">Used</dt>
      <dd>{used}</dd>
      <dt className="text-ink-soft">Suggests</dt>
      <dd>{suggests}</dd>
      <dt className="text-ink-soft">You approve</dt>
      <dd>{approve}</dd>
    </dl>
  );
}
