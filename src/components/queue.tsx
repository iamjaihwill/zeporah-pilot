import { Link, useRouter } from "@tanstack/react-router";
import { updateEscalation } from "@/functions/staff";
import { Badge, Button, EmptyState, Stamp, type Tone } from "@/components/ui";
import { useAction } from "@/lib/client";
import {
  NO_ACTION,
  NO_OWNER,
  PRIORITY_LABELS,
  QUEUE_KINDS,
  QUEUE_LABELS,
  type Priority,
  type QueueKind,
  type QueueRow,
} from "@/domain/queue";
import { cx } from "@/lib/client";

export type QueueItem = QueueRow;

const KIND_TONE: Record<QueueKind, Tone> = {
  correction: "rose",
  escalation: "rose",
  authority: "ochre",
  consent: "ochre",
  transition: "staff",
  packet: "ochre",
  message: "harbor",
  acknowledgement: "harbor",
  task: "neutral",
  onboarding: "neutral",
  missing_consent: "rose",
  access_ending: "ochre",
  recipient_unopened: "harbor",
  handoff: "staff",
  coverage: "rose",
  checkin: "neutral",
  risk: "ochre",
};
/** Shape and word, never color alone. */
const PRIORITY_MARK: Record<Priority, { mark: string; tone: Tone }> = {
  high: { mark: "▲", tone: "rose" },
  normal: { mark: "●", tone: "ochre" },
  routine: { mark: "○", tone: "neutral" },
};

function PriorityBadge({ p, reason }: { p: Priority; reason: string }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <Badge tone={PRIORITY_MARK[p].tone}>
        <span aria-hidden>{PRIORITY_MARK[p].mark}</span> {PRIORITY_LABELS[p]}
        <span className="sr-only"> workflow priority</span>
      </Badge>
      <span className="text-xs text-ink-soft">{reason}</span>
    </span>
  );
}

/** A real link (opens in a new tab normally) that navigates in-app on a plain click. */
function RowLink({ q }: { q: QueueRow }) {
  const router = useRouter();
  return (
    <a
      href={q.link}
      className="font-medium text-harbor underline-offset-2 hover:underline"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        router.history.push(q.link);
      }}
    >
      {q.summary}
      <span className="sr-only">, {q.household}</span>
    </a>
  );
}

const LastAction = ({ q }: { q: QueueRow }) =>
  q.lastAction ? (
    <>
      {q.lastAction.actor} {q.lastAction.did}
      <span className="block text-xs">
        <Stamp at={q.lastAction.at} full />
      </span>
    </>
  ) : (
    <span className="italic">{NO_ACTION}</span>
  );

