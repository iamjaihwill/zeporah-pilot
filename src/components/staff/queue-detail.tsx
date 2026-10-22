import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  assignException,
  dismissException,
  getAssignableOwners,
  getQueueDetail,
  markExceptionWaiting,
  recordReachedByPhone,
  releaseException,
  takeException,
} from "@/functions/staff-shell";
import { activateConsent, giveEscalation, sendStaffMessage, updateEscalation } from "@/functions/staff";
import { dateOnly, stamp, useAction } from "@/lib/client";
import { Button, ConfirmDialog, ErrorText, inputClass } from "@/components/ui";
import { StatusChip } from "./status-chip";
import { Skeleton } from "./page";
import { CATEGORY_LABELS, PRIORITY_LABELS, type QueueKind, type QueueRow } from "@/domain/queue";

type Detail =
  Awaited<ReturnType<typeof getQueueDetail>> extends infer R
    ? R extends { ok: true; data: infer D }
      ? D
      : never
    : never;

/**
 * The queue's detail panel (staff rework, section 3). Loads one item and offers its actions, each
 * through the same server function and checks as everywhere else. Consequential actions (resolve,
 * activate) confirm first and restate exactly what they act on; taking ownership doesn't.
 */
export function QueueDetailPanel({
  item,
  onChanged,
  onClose,
  focusOnLoad,
  canAssign = false,
}: {
  item: {
    kind: QueueKind;
    subjectId: string | null;
    householdId: string;
    deepLink: string;
    summary: string;
  } & Partial<QueueRow>;
  onChanged: () => void;
  onClose: () => void;
  focusOnLoad?: boolean;
  /** Operations may assign exceptions (decision 58). */
  canAssign?: boolean;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setErr(null);
    void getQueueDetail({
      data: {
        kind: item.kind,
        subjectId: item.subjectId,
        householdId: item.householdId,
        ...(item.id ? { key: item.id } : {}),
      },
    }).then((r) => {
      if (!live) return;
      if (r.ok) setD(r.data as Detail);
      else setErr(r.message);
    });
    return () => {
      live = false;
    };
  }, [item.kind, item.subjectId, item.householdId, item.id, n]);
  useEffect(() => {
    if (focusOnLoad && d) document.getElementById("detail-title")?.focus();
  }, [d, focusOnLoad]);
  const refresh = () => {
    setN((x) => x + 1);
    onChanged();
  };

  return (
    <div className="space-y-3" data-testid="detail-panel">
      <div className="flex items-start justify-between gap-2">
        <h2 id="detail-title" tabIndex={-1} className="outline-none">
          {item.summary}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-[0.75rem] text-ink-soft hover:bg-sunk"
        >
          Close<span className="sr-only"> the detail panel</span> <span aria-hidden>Esc</span>
        </button>
      </div>
      {err ? (
        <ErrorText error={err} />
      ) : !d ? (
        <Skeleton rows={4} />
      ) : d.kind === "escalation" ? (
        <EscalationDetail d={d} onChanged={refresh} />
      ) : d.kind === "consent" ? (
        <ConsentDetail d={d} onChanged={refresh} />
      ) : d.kind === "message" ? (
        <MessageDetail d={d} onChanged={refresh} />
      ) : d.kind === "packet" ? (
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
          <dt className="text-ink-soft">Status</dt>
          <dd>
            <StatusChip domain="packet" value={d.state} />
          </dd>
          <dt className="text-ink-soft">To</dt>
          <dd>{d.recipient}</dd>
          <dt className="text-ink-soft">For</dt>
          <dd>{d.purpose}</dd>
          <dt className="text-ink-soft">Until</dt>
          <dd>{dateOnly(d.expiresAt)}</dd>
        </dl>
      ) : null}
      {item.category && item.why && <WhyHere item={item as QueueRow} />}
      {d && item.claimable && (
        <ExceptionActions item={item as QueueRow} canAssign={canAssign} onChanged={refresh} />
      )}
      {d && d.kind === "other" && d.waitingOn.length > 0 && item.subjectId && (
        <ReachedByPhone updateId={item.subjectId} people={d.waitingOn} onChanged={refresh} />
      )}
      {d && d.kind === "other" && d.history.length > 0 && (
        <section aria-labelledby="exc-history" className="border-t pt-2 text-[0.8125rem]">
          <h3 id="exc-history" className="text-[0.8125rem] font-semibold">
            Recent actions
          </h3>
          <ol className="mt-1 space-y-0.5 text-ink-soft">
            {d.history.map((h, i) => (
              <li key={i}>
                {h.who} {h.did} · {stamp(h.at)}
              </li>
            ))}
          </ol>
        </section>
      )}
      <p className="border-t pt-2 text-[0.8125rem]">
        <a href={item.deepLink} className="text-harbor underline">
          Open the full record
        </a>{" "}
        · {d?.household}
      </p>
    </div>
  );
}

