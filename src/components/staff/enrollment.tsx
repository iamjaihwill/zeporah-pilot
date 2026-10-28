/**
 * Enrollment and getting started (founder decisions 66–70): the enroll form on Households, and the
 * Getting started card with the first-member invitation on a household's overview.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { enrollHousehold, getEnrollment, inviteFirstMember } from "@/functions/staff";
import { dateOnly, useAction } from "@/lib/client";
import { Button, Card, ErrorText, Field, Notice, StateBadge, inputClass } from "@/components/ui";

type EnrollView = { inPilot: number; cap: number; careGuides: { actorId: string; name: string }[] };

/** Operations and administrators (decision 66). Administrators see the new household's name only. */
export function EnrollHousehold({ opensRecords }: { opensRecords: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<EnrollView | null>(null);
  const [v, setV] = useState({ patientName: "", careGuideActorId: "" });
  const [done, setDone] = useState<string | null>(null);
  const { act, pending, error, setError } = useAction();
  const start = async () => {
    setOpen(true);
    setDone(null);
    const r = await getEnrollment();
    if (r.ok) {
      setView(r.data);
      setV((x) => ({ ...x, careGuideActorId: x.careGuideActorId || r.data.careGuides[0]?.actorId || "" }));
    } else setError(r.message);
  };
  const full = !!view && view.inPilot >= view.cap;
  if (!open)
    return (
      <div className="mb-3">
        <Button variant="secondary" onClick={start}>
          Enroll a household
        </Button>
      </div>
    );
  return (
    <Card title="Enroll a household" className="mb-4">
      <p className="text-ink-soft">
        This creates the household in Zeporah. It doesn't admit anyone to hospice care, and declining Zeporah
        changes nothing about care.
      </p>
      {view && (
        <p className="mt-2 text-sm" data-testid="pilot-count">
          {view.inPilot} of {view.cap} households in the pilot.
        </p>
      )}
      {done && (
        <div className="mt-3">
          <Notice tone="harbor" title="Enrolled">
            {done}
          </Notice>
        </div>
      )}
      {full ? (
        <div className="mt-3">
          <Notice tone="ochre" title="The pilot is full">
            This hospice has {view!.cap} households in the pilot, its limit. An administrator can change the
            limit in Hospice settings.
          </Notice>
        </div>
      ) : (
        <form
          className="mt-3 grid gap-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act(() => enrollHousehold({ data: v }), "Household enrolled.");
            if (!r) return;
            if (opensRecords)
              await navigate({
                to: "/staff/households/$householdId",
                params: { householdId: r.data.householdId },
              });
            else {
              setDone(`${r.data.displayName} is enrolled. Its care guide takes it from here.`);
              setV({ ...v, patientName: "" });
              const again = await getEnrollment();
              if (again.ok) setView(again.data);
            }
          }}
        >
          <Field
            label="Patient's name"
            hint="Just the name. Everything else comes later, from the household."
          >
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                required
                maxLength={120}
                className={inputClass}
                value={v.patientName}
                onChange={(e) => setV({ ...v, patientName: e.target.value })}
              />
            )}
          </Field>
          <Field label="Care guide who gets it started">
            {(id) => (
              <select
                id={id}
                required
                className={inputClass}
                value={v.careGuideActorId}
                onChange={(e) => setV({ ...v, careGuideActorId: e.target.value })}
              >
                {(view?.careGuides ?? []).map((g) => (
                  <option key={g.actorId} value={g.actorId}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="sm:col-span-2">
            <ErrorText error={error} />
            <Button type="submit" disabled={pending || !view}>
              Enroll
            </Button>
            <Button variant="quiet" className="ml-2" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

type Activation = {
  owner: string | null;
  items: { key: string; label: string; done: boolean }[];
  activated: boolean;
  pendingInvitations: { name: string; role: string; expiresAt: Date }[];
};

/** Where the household is in getting started (tracked, not a gate), and the first invitation. */
export function GettingStarted({
  householdId,
  activation: a,
  canInvite,
}: {
  householdId: string;
  activation: Activation;
  canInvite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<{ name: string; url: string } | null>(null);
  const blank = {
    role: "patient" as "patient" | "coordinator",
    name: "",
    email: "",
    identityConfirmation: "",
  };
  const [v, setV] = useState(blank);
  const { act, pending, error } = useAction();
  const needsAccount = !a.items.find((i) => i.key === "account")?.done;
  return (
    <Card title="Getting started" className="mt-4">
      {a.owner && <p className="text-sm text-ink-soft">Owned by {a.owner}.</p>}
      <ul className="mt-2 space-y-1 text-sm">
        {a.items.map((i) => (
          <li key={i.key} className="flex items-start gap-2">
            <StateBadge state={i.done ? "done" : "pending"} label={i.done ? "Done" : "Not yet"} /> {i.label}
          </li>
        ))}
      </ul>
      {a.pendingInvitations.length > 0 && (
        <p className="mt-3 text-sm">
          Waiting:{" "}
          {a.pendingInvitations
            .map((p) => `${p.name} (${p.role.toLowerCase()}, until ${dateOnly(p.expiresAt)})`)
            .join("; ")}
          .
        </p>
      )}
      {issued && (
        <div className="mt-3" data-testid="first-invitation-link">
          <Notice tone="harbor" title={`Invitation link for ${issued.name}`}>
            <p>
              Zeporah doesn't email invitations. Give this link to {issued.name} yourself, or open it together
              at a visit. It works once, for the email you entered, and expires in 7 days. It won't be shown
              again.
            </p>
            <p className="mt-2 font-mono text-sm break-all text-ink">{issued.url}</p>
          </Notice>
        </div>
      )}
      {canInvite && needsAccount && !open && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setOpen(true)}>
          Invite the patient or coordinator
        </Button>
      )}
      {canInvite && open && (
        <form
          className="mt-3 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act(
              () => inviteFirstMember({ data: { householdId, ...v } }),
              `Invitation ready for ${v.name}.`,
            );
            if (r) {
              setIssued({ name: v.name, url: new URL(r.data.acceptUrl, window.location.origin).href });
              setV(blank);
              setOpen(false);
            }
          }}
        >
          <Field label="Inviting">
            {(id) => (
              <select
                id={id}
                className={inputClass}
                value={v.role}
                onChange={(e) => setV({ ...v, role: e.target.value as typeof v.role })}
              >
                <option value="patient">The patient</option>
                <option value="coordinator">A household coordinator</option>
              </select>
            )}
          </Field>
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
          <Field
            label="How did you confirm who they are and their role?"
            hint="For example: in person at the admission visit. A role organizes access; it isn't legal authority."
          >
            {(id, d) => (
              <textarea
                id={id}
                aria-describedby={d}
                required
                rows={2}
                maxLength={300}
                className={inputClass}
                value={v.identityConfirmation}
                onChange={(e) => setV({ ...v, identityConfirmation: e.target.value })}
              />
            )}
          </Field>
          <ErrorText error={error} />
          <Button type="submit" size="sm" disabled={pending}>
            Create invitation
          </Button>
          <Button variant="quiet" size="sm" className="ml-2" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      )}
    </Card>
  );
}
