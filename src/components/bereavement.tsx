import { useState } from "react";
import { recordCheckIn } from "@/functions/staff";
import { cx, dateOnly, useAction } from "@/lib/client";
import { useHashTarget } from "@/lib/use-hash-target";
import {
  Badge,
  Button,
  Card,
  ChoiceGroup,
  ConfirmDialog,
  Field,
  Notice,
  Stamp,
  inputClass,
} from "@/components/ui";
import { CONTACT_OUTCOME_LABELS, CONTACT_OUTCOMES, type ContactOutcome } from "@/domain/bereavement";

type Step = {
  id: string;
  label: string;
  dueOn: Date;
  window: string | null;
  status: string;
  outcome: string | null;
  note: string;
  completedAt: Date | null;
  completedBy: string | null;
};

/** Staff: a household's bereavement check-ins, with recording for the care team. */
export function BereavementPlanCard({
  plan,
}: {
  plan: { supportEndsAt: Date; canRecord: boolean; declined: boolean; steps: Step[] };
}) {
  const target = useHashTarget();
  return (
    <Card title="Bereavement follow-up" className="lg:col-span-3">
      <p className="mb-3 text-sm text-ink-soft">
        Check-ins are human contacts made by the care team; Zeporah doesn't contact anyone. Support continues
        until <Stamp at={plan.supportEndsAt} />.
      </p>
      {plan.declined && (
        <div className="mb-3">
          <Notice tone="ochre" title="The family asked not to be contacted">
            Check with the care team before reaching out again.
          </Notice>
        </div>
      )}
      <ol className="divide-y">
        {plan.steps.map((st) => (
          // The follow-up page links here as #checkin-…: scrolled to, focused and tinted.
          <li
            key={st.id}
            id={`checkin-${st.id}`}
            tabIndex={-1}
            className={cx(
              "flex flex-wrap items-start justify-between gap-2 py-2 outline-none",
              target === `checkin-${st.id}` && "-mx-2 rounded bg-harbor-soft px-2",
            )}
          >
            <span>
              <span className="font-medium">{st.label}</span>{" "}
              <span className="text-sm text-ink-soft">
                {/* "Around": a date, never a time (it's deliberately approximate). */}· due around{" "}
                {dateOnly(st.dueOn)}
              </span>
              {st.status === "done" ? (
                <span className="block text-sm text-ink-soft">
                  {st.outcome} · {st.completedBy}, {st.completedAt && <Stamp at={st.completedAt} />}
                  {st.note && <span className="block">Note (staff only): {st.note}</span>}
                </span>
              ) : (
                st.window && <span className="block text-sm text-ink-soft">{st.window}</span>
              )}
            </span>
            {st.status === "done" ? (
              <Badge tone="moss">Recorded</Badge>
            ) : (
              plan.canRecord && <RecordCheckIn id={st.id} label={st.label} />
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function RecordCheckIn({ id, label }: { id: string; label: string }) {
  const [outcome, setOutcome] = useState<ContactOutcome>("reached");
  const [note, setNote] = useState("");
  const { act, pending, error } = useAction();
  return (
    <ConfirmDialog
      title={`Record the ${label.toLowerCase()}`}
      confirmLabel="Record"
      disabled={pending}
      error={error}
      trigger={(open) => (
        <Button size="sm" variant="secondary" onClick={open}>
          Record<span className="sr-only"> the {label.toLowerCase()}</span>
        </Button>
      )}
      onConfirm={() =>
        act(() => recordCheckIn({ data: { contactId: id, outcome, note } }), `${label} recorded.`)
      }
    >
      <ChoiceGroup
        legend="What happened"
        name={`outcome-${id}`}
        value={outcome}
        onChange={setOutcome}
        options={CONTACT_OUTCOMES.map((o) => ({ value: o, label: CONTACT_OUTCOME_LABELS[o] }))}
      />
      <Field
        label="Note (optional)"
        hint="Only the care team sees this. Keep it practical; no clinical detail."
      >
        {(fid, d) => (
          <textarea
            id={fid}
            aria-describedby={d}
            rows={2}
            maxLength={1000}
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}