/** Filter links for the full queue page; the current choice is marked for assistive technology. */
export function QueueFilter({
  items,
  kind,
  search = {},
}: {
  items: QueueRow[];
  kind?: QueueKind | undefined;
  search?: Record<string, string | undefined>;
}) {
  const present = QUEUE_KINDS.filter((k) => items.some((q) => q.kind === k));
  const chip = (active: boolean) =>
    cx(
      "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm",
      active
        ? "border-harbor bg-harbor-soft font-semibold text-ink"
        : "bg-surface text-ink-soft hover:text-ink",
    );
  return (
    <nav aria-label="Filter the queue" className="mb-4">
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link
            to="/staff/exceptions"
            search={{ ...search, kind: undefined }}
            className={chip(!kind)}
            aria-current={!kind ? "page" : undefined}
          >
            Everything <span className="text-xs">({items.length})</span>
          </Link>
        </li>
        {present.map((k) => (
          <li key={k}>
            <Link
              to="/staff/exceptions"
              search={{ ...search, kind: k }}
              className={chip(kind === k)}
              aria-current={kind === k ? "page" : undefined}
            >
              {QUEUE_LABELS[k]} <span className="text-xs">({items.filter((q) => q.kind === k).length})</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The work list. Every row shows the same things — priority (with its reason), what and where,
 * state, owner, last action, next step and how long it has waited — so staff never have to open
 * another screen to know what an item needs. Wide screens get a table; narrow screens get one card
 * per item with the same fields, in the same order.
 */
/** Takes ownership straight from the row, when that's the next step and the viewer may. */
function TakeButton({ q }: { q: QueueRow }) {
  const { act, pending, error } = useAction();
  if (!q.takeEscalationId) return null;
  const id = q.takeEscalationId;
  return (
    <span className="mt-1 block">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          act(() => updateEscalation({ data: { id, action: "take" } }), "You own this escalation now.")
        }
      >
        Take ownership
        <span className="sr-only">
          : {q.summary}, {q.household}
        </span>
      </Button>
      {error && <span className="block text-xs text-rose">{error}</span>}
    </span>
  );
}

export type QueueSort = "priority" | "waiting";

/** A sortable column header: a link that sets ?sort=, with aria-sort on the active column. */
function SortHeader({
  label,
  value,
  sort,
  search,
}: {
  label: string;
  value: QueueSort;
  sort: QueueSort | undefined;
  search: Record<string, string | undefined>;
}) {
  const active = (sort ?? "priority") === value;
  return (
    <th
      scope="col"
      className="px-3 py-2.5"
      aria-sort={active ? (value === "waiting" ? "descending" : "ascending") : "none"}
    >
      <Link
        to="/staff/exceptions"
        search={{ ...search, sort: value === "priority" ? undefined : value }}
        className="underline-offset-2 hover:underline"
      >
        {label}
        {active && <span aria-hidden> ▾</span>}
        <span className="sr-only">{active ? " (sorted)" : ", sort by this"}</span>
      </Link>
    </th>
  );
}

export function QueueTable({
  items,
  caption,
  sortable,
}: {
  items: QueueRow[];
  caption: string;
  /** On the full queue page: makes Priority and Waiting sortable. */
  sortable?: { sort: QueueSort | undefined; search: Record<string, string | undefined> };
}) {
  if (!items.length)
    return <EmptyState title="Nothing waiting">New messages, holds and reviews will appear here.</EmptyState>;
  return (
    <>
      <div className="hidden relative overflow-x-auto rounded-[var(--radius-card)] border bg-surface md:block">
        <table className="w-full min-w-[68rem] text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b bg-sunk text-xs tracking-wide text-ink-soft uppercase">
            <tr>
              {sortable ? (
                <SortHeader label="Workflow priority" value="priority" {...sortable} />
              ) : (
                <th scope="col" className="px-3 py-2.5">
                  Workflow priority
                </th>
              )}
              <th scope="col" className="px-3 py-2.5">
                Item
              </th>
              <th scope="col" className="px-3 py-2.5">
                State
              </th>
              <th scope="col" className="px-3 py-2.5">
                Owner
              </th>
              <th scope="col" className="px-3 py-2.5">
                Last action
              </th>
              <th scope="col" className="px-3 py-2.5">
                Next step
              </th>
              {sortable ? (
                <SortHeader label="Waiting" value="waiting" {...sortable} />
              ) : (
                <th scope="col" className="px-3 py-2.5">
                  Waiting
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((q, i) => (
              <tr key={i} className="align-top hover:bg-sunk">
                <td className="px-3 py-2.5">
                  <PriorityBadge p={q.priority} reason={q.priorityReason} />
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={KIND_TONE[q.kind]}>{QUEUE_LABELS[q.kind]}</Badge>
                  <span className="mt-1 block">
                    <RowLink q={q} />
                  </span>
                  <span className="block text-ink-soft" aria-hidden>
                    {q.household}
                  </span>
                </td>
                <td className="px-3 py-2.5">{q.state}</td>
                <td className="px-3 py-2.5 text-ink-soft">
                  {q.owner ?? <span className="italic">{NO_OWNER}</span>}
                </td>
                <td className="px-3 py-2.5 text-ink-soft">
                  <LastAction q={q} />
                </td>
                <td className="px-3 py-2.5">
                  {q.next}
                  <TakeButton q={q} />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-ink-soft">
                  {q.age}
                  <span className="block text-xs">
                    since <Stamp at={q.since} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden" aria-label={caption}>
        {items.map((q, i) => (
          <li key={i} className="rounded-xl border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Badge tone={KIND_TONE[q.kind]}>{QUEUE_LABELS[q.kind]}</Badge>
              <PriorityBadge p={q.priority} reason={q.priorityReason} />
            </div>
            <p className="mt-2">
              <RowLink q={q} />
            </p>
            <p className="text-sm text-ink-soft" aria-hidden>
              {q.household}
            </p>
            <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-ink-soft">State</dt>
              <dd>{q.state}</dd>
              <dt className="text-ink-soft">Owner</dt>
              <dd>{q.owner ?? <span className="italic">{NO_OWNER}</span>}</dd>
              <dt className="text-ink-soft">Last action</dt>
              <dd>
                <LastAction q={q} />
              </dd>
              <dt className="text-ink-soft">Next step</dt>
              <dd>
                {q.next}
                <TakeButton q={q} />
              </dd>
              <dt className="text-ink-soft">Waiting</dt>
              <dd>{q.age}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
