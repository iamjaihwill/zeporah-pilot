/**
 * Planned absences, cover and handoffs (decision 58, workstream 3; decisions 59–61). Operations
 * record absences and offer cover or a transfer; the receiving care guide accepts or declines.
 * Every step confirms first and restates the household, the person and the exact times.
 */
import { useState } from "react";
import type { getCoverageBoard, getMyHandoffs } from "@/functions/staff-shell";
import {
  acceptHandoff,
  cancelAbsence,
  declineHandoff,
  offerCover,
  offerTransfer,
  recordAbsence,
  withdrawHandoff,
} from "@/functions/staff-shell";
import { Button, Card, ConfirmDialog, inputClass } from "@/components/ui";
import { cx, stamp, useAction } from "@/lib/client";
import { PreparedDraft } from "./prepared";

type Board = Extract<Awaited<ReturnType<typeof getCoverageBoard>>, { ok: true }>["data"];
type Mine = Extract<Awaited<ReturnType<typeof getMyHandoffs>>, { ok: true }>["data"];

/** A local datetime-local value for an ISO time, and back. */
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const iso = (v: string) => new Date(v).toISOString();

/* ------------------------------------------------------------------ operations */

export function PlannedAbsences({ board }: { board: Board }) {
  return (
    <section aria-labelledby="absences" className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="absences" className="text-2xl">
          Planned absences and cover
        </h2>
        <RecordAbsence guides={board.guides} />
      </div>
      {board.absences.length === 0 ? (
        <p className="rounded-[var(--s-radius)] border bg-surface px-4 py-4 text-ink-soft">
          No one is away now or soon.
        </p>
      ) : (
        <ul className="space-y-3">
          {board.absences.map((a) => (
            <li key={a.id}>
              <Card
                title={`${a.person} · ${stamp(a.startsAt)} to ${stamp(a.endsAt)}`}
                actions={<CancelAbsence id={a.id} who={a.person} />}
              >
                <p className="text-[0.8125rem] text-ink-soft">
                  {a.started ? "Away now. " : ""}Reason: {a.reason}
                </p>
                {a.households.length === 0 ? (
                  <p className="mt-2 text-ink-soft">{a.person} has no households to cover.</p>
                ) : (
                  <table className="mt-2 w-full text-[0.8125rem]">
                    <caption className="sr-only">Cover for {a.person}'s households</caption>
                    <thead className="text-left text-[0.75rem] text-ink-soft">
                      <tr>
                        <th scope="col" className="py-1 pr-3 font-semibold">
                          Household
                        </th>
                        <th scope="col" className="py-1 pr-3 font-semibold">
                          Cover
                        </th>
                        <th scope="col" className="py-1 font-semibold">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.households.map((h) => (
                        <tr key={h.householdId} className="border-t align-top">
                          <td className="py-1.5 pr-3 font-medium">{h.name}</td>
                          <td className="py-1.5 pr-3">
                            {!h.cover && h.alsoAssigned.length > 0 ? (
                              <span className="text-ink-soft">
                                {h.alsoAssigned.join(", ")} also assigned; cover optional
                              </span>
                            ) : (
                              <CoverState c={h.cover} />
                            )}
                          </td>
                          <td className="py-1.5 text-right">
                            {h.cover?.state === "accepted" ? null : (
                              <div className="flex flex-wrap justify-end gap-2">
                                {h.cover?.state === "offered" && (
                                  <Withdraw id={h.cover.id} what={`cover for ${h.name}`} />
                                )}
                                <OfferCover absence={a} household={h} again={!!h.cover} />
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {board.transfers.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-lg">Households offered to another care guide</h3>
          <ul className="space-y-1.5 text-[0.8125rem]">
            {board.transfers.map((x) => (
              <li
                key={x.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border bg-surface px-3 py-2"
              >
                <span>
                  From {x.from} to {x.to}:{" "}
                  {x.state === "declined" ? (
                    <span className="text-ochre">declined — {x.declineReason}</span>
                  ) : (
                    <>
                      waiting for {x.to} to accept, by {stamp(x.acceptBy)}
                    </>
                  )}
                </span>
                <Withdraw id={x.id} what="this offer" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CoverState({ c }: { c: Board["absences"][number]["households"][number]["cover"] }) {
  if (!c) return <span className="font-semibold text-rose">No cover yet</span>;
  if (c.state === "accepted") return <span className="font-semibold text-moss">{c.to} accepted</span>;
  if (c.state === "declined")
    return (
      <span className="text-ochre">
        {c.to} declined: {c.declineReason}
      </span>
    );
  return (
    <span className={cx(c.stalled && "font-semibold text-ochre")}>
      Offered to {c.to} · {c.stalled ? "not accepted in time" : `accept by ${stamp(c.acceptBy)}`}
    </span>
  );
}

function RecordAbsence({ guides }: { guides: Board["guides"] }) {
  const { act, error } = useAction();
  const [who, setWho] = useState(guides[0]?.actorId ?? "");
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setHours(8, 0, 0, 0);
  const [from, setFrom] = useState(local(tomorrow));
  const [to, setTo] = useState(local(new Date(tomorrow.getTime() + 34 * 3_600_000)));
  const [reason, setReason] = useState("");
  const name = guides.find((g) => g.actorId === who)?.name ?? "";
  return (
    <ConfirmDialog
      title="Record a planned absence"
      confirmLabel="Record the absence"
      error={error}
      trigger={(o) => (
        <Button size="sm" variant="secondary" onClick={o}>
          Record an absence…
        </Button>
      )}
      onConfirm={() =>
        act(
          () => recordAbsence({ data: { actorId: who, startsAt: iso(from), endsAt: iso(to), reason } }),
          `Absence recorded for ${name}. Offer cover for their households next.`,
        )
      }
    >
      <p>
        Recording an absence changes no one's access. You then offer cover for each household; it starts only
        when the covering guide accepts, and only for these dates.
      </p>
      <div className="space-y-3 text-ink">
        <label className="block">
          <span className="font-medium">Care guide</span>
          <select
            className={cx(inputClass, "mt-1 w-full")}
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            {guides.map((g) => (
              <option key={g.actorId} value={g.actorId}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-medium">From</span>
          <input
            type="datetime-local"
            className={cx(inputClass, "mt-1 w-full")}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="font-medium">Until</span>
          <input
            type="datetime-local"
            className={cx(inputClass, "mt-1 w-full")}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="font-medium">Reason</span>
          <span className="block text-[0.75rem] text-ink-soft">
            Required. No health details; only staff see it.
          </span>
          <input
            className={cx(inputClass, "mt-1 w-full")}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
    </ConfirmDialog>
  );
}

function CancelAbsence({ id, who }: { id: string; who: string }) {
  const { act, error } = useAction();
  return (
    <ConfirmDialog
      title={`Cancel ${who}'s absence?`}
      confirmLabel="Cancel the absence"
      tone="danger"
      error={error}
      trigger={(o) => (
        <Button size="sm" variant="quiet" onClick={o}>
          Cancel absence…
        </Button>
      )}
      onConfirm={() => act(() => cancelAbsence({ data: { id } }), "Absence cancelled.")}
    >
      <p>Open cover offers are withdrawn, and any cover already accepted ends now.</p>
    </ConfirmDialog>
  );
}

function OfferCover({
  absence,
  household,
  again,
}: {
  absence: Board["absences"][number];
  household: Board["absences"][number]["households"][number];
  again: boolean;
}) {
  const { act, error } = useAction();
  const [to, setTo] = useState(absence.candidates[0]?.actorId ?? "");
  const [note, setNote] = useState("");
  const [usedPrepared, setUsedPrepared] = useState(false);
  const name = absence.candidates.find((g) => g.actorId === to)?.name ?? "";
  return (
    <ConfirmDialog
      title={`Offer cover for ${household.name}?`}
      confirmLabel="Offer cover"
      error={error}
      disabled={!absence.candidates.length}
      trigger={(o) => (
        <Button size="sm" variant="secondary" onClick={o} disabled={!absence.candidates.length}>
          {again ? "Offer to someone else…" : "Offer cover…"}
          <span className="sr-only">: {household.name}</span>
        </Button>
      )}
      onConfirm={() =>
        act(
          () =>
            offerCover({
              data: {
                absenceId: absence.id,
                householdId: household.householdId,
                toActorId: to,
                note,
                prepared: usedPrepared,
              },
            }),
          `Cover offered to ${name}.`,
        )
      }
    >
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-ink">
        <dt className="text-ink-soft">Household</dt>
        <dd>{household.name}</dd>
        <dt className="text-ink-soft">Covering for</dt>
        <dd>{absence.person}</dd>
        <dt className="text-ink-soft">From</dt>
        <dd>{stamp(absence.startsAt)}</dd>
        <dt className="text-ink-soft">Until</dt>
        <dd>{stamp(absence.endsAt)}</dd>
      </dl>
      <p>
        Nothing changes until they accept. Then they can open this household as its care guide from the start
        time, and that access ends by itself at the end time.
      </p>
      <div className="space-y-3 text-ink">
        <label className="block">
          <span className="font-medium">Offer to</span>
          <select
            className={cx(inputClass, "mt-1 w-full")}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            {absence.candidates.map((g) => (
              <option key={g.actorId} value={g.actorId}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {household.preparedNote && !usedPrepared && (
          <PreparedDraft
            label="Prepared with Copilot · synthetic example"
            text={household.preparedNote}
            suggests="A handoff note for the covering care guide."
            approve="Nothing yet. The note goes with the offer only when you confirm the offer."
            onUse={() => {
              setNote(household.preparedNote!);
              setUsedPrepared(true);
            }}
          />
        )}
        <label className="block">
          <span className="font-medium">Handoff note (optional)</span>
          <span className="block text-[0.75rem] text-ink-soft">
            What they need to know. Only staff see it.
          </span>
          <textarea
            className={cx(inputClass, "mt-1 w-full")}
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
    </ConfirmDialog>
  );
}

function Withdraw({ id, what }: { id: string; what: string }) {
  const { act, error } = useAction();
  return (
    <ConfirmDialog
      title={`Withdraw ${what}?`}
      confirmLabel="Withdraw"
      error={error}
      trigger={(o) => (
        <Button size="sm" variant="quiet" onClick={o}>
          Withdraw…
        </Button>
      )}
      onConfirm={() => act(() => withdrawHandoff({ data: { id } }), "Offer withdrawn.")}
    >
      <p>The person it was offered to won't be able to accept it.</p>
    </ConfirmDialog>
  );
}

/** Operations: offer a household permanently to another care guide (story C-7). */
export function HandOver({
  householdId,
  householdName,
  from,
  guides,
}: {
  householdId: string;
  householdName: string;
  from: { actorId: string; name: string };
  guides: { actorId: string; name: string }[];
}) {
  const { act, error } = useAction();
  const options = guides.filter((g) => g.actorId !== from.actorId);
  const [to, setTo] = useState(options[0]?.actorId ?? "");
  const [note, setNote] = useState("");
  const name = options.find((g) => g.actorId === to)?.name ?? "";
  if (!options.length) return null;
  return (
    <ConfirmDialog
      title={`Hand ${householdName} over?`}
      confirmLabel="Offer the handoff"
      error={error}
      trigger={(o) => (
        <Button size="sm" variant="quiet" onClick={o}>
          Hand over…<span className="sr-only"> from {from.name}</span>
        </Button>
      )}
      onConfirm={() =>
        act(
          () => offerTransfer({ data: { householdId, fromActorId: from.actorId, toActorId: to, note } }),
          `Handoff offered to ${name}.`,
        )
      }
    >
      <p>
        {from.name} stays the care guide until {name || "they"} accept. Then {from.name}'s open escalations
        and care-team tasks here move to them, and {from.name}'s assignment ends.
      </p>
      <div className="space-y-3 text-ink">
        <label className="block">
          <span className="font-medium">Offer to</span>
          <select
            className={cx(inputClass, "mt-1 w-full")}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            {options.map((g) => (
              <option key={g.actorId} value={g.actorId}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-medium">Handoff note (optional)</span>
          <textarea
            className={cx(inputClass, "mt-1 w-full")}
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
    </ConfirmDialog>
  );
}

/* ------------------------------------------------------------------ the receiving care guide */

/** On My work: households offered to me, with the note, and Accept or Decline (with a reason). */
export function HandoffsForMe({ items }: { items: Mine }) {
  if (!items.length) return null;
  return (
    <section id="handoffs" aria-labelledby="handoffs-title" tabIndex={-1} className="mb-6 outline-none">
      <Card title={<span id="handoffs-title">Handoffs offered to you ({items.length})</span>} tone="harbor">
        <ul className="divide-y text-[0.8125rem]">
          {items.map((h) => (
            <li key={h.id} className="space-y-1 py-2.5" data-testid="handoff-offer">
              <p>
                <span className="font-medium">{h.household}</span>{" "}
                <span className="text-ink-soft">
                  · {h.kind === "cover" ? `cover while ${h.from} is away` : `take over from ${h.from}`}
                </span>
              </p>
              {h.kind === "cover" && h.startsAt && h.endsAt && (
                <p className="text-ink-soft">
                  From {stamp(h.startsAt)} until {stamp(h.endsAt)}
                </p>
              )}
              {h.note && <p className="rounded bg-sunk/60 px-2 py-1">{h.note}</p>}
              <p className="text-[0.75rem] text-ink-soft">
                Offered by {h.offeredBy} · please answer by {stamp(h.acceptBy)}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Accept h={h} />
                <Decline h={h} />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function Accept({ h }: { h: Mine[number] }) {
  const { act, error } = useAction();
  return (
    <ConfirmDialog
      title={`Accept ${h.household}?`}
      confirmLabel="Accept"
      error={error}
      trigger={(o) => (
        <Button size="sm" onClick={o}>
          Accept…<span className="sr-only"> {h.household}</span>
        </Button>
      )}
      onConfirm={() => act(() => acceptHandoff({ data: { id: h.id } }), `You accepted ${h.household}.`)}
    >
      {h.kind === "cover" ? (
        <p>
          You'll be this household's care guide from {h.startsAt ? stamp(h.startsAt) : "now"} until{" "}
          {h.endsAt ? stamp(h.endsAt) : "the end of the absence"}, while {h.from} is away. Your access ends by
          itself at that time.
        </p>
      ) : (
        <p>
          You'll become this household's care guide, and {h.from}'s open escalations and care-team tasks here
          will move to you.
        </p>
      )}
    </ConfirmDialog>
  );
}

function Decline({ h }: { h: Mine[number] }) {
  const { act, error } = useAction();
  const [reason, setReason] = useState("");
  return (
    <ConfirmDialog
      title={`Decline ${h.household}?`}
      confirmLabel="Decline"
      tone="danger"
      error={error}
      trigger={(o) => (
        <Button size="sm" variant="quiet" onClick={o}>
          Decline…<span className="sr-only"> {h.household}</span>
        </Button>
      )}
      onConfirm={() =>
        act(() => declineHandoff({ data: { id: h.id, reason } }), "Declined. Operations will be told.")
      }
    >
      <p>Operations see your reason and will offer it to someone else.</p>
      <label className="block text-ink">
        <span className="font-medium">Reason</span>
        <textarea
          className={cx(inputClass, "mt-1 w-full")}
          rows={2}
          maxLength={280}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
    </ConfirmDialog>
  );
}
