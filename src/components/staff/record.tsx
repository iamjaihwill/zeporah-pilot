/**
 * Coordination Record v2 (decision 58; spec section 2): the unified timeline and the context
 * column beside it, for the household record's Overview. Read-only apart from logging a partner
 * event (decision 60), which goes through its own confirmation and is labelled simulated.
 */
import { Link } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import type { getHouseholdOverview } from "@/functions/staff";
import { logPartnerEvent, updateEscalation } from "@/functions/staff";
import { getCatchMeUp } from "@/functions/staff-shell";
import { Card, Coded, ConfirmDialog, ErrorText, StateBadge, inputClass } from "@/components/ui";
import { StatusChip } from "./status-chip";
import { ShapeBadges, recordLink } from "./audit-bits";
import { EvidenceLines } from "./prepared";
import { auditLabel, reasonLabel } from "@/domain/labels";
import { QUEUE_LABELS } from "@/domain/queue";
import { cx, dateOnly, stamp, useAction } from "@/lib/client";

export type RecordOverview = Extract<Awaited<ReturnType<typeof getHouseholdOverview>>, { ok: true }>["data"];
type Event = RecordOverview["audit"][number];

/* ------------------------------------------------------------------ timeline */

const FILTERS = [
  ["all", "All", []],
  ["message", "Messages", ["message."]],
  ["update", "Updates", ["update."]],
  ["task", "Tasks", ["task."]],
  ["escalation", "Requests & escalations", ["escalation."]],
  ["sharing", "Sharing & releases", ["consent.", "packet."]],
  ["authority", "Authority", ["authority."]],
  ["partner", "Partner events", ["partner_event."]],
  ["team", "Team & assignment", ["assignment.", "handoff.", "coverage.", "absence."]],
  ["lifecycle", "Lifecycle", ["lifecycle.", "bereavement."]],
] as const;
type Filter = (typeof FILTERS)[number][0];
const PAGE = 50;

/**
 * Every recorded event for this household, newest first, in one stream: exact time, who (and
 * their role at the time), where it came from, one line, and a link to the record it's about.
 * Event labels and safe summaries only — never message or note text.
 */
export function RecordTimeline({ o }: { o: RecordOverview }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const prefixes = FILTERS.find((f) => f[0] === filter)![2] as readonly string[];
  const items = o.audit.filter((e) => !prefixes.length || prefixes.some((p) => e.action.startsWith(p)));
  const label = FILTERS.find((f) => f[0] === filter)![1];
  return (
    <section aria-labelledby="timeline-title" className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="timeline-title" className="text-xl">
          Timeline
        </h2>
        {o.context.canLogPartnerEvent && o.household.lifecycle !== "closed" && <LogPartnerEvent o={o} />}
      </div>
      <div role="group" aria-label="Show events of type" className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => {
              setFilter(k);
              setShown(PAGE);
            }}
            className={cx(
              "min-h-7 rounded-full border px-2.5 text-[0.75rem]",
              filter === k ? "border-harbor bg-harbor-soft font-semibold" : "text-ink-soft hover:text-ink",
            )}
          >
            {l}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="rounded-[var(--s-radius)] border bg-surface px-4 py-6 text-ink-soft">
          {filter === "all"
            ? "Nothing has been recorded for this household yet."
            : `No ${label.toLowerCase()} events for this household.`}{" "}
          {filter !== "all" && (
            <button type="button" className="text-harbor underline" onClick={() => setFilter("all")}>
              Show all
            </button>
          )}
        </p>
      ) : (
        <ol
          aria-label={`Timeline: ${label.toLowerCase()}, newest first`}
          className="divide-y rounded-[var(--s-radius)] border bg-surface"
          data-testid="record-timeline"
        >
          {items.slice(0, shown).map((e) => (
            <TimelineRow key={e.id} e={e} householdId={o.household.id} />
          ))}
        </ol>
      )}
      {items.length > shown ? (
        <div className="mt-2 flex items-center justify-between gap-3 text-[0.8125rem]">
          <span className="text-ink-soft" aria-live="polite">
            Showing {shown} of {items.length}
          </span>
          <button type="button" className="text-harbor underline" onClick={() => setShown((n) => n + PAGE)}>
            Show earlier
          </button>
        </div>
      ) : (
        items.length > 0 && (
          <p className="mt-2 text-[0.75rem] text-ink-soft">
            The household's full log is on the{" "}
            <Link
              to="/staff/households/$householdId"
              params={{ householdId: o.household.id }}
              search={{ tab: "timeline" }}
              className="text-harbor underline"
            >
              Audit tab
            </Link>
            .
          </p>
        )
      )}
    </section>
  );
}

