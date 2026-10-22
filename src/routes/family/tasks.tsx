import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  closeHouseholdTask,
  completeFamilyTask,
  getFamilyTasks,
  getTaskFormOptions,
  reopenFamilyTask,
} from "@/functions/family";
import { TaskForm } from "@/components/task-form";
import { IssuedLink } from "@/components/forms";
import { inviteContact } from "@/functions/family";
import { cx, isDenied, unwrap, useAction } from "@/lib/client";
import { HIGHLIGHT, useHashTarget } from "@/lib/use-hash-target";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DeniedView,
  Field,
  inputClass,
  EmptyState,
  ErrorText,
  PageHeader,
  StateBadge,
  Stamp,
} from "@/components/ui";

export const Route = createFileRoute("/family/tasks")({
  loader: async () => {
    const [tasks, options] = await Promise.all([getFamilyTasks(), getTaskFormOptions()]);
    return {
      tasks: unwrap(tasks),
      options: options.ok ? options.data : { canManage: false, canInvite: false, people: [], catalog: [] },
    };
  },
  component: Tasks,
});

const dueText = (at: Date) =>
  `Due ${new Date(at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;

function Tasks() {
  const { tasks, options } = Route.useLoaderData();
  const { act, pending, error } = useAction();
  const target = useHashTarget();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  if (isDenied(tasks)) return <DeniedView d={tasks} />;
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status !== "open");
  return (
    <>
      <PageHeader
        eyebrow="Tasks"
        title="What's being taken care of"
        lede="Each task shows who it's with. Nothing here is overdue — take things one at a time."
      />
      <ErrorText error={error} />
      {options.canManage && (
        <div className="mb-6">
          {adding ? (
            <Card title="Add a task">
              <TaskForm people={options.people} catalog={options.catalog} onDone={() => setAdding(false)} />
            </Card>
          ) : (
            <Button onClick={() => setAdding(true)}>Add a task</Button>
          )}
        </div>
      )}
      {open.length === 0 ? (
        <EmptyState title="No open tasks">
          {options.canManage
            ? "Add a task above, or your care team may share one with your household."
            : "When your care team shares a task with your household, it will appear here."}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {open.map((t) => (
            <Card
              as="li"
              key={t.id}
              id={`task-${t.id}`}
              className={cx(target === `task-${t.id}` && HIGHLIGHT)}
            >
              {editing === t.id ? (
                <TaskForm
                  people={options.people}
                  initial={{
                    id: t.id,
                    title: t.title,
                    detail: t.detail,
                    assigneeActorId: t.assigneeActorId,
                    dueAt: t.dueAt ? new Date(t.dueAt).toISOString() : null,
                    visibility: t.visibility,
                    sharedWith: t.sharedWithIds,
                  }}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg">{t.title}</h2>
                    {t.detail && <p className="mt-1 text-ink-soft">{t.detail}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone={t.mine ? "harbor" : "neutral"}>
                        {t.mine ? "With you" : t.assignee ? `With ${t.assignee}` : "Not assigned yet"}
                      </Badge>
                      {t.whenLabel && <Badge>{t.whenLabel}</Badge>}
                      {t.dueAt && <Badge>{dueText(t.dueAt)}</Badge>}
                      {t.visibility === "limited" && (
                        <Badge tone="neutral">
                          Only some people can see this
                          {t.sharedWith.length
                            ? `: also ${t.sharedWith.map((n) => n.split(" ")[0]).join(", ")}`
                            : ""}
                        </Badge>
                      )}
                      {t.requiresAck && (
                        <Badge tone="ochre">Your care team asked to know when it's done</Badge>
                      )}
                    </div>
                  </div>
                  {t.canComplete && (
                    // Your own task gets the main button; someone else's gets a quieter one that names them.
                    <Button
                      size="sm"
                      variant={t.mine ? "primary" : "secondary"}
                      disabled={pending}
                      onClick={() =>
                        // Reversible: the note offers Undo for a few seconds (item 4). No task title in
                        // the note, so nothing personal sits on screen after the page changes.
                        act(
                          () => completeFamilyTask({ data: { id: t.id } }),
                          t.mine || !t.assignee
                            ? "Task marked done."
                            : `Marked done for ${t.assignee.split(" ")[0]}.`,
                          () => () => reopenFamilyTask({ data: { id: t.id } }),
                        )
                      }
                    >
                      {t.mine
                        ? "Mark done"
                        : t.assignee
                          ? `Mark done for ${t.assignee.split(" ")[0]}`
                          : "Mark done"}
                      {!t.mine && <span className="sr-only">: {t.title}</span>}
                    </Button>
                  )}
                  {options.canInvite && !t.mine && <AskForHelp taskId={t.id} title={t.title} />}
                  {t.canEdit && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(t.id)}>
                        Edit<span className="sr-only">: {t.title}</span>
                      </Button>
                      <CloseTask id={t.id} title={t.title} />
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details className="mt-8 rounded-xl border bg-surface p-4">
          <summary className="cursor-pointer font-medium">Done or closed ({done.length})</summary>
          <ul className="mt-3 divide-y">
            {done.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    {t.status === "closed" ? (
                      <Badge tone="neutral">Closed — not needed</Badge>
                    ) : (
                      <StateBadge state="done" />
                    )}{" "}
                    {t.title}
                  </span>
                  {t.closedReason && <span className="block text-sm text-ink-soft">{t.closedReason}</span>}
                  {t.done?.by && (
                    <span className="block text-sm text-ink-soft">
                      Done by {t.done.by.split(" ")[0]}
                      {t.done.for ? ` for ${t.done.for.split(" ")[0]}` : ""}
                      {t.done.at && (
                        <>
                          {" "}
                          · <Stamp at={t.done.at} />
                        </>
                      )}
                    </span>
                  )}
                </span>
                {t.canReopen && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => act(() => reopenFamilyTask({ data: { id: t.id } }), "Task reopened.")}
                  >
                    Reopen<span className="sr-only">: {t.title}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** Close a task that's no longer needed (decision 44): confirmed, with a short reason. */
function CloseTask({ id, title }: { id: string; title: string }) {
  const [reason, setReason] = useState("");
  const { act, pending, error } = useAction();
  return (
    <ConfirmDialog
      title={`Close “${title}”?`}
      confirmLabel="Close task"
      disabled={pending || !reason.trim()}
      error={error}
      trigger={(open) => (
        <Button size="sm" variant="secondary" onClick={open}>
          Close…<span className="sr-only">: {title}</span>
        </Button>
      )}
      onConfirm={() => act(() => closeHouseholdTask({ data: { id, reason } }), "Task closed.")}
    >
      <p>It moves to the closed list. Whoever had it is told it's no longer needed.</p>
      <Field label="Why isn't it needed?">
        {(fid) => (
          <input
            id={fid}
            required
            maxLength={300}
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}

/**
 * Ask someone outside the household to help with one task (decision 42): task-only access by
 * default. They see this task and what it needs, nothing else, until it's done or the date.
 */
function AskForHelp({ taskId, title }: { taskId: string; title: string }) {
  const [v, setV] = useState({ name: "", email: "", endsOn: "" });
  const [issued, setIssued] = useState<{ name: string; url: string } | null>(null);
  const { act, pending, error } = useAction();
  return (
    <>
      {issued && (
        <div className="basis-full">
          <IssuedLink name={issued.name} url={issued.url} />
        </div>
      )}
      <ConfirmDialog
        title={`Ask someone to help with “${title}”?`}
        confirmLabel="Create invitation link"
        disabled={pending || !v.name.trim() || !v.email.trim()}
        error={error}
        trigger={(open) => (
          <Button size="sm" variant="secondary" onClick={open}>
            Ask someone to help…<span className="sr-only">: {title}</span>
          </Button>
        )}
        onConfirm={async () => {
          const r = await act(
            () =>
              inviteContact({
                data: {
                  name: v.name,
                  contact: v.email,
                  role: "helper",
                  accessModel: "task",
                  taskId,
                  ...(v.endsOn ? { accessEndsAt: new Date(`${v.endsOn}T23:59:00`).toISOString() } : {}),
                },
              }),
            `Invitation link ready for ${v.name}.`,
          );
          if (r) {
            setIssued({ name: v.name, url: `${window.location.origin}${r.data.acceptPath}` });
            setV({ name: "", email: "", endsOn: "" });
          }
          return r;
        }}
      >
        <p>
          They'll see this task and what they need to do it — nothing else in your household: no people,
          messages, updates or vault.
        </p>
        <p className="text-sm text-ink-soft">
          Their access ends when the task is done, or on the date you choose, whichever comes first. The task
          will be theirs once they accept.
        </p>
        <Field label="Their name">
          {(id) => (
            <input
              id={id}
              required
              className={inputClass}
              value={v.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Their email" hint="They'll use it to create their account.">
          {(id, d) => (
            <input
              id={id}
              aria-describedby={d}
              type="email"
              required
              autoComplete="off"
              className={inputClass}
              value={v.email}
              onChange={(e) => setV({ ...v, email: e.target.value })}
            />
          )}
        </Field>
        <Field label="End access on (optional)">
          {(id) => (
            <input
              id={id}
              type="date"
              className={inputClass}
              value={v.endsOn}
              onChange={(e) => setV({ ...v, endsOn: e.target.value })}
            />
          )}
        </Field>
      </ConfirmDialog>
    </>
  );
}