function EscalationDetail({
  d,
  onChanged,
}: {
  d: Extract<Detail, { kind: "escalation" }>;
  onChanged: () => void;
}) {
  const { act, pending, error } = useAction();
  const [note, setNote] = useState("");
  const [tell, setTell] = useState(false);
  const [msg, setMsg] = useState(
    "We've followed up on your request. If anything else would help, reply here or ask for support again.",
  );
  const [owners, setOwners] = useState<{ actorId: string; name: string }[] | null>(null);
  const [to, setTo] = useState("");
  const open = d.status !== "resolved";
  const resolveBody = (
    <>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-ink">
        <dt className="text-ink-soft">What</dt>
        <dd>{d.what}</dd>
        <dt className="text-ink-soft">Household</dt>
        <dd>{d.household}</dd>
        <dt className="text-ink-soft">Raised</dt>
        <dd>
          {stamp(d.raisedAt)}
          {d.raisedBy ? ` by ${d.raisedBy}` : ""}
        </dd>
        {d.owner && !d.mine && (
          <>
            <dt className="text-ink-soft">Owner now</dt>
            <dd>{d.owner.name} — resolving takes it over from them</dd>
          </>
        )}
      </dl>
      <label className="mt-3 block text-ink">
        <span className="font-medium">How was it resolved?</span>
        <textarea
          rows={3}
          className={inputClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
        />
      </label>
      {d.fromFamily && d.canReplyToFamily && (
        <div className="mt-2 text-ink">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} />
            Let the family know
          </label>
          {tell && (
            <>
              <textarea
                aria-label="Message to the household"
                rows={3}
                className={inputClass}
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                maxLength={600}
              />
              <p className="mt-1 rounded bg-sunk p-2 text-[0.75rem]">
                <span className="font-semibold">Preview — the household's message thread:</span> {msg}
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip domain="escalation" value={d.status} />
        <span className="text-[0.8125rem] text-ink-soft">
          {d.owner ? `Owner: ${d.owner.name}` : "No owner"} · raised {stamp(d.raisedAt)}
        </span>
      </div>
      <p className="whitespace-pre-wrap">{d.summary}</p>
      {d.history.length > 0 && (
        <section aria-labelledby="esc-history">
          <h3 id="esc-history" className="text-[0.8125rem] font-semibold">
            History
          </h3>
          <ol className="mt-1 space-y-0.5 text-[0.8125rem] text-ink-soft">
            {d.history.map((h, i) => (
              <li key={i}>
                {h.who} {h.did} · {stamp(h.at)}
              </li>
            ))}
          </ol>
        </section>
      )}
      {d.status === "resolved" && (
        <p className="rounded bg-sunk p-2">
          Resolved by {d.resolvedBy ?? "someone"} {d.resolvedAt ? stamp(d.resolvedAt) : ""}: {d.resolution}
        </p>
      )}
      <ErrorText error={error} />
      {open && !d.isCorrection && (
        <div className="flex flex-wrap gap-2">
          {!d.owner && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                act(() => updateEscalation({ data: { id: d.id, action: "take" } }), "You own this now.").then(
                  (r) => r && onChanged(),
                )
              }
            >
              Take ownership
            </Button>
          )}
          {!d.owner && (
            // One confirmed step for the common case: take it and resolve it (both are recorded).
            <ConfirmDialog
              title="Take ownership and resolve?"
              confirmLabel="Take ownership and resolve"
              error={error}
              disabled={pending || !note.trim()}
              trigger={(o) => (
                <Button size="sm" variant="secondary" onClick={o} disabled={pending}>
                  Take ownership and resolve…
                </Button>
              )}
              onConfirm={async () => {
                const r = await act(
                  () =>
                    updateEscalation({
                      data: {
                        id: d.id,
                        action: "resolve",
                        resolution: note,
                        takeOver: true,
                        ...(tell && msg.trim() ? { familyMessage: msg } : {}),
                      },
                    }),
                  tell ? "Resolved. The household was sent your message." : "Resolved.",
                );
                if (r) onChanged();
                return r;
              }}
            >
              {resolveBody}
            </ConfirmDialog>
          )}
          {d.owner && (
            <ConfirmDialog
              title={d.mine ? "Resolve this escalation?" : `Take over from ${d.owner.name} and resolve?`}
              confirmLabel={d.mine ? "Resolve" : "Take over and resolve"}
              error={error}
              disabled={pending || !note.trim()}
              trigger={(o) => (
                <Button size="sm" variant={d.mine ? "primary" : "secondary"} onClick={o} disabled={pending}>
                  {d.mine ? "Resolve…" : "Take over and resolve…"}
                </Button>
              )}
              onConfirm={async () => {
                const r = await act(
                  () =>
                    updateEscalation({
                      data: {
                        id: d.id,
                        action: "resolve",
                        resolution: note,
                        ...(d.mine ? {} : { takeOver: true }),
                        ...(tell && msg.trim() ? { familyMessage: msg } : {}),
                      },
                    }),
                  tell ? "Resolved. The household was sent your message." : "Resolved.",
                );
                if (r) onChanged();
                return r;
              }}
            >
              {resolveBody}
            </ConfirmDialog>
          )}
          {d.canAssign && (
            <span className="inline-flex items-center gap-1">
              <select
                aria-label="Assign to"
                className={inputClass + " !w-auto"}
                value={to}
                onFocus={async () => {
                  if (owners) return;
                  const r = await getAssignableOwners();
                  setOwners(r.ok ? r.data.filter((o) => o.actorId !== d.owner?.id) : []);
                }}
                onChange={(e) => setTo(e.target.value)}
              >
                <option value="">Assign to…</option>
                {owners?.map((o) => (
                  <option key={o.actorId} value={o.actorId}>
                    {o.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                disabled={!to || pending}
                onClick={() =>
                  act(() => giveEscalation({ data: { id: d.id, actorId: to } }), "Assigned.").then(
                    (r) => r && onChanged(),
                  )
                }
              >
                Assign
              </Button>
            </span>
          )}
        </div>
      )}
      {d.isCorrection && (
        <p className="text-[0.8125rem] text-ink-soft">
          Correction requests are resolved from the consent itself.
        </p>
      )}
    </div>
  );
}

type ConsentD = Extract<Detail, { kind: "consent" }>;

/** The facts an activation dialog restates (interaction review item 18). */
function consentFacts(d: ConsentD) {
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-ink">
      <dt className="text-ink-soft">Recipient</dt>
      <dd>{d.recipient}</dd>
      <dt className="text-ink-soft">Purpose</dt>
      <dd>{d.purpose}</dd>
      <dt className="text-ink-soft">What's included</dt>
      <dd>
        <ul className="list-disc pl-4">
          {d.included.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </dd>
      <dt className="text-ink-soft">Dates</dt>
      <dd>
        {dateOnly(d.startsAt)} – {dateOnly(d.expiresAt)}
      </dd>
      <dt className="text-ink-soft">Confirmed</dt>
      <dd>
        {d.confirmed ? `${d.confirmed.by}, ${stamp(d.confirmed.at)} (version ${d.version})` : "Not yet"}
      </dd>
      <dt className="text-ink-soft">Recorded by</dt>
      <dd>{d.recordedBy}</dd>
    </dl>
  );
}

function ConsentDetail({ d, onChanged }: { d: ConsentD; onChanged: () => void }) {
  const { act, pending, error } = useAction();
  const facts = consentFacts(d);
  return (
    <div className="space-y-3">
      <StatusChip domain="consent" value={d.correction ? "needs_review" : d.stage} />
      {facts}
      <ErrorText error={error} />
      {d.canActivate ? (
        <ConfirmDialog
          title="Activate this consent?"
          confirmLabel="Activate consent"
          error={error}
          disabled={pending}
          trigger={(o) => (
            <Button size="sm" onClick={o} disabled={pending}>
              Activate…
            </Button>
          )}
          onConfirm={async () => {
            const r = await act(() => activateConsent({ data: { id: d.id } }), "Consent activated.");
            if (r) onChanged();
            return r;
          }}
        >
          <p>
            Once active, packets that stay within this consent can be released to the recipient below, until
            the end date. Nothing is shared by activating it.
          </p>
          {facts}
        </ConfirmDialog>
      ) : d.recordedByMe ? (
        <p className="text-[0.8125rem] text-ink-soft">
          You recorded this consent, so a different reviewer activates it.
        </p>
      ) : null}
    </div>
  );
}

function MessageDetail({ d, onChanged }: { d: Extract<Detail, { kind: "message" }>; onChanged: () => void }) {
  const { act, pending, error } = useAction();
  const [body, setBody] = useState("");
  return (
    <div className="space-y-3">
      <ol className="space-y-2" aria-label="Recent messages">
        {d.messages.map((m) => (
          <li
            key={m.id}
            className={m.side === "staff" ? "ml-6 rounded bg-harbor-soft p-2" : "mr-6 rounded bg-sunk p-2"}
          >
            <p className="text-[0.75rem] text-ink-soft">
              {m.author} · {stamp(m.at)}
            </p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      {d.canReply && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act(
              () => sendStaffMessage({ data: { householdId: d.householdId, body } }),
              "Reply sent to the household.",
            );
            if (r) {
              setBody("");
              onChanged();
            }
          }}
        >
          <label className="block">
            <span className="font-medium">Reply to the household</span>
            <textarea
              id="detail-reply"
              rows={3}
              className={inputClass}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
            />
          </label>
          <ErrorText error={error} />
          <Button type="submit" size="sm" className="mt-2" disabled={pending || !body.trim()}>
            Send reply
          </Button>
        </form>
      )}
      <p className="text-[0.75rem] text-ink-soft">
        <Link
          to="/staff/households/$householdId"
          params={{ householdId: d.householdId }}
          search={{ tab: "messages" } as never}
        >
          Open the whole thread
        </Link>
      </p>
    </div>
  );
}

/**
 * "Activate…" anywhere a consent can be activated (Reviews, lists): loads the consent, then
 * confirms with the same restatement as the detail panel and the household record.
 */
export function ActivateConsentButton({
  consentId,
  householdId,
  label,
}: {
  consentId: string;
  householdId: string;
  label: string;
}) {
  const { act, pending, error } = useAction();
  const [d, setD] = useState<ConsentD | null>(null);
  return (
    <ConfirmDialog
      title={`Activate the consent for ${label}?`}
      confirmLabel="Activate consent"
      error={error}
      disabled={pending || !d}
      trigger={(open) => (
        <Button
          size="sm"
          disabled={pending}
          onClick={async () => {
            if (!d) {
              const r = await getQueueDetail({
                data: { kind: "consent", subjectId: consentId, householdId },
              });
              if (r.ok && r.data.kind === "consent") setD(r.data as ConsentD);
            }
            open();
          }}
        >
          Activate…<span className="sr-only"> the consent for {label}</span>
        </Button>
      )}
      onConfirm={() => act(() => activateConsent({ data: { id: consentId } }), "Consent activated.")}
    >
      <p>
        Once active, packets within this consent can be released to the recipient until the end date.
        Activating doesn't share anything.
      </p>
      {d ? consentFacts(d) : <p>Loading…</p>}
    </ConfirmDialog>
  );
}

/* ------------------------------------------------------------------ exceptions (decision 58) */

/**
 * "Why this is here": the rule in plain words, its urgency and reason, when it's due, the consent or
 * authority record it rests on (direction refinement D-2) and what closes it.
 */
function WhyHere({ item }: { item: QueueRow }) {
  return (
    <section
      aria-labelledby="exc-why"
      className="rounded-[var(--s-radius)] border bg-sunk/50 p-2.5 text-[0.8125rem]"
    >
      <h3 id="exc-why" className="text-[0.8125rem] font-semibold">
        Why this is here
      </h3>
      <p className="mt-0.5">{item.why}</p>
      <dl className="mt-1.5 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-0.5 text-ink-soft">
        <dt>Category</dt>
        <dd className="text-ink">{CATEGORY_LABELS[item.category]}</dd>
        <dt>Urgency</dt>
        <dd className="text-ink">
          {PRIORITY_LABELS[item.priority]} · {item.priorityReason}
        </dd>
        <dt>Owner</dt>
        <dd className="text-ink">{item.owner ?? "No owner"}</dd>
        <dt>Open since</dt>
        <dd className="text-ink">{stamp(item.since)}</dd>
        {item.dueBy && (
          <>
            <dt>Due by</dt>
            <dd className="text-ink">{stamp(item.dueBy)}</dd>
          </>
        )}
        {item.basis && (
          <>
            <dt>Based on</dt>
            <dd className="text-ink" data-testid="exception-basis">
              {item.basis.text}
              {item.basis.until && ` · until ${stamp(item.basis.until)}`}
            </dd>
          </>
        )}
        <dt>Next step</dt>
        <dd className="text-ink">{item.next}</dd>
        <dt>Closes when</dt>
        <dd className="text-ink">
          {item.dismissable
            ? "What raised it is resolved, or someone dismisses it with a reason."
            : "What raised it is resolved through its own workflow. It can't be dismissed."}
        </dd>
      </dl>
      <p className="mt-1.5 text-[0.75rem] text-ink-faint">
        Urgency orders the work; it isn't clinical triage.
      </p>
    </section>
  );
}

/**
 * Take, wait, release, assign (operations) and dismiss with a reason. Consent, authority and owned
 * work can't be dismissed: they're resolved through their own workflow (the server refuses too).
 */
function ExceptionActions({
  item,
  canAssign,
  onChanged,
}: {
  item: QueueRow;
  canAssign: boolean;
  onChanged: () => void;
}) {
  const { act, pending, error } = useAction();
  const [on, setOn] = useState<"family" | "partner" | "staff">("family");
  const [note, setNote] = useState("");
  const [owners, setOwners] = useState<{ actorId: string; name: string }[] | null>(null);
  const [to, setTo] = useState("");
  const [why, setWhy] = useState("");
  const [reason, setReason] = useState("");
  const done = (r?: unknown) => {
    if (r) onChanged();
    return r;
  };
  return (
    <section aria-labelledby="exc-actions" className="space-y-2 border-t pt-2 text-[0.8125rem]">
      <h3 id="exc-actions" className="text-[0.8125rem] font-semibold">
        Actions
      </h3>
      <div className="flex flex-wrap gap-2">
        {!item.mine && (
          <Button
            size="sm"
            disabled={pending}
            onClick={async () =>
              done(await act(() => takeException({ data: { key: item.id } }), "You own this now."))
            }
          >
            Take ownership
          </Button>
        )}
        {item.mine && item.claimed && (
          <Button
            size="sm"
            variant="quiet"
            disabled={pending}
            onClick={async () =>
              done(await act(() => releaseException({ data: { key: item.id } }), "Ownership released."))
            }
          >
            Release ownership
          </Button>
        )}
      </div>
      {(item.mine || canAssign) && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            done(
              await act(
                () => markExceptionWaiting({ data: { key: item.id, on, ...(note.trim() ? { note } : {}) } }),
                "Marked as waiting.",
              ),
            );
          }}
        >
          <label className="text-[0.75rem] text-ink-soft">
            Waiting on
            <select
              className={inputClass + " !w-32"}
              value={on}
              onChange={(e) => setOn(e.target.value as typeof on)}
            >
              <option value="family">The family</option>
              <option value="partner">A partner</option>
              <option value="staff">Staff</option>
            </select>
          </label>
          <label className="text-[0.75rem] text-ink-soft">
            Note (optional)
            <input
              className={inputClass + " !w-44"}
              maxLength={140}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Left a voicemail"
            />
          </label>
          <Button size="sm" variant="secondary" type="submit" disabled={pending}>
            Mark as waiting
          </Button>
        </form>
      )}
      {canAssign && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[0.75rem] text-ink-soft">
            Assign to
            <select
              aria-label="Assign to"
              className={inputClass + " !w-40"}
              value={to}
              onFocus={async () => {
                if (owners) return;
                const r = await getAssignableOwners();
                setOwners(r.ok ? r.data : []);
              }}
              onChange={(e) => setTo(e.target.value)}
            >
              <option value="">Choose…</option>
              {owners?.map((o) => (
                <option key={o.actorId} value={o.actorId}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[0.75rem] text-ink-soft">
            Reason (optional)
            <input
              className={inputClass + " !w-44"}
              maxLength={280}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !to}
            onClick={async () =>
              done(
                await act(
                  () =>
                    assignException({
                      data: { key: item.id, toActorId: to, ...(why.trim() ? { reason: why } : {}) },
                    }),
                  `Assigned to ${owners?.find((o) => o.actorId === to)?.name ?? "them"}.`,
                ),
              )
            }
          >
            Assign
          </Button>
        </div>
      )}
      {item.dismissable && (item.mine || canAssign) && (
        <ConfirmDialog
          title="Dismiss this exception?"
          confirmLabel="Dismiss"
          tone="danger"
          error={error}
          trigger={(o) => (
            <Button size="sm" variant="quiet" onClick={o}>
              Dismiss…
            </Button>
          )}
          onConfirm={() =>
            act(
              () => dismissException({ data: { key: item.id, reason } }),
              "Dismissed, with your reason recorded.",
            ).then(done)
          }
        >
          <p>
            {CATEGORY_LABELS[item.category]}: {item.summary} · {item.household}. It leaves the list; your
            reason is recorded and only staff see it.
          </p>
          <label className="block text-ink">
            <span className="font-medium">Reason</span>
            <textarea
              className={inputClass + " mt-1 w-full"}
              rows={2}
              maxLength={280}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </ConfirmDialog>
      )}
      {!item.dismissable && (
        <p className="text-[0.75rem] text-ink-soft">
          This can't be dismissed; it clears when its own workflow is done.
        </p>
      )}
      <ErrorText error={error} />
    </section>
  );
}

/** Unread critical update: record that someone reached the person by phone (exception E-8). */
function ReachedByPhone({
  updateId,
  people,
  onChanged,
}: {
  updateId: string;
  people: { actorId: string; name: string }[];
  onChanged: () => void;
}) {
  const { act, error } = useAction();
  const [who, setWho] = useState(people[0]?.actorId ?? "");
  const name = people.find((p) => p.actorId === who)?.name ?? "";
  return (
    <section aria-labelledby="exc-phone" className="space-y-2 border-t pt-2 text-[0.8125rem]">
      <h3 id="exc-phone" className="text-[0.8125rem] font-semibold">
        Reached by phone?
      </h3>
      <label className="text-[0.75rem] text-ink-soft">
        Who you reached
        <select className={inputClass + " !w-44"} value={who} onChange={(e) => setWho(e.target.value)}>
          {people.map((p) => (
            <option key={p.actorId} value={p.actorId}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <ConfirmDialog
        title={`Record reaching ${name} by phone?`}
        confirmLabel="Record it"
        error={error}
        trigger={(o) => (
          <Button size="sm" variant="secondary" onClick={o} disabled={!who}>
            Record reaching them…
          </Button>
        )}
        onConfirm={() =>
          act(
            () => recordReachedByPhone({ data: { updateId, personActorId: who } }),
            "Recorded. The update no longer needs following up.",
          ).then((r) => {
            if (r) onChanged();
            return r;
          })
        }
      >
        <p>
          This records that you reached {name} by phone. Their own acknowledgement in the app doesn't change.
        </p>
      </ConfirmDialog>
    </section>
  );
}
