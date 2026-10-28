import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  cancelInvitation,
  changeMemberRole,
  getPeople,
  reissueInvitation,
  removeMember,
  getContacts,
  addContact,
  updateContact,
  removeContact,
} from "@/functions/family";
import { dateOnly, isDenied, unwrap, useAction } from "@/lib/client";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DeniedView,
  ErrorText,
  Field,
  Notice,
  PageHeader,
  StateBadge,
  inputClass,
} from "@/components/ui";
import { InviteForm, IssuedLink } from "@/components/forms";
import { ContactsCard } from "@/components/contacts";
import { HOUSEHOLD_ROLES, ROLE_EXPLANATIONS, ROLE_LABELS } from "@/domain/model";

/** One short line per role here; the full definitions are in "What each role means". */
const ROLE_SHORT: Record<string, string> = {
  patient: "The person receiving care.",
  coordinator: "Organizes the household's tasks, people and preferences.",
  proxy: "Helps act for the patient.",
  family_member: "Sees updates and household tasks.",
};

export const Route = createFileRoute("/family/people")({
  loader: async () => {
    const [people, contacts] = await Promise.all([getPeople(), getContacts()]);
    return { people: unwrap(people), contacts: unwrap(contacts) };
  },
  component: People,
});

function People() {
  const { people: p, contacts } = Route.useLoaderData();
  const [inviting, setInviting] = useState<{ name: string; contact: string; key: number } | null>(null);
  if (isDenied(p)) return <DeniedView d={p} />;
  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Who's part of this"
        lede="Everyone here sees only what their role allows. A role organizes access — it never gives anyone legal authority."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card title="Your household">
            <ul className="divide-y">
              {p.members.map((m) => (
                <li key={m.actorId} className="py-3">
                  <p className="font-medium">
                    {m.name} {m.me && <Badge tone="harbor">You</Badge>}
                  </p>
                  {m.roles.map((r) => (
                    <p key={r.code} className="mt-1 text-sm text-ink-soft">
                      <span className="font-medium text-ink">{r.label}.</span> {ROLE_SHORT[r.code] ?? ""}
                    </p>
                  ))}
                  {m.manage &&
                    (m.manage.blocker ? (
                      <p className="mt-2 text-sm text-ink-soft">{m.manage.blocker}</p>
                    ) : (
                      <ManageMember actorId={m.actorId} name={m.name} role={m.roles[0]!.code} />
                    ))}
                </li>
              ))}
            </ul>
          </Card>
          {p.invitations.length > 0 && (
            <Card title="Invitations">
              <ul className="divide-y">
                {p.invitations.map((i) => (
                  <InvitationRow key={i.id} i={i} canManage={p.canInvite} />
                ))}
              </ul>
              <p className="mt-3 text-sm text-ink-soft">
                Zeporah doesn't send invitations itself. Each one gives you a one-time link to share with the
                person.
              </p>
            </Card>
          )}
          {!isDenied(contacts) && (
            <ContactsCard
              data={contacts}
              audience="family"
              add={(v) => addContact({ data: v })}
              update={(id, v) => updateContact({ data: { id, ...v } })}
              remove={(id) => removeContact({ data: { id } })}
              onInvite={
                p.canInvite
                  ? (c) => {
                      setInviting({ name: c.name, contact: c.email, key: Date.now() });
                      document.getElementById("invite-someone")?.scrollIntoView({ block: "start" });
                    }
                  : undefined
              }
            />
          )}
          {p.canInvite && (
            <div id="invite-someone">
              <InviteForm key={inviting?.key ?? 0} initial={inviting ?? undefined} />
            </div>
          )}
        </div>
        <aside className="space-y-6">
          <Card tone="quiet" title="Your care team">
            <ul className="space-y-1">
              {p.careTeam.map((c) => (
                <li key={c.name}>
                  {c.name} <span className="text-ink-soft">· {c.role}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card tone="quiet" title="What each role means">
            <dl className="space-y-3 text-sm">
              {HOUSEHOLD_ROLES.map((r) => (
                <div key={r}>
                  <dt className="font-medium">{ROLE_LABELS[r]}</dt>
                  <dd className="text-ink-soft">{ROLE_EXPLANATIONS[r]}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Notice tone="quiet">
            Being part of the household never opens protected information by itself.
          </Notice>
        </aside>
      </div>
    </>
  );
}

/** Change someone between Family member and Proxy, or remove them from the household. */
function ManageMember({ actorId, name, role }: { actorId: string; name: string; role: string }) {
  const other = role === "proxy" ? "family_member" : "proxy";
  const [next, setNext] = useState<"family_member" | "proxy">(other);
  const { act, pending, error } = useAction();
  const remove = useAction();
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act(
            () => changeMemberRole({ data: { actorId, role: next } }),
            `${name}'s role is now ${ROLE_LABELS[next].toLowerCase()}.`,
          );
        }}
      >
        <Field label={`Role for ${name}`}>
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={next}
              onChange={(e) => setNext(e.target.value as typeof next)}
            >
              <option value="family_member">{ROLE_LABELS.family_member}</option>
              <option value="proxy">{ROLE_LABELS.proxy}</option>
            </select>
          )}
        </Field>
        <Button type="submit" size="sm" variant="secondary" disabled={pending || next === role}>
          Change role<span className="sr-only"> for {name}</span>
        </Button>
      </form>
      <ConfirmDialog
        title={`Remove ${name} from your household?`}
        confirmLabel="Remove"
        tone="danger"
        disabled={remove.pending}
        error={remove.error}
        trigger={(open) => (
          <Button size="sm" variant="quiet" onClick={open}>
            Remove<span className="sr-only"> {name} from the household</span>
          </Button>
        )}
        onConfirm={() =>
          remove.act(
            () => removeMember({ data: { actorId } }),
            `${name} is no longer part of your household.`,
          )
        }
      >
        <p>
          {name} will no longer see anything in your household space. Tasks they were doing will be
          unassigned. Nothing they did is deleted, and you can invite them again later.
        </p>
        <p>Your care team will see that this changed.</p>
      </ConfirmDialog>
      <ErrorText error={error} />
    </div>
  );
}

