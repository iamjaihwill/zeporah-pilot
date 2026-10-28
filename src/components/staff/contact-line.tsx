/**
 * The 24-hour line card in Hospice settings (founder decision 72): the line families see, when it
 * was last called and confirmed, a change waiting for someone else to confirm, and re-confirming.
 */
import { useState } from "react";
import {
  confirmContactLine,
  proposeContactLine,
  reconfirmContactLine,
  withdrawContactLine,
} from "@/functions/staff";
import { dateOnly, useAction } from "@/lib/client";
import { Button, Card, ErrorText, Field, Notice, inputClass } from "@/components/ui";
import { RECONFIRM_DAYS } from "@/domain/contact-line";

type LineStatus = {
  line: string;
  backupLine: string | null;
  lastConfirmed: { at: Date; by: string; note: string } | null;
  dueAt: Date | null;
  due: boolean;
  pending: {
    id: string;
    line: string;
    backupLine: string | null;
    proposedBy: string;
    proposedAt: Date;
  } | null;
  canPropose: boolean;
  canConfirm: boolean;
  canConfirmPending: boolean;
};

/** "I called it": the checkbox and a short note, shared by confirming a change and re-confirming. */
function CallRecord({
  label,
  onSubmit,
  pending,
}: {
  label: string;
  onSubmit: (v: { reached: boolean; note: string }) => void;
  pending: boolean;
}) {
  const [reached, setReached] = useState(false);
  const [note, setNote] = useState("");
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ reached, note });
      }}
    >
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={reached}
          onChange={(e) => setReached(e.target.checked)}
        />
        I called this number and reached the hospice's after-hours service.
      </label>
      <Field label="What you reached" hint="For example: the nurse line answered.">
        {(id, d) => (
          <input
            id={id}
            aria-describedby={d}
            maxLength={200}
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" size="sm" disabled={pending || !reached || !note.trim()}>
        {label}
      </Button>
    </form>
  );
}

export function ContactLineCard({ status: l }: { status: LineStatus }) {
  const [proposing, setProposing] = useState(false);
  const [v, setV] = useState({ line: "", backupLine: "" });
  const { act, pending, error } = useAction();
  return (
    <Card title="24-hour line">
      <p className="text-[0.8125rem] text-ink-soft">
        Families are told to call this for anything urgent. A change reaches families only after someone else
        calls it and confirms it.
      </p>
      <dl className="mt-3 grid grid-cols-[9rem_1fr] gap-x-4 gap-y-1 text-[0.875rem]">
        <dt className="text-ink-soft">Families see</dt>
        <dd data-testid="live-line">{l.line || "Not set"}</dd>
        {l.backupLine && (
          <>
            <dt className="text-ink-soft">If they can't get through</dt>
            <dd>{l.backupLine}</dd>
          </>
        )}
        <dt className="text-ink-soft">Last confirmed</dt>
        <dd>
          {l.lastConfirmed
            ? `${dateOnly(l.lastConfirmed.at)} by ${l.lastConfirmed.by}: “${l.lastConfirmed.note}”`
            : "Never"}
        </dd>
      </dl>
      {l.due && (
        <div className="mt-3">
          <Notice tone="ochre" title={l.lastConfirmed ? "Due to be confirmed" : "Not confirmed yet"}>
            Call the line and confirm it below. It's checked at least every {RECONFIRM_DAYS} days.
          </Notice>
        </div>
      )}
      {l.pending && (
        <div
          className="mt-3 rounded-lg border border-ochre/40 bg-ochre-soft/40 p-3"
          data-testid="pending-line"
        >
          <p className="text-sm">
            <strong>Waiting for confirmation:</strong> {l.pending.line}
            {l.pending.backupLine ? ` (backup ${l.pending.backupLine})` : ""}, proposed by{" "}
            {l.pending.proposedBy} on {dateOnly(l.pending.proposedAt)}. Families still see the line above.
          </p>
          {l.canConfirmPending ? (
            <CallRecord
              label="Confirm the new line"
              pending={pending}
              onSubmit={(x) =>
                void act(
                  () => confirmContactLine({ data: { changeId: l.pending!.id, ...x } }),
                  "The new line is confirmed and families see it now.",
                )
              }
            />
          ) : (
            <p className="mt-2 text-sm text-ink-soft">
              Someone other than {l.pending.proposedBy} in operations or administration needs to call it and
              confirm.
            </p>
          )}
          {l.canConfirm && (
            <Button
              variant="quiet"
              size="sm"
              className="mt-2"
              onClick={() =>
                void act(
                  () => withdrawContactLine({ data: { changeId: l.pending!.id } }),
                  "The proposed line was withdrawn.",
                )
              }
            >
              Withdraw this change
            </Button>
          )}
        </div>
      )}
      {l.canConfirm && !l.pending && (
        <CallRecord
          label="Confirm the current line"
          pending={pending}
          onSubmit={(x) =>
            void act(() => reconfirmContactLine({ data: x }), "The 24-hour line is confirmed.")
          }
        />
      )}
      {l.canPropose && !proposing && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setProposing(true)}>
          Propose a new line
        </Button>
      )}
      {l.canPropose && proposing && (
        <form
          className="mt-3 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act(
              () =>
                proposeContactLine({
                  data: { line: v.line, ...(v.backupLine.trim() ? { backupLine: v.backupLine } : {}) },
                }),
              "Proposed. Someone else needs to call it and confirm it.",
            );
            if (r) {
              setProposing(false);
              setV({ line: "", backupLine: "" });
            }
          }}
        >
          <Field
            label="New 24-hour line"
            hint="A US number with area code. You can add an extension or a note after a comma."
          >
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                required
                maxLength={80}
                className={inputClass}
                value={v.line}
                onChange={(e) => setV({ ...v, line: e.target.value })}
              />
            )}
          </Field>
          <Field label="Backup line (optional)" hint="Shown as “if you can't get through”.">
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                maxLength={80}
                className={inputClass}
                value={v.backupLine}
                onChange={(e) => setV({ ...v, backupLine: e.target.value })}
              />
            )}
          </Field>
          <Button type="submit" size="sm" disabled={pending}>
            Propose
          </Button>
          <Button variant="quiet" size="sm" className="ml-2" onClick={() => setProposing(false)}>
            Cancel
          </Button>
        </form>
      )}
      <ErrorText error={error} />
    </Card>
  );
}
