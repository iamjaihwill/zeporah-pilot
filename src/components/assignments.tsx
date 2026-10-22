import { useState } from "react";
import { assignCareGuide, endAssignment, reassignCareGuide } from "@/functions/staff";
import { useAction } from "@/lib/client";
import { Button, Check, ConfirmDialog, ErrorText, Field, inputClass } from "@/components/ui";

/**
 * Care-guide assignment controls shared by a household's Care team panel and the Team page.
 * Only hospice operations sees them; the server checks `staff.assignment.manage` on every call.
 */

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Reason" hint="Required. Only staff will see it.">
      {(id, d) => (
        <textarea
          id={id}
          aria-describedby={d}
          rows={2}
          maxLength={500}
          required
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/** Ends one assignment after a confirmation with a required, staff-only reason. */
export function EndAssignment({
  membershipId,
  name,
  household,
  quiet = false,
}: {
  membershipId: string;
  name: string;
  /** Shown when the control isn't already inside that household's page. */
  household?: string;
  /** A small text button (lists with many rows, e.g. Team & coverage). */
  quiet?: boolean;
}) {
  const [reason, setReason] = useState("");
  const { act, pending, error } = useAction();
  const where = household ? `${household}` : "this household";
  return (
    <ConfirmDialog
      title={household ? `End ${name}'s assignment to ${household}?` : `End ${name}'s assignment?`}
      confirmLabel="End assignment"
      tone="danger"
      disabled={pending || !reason.trim()}
      error={error}
      trigger={(open) => (
        <Button size="sm" variant={quiet ? "quiet" : "secondary"} onClick={open}>
          End assignment
          <span className="sr-only">
            {" "}
            for {name}
            {household ? ` on ${household}` : ""}
          </span>
        </Button>
      )}
      onConfirm={() =>
        act(() => endAssignment({ data: { membershipId, reason } }), `${name}'s assignment ended.`)
      }
    >
      <p>
        {name} will no longer see {where} or its notifications. Escalations there that they own go back to
        having no owner. Their past notes and messages stay on the record.
      </p>
      <ReasonField value={reason} onChange={setReason} />
    </ConfirmDialog>
  );
}

/** Moves a household from one care guide to another in one step. */
export function ReassignAssignment({
  membershipId,
  name,
  household,
  others,
  handOverByDefault = false,
  caseloadWarnAt = null,
  quiet = false,
}: {
  membershipId: string;
  name: string;
  household: string;
  others: { actorId: string; name: string; caseload?: number }[];
  /** The hospice's assignment defaults (decision 39); decision 4's default is off. */
  handOverByDefault?: boolean;
  caseloadWarnAt?: number | null;
  /** A small text button (lists with many rows, e.g. Team & coverage). */
  quiet?: boolean;
}) {
  const [to, setTo] = useState(others[0]?.actorId ?? "");
  const [reason, setReason] = useState("");
  const [handOver, setHandOver] = useState(handOverByDefault);
  const { act, pending, error } = useAction();
  const target = others.find((o) => o.actorId === to);
  if (!others.length) return null;
  return (
    <ConfirmDialog
      title={`Reassign ${household}`}
      confirmLabel="Reassign"
      disabled={pending || !reason.trim() || !target}
      error={error}
      trigger={(open) => (
        <Button size="sm" variant={quiet ? "quiet" : "secondary"} onClick={open}>
          Reassign
          <span className="sr-only">
            {" "}
            {household} from {name}
          </span>
        </Button>
      )}
      onConfirm={() =>
        act(
          () => reassignCareGuide({ data: { membershipId, toActorId: to, reason, handOver } }),
          `${household} is now with ${target?.name ?? "the new care guide"}.`,
        )
      }
    >
      <p>
        {name}'s assignment ends and the new care guide's starts, together. {name} will no longer see this
        household.
      </p>
      <Field label="New care guide">
        {(id) => (
          <select id={id} className={inputClass} value={to} onChange={(e) => setTo(e.target.value)}>
            {others.map((o) => (
              <option key={o.actorId} value={o.actorId}>
                {o.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Check
        label={`Hand ${name}'s open work here to ${target?.name ?? "the new care guide"}`}
        hint={
          handOver
            ? "Their open escalations and care-team tasks for this household move to the new care guide, who is notified."
            : 'If unticked, their open escalations and care-team tasks here go back to "No owner assigned" for someone to take.'
        }
        checked={handOver}
        onChange={setHandOver}
      />
      <CaseloadWarning guide={target} at={caseloadWarnAt} />
      <ReasonField value={reason} onChange={setReason} />
    </ConfirmDialog>
  );
}

/** Assigns one of the eligible care guides to a household. */
export function AssignCareGuide({
  householdId,
  household,
  eligible,
  hint,
  caseloadWarnAt = null,
}: {
  householdId: string;
  household?: string;
  eligible: { actorId: string; name: string; caseload?: number }[];
  hint?: string;
  caseloadWarnAt?: number | null;
}) {
  const [pick, setPick] = useState("");
  const { act, pending, error } = useAction();
  // No one is pre-selected: whoever assigns chooses, seeing each guide's current caseload.
  const choice = eligible.some((g) => g.actorId === pick) ? pick : "";
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const name = eligible.find((g) => g.actorId === choice)?.name ?? "The care guide";
        const r = await act(
          () => assignCareGuide({ data: { householdId, actorId: choice } }),
          household ? `${name} was assigned to ${household}.` : `${name} was assigned to this household.`,
        );
        if (r) setPick("");
      }}
    >
      <Field label={household ? `Assign a care guide to ${household}` : "Assign a care guide"} hint={hint}>
        {(id, d) => (
          <select
            id={id}
            aria-describedby={d}
            className={inputClass}
            value={choice}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">Choose a care guide</option>
            {eligible.map((g) => (
              <option key={g.actorId} value={g.actorId}>
                {g.name}
                {g.caseload !== undefined ? ` (${g.caseload} household${g.caseload === 1 ? "" : "s"})` : ""}
              </option>
            ))}
          </select>
        )}
      </Field>
      <CaseloadWarning guide={eligible.find((g) => g.actorId === choice)} at={caseloadWarnAt} />
      <ErrorText error={error} />
      <Button type="submit" size="sm" disabled={pending || !choice}>
        Assign<span className="sr-only"> to {household ?? "this household"}</span>
      </Button>
    </form>
  );
}

/** The hospice's optional caseload warning (decision 39). A warning only: it never blocks. */
function CaseloadWarning({
  guide,
  at,
}: {
  guide: { name: string; caseload?: number } | undefined;
  at: number | null;
}) {
  if (!guide || at === null || guide.caseload === undefined || guide.caseload < at) return null;
  return (
    <p className="text-sm text-ochre" role="status">
      {guide.name} already has {guide.caseload} households; your hospice asks for a second look at {at} or
      more.
    </p>
  );
}
