import { useBlocker } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { getRetentionReview, updateSettingsGroup } from "@/functions/staff";
import { cx, useAction } from "@/lib/client";
import { Button, Card, ChoiceGroup, ErrorText, Field, Stamp, inputClass } from "@/components/ui";
import {
  GROUP_LABELS,
  REPORT_KEYS,
  type OrgSettings,
  type ReportKey,
  type SettingsGroup,
  type TaskTemplate,
} from "@/domain/org-settings";

/**
 * Hospice workflow and organization settings (founder decision 39). One row per group: what it is,
 * who last changed it and whether it has unsaved edits on the left; its controls on the right. Each
 * group saves on its own (the server checks who may change it, validates it and records before and
 * after); a section's save bar saves every edited group at once. Defaults are what the app did
 * before each setting existed.
 */

/*
 * Unsaved changes: each row with edits registers its save and discard here. The section's save bar
 * lists them, and the page asks before leaving (in-app navigation and closing the tab).
 */
type Pending = { label: string; save: () => Promise<boolean>; discard: () => void };
const unsaved = new Map<string, Pending>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const useUnsavedVersion = () =>
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
/** Registers (or clears) this row's pending edit; `pending` is rebuilt as the edit changes. */
function useUnsaved(key: string, pending: Pending | null) {
  useEffect(() => {
    if (pending) unsaved.set(key, pending);
    else unsaved.delete(key);
    notify();
    return () => {
      unsaved.delete(key);
      notify();
    };
  }, [key, pending]);
}
/** For pages with their own forms (messaging, hospice details): the same registry. */
export { useUnsaved as useUnsavedEdit };

/** Asks "Leave without saving?" when a settings row has unsaved edits. Render once per page. */
export function UnsavedGuard() {
  useUnsavedVersion();
  const count = unsaved.size;
  useBlocker({
    shouldBlockFn: () =>
      count > 0 &&
      !window.confirm(
        `Leave without saving? ${count === 1 ? "One card has" : `${count} cards have`} unsaved changes.`,
      ),
    enableBeforeUnload: count > 0,
  });
  return null;
}

/**
 * The section's save bar: appears (stuck to the bottom of the screen) while anything is edited,
 * names what, and saves or discards it all.
 */
export function SaveBar() {
  useUnsavedVersion();
  const [busy, setBusy] = useState(false);
  const items = [...unsaved.values()];
  if (!items.length) return null;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="sticky bottom-3 z-20 mt-4 flex flex-wrap items-center gap-3 rounded-[var(--s-radius)] border border-ochre/40 bg-surface px-4 py-2.5 shadow-lg"
      data-testid="save-bar"
    >
      <span className="text-[0.875rem]">
        <strong>{items.length === 1 ? "1 unsaved change" : `${items.length} unsaved changes`}</strong>
        <span className="text-ink-soft"> · {items.map((i) => i.label).join(", ")}</span>
      </span>
      <span className="ml-auto flex gap-2">
        <Button size="sm" variant="quiet" disabled={busy} onClick={() => items.forEach((i) => i.discard())}>
          Discard
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            // One at a time, so each is checked and recorded on its own; stops at the first refusal.
            for (const i of items) if (!(await i.save())) break;
            setBusy(false);
          }}
        >
          {busy ? "Saving…" : items.length === 1 ? "Save" : "Save all"}
        </Button>
      </span>
    </div>
  );
}

/** "Last changed by Dana Brooks · Oct 14, 2026, 4:41 PM ET", from the audit entry the save wrote. */
export function LastChanged({ change }: { change?: { by: string; at: Date } | undefined }) {
  return (
    <p className="text-[0.75rem] text-ink-soft" data-testid="last-changed">
      {change ? (
        <>
          Last changed by {change.by} · <Stamp at={change.at} full />
        </>
      ) : (
        "Not changed yet: the standard setting."
      )}
    </p>
  );
}

