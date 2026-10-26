import { useState } from "react";
import { cancelStaffInvitation, createStaffInvitation } from "@/functions/staff";
import { useAction } from "@/lib/client";
import { Button, Card, ErrorText, Field, Notice, Stamp, inputClass } from "@/components/ui";

/**
 * Inviting care-team members, and the invitations already made (Hospice settings → Invitations,
 * and Team & coverage). Operations invite care guides; other roles need an administrator.
 */
const STAFF_ROLE_OPTIONS = [
  ["care_guide", "Care guide"],
  ["hospice_ops", "Hospice operations"],
  ["privileged_reviewer", "Authority/consent reviewer"],
  ["hospice_admin", "Hospice administrator"],
] as const;

export function StaffInvites({
  list,
  canInviteAnyRole,
  compact = false,
}: {
  canInviteAnyRole: boolean;
  /**
   * Team & coverage: the form opens from an "Invite staff" button, and the list shows only
   * invitations still waiting, under "Waiting to join".
   */
  compact?: boolean;
  list: {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    invitedBy: string;
    expiresAt: Date;
  }[];
}) {
  const [v, setV] = useState({
    name: "",
    email: "",
    role: "care_guide" as (typeof STAFF_ROLE_OPTIONS)[number][0],
  });
  const [issued, setIssued] = useState<{ name: string; url: string } | null>(null);
  const { act, pending, error } = useAction();
  const [formOpen, setFormOpen] = useState(!compact);
  const shown = compact ? list.filter((x) => x.status === "pending") : list;
  return (
    <section className={compact ? "" : "mt-8"} aria-labelledby="staff-invites">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="staff-invites" className="text-2xl">
          {compact ? "Waiting to join" : "Invite a care-team member"}
        </h2>
        {compact && !formOpen && (
          <Button size="sm" onClick={() => setFormOpen(true)}>
            Invite staff
          </Button>
        )}
      </div>
      {compact && shown.length === 0 && !formOpen && (
        <p className="mt-1 text-ink-soft">No invitations are waiting.</p>
      )}
      {formOpen && (
        <p className="mt-1 text-ink-soft">
          They join this hospice in the role you choose.{" "}
          {canInviteAnyRole
            ? "Only administrators can invite into roles other than care guide."
            : "You can invite care guides; other roles need an administrator."}
        </p>
      )}
      {issued && (
        <div className="mt-4" data-testid="invitation-link">
          <Notice tone="harbor" title={`Invitation link for ${issued.name}`}>
            <p>
              Zeporah doesn't email invitations. Share this link with {issued.name} yourself. It works once,
              for the email you entered, and expires in 7 days. It won't be shown again.
            </p>
            <p className="mt-2 break-all font-mono text-sm text-ink">{issued.url}</p>
          </Notice>
        </div>
      )}
      {formOpen && (
        <Card className="mt-4">
          <form
            className="grid gap-4 sm:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await act(() => createStaffInvitation({ data: v }), `${v.name} was invited.`);
              if (r) {
                setIssued({ name: v.name, url: new URL(r.data.acceptUrl, window.location.origin).href });
                setV({ name: "", email: "", role: "care_guide" });
              }
            }}
          >
            <Field label="Their name">
              {(id) => (
                <input
                  id={id}
                  required
                  maxLength={120}
                  className={inputClass}
                  value={v.name}
                  onChange={(e) => setV({ ...v, name: e.target.value })}
                />
              )}
            </Field>
            <Field label="Their email">
              {(id) => (
                <input
                  id={id}
                  type="email"
                  required
                  autoComplete="off"
                  className={inputClass}
                  value={v.email}
                  onChange={(e) => setV({ ...v, email: e.target.value })}
                />
              )}
            </Field>
            <Field label="Role">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={v.role}
                  onChange={(e) => setV({ ...v, role: e.target.value as typeof v.role })}
                >
                  {STAFF_ROLE_OPTIONS.filter(([code]) => canInviteAnyRole || code === "care_guide").map(
                    ([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              )}
            </Field>
            <div className="sm:col-span-3">
              <ErrorText error={error} />
              <Button type="submit" disabled={pending}>
                Create invitation
              </Button>
              {compact && (
                <Button variant="quiet" className="ml-2" onClick={() => setFormOpen(false)}>
                  Close
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}
      {shown.length > 0 && (
        <div className="mt-4 relative overflow-x-auto rounded-[var(--radius-card)] border bg-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Care-team invitations</caption>
            <thead className="border-b bg-sunk text-xs tracking-wide text-ink-soft uppercase">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Name and email
                </th>
                <th scope="col" className="px-3 py-2">
                  Role
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((x) => (
                <tr key={x.id}>
                  <td className="px-3 py-2">
                    {x.name}
                    <span className="block text-ink-soft">{x.email}</span>
                  </td>
                  <td className="px-3 py-2">{x.role}</td>
                  <td className="px-3 py-2">
                    {x.status === "pending" ? (
                      <>
                        Pending · expires <Stamp at={x.expiresAt} full />
                      </>
                    ) : (
                      x.status.replace(/^./, (c) => c.toUpperCase())
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {x.status === "pending" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() =>
                          act(() => cancelStaffInvitation({ data: { id: x.id } }), "Invitation cancelled.")
                        }
                      >
                        Cancel<span className="sr-only"> invitation for {x.name}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