function TimelineRow({ e, householdId }: { e: Event; householdId: string }) {
  const link = recordLink(e);
  // A link back to this same overview adds nothing.
  const here =
    link?.to === "/staff/households/$householdId" &&
    link.params?.["householdId"] === householdId &&
    link.search?.["tab"] === "overview" &&
    !link.hash;
  return (
    <li
      id={`event-${e.id}`}
      tabIndex={-1}
      className="grid scroll-mt-40 gap-x-3 gap-y-0.5 px-3 py-2 text-[0.8125rem] outline-none target:bg-harbor-soft sm:grid-cols-[11.5rem_minmax(0,1fr)]"
    >
      <div className="text-ink-soft">
        <time dateTime={new Date(e.at).toISOString()} className="block whitespace-nowrap">
          {stamp(e.at)}
        </time>
        <span className="block text-ink">{e.actor}</span>
        {e.role && (
          <span className="block text-[0.75rem]">
            {e.role}
            {!e.roleRecorded && " (current role)"}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Coded className="font-medium text-ink" label={auditLabel(e.action)} code={e.action} />
          {e.decision && <StateBadge state={e.decision} />}
          <ShapeBadges e={e} />
        </span>
        {e.partner ? (
          <span className="block">
            <span className="font-medium">{e.partner.organization}:</span> {e.partner.said}
            <span className="block text-[0.75rem] text-ink-soft">
              Happened {stamp(e.partner.occurredAt)}. Entered by staff; simulated.
            </span>
          </span>
        ) : (
          <span className="block text-ink-soft">{e.summary}</span>
        )}
        {e.reasonCode && (
          <Coded
            className="block text-[0.75rem] text-ink-soft"
            label={reasonLabel(e.reasonCode)}
            code={e.reasonCode}
          />
        )}
        {link && !here && (
          <Link {...(link as { to: "/staff" })} className="text-[0.75rem] text-harbor underline">
            Open the record<span className="sr-only">: {auditLabel(e.action)}</span>
          </Link>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ partner events */

const KIND_LABELS = {
  status: "A status change",
  request: "A request",
  acknowledgement: "An acknowledgement",
} as const;

/** Decision 60: record what an outside organization said. Staff-entered, simulated, sent nowhere. */
function LogPartnerEvent({ o }: { o: RecordOverview }) {
  const { act, error } = useAction();
  const known = o.context.organizations.map((x) => x.name);
  const [org, setOrg] = useState(known[0] ?? "");
  const [kind, setKind] = useState<keyof typeof KIND_LABELS>("status");
  const [said, setSaid] = useState("");
  const [when, setWhen] = useState("");
  const listId = `orgs-${o.household.id}`;
  return (
    <ConfirmDialog
      title="Log a partner event"
      confirmLabel="Add to the timeline"
      error={error}
      trigger={(open) => (
        <button
          type="button"
          onClick={() => {
            // Now, to the minute, in this device's time.
            const d = new Date();
            d.setSeconds(0, 0);
            setWhen(new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
            open();
          }}
          className="min-h-8 rounded-[var(--s-radius)] border bg-surface px-3 text-[0.8125rem] font-medium hover:bg-sunk"
        >
          Log a partner event
        </button>
      )}
      onConfirm={() =>
        act(
          () =>
            logPartnerEvent({
              data: {
                householdId: o.household.id,
                organization: org,
                kind,
                said,
                occurredAt: new Date(when).toISOString(),
              },
            }),
          "Partner event added to the timeline.",
        )
      }
    >
      <p>
        For {o.household.name}. It goes on this household's timeline only, labelled simulated, and isn't sent
        anywhere.
      </p>
      <div className="space-y-3 text-ink">
        <label className="block">
          <span className="font-medium">Organization</span>
          <input
            list={listId}
            className={cx(inputClass, "mt-1 w-full")}
            value={org}
            maxLength={120}
            onChange={(e) => setOrg(e.target.value)}
          />
          <datalist id={listId}>
            {known.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="font-medium">What it was</span>
          <select
            className={cx(inputClass, "mt-1 w-full")}
            value={kind}
            onChange={(e) => setKind(e.target.value as keyof typeof KIND_LABELS)}
          >
            {Object.entries(KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-medium">What they said</span>
          <span className="block text-[0.75rem] text-ink-soft">Short, and no clinical details.</span>
          <textarea
            className={cx(inputClass, "mt-1 w-full")}
            rows={3}
            maxLength={280}
            value={said}
            onChange={(e) => setSaid(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="font-medium">When it happened</span>
          <input
            type="datetime-local"
            className={cx(inputClass, "mt-1 w-full")}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </label>
      </div>
    </ConfirmDialog>
  );
}

/* ------------------------------------------------------------------ context column */

/** What's waiting for this household, and who owns each item: its open exceptions. */
export function OpenItems({ o, id }: { o: RecordOverview; id?: string }) {
  const items = o.context.openItems;
  return (
    <Card title={`What's waiting and who owns it (${items.length})`} {...(id ? { id } : {})}>
      {items.length === 0 ? (
        <p className="text-ink-soft">Nothing is open for this household.</p>
      ) : (
        <ul className="space-y-2.5 text-[0.8125rem]">
          {items.slice(0, 5).map((r) => (
            <li key={r.id}>
              <a href={r.link} className="font-medium text-ink hover:underline">
                {r.summary}
              </a>
              <span className="block text-[0.75rem] text-ink-soft">
                {QUEUE_LABELS[r.kind]} · waiting {r.age}
              </span>
              <span className="block text-[0.75rem]">
                Owner: <span className="font-medium">{r.owner ?? "No owner"}</span>
              </span>
              <span className="block text-[0.75rem]">Next: {r.next}</span>
              {r.takeEscalationId && <TakeOwnership id={r.takeEscalationId} what={r.summary} />}
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <p className="mt-3 text-[0.75rem]">
          <Link
            to="/staff/exceptions"
            search={{ household: o.household.id, view: "all" }}
            className="text-harbor underline"
          >
            {items.length > 5 ? `See all ${items.length} in the queue` : "Open in the queue"}
          </Link>
        </p>
      )}
    </Card>
  );
}

function TakeOwnership({ id, what }: { id: string; what: string }) {
  const { act, pending, error } = useAction();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          act(() => updateEscalation({ data: { id, action: "take" } }), "You own this escalation now.")
        }
        className="mt-1 min-h-7 rounded-[var(--s-radius)] border bg-surface px-2 text-[0.75rem] font-medium hover:bg-sunk"
      >
        Take ownership<span className="sr-only">: {what}</span>
      </button>
      <ErrorText error={error} />
    </>
  );
}

/**
 * The context column, grouped by the questions the record answers (direction refinement D-1): what's
 * waiting and who owns it, who is involved, what has been agreed, what has been shared.
 */
export function ContextColumn({ o, careTeam }: { o: RecordOverview; careTeam: ReactNode }) {
  const c = o.context;
  const contact = new Map(o.members.map((m) => [m.actorId, m.contactPreference]));
  const agreed = c.organizations.filter((g) => g.consents.length > 0);
  const authority = c.participants.filter((p) => p.authority.length > 0);
  const shared = c.organizations.filter((g) => g.access.length > 0);
  return (
    <div className="space-y-4">
      <div className="max-lg:hidden">
        <OpenItems o={o} id="open-items" />
      </div>
      <Card title="Who is involved">
        {c.participants.length === 0 ? (
          <p className="text-ink-soft">No one in the household yet.</p>
        ) : (
          <ul className="space-y-2.5 text-[0.8125rem]">
            {c.participants.map((p) => (
              <li key={p.actorId}>
                <span className="font-medium">{p.name}</span>{" "}
                <span className="text-ink-soft">· {p.roleLabels.join(", ")}</span>
                {p.taskOnly && <span className="block text-[0.75rem] text-ink-soft">For one task</span>}
                {p.until && (
                  <span className="block text-[0.75rem] text-ink-soft">Until {stamp(p.until)}</span>
                )}
                {contact.get(p.actorId) && (
                  <span className="block text-[0.75rem] text-ink-soft">
                    Prefers to be reached: {contact.get(p.actorId)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {c.former.length > 0 && (
          <details className="mt-3 text-[0.8125rem]">
            <summary className="cursor-pointer text-ink-soft">Show former ({c.former.length})</summary>
            <ul className="mt-2 space-y-1 text-ink-soft">
              {c.former.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  {f.name} · {f.role}
                  {f.endedAt && ` · ended ${dateOnly(f.endedAt)}`}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="mt-3 border-t pt-2 text-[0.75rem]">
          <Link
            to="/staff/households/$householdId/access"
            params={{ householdId: o.household.id }}
            className="text-harbor underline"
          >
            Who can see what
          </Link>
        </p>
      </Card>
      <div id="care-team" tabIndex={-1} className="outline-none">
        {careTeam}
      </div>
      <Card title="What has been agreed">
        {agreed.length === 0 && authority.length === 0 ? (
          <p className="text-ink-soft">No consents or authority records yet.</p>
        ) : (
          <ul className="space-y-3 text-[0.8125rem]">
            {agreed.map((g) => (
              <li key={g.name}>
                <span className="font-medium">Sharing with {g.name}</span>
                <ul className="mt-1 space-y-1">
                  {g.consents.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center gap-x-2">
                      <span className="text-ink-soft">{x.purpose}</span>
                      <StatusChip domain="consent" value={x.state} />
                      <span className="text-[0.75rem] text-ink-soft">until {dateOnly(x.until)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {authority.map((p) => (
              <li key={p.actorId}>
                <span className="font-medium">{p.name}</span>
                <span className="block text-ink-soft">{p.authority.join(", ")}: active workflow</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="What has been shared">
        {shared.length === 0 ? (
          <p className="text-ink-soft">Nothing is shared outside the household.</p>
        ) : (
          <ul className="space-y-3 text-[0.8125rem]">
            {shared.map((g) => (
              <li key={g.name}>
                <span className="font-medium">{g.name}</span>
                <ul className="mt-1 space-y-1">
                  {g.access
                    .filter((a) => !a.ended)
                    .map((a) => (
                      <li key={a.packetId} className="text-ink-soft">
                        {a.person} reads “{a.purpose}”, read-only, until {stamp(a.until)}
                        <span className="block text-[0.75rem]">
                          {a.acknowledged
                            ? `Acknowledged ${stamp(a.acknowledged)}`
                            : a.opened
                              ? `Opened ${stamp(a.opened)}`
                              : "Not opened yet"}
                        </span>
                      </li>
                    ))}
                  {g.access.some((a) => a.ended) && (
                    <li className="text-[0.75rem] text-ink-soft">
                      {g.access.filter((a) => a.ended).length} ended packet access
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Care-plan context">
        {o.record ? (
          <dl className="space-y-2 text-[0.8125rem]">
            <div>
              <dt className="font-medium">What matters to the household</dt>
              <dd className="text-ink-soft">{o.record.familyPriorities || "Not recorded yet."}</dd>
            </div>
            <div>
              <dt className="font-medium">Visit rhythm</dt>
              <dd className="text-ink-soft">{o.record.visitRhythm}</dd>
            </div>
            <div>
              <dt className="font-medium">After hours</dt>
              <dd className="text-ink-soft">
                {o.hotline
                  ? `For anything urgent, the family calls the hospice 24-hour line: ${o.hotline}. Zeporah is not monitored for emergencies.`
                  : "No 24-hour line is set. An administrator needs to add one in Hospice settings."}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Clinical record</dt>
              <dd className="text-ink-soft" data-testid="ehr-pointer">
                {o.record.ehrReference
                  ? `${o.record.ehrReference} in the hospice's EHR.`
                  : "No EHR reference recorded."}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-ink-soft">No coordination record.</p>
        )}
        <p className="mt-3 text-[0.75rem] text-ink-faint">
          Coordination context. Clinical details live in the EHR.
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ catch me up (decision 58, workstream 5) */

type Brief = Extract<Awaited<ReturnType<typeof getCatchMeUp>>, { ok: true }>["data"];

/**
 * A short summary of the household, prepared from its record by fixed rules (no AI), each line
 * citing the recorded events it comes from. Opening it is recorded (summary.prepared).
 */
export function CatchMeUp({ householdId }: { householdId: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setBrief(null);
    setError(null);
    ref.current?.showModal();
    const r = await getCatchMeUp({ data: { householdId } });
    if (r.ok) setBrief(r.data);
    else setError(r.message);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => void open()}
        className="min-h-8 rounded-[var(--s-radius)] border bg-surface px-3 text-[0.8125rem] font-medium hover:bg-sunk"
      >
        Catch me up
      </button>
      <dialog
        ref={ref}
        aria-labelledby="brief-title"
        className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-2xl border bg-surface p-6 text-ink shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="brief-title" className="text-2xl">
            Catch me up
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="rounded px-2 py-1 text-[0.8125rem] text-ink-soft hover:bg-sunk"
          >
            Close
          </button>
        </div>
        <p className="mt-1 text-[0.75rem] text-ink-soft" data-testid="brief-label">
          Prepared from this household's record by fixed rules, not AI. Every line links to the events it
          comes from.{brief && ` As of ${stamp(brief.asOf)}.`}
        </p>
        {error ? (
          <ErrorText error={error} />
        ) : !brief ? (
          <p className="mt-4 text-ink-soft">Preparing…</p>
        ) : brief.lines.length === 0 ? (
          <p className="mt-4 text-ink-soft">Nothing has been recorded for this household yet.</p>
        ) : (
          <ol className="mt-4 space-y-3 text-[0.875rem]" data-testid="brief-lines">
            {brief.lines.map((l, i) => (
              <li key={i}>
                <p>{l.text}</p>
                <p className="mt-1 text-[0.75rem] text-ink-soft">Sources</p>
                <ul className="flex flex-wrap gap-x-2 gap-y-1 text-[0.75rem]">
                  {l.sources.map((x) => (
                    <li key={x.id}>
                      <a
                        href={`/staff/households/${householdId}?tab=overview#event-${x.id}`}
                        onClick={() => ref.current?.close()}
                        className="inline-flex min-h-6 items-center rounded border px-1.5 text-harbor underline-offset-2 hover:underline"
                      >
                        {x.label}, {stamp(x.at)}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        {brief && brief.lines.length > 0 && (
          <EvidenceLines
            used={`${new Set(brief.lines.flatMap((l) => l.sources.map((x) => x.id))).size} recorded events in this household, linked on each line. Never private notes, internal note text or message text.`}
            suggests="Nothing to do. It's a summary."
            approve="Nothing. Opening it is recorded, with the events it cites."
          />
        )}
      </dialog>
    </>
  );
}