/** The "Unsaved changes" tag on an edited row. */
export function UnsavedTag() {
  return (
    <span
      className="inline-block rounded-full border border-ochre/30 bg-ochre-soft px-2 text-[0.75rem] font-semibold text-ochre"
      data-testid="unsaved"
    >
      Unsaved changes
    </span>
  );
}

/**
 * One settings row: name, purpose and history on the left; controls (or, for people who can't change
 * it, the values as text) and a plain-English summary of the effect on the right.
 */
function GroupCard<K extends SettingsGroup>({
  group,
  value,
  canEdit,
  description,
  children,
  change,
  readOnly,
  summary,
}: {
  group: K;
  value: OrgSettings[K];
  canEdit: boolean;
  description: ReactNode;
  children: (v: OrgSettings[K], set: (v: OrgSettings[K]) => void, disabled: boolean) => ReactNode;
  /** Who last changed it. */
  change?: { by: string; at: Date } | undefined;
  /** For people who can't change it: the values as plain text, instead of a locked form. */
  readOnly?: (v: OrgSettings[K]) => ReactNode;
  /** What the current choice does, in a sentence (updates as it's edited). */
  summary?: (v: OrgSettings[K]) => ReactNode;
}) {
  const [v, setV] = useState(value);
  const [saved, setSaved] = useState(value);
  const { act, pending, error } = useAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  const save = async () => {
    const r = await act(
      () => updateSettingsGroup({ data: { group, value: v } }),
      `${GROUP_LABELS[group]} saved.`,
    );
    if (r) setSaved(v);
    return !!r;
  };
  const edit = useMemo<Pending | null>(
    () => (canEdit && dirty ? { label: GROUP_LABELS[group], save, discard: () => setV(saved) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, dirty, v, saved],
  );
  useUnsaved(group, edit);
  const titleId = `settings-${group}-title`;
  return (
    <section
      aria-labelledby={titleId}
      className={cx(
        "rounded-[var(--s-radius)] border bg-surface p-[var(--s-pad)]",
        canEdit && dirty && "border-ochre/50",
      )}
      data-testid={`settings-${group}`}
    >
      <div className="grid gap-x-8 gap-y-3 xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <h3 id={titleId} className="text-[1rem] font-semibold">
            {GROUP_LABELS[group]}
          </h3>
          <p className="text-[0.8125rem] text-ink-soft">{description}</p>
          <LastChanged change={change} />
          {canEdit && dirty && <UnsavedTag />}
        </div>
        <div>
          {!canEdit && (
            <p className="mb-2 text-[0.8125rem] text-ink-soft">Only an administrator can change these.</p>
          )}
          {!canEdit && readOnly ? (
            <div className="text-[0.875rem]">{readOnly(value)}</div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <fieldset disabled={!canEdit} className="space-y-3">
                {children(v, setV, !canEdit)}
              </fieldset>
              {summary && (
                <p className="rounded-md bg-sunk px-3 py-2 text-[0.8125rem]" data-testid="setting-effect">
                  {summary(v)}
                </p>
              )}
              <ErrorText error={error} />
              {canEdit && (
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={pending || !dirty}>
                    Save {GROUP_LABELS[group].toLowerCase()}
                  </Button>
                  {dirty && (
                    <Button size="sm" variant="quiet" onClick={() => setV(saved)}>
                      Discard
                    </Button>
                  )}
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

/** A number that can be turned off (null). */
function OptionalNumber({
  label,
  unit,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  unit: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="font-medium">{label}</legend>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value !== null}
          onChange={(e) => onChange(e.target.checked ? min : null)}
        />
        Turn on
      </label>
      {value !== null && (
        <label className="flex items-center gap-2">
          <input
            type="number"
            min={min}
            max={max}
            className={`${inputClass} w-24`}
            value={value}
            aria-label={`${label} (${unit})`}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="text-ink-soft">{unit}</span>
        </label>
      )}
    </fieldset>
  );
}

const REPORT_LABELS: Record<ReportKey, string> = {
  overview: "Executive overview",
  households: "Households and caseload",
  work: "Open work and aging",
  exceptions: "Sharing exceptions",
  bereavement: "Bereavement follow-up",
  workforce: "Workforce and workload",
};

/** "21:00" → "9:00 PM", as times read elsewhere in the app. */
const clock = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

const STATUS_WORDING = [
  ["task", "open", "Task: open", "Open"],
  ["task", "done", "Task: done", "Done"],
  ["task", "closed", "Task: closed", "Closed — not needed"],
  ["escalation", "open", "Escalation: no owner", "Needs an owner"],
  ["escalation", "acknowledged", "Escalation: owned", "Owned — in progress"],
  ["escalation", "resolved", "Escalation: resolved", "Resolved"],
] as const;

type Changes = Partial<Record<SettingsGroup, { by: string; at: Date }>>;

export function OperationsSettings({
  values,
  canEdit,
  changes,
}: {
  values: OrgSettings;
  canEdit: boolean;
  changes?: Changes;
}) {
  return (
    <div className="space-y-4">
      <GroupCard
        group="queue"
        change={changes?.queue}
        summary={(v) =>
          v.messageHighAfterHours === null && v.routineNormalAfterDays === null
            ? "The queue uses its standard order."
            : [
                v.messageHighAfterHours !== null &&
                  `A household waiting more than ${v.messageHighAfterHours} hours for a reply moves to high priority.`,
                v.routineNormalAfterDays !== null &&
                  `Routine follow-ups move to normal priority after ${v.routineNormalAfterDays} days.`,
              ]
                .filter(Boolean)
                .join(" ")
        }
        value={values.queue}
        canEdit={canEdit}
        description="When waiting work moves up the queue. Off: the standard order. This orders the queue; it isn't clinical triage."
      >
        {(v, set) => (
          <>
            <OptionalNumber
              label="A household waiting for a reply becomes high priority after"
              unit="hours"
              min={1}
              max={336}
              value={v.messageHighAfterHours}
              onChange={(messageHighAfterHours) => set({ ...v, messageHighAfterHours })}
            />
            <OptionalNumber
              label="Routine follow-ups become normal priority after"
              unit="days"
              min={1}
              max={60}
              value={v.routineNormalAfterDays}
              onChange={(routineNormalAfterDays) => set({ ...v, routineNormalAfterDays })}
            />
          </>
        )}
      </GroupCard>

      <GroupCard
        group="exceptions"
        change={changes?.exceptions}
        summary={(v) =>
          `Handoffs stall after ${v.handoffAcceptHours} h; unopened packets after ${v.recipientUnopenedHours} h; access ending within ${v.accessEndingDays} days; updates unacknowledged after ${v.ackOverdueHours} h; no contact for ${v.noTeamContactDays} days or ${v.coordinationRiskOpenCount} open items raise coordination risk.`
        }
        value={values.exceptions}
        canEdit={canEdit}
        description="When the deterministic rules raise an exception (decision 58). These order the work; they aren't clinical triage."
      >
        {(v, set) => (
          <>
            {(
              [
                ["handoffAcceptHours", "A handoff not accepted becomes stalled after", "hours", 1, 168],
                [
                  "recipientUnopenedHours",
                  "A released packet not opened waits on the partner after",
                  "hours",
                  1,
                  336,
                ],
                ["accessEndingDays", "Consents and outside access show as ending within", "days", 1, 60],
                [
                  "ackOverdueHours",
                  "An update needing acknowledgement becomes urgent after",
                  "hours",
                  1,
                  336,
                ],
                ["noTeamContactDays", "No team contact raises coordination risk after", "days", 1, 60],
                [
                  "coordinationRiskOpenCount",
                  "Open exceptions on one household that raise coordination risk",
                  "items",
                  2,
                  20,
                ],
              ] as const
            ).map(([k, label, unit, min, max]) => (
              <Field key={k} label={`${label} (${unit})`}>
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={min}
                    max={max}
                    className={`${inputClass} w-24`}
                    value={v[k]}
                    onChange={(e) => set({ ...v, [k]: Number(e.target.value) })}
                  />
                )}
              </Field>
            ))}
          </>
        )}
      </GroupCard>

      <GroupCard
        group="assignment"
        change={changes?.assignment}
        summary={(v) =>
          `When someone reassigns a household, "hand over open work" starts ${v.handOverByDefault ? "ticked" : "unticked"}. ` +
          (v.caseloadWarnAt === null
            ? "No caseload warning."
            : `They're warned when the new care guide already has ${v.caseloadWarnAt} or more households.`)
        }
        value={values.assignment}
        canEdit={canEdit}
        description="Starting choices when assigning care guides. Whoever assigns can still change them each time."
      >
        {(v, set) => (
          <>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={v.handOverByDefault}
                onChange={(e) => set({ ...v, handOverByDefault: e.target.checked })}
              />
              <span>
                Tick “hand over open work” when reassigning
                <span className="block text-sm text-ink-soft">
                  Unticked releases work for someone to take (decision 4).
                </span>
              </span>
            </label>
            <OptionalNumber
              label="Warn when a care guide already has this many households"
              unit="households"
              min={1}
              max={200}
              value={v.caseloadWarnAt}
              onChange={(caseloadWarnAt) => set({ ...v, caseloadWarnAt })}
            />
          </>
        )}
      </GroupCard>

      <GroupCard
        group="taskCatalog"
        change={changes?.taskCatalog}
        summary={(v) =>
          v.length === 0
            ? "No common tasks: everyone writes their own."
            : `${v.length} common task${v.length === 1 ? "" : "s"} offered when adding a task.`
        }
        value={values.taskCatalog}
        canEdit={canEdit}
        description="Common tasks to start from. Household tasks are offered to coordinators and patients; care-team tasks to staff. Practical coordination only — no medical orders or legal steps."
      >
        {(v, set) => <Catalog value={v} onChange={set} />}
      </GroupCard>

      <GroupCard
        group="notifications"
        change={changes?.notifications}
        summary={(v) =>
          `Someone new gets notices ${
            v.cadence === "as_it_happens"
              ? "as things happen"
              : v.cadence === "daily_summary"
                ? "in a daily summary"
                : "for essentials only"
          }, quiet from ${clock(v.quietStart)} to ${clock(v.quietEnd)}, until they choose their own.`
        }
        value={values.notifications}
        canEdit={canEdit}
        description="Starting choices for someone who hasn't set their own. Email stays off until each person turns it on."
      >
        {(v, set) => (
          <>
            <ChoiceGroup
              legend="How often"
              name="default-cadence"
              value={v.cadence}
              onChange={(cadence) => set({ ...v, cadence })}
              options={[
                { value: "as_it_happens", label: "As things happen" },
                { value: "daily_summary", label: "A daily summary" },
                { value: "essential_only", label: "Only essentials" },
              ]}
            />
            <div className="flex flex-wrap gap-3">
              <Field label="Quiet from">
                {(id) => (
                  <input
                    id={id}
                    type="time"
                    className={inputClass}
                    value={v.quietStart}
                    onChange={(e) => set({ ...v, quietStart: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Quiet until">
                {(id) => (
                  <input
                    id={id}
                    type="time"
                    className={inputClass}
                    value={v.quietEnd}
                    onChange={(e) => set({ ...v, quietEnd: e.target.value })}
                  />
                )}
              </Field>
            </div>
          </>
        )}
      </GroupCard>

      <GroupCard
        group="reports"
        change={changes?.reports}
        summary={(v) =>
          `Reports open on ${REPORT_LABELS[v.defaultReport]}, for the last ${v.defaultDays} days.`
        }
        value={values.reports}
        canEdit={canEdit}
        description="Which report and date range open first."
      >
        {(v, set) => (
          <>
            <Field label="Report that opens first">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={v.defaultReport}
                  onChange={(e) => set({ ...v, defaultReport: e.target.value as ReportKey })}
                >
                  {REPORT_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {REPORT_LABELS[k]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Date range">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={v.defaultDays}
                  onChange={(e) => set({ ...v, defaultDays: Number(e.target.value) as 7 | 30 | 90 })}
                >
                  {[7, 30, 90].map((d) => (
                    <option key={d} value={d}>
                      Last {d} days
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </>
        )}
      </GroupCard>

      <GroupCard
        group="statusLabels"
        change={changes?.statusLabels}
        summary={(v) => (
          <>
            <span className="mb-1 block text-ink-soft">Staff will see:</span>
            <span className="flex flex-wrap gap-1.5">
              {STATUS_WORDING.map(([domain, key, , standard]) => (
                <span
                  key={`${domain}-${key}`}
                  className="rounded-full border bg-surface px-2 text-[0.75rem] font-semibold"
                >
                  {(v[domain] as Record<string, string | undefined>)[key]?.trim() || standard}
                </span>
              ))}
            </span>
          </>
        )}
        value={values.statusLabels}
        canEdit={canEdit}
        description="Your own words for task and escalation statuses in the staff workspace. Empty: the standard wording. Consent, authority, sharing and household statuses always use the standard wording."
      >
        {(v, set) => (
          <div className="grid gap-3 sm:grid-cols-2">
            {STATUS_WORDING.map(([domain, key, lbl, standard]) => (
              <Field key={`${domain}-${key}`} label={lbl} hint={`Standard: ${standard}`}>
                {(id, d) => (
                  <input
                    id={id}
                    aria-describedby={d}
                    maxLength={40}
                    className={inputClass}
                    value={(v[domain] as Record<string, string | undefined>)[key] ?? ""}
                    onChange={(e) => set({ ...v, [domain]: { ...v[domain], [key]: e.target.value } })}
                  />
                )}
              </Field>
            ))}
          </div>
        )}
      </GroupCard>
    </div>
  );
}

function Catalog({ value, onChange }: { value: TaskTemplate[]; onChange: (v: TaskTemplate[]) => void }) {
  const update = (i: number, patch: Partial<TaskTemplate>) =>
    onChange(value.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="text-ink-soft">No common tasks yet.</p>}
      {value.map((t, i) => (
        <fieldset key={t.id} className="space-y-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Common task {i + 1}</legend>
          <Field label="Title">
            {(id) => (
              <input
                id={id}
                required
                maxLength={120}
                className={inputClass}
                value={t.title}
                onChange={(e) => update(i, { title: e.target.value })}
              />
            )}
          </Field>
          <Field label="Details (optional)">
            {(id) => (
              <input
                id={id}
                maxLength={600}
                className={inputClass}
                value={t.detail}
                onChange={(e) => update(i, { detail: e.target.value })}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="For">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={t.audience}
                  onChange={(e) => update(i, { audience: e.target.value as "family" | "staff" })}
                >
                  <option value="family">The household</option>
                  <option value="staff">The care team</option>
                </select>
              )}
            </Field>
            <Field label="Due in (days, optional)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={0}
                  max={365}
                  className={`${inputClass} w-24`}
                  value={t.dueInDays ?? ""}
                  onChange={(e) =>
                    update(i, { dueInDays: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
              )}
            </Field>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onChange(value.filter((_, k) => k !== i))}
            >
              Remove<span className="sr-only"> common task {i + 1}</span>
            </Button>
          </div>
        </fieldset>
      ))}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() =>
          onChange([
            ...value,
            { id: `t${Date.now().toString(36)}`, title: "", detail: "", audience: "family", dueInDays: null },
          ])
        }
      >
        Add a common task
      </Button>
    </div>
  );
}

export function AdminSettings({
  values,
  canEdit,
  changes,
}: {
  values: OrgSettings;
  canEdit: boolean;
  changes?: Changes;
}) {
  return (
    <div className="space-y-4">
      <GroupCard
        group="access"
        change={changes?.access}
        summary={(v) =>
          `New helper invitations last at most ${v.taskHelperMaxDays} days; household collaboration at most ${v.collaborationMaxDays} days.`
        }
        value={values.access}
        canEdit={canEdit}
        description="The longest anyone outside the household's usual members can have access (decision 42). Changes apply to new invitations."
        readOnly={(v) => (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            <dt className="text-ink-soft">Task-only helper access</dt>
            <dd>at most {v.taskHelperMaxDays} days</dd>
            <dt className="text-ink-soft">Household collaboration</dt>
            <dd>at most {v.collaborationMaxDays} days</dd>
          </dl>
        )}
      >
        {(v, set) => (
          <>
            <Field label="Task-only helper access: at most (days)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={365}
                  className={`${inputClass} w-24`}
                  value={v.taskHelperMaxDays}
                  onChange={(e) => set({ ...v, taskHelperMaxDays: Number(e.target.value) })}
                />
              )}
            </Field>
            <Field label="Household collaboration: at most (days)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={365}
                  className={`${inputClass} w-24`}
                  value={v.collaborationMaxDays}
                  onChange={(e) => set({ ...v, collaborationMaxDays: Number(e.target.value) })}
                />
              )}
            </Field>
          </>
        )}
      </GroupCard>

      <GroupCard
        group="retention"
        change={changes?.retention}
        summary={(v) =>
          v.closedHouseholdsMonths === null && v.messagesMonths === null
            ? "No retention periods: nothing is counted for review."
            : "Records past these periods are counted for your records team. Nothing is deleted."
        }
        value={values.retention}
        canEdit={canEdit}
        description="How long records should be kept. Zeporah never deletes anything automatically: records past these periods are counted below for your records team to review. The audit log is always kept."
        readOnly={(v) => (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            <dt className="text-ink-soft">Closed households</dt>
            <dd>
              {v.closedHouseholdsMonths ? `${v.closedHouseholdsMonths} months after closing` : "Not set"}
            </dd>
            <dt className="text-ink-soft">Messages</dt>
            <dd>{v.messagesMonths ? `${v.messagesMonths} months` : "Not set"}</dd>
          </dl>
        )}
      >
        {(v, set) => (
          <>
            <OptionalNumber
              label="Closed households: keep for"
              unit="months after closing"
              min={1}
              max={240}
              value={v.closedHouseholdsMonths}
              onChange={(closedHouseholdsMonths) => set({ ...v, closedHouseholdsMonths })}
            />
            <OptionalNumber
              label="Messages: keep for"
              unit="months"
              min={1}
              max={240}
              value={v.messagesMonths}
              onChange={(messagesMonths) => set({ ...v, messagesMonths })}
            />
            {canEdit && <RetentionReview />}
          </>
        )}
      </GroupCard>
    </div>
  );
}

function RetentionReview() {
  const [r, setR] = useState<{ closedHouseholdsPast: number | null; messagesPast: number | null } | null>(
    null,
  );
  return (
    <div className="rounded-lg bg-sunk p-3 text-sm" data-testid="retention-review">
      {r ? (
        <ul className="space-y-1">
          <li>Closed households past their period: {r.closedHouseholdsPast ?? "no rule set"}</li>
          <li>Messages past their period: {r.messagesPast ?? "no rule set"}</li>
        </ul>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={async () => {
            const x = await getRetentionReview();
            if (x.ok) setR(x.data);
          }}
        >
          Count records past retention
        </Button>
      )}
    </div>
  );
}
