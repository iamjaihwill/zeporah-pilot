import { useState } from "react";
import { createHouseholdTask, editHouseholdTask } from "@/functions/family";
import { useAction } from "@/lib/client";
import { Button, ChoiceGroup, ErrorText, Field, inputClass } from "@/components/ui";

type Person = { actorId: string; name: string; kind: "family" | "staff" };
export type TaskDraft = {
  id?: string;
  title: string;
  detail: string;
  assigneeActorId: string | null;
  dueAt: string | null;
  visibility: "household" | "limited";
  sharedWith: string[];
};

const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/**
 * The coordinator's and the patient's task form (founder decisions 44 and 48b). Practical coordination only: the form says
 * so, and the server refuses medical orders and legal steps. A task marked sensitive starts with no
 * visibility chosen — the coordinator must pick one — so nothing is hidden by default.
 */
export function TaskForm({
  people,
  initial,
  onDone,
  catalog = [],
}: {
  people: Person[];
  initial?: TaskDraft;
  onDone: () => void;
  /** The hospice's common household tasks (decision 39), offered when adding. */
  catalog?: { id: string; title: string; detail: string; dueInDays: number | null }[];
}) {
  const [v, setV] = useState({
    title: initial?.title ?? "",
    detail: initial?.detail ?? "",
    assigneeActorId: initial?.assigneeActorId ?? "",
    due: dateOnly(initial?.dueAt ?? null),
    sharedWith: initial?.sharedWith ?? [],
  });
  const [sensitive, setSensitive] = useState(initial?.visibility === "limited");
  const [visibility, setVisibility] = useState<"household" | "limited" | null>(
    initial?.visibility ?? "household",
  );
  const { act, pending, error } = useAction();
  const family = people.filter((p) => p.kind === "family");
  const editing = !!initial?.id;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!visibility) return;
        const data = {
          title: v.title,
          detail: v.detail,
          assigneeActorId: v.assigneeActorId || null,
          // Due at the end of the chosen day, local time.
          dueAt: v.due ? new Date(`${v.due}T17:00:00`).toISOString() : null,
          sensitive,
          visibility,
          sharedWith: visibility === "limited" ? v.sharedWith : [],
        };
        const r = editing
          ? await act(() => editHouseholdTask({ data: { ...data, id: initial!.id! } }), "Task saved.")
          : await act(() => createHouseholdTask({ data }), "Task added.");
        if (r) onDone();
      }}
    >
      <p className="text-sm text-ink-soft">
        For practical things: rides, calls, errands, paperwork to gather. Medical orders and legal steps go
        through your care team.
      </p>
      {!initial && catalog.length > 0 && (
        <Field label="Start from a common task (optional)">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value=""
              onChange={(e) => {
                const t = catalog.find((x) => x.id === e.target.value);
                if (t)
                  setV({
                    ...v,
                    title: t.title,
                    detail: t.detail,
                    due:
                      t.dueInDays === null
                        ? ""
                        : new Date(Date.now() + t.dueInDays * 86_400_000).toISOString().slice(0, 10),
                  });
              }}
            >
              <option value="">Choose a common task</option>
              {catalog.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label="What needs doing">
        {(id) => (
          <input
            id={id}
            required
            maxLength={120}
            className={inputClass}
            value={v.title}
            onChange={(e) => setV({ ...v, title: e.target.value })}
          />
        )}
      </Field>
      <Field label="Details (optional)" hint="Anything that helps whoever does it.">
        {(id, d) => (
          <textarea
            id={id}
            aria-describedby={d}
            rows={2}
            maxLength={600}
            className={inputClass}
            value={v.detail}
            onChange={(e) => setV({ ...v, detail: e.target.value })}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Who's doing it">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={v.assigneeActorId}
              onChange={(e) => setV({ ...v, assigneeActorId: e.target.value })}
            >
              <option value="">Not assigned yet</option>
              {people.map((p) => (
                <option key={p.actorId} value={p.actorId}>
                  {p.name}
                  {p.kind === "staff" ? " (care team)" : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Due (optional)">
          {(id) => (
            <input
              id={id}
              type="date"
              className={inputClass}
              value={v.due}
              onChange={(e) => setV({ ...v, due: e.target.value })}
            />
          )}
        </Field>
      </div>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={sensitive}
          onChange={(e) => {
            setSensitive(e.target.checked);
            // A sensitive task: choose who sees it; nothing is assumed.
            setVisibility(e.target.checked ? null : "household");
          }}
        />
        <span>
          This is sensitive
          <span className="block text-sm text-ink-soft">You'll choose who can see it.</span>
        </span>
      </label>
      {sensitive && (
        <ChoiceGroup
          legend="Who can see this task"
          name="task-visibility"
          required
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: "household", label: "Everyone in the household", hint: "As with any household task." },
            {
              value: "limited",
              label: "Only some people",
              hint: "Whoever's doing it, you, the coordinators, your care team, and anyone you pick below.",
            },
          ]}
        />
      )}
      {visibility === "limited" && family.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="font-medium">Also let these people see it</legend>
          {family.map((p) => (
            <label key={p.actorId} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={v.sharedWith.includes(p.actorId)}
                onChange={(e) =>
                  setV({
                    ...v,
                    sharedWith: e.target.checked
                      ? [...v.sharedWith, p.actorId]
                      : v.sharedWith.filter((x) => x !== p.actorId),
                  })
                }
              />
              {p.name}
            </label>
          ))}
        </fieldset>
      )}
      <ErrorText error={error} />
      {sensitive && !visibility && (
        <p className="text-sm text-ink-soft">Choose who can see this task to save it.</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !visibility || !v.title.trim()}>
          {editing ? "Save task" : "Add task"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