/**
 * One invitation. While it hasn't been accepted, whoever can invite may revoke it or replace its
 * link (item 7). Both are confirmed and audit-logged; a replaced link stops working at once.
 */
function InvitationRow({
  i,
  canManage,
}: {
  i: { id: string; name: string; role: string; relationship: string | null; status: string; createdAt: Date };
  canManage: boolean;
}) {
  const { act, pending, error } = useAction();
  const [issued, setIssued] = useState<string | null>(null);
  const open = i.status === "pending" || i.status === "expired";
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{i.name}</span>
        <span className="text-ink-soft">
          {i.role}
          {i.relationship ? ` · ${i.relationship}` : ""} · {dateOnly(i.createdAt)}
        </span>
        <StateBadge state={i.status} />
      </div>
      {canManage && open && (
        <div className="mt-2 flex flex-wrap gap-2">
          <ConfirmDialog
            title={`Create a new link for ${i.name}?`}
            confirmLabel="Create a new link"
            error={error}
            disabled={pending}
            trigger={(o) => (
              <Button size="sm" variant="secondary" onClick={o} disabled={pending}>
                Create a new link<span className="sr-only"> for {i.name}</span>
              </Button>
            )}
            onConfirm={async () => {
              const r = await act(
                () => reissueInvitation({ data: { id: i.id } }),
                `New invitation link ready for ${i.name}.`,
              );
              if (r) setIssued(new URL(r.data.acceptUrl, window.location.origin).href);
              return r;
            }}
          >
            <p>The earlier link stops working straight away. The new one works once and expires in 7 days.</p>
          </ConfirmDialog>
          <ConfirmDialog
            title={`Revoke the invitation for ${i.name}?`}
            confirmLabel="Revoke invitation"
            tone="danger"
            error={error}
            disabled={pending}
            trigger={(o) => (
              <Button size="sm" variant="secondary" onClick={o} disabled={pending}>
                Revoke<span className="sr-only"> the invitation for {i.name}</span>
              </Button>
            )}
            onConfirm={() => act(() => cancelInvitation({ data: { id: i.id } }), "Invitation revoked.")}
          >
            <p>
              The link stops working, and {i.name} won't be able to join with it. You can invite them again
              later.
            </p>
          </ConfirmDialog>
        </div>
      )}
      {issued && (
        <div className="mt-3">
          <IssuedLink name={i.name} url={issued} />
        </div>
      )}
    </li>
  );
}
