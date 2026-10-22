import { StaffPending } from "@/components/staff/pending";
import { StaffPageHeader } from "@/components/staff";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { changeStaffRole, deactivateStaff, getStaffMember, reactivateStaff } from "@/functions/staff";
import { auditLabel } from "@/domain/labels";
import type { OwnershipHistory, TimelineEntry } from "@/server/services/team";
import { ESCALATION_WHAT } from "@/domain/queue";
import { isDenied, unwrap, useAction, type Denied } from "@/lib/client";
import {
  Button,
  Card,
  ConfirmDialog,
  DeniedView,
  Field,
  Notice,
  PageHeader,
  Stamp,
  inputClass,
} from "@/components/ui";

/** One staff member: what they cover, and (for operations) changing their role or deactivating them. */
export const Route = createFileRoute("/staff/team/$actorId")({
  loader: async ({ params }) => unwrap(await getStaffMember({ data: { actorId: params.actorId } })),
  component: StaffMemberPage,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

type Member = Exclude<ReturnType<typeof Route.useLoaderData>, Denied>;

const ROLES = [
  ["care_guide", "Care guide"],
  ["hospice_ops", "Hospice operations"],
  ["privileged_reviewer", "Authority/consent reviewer"],
  ["hospice_admin", "Hospice administrator"],
] as const;
type RoleCode = (typeof ROLES)[number][0];

function Reason({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

function Impact({ m }: { m: Member }) {
  const { assignments, escalations, tasks } = m.impact;
  return (
    <ul className="list-disc space-y-1 pl-5">
      <li>
        {assignments.length === 0
          ? "No household assignments."
          : `${assignments.length} household assignment${assignments.length === 1 ? "" : "s"} end: ${assignments.map((a: { name: string }) => a.name).join(", ")}.`}
      </li>
      <li>
        {escalations.length === 0
          ? "No open escalations they own."
          : `${escalations.length} open escalation${escalations.length === 1 ? "" : "s"} go back to "No owner assigned".`}
      </li>
      <li>
        {tasks.length === 0
          ? "No open care-team tasks assigned to them."
          : `${tasks.length} open care-team task${tasks.length === 1 ? "" : "s"} lose their assignee.`}
      </li>
    </ul>
  );
}

function StaffMemberPage() {
  const m = Route.useLoaderData();
  if (isDenied(m)) return <DeniedView d={m} />;
  const locked = m.isSelf
    ? "You can't change your own role or account. Ask another administrator."
    : m.lastRole
      ? `${m.lastRole.replace("This hospice needs", "The hospice needs")} This is the only one, so their role can't be removed.`
      : null;
  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/staff/team" className="text-harbor underline-offset-2 hover:underline">
          ← Team &amp; coverage
        </Link>
      </p>
      <StaffPageHeader
        title={m.name}
        description={
          m.deactivatedAt ? `Former staff · ${m.email}` : `${m.role?.label ?? "No role"} · ${m.email}`
        }
      />
      {m.deactivatedAt && (
        <div className="mb-6">
          <Notice tone="quiet" title="Deactivated">
            Deactivated <Stamp at={m.deactivatedAt} full />. They can't sign in and have no access. Their past
            notes, messages and actions stay on the record.
          </Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="What they cover" className="lg:col-span-2">
          <h3 className="font-medium">Households assigned</h3>
          {m.impact.assignments.length ? (
            <ul className="mt-1 mb-4 space-y-1">
              {m.impact.assignments.map((a) => (
                <li key={a.householdId}>
                  {m.canOpenHouseholds ? (
                    <Link
                      to="/staff/households/$householdId"
                      params={{ householdId: a.householdId }}
                      search={{ tab: "overview" }}
                      className="text-harbor underline-offset-2 hover:underline"
                    >
                      {a.name}
                    </Link>
                  ) : (
                    a.name
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 mb-4 text-ink-soft">
              {m.role?.code === "care_guide"
                ? "None yet."
                : "Not assigned to households; their role covers the whole hospice."}
            </p>
          )}
          <h3 className="font-medium">Open escalations they own</h3>
          {m.impact.escalations.length ? (
            <ul className="mt-1 mb-4 space-y-1">
              {m.impact.escalations.map((e) => (
                <li key={e.id}>
                  {m.canOpenHouseholds ? (
                    <Link
                      to="/staff/exceptions"
                      search={{ view: "all", kind: "escalation", sel: `escalation:${e.id}` }}
                      className="text-harbor underline-offset-2 hover:underline"
                    >
                      {e.what}
                    </Link>
                  ) : (
                    e.what
                  )}{" "}
                  <span className="text-ink-soft">· {e.household}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 mb-4 text-ink-soft">None.</p>
          )}
          <h3 className="font-medium">Open care-team tasks assigned to them</h3>
          {m.impact.tasks.length ? (
            <ul className="mt-1 space-y-1">
              {m.impact.tasks.map((x) => (
                <li key={x.id}>
                  {m.canOpenHouseholds ? (
                    <Link
                      to="/staff/households/$householdId"
                      params={{ householdId: x.householdId }}
                      search={{ tab: "tasks" }}
                      hash={`task-${x.id}`}
                      className="text-harbor underline-offset-2 hover:underline"
                    >
                      {x.title}
                    </Link>
                  ) : (
                    x.title
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-ink-soft">None.</p>
          )}
        </Card>
        <Card title="Role history">
          <ul className="space-y-2 text-sm">
            {m.history.map((h, i) => (
              <li key={i}>
                <span className="font-medium">{h.role}</span> · from <Stamp at={h.since} />
                {h.endedAt && (
                  <>
                    {" "}
                    to <Stamp at={h.endedAt} />
                    <span className="block text-ink-soft">{h.endReason}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {!m.deactivatedAt && m.role && (
        <section aria-labelledby="manage" className="mt-8">
          <h2 id="manage" className="mb-3 text-2xl">
            Manage
          </h2>
          {locked ? (
            <Notice tone="quiet">{locked}</Notice>
          ) : !m.canManageRoles && !m.canDeactivate ? (
            <Notice tone="quiet">Only an administrator can change an administrator's account.</Notice>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {m.canManageRoles ? (
                <ChangeRole m={m} />
              ) : (
                <Card title="Change role">
                  <p className="text-ink-soft">Only an administrator can change someone's role.</p>
                </Card>
              )}
              {m.canDeactivate && <Deactivate m={m} />}
            </div>
          )}
        </section>
      )}
      {m.deactivatedAt && !m.isSelf && m.canManageRoles && (
        <section aria-labelledby="manage" className="mt-8">
          <h2 id="manage" className="mb-3 text-2xl">
            Manage
          </h2>
          <Reactivate m={m} />
        </section>
      )}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Ownership m={m} />
        <Timeline m={m} />
      </div>
    </>
  );
}

function ChangeRole({ m }: { m: Member }) {
  const options = ROLES.filter(([code]) => code !== m.role!.code);
  const [role, setRole] = useState<RoleCode>(options[0]![0]);
  const [reason, setReason] = useState("");
  const { act, pending, error } = useAction();
  const label = ROLES.find(([c]) => c === role)![1];
  return (
    <Card title="Change role">
      <p className="mb-3 text-ink-soft">
        Each person has one role at this hospice.
        {m.role!.code === "care_guide" ? " Leaving the care-guide role ends every household assignment." : ""}
      </p>
      <Field label="New role">
        {(id) => (
          <select
            id={id}
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value as RoleCode)}
          >
            {options.map(([code, l]) => (
              <option key={code} value={code}>
                {l}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="mt-3">
        <ConfirmDialog
          title={`Change ${m.name}'s role to ${label.toLowerCase()}?`}
          confirmLabel="Change role"
          disabled={pending || !reason.trim()}
          error={error}
          trigger={(open) => <Button onClick={open}>Change role…</Button>}
          onConfirm={() =>
            act(
              () => changeStaffRole({ data: { actorId: m.actorId, role, reason } }),
              `${m.name}'s role is now ${label.toLowerCase()}.`,
            )
          }
        >
          {m.role!.code === "care_guide" ? (
            <>
              <p>When their role changes:</p>
              <Impact m={{ ...m, impact: { ...m.impact, tasks: [] } }} />
            </>
          ) : (
            <p>Their access changes on their next page load.</p>
          )}
          <Reason value={reason} onChange={setReason} />
        </ConfirmDialog>
      </div>
    </Card>
  );
}

function Deactivate({ m }: { m: Member }) {
  const [reason, setReason] = useState("");
  const { act, pending, error } = useAction();
  return (
    <Card title="Deactivate">
      <p className="mb-3 text-ink-soft">
        For someone who has left or no longer needs access. They're signed out everywhere and can't sign in
        again. Nothing they did is deleted.
      </p>
      <ConfirmDialog
        title={`Deactivate ${m.name}?`}
        confirmLabel="Deactivate"
        tone="danger"
        disabled={pending || !reason.trim()}
        error={error}
        trigger={(open) => (
          <Button variant="danger" onClick={open}>
            Deactivate…
          </Button>
        )}
        onConfirm={() =>
          act(() => deactivateStaff({ data: { actorId: m.actorId, reason } }), `${m.name} was deactivated.`)
        }
      >
        <p>When you confirm:</p>
        <Impact m={m} />
        <p>Their role ends, their sessions end, and they can't sign in again.</p>
        <Reason value={reason} onChange={setReason} />
      </ConfirmDialog>
    </Card>
  );
}

function Reactivate({ m }: { m: Member }) {
  const [role, setRole] = useState<RoleCode>("care_guide");
  const [reason, setReason] = useState("");
  const { act, pending, error } = useAction();
  const label = ROLES.find(([c]) => c === role)![1];
  return (
    <Card title="Reactivate">
      <p className="mb-3 text-ink-soft">
        For someone returning. They can sign in again with the role you choose. Their earlier household
        assignments, escalations and tasks are not given back; assign them again if needed.
      </p>
      <Field label="Role">
        {(id) => (
          <select
            id={id}
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value as RoleCode)}
          >
            {ROLES.map(([code, l]) => (
              <option key={code} value={code}>
                {l}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="mt-3">
        <ConfirmDialog
          title={`Reactivate ${m.name} as ${label.toLowerCase()}?`}
          confirmLabel="Reactivate"
          disabled={pending || !reason.trim()}
          error={error}
          trigger={(open) => <Button onClick={open}>Reactivate…</Button>}
          onConfirm={() =>
            act(
              () => reactivateStaff({ data: { actorId: m.actorId, role, reason } }),
              `${m.name} was reactivated as ${label.toLowerCase()}.`,
            )
          }
        >
          <p>When you confirm:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>They can sign in again, as {label.toLowerCase()}.</li>
            <li>No household assignments, escalations or tasks come back.</li>
            <li>This is recorded in the audit log with your reason.</li>
          </ul>
          <Reason value={reason} onChange={setReason} />
        </ConfirmDialog>
      </div>
    </Card>
  );
}

function Ownership({ m }: { m: Member }) {
  const { assignments, escalations } = m.ownership as OwnershipHistory;
  return (
    <Card title="Ownership history">
      <h3 className="font-medium">Household coverage</h3>
      {assignments.length ? (
        <ul className="mt-1 mb-4 space-y-1.5 text-sm">
          {assignments.map((a, i) => (
            <li key={i}>
              <span className="font-medium">{a.household}</span> · from <Stamp at={a.since} />
              {a.endedAt ? (
                <>
                  {" "}
                  to <Stamp at={a.endedAt} />
                  {a.endReason && <span className="block text-ink-soft">{a.endReason}</span>}
                </>
              ) : (
                <span className="text-ink-soft"> · current</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 mb-4 text-ink-soft">None.</p>
      )}
      <h3 className="font-medium">Escalations owned or resolved</h3>
      {escalations.length ? (
        <ul className="mt-1 space-y-1.5 text-sm">
          {escalations.map((e) => (
            <li key={e.id}>
              {ESCALATION_WHAT[e.kind] ?? "Escalation"} · {e.household} ·{" "}
              {e.state === "resolved" && e.resolvedAt ? (
                <>
                  resolved <Stamp at={e.resolvedAt} />
                </>
              ) : (
                "open"
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-ink-soft">None.</p>
      )}
    </Card>
  );
}

function Timeline({ m }: { m: Member }) {
  return (
    <Card title="Audit timeline">
      <p className="mb-2 text-[0.8125rem] text-ink-soft">
        The 40 most recent events: their actions and changes to their account.
      </p>
      {m.timeline.length ? (
        <ol className="space-y-1.5 text-sm">
          {(m.timeline as TimelineEntry[]).map((t) => (
            <li key={t.id}>
              <Stamp at={t.at} /> · {auditLabel(t.action)}
              {!t.byThem && <span className="text-ink-soft"> (by someone else)</span>}
              {t.summary && <span className="block text-ink-soft">{t.summary}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-ink-soft">Nothing yet.</p>
      )}
    </Card>
  );
}
