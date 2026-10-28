/**
 * Listed contacts (founder decisions 74–78), on the family People page and the staff household
 * record. A listing is information only: it gives the person no account, no messages and no access.
 */
import { useState } from "react";
import type { Res } from "@/lib/client";
import { useAction } from "@/lib/client";
import { Badge, Button, Card, ConfirmDialog, ErrorText, Field, inputClass } from "@/components/ui";
import {
  CONTACT_RELATIONSHIP_LABELS,
  CONTACT_RELATIONSHIPS,
  type ContactRelationship,
} from "@/domain/contacts";

export type Contact = {
  id: string;
  name: string;
  relationship: ContactRelationship;
  relationshipLabel: string;
  organization: string;
  phone: string;
  email: string;
  note: string;
  patientPrivate: boolean;
  canEdit: boolean;
};

export type ContactFields = {
  name: string;
  relationship: ContactRelationship;
  organization: string;
  phone: string;
  email: string;
  note: string;
  patientPrivate: boolean;
};

const blank: ContactFields = {
  name: "",
  relationship: "private_caregiver",
  organization: "",
  phone: "",
  email: "",
  note: "",
  patientPrivate: false,
};

function ContactForm({
  initial,
  canMakePrivate,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ContactFields;
  canMakePrivate: boolean;
  submitLabel: string;
  onSubmit: (v: ContactFields) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const text = (
    key: "name" | "organization" | "phone" | "email",
    label: string,
    type = "text",
    hint?: string,
  ) => (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(id, d) => (
        <input
          id={id}
          aria-describedby={d}
          type={type}
          required={key === "name"}
          maxLength={key === "email" ? 254 : 120}
          autoComplete="off"
          className={inputClass}
          value={v[key]}
          onChange={(e) => setV({ ...v, [key]: e.target.value })}
        />
      )}
    </Field>
  );
  return (
    <form
      className="mt-3 grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await onSubmit(v);
        setBusy(false);
        if (ok) onCancel();
      }}
    >
      {text("name", "Their name")}
      <Field label="How they're involved">
        {(id) => (
          <select
            id={id}
            className={inputClass}
            value={v.relationship}
            onChange={(e) => setV({ ...v, relationship: e.target.value as ContactRelationship })}
          >
            {CONTACT_RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {CONTACT_RELATIONSHIP_LABELS[r]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {text("organization", "Organization (optional)")}
      {text("phone", "Phone (optional)", "tel")}
      {text("email", "Email (optional)", "email")}
      <Field label="How they help (optional)" hint="A few words. Please don't include health details.">
        {(id, d) => (
          <input
            id={id}
            aria-describedby={d}
            maxLength={300}
            className={inputClass}
            value={v.note}
            onChange={(e) => setV({ ...v, note: e.target.value })}
          />
        )}
      </Field>
      {canMakePrivate && (
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={v.patientPrivate}
            onChange={(e) => setV({ ...v, patientPrivate: e.target.checked })}
          />
          Only me and the care team can see this contact
        </label>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={busy}>
          {submitLabel}
        </Button>
        <Button variant="quiet" size="sm" className="ml-2" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ContactsCard({
  data,
  audience,
  add,
  update,
  remove,
  onInvite,
}: {
  data: { canAdd: boolean; canAddPrivate: boolean; contacts: Contact[] };
  /** Who's reading: the household, or the care team. */
  audience: "family" | "staff";
  add: (v: ContactFields) => Promise<Res<unknown>>;
  update: (id: string, v: ContactFields) => Promise<Res<unknown>>;
  remove: (id: string) => Promise<Res<unknown>>;
  /** Decision 78: turn a contact into an invitation (coordinators, on the People page). */
  onInvite?: ((c: Contact) => void) | undefined;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const { act, error } = useAction();
  const removing = useAction();
  return (
    <Card title={audience === "family" ? "Other people who help" : "Listed contacts"}>
      <p className="text-sm text-ink-soft">
        {audience === "family"
          ? "People who help outside Zeporah, like a doula, a private caregiver or a faith leader. Listing someone doesn't give them an account or show them anything."
          : "Supporters the household has listed. A listing gives them no account and no access."}
      </p>
      {data.contacts.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">No one listed yet.</p>
      ) : (
        <ul className="mt-3 divide-y">
          {data.contacts.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{c.name}</span>
                <Badge tone="neutral">{c.relationshipLabel}</Badge>
                {c.patientPrivate && (
                  <Badge tone="staff">
                    {audience === "family" ? "Only you and the care team" : "Private to the patient"}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                {[c.organization, c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}
              </p>
              {c.note && <p className="mt-1 text-sm">{c.note}</p>}
              {editing === c.id ? (
                <ContactForm
                  initial={{ ...c }}
                  canMakePrivate={data.canAddPrivate}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (v) => !!(await act(() => update(c.id, v), `${v.name} was updated.`))}
                />
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.canEdit && (
                    <Button variant="quiet" size="sm" onClick={() => setEditing(c.id)}>
                      Edit
                    </Button>
                  )}
                  {c.canEdit && (
                    <ConfirmDialog
                      trigger={(open) => (
                        <Button variant="quiet" size="sm" onClick={open}>
                          Remove
                        </Button>
                      )}
                      title={`Remove ${c.name}?`}
                      confirmLabel="Remove"
                      tone="danger"
                      error={removing.error}
                      onConfirm={() =>
                        removing.act(() => remove(c.id), `${c.name} was removed from the list.`)
                      }
                    >
                      They're taken off this list. Nothing is sent to them.
                    </ConfirmDialog>
                  )}
                  {onInvite && !c.patientPrivate && (
                    <Button variant="quiet" size="sm" onClick={() => onInvite(c)}>
                      Invite them to help…
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.canAdd &&
        (adding ? (
          <ContactForm
            initial={blank}
            canMakePrivate={data.canAddPrivate}
            submitLabel="Add to the list"
            onCancel={() => setAdding(false)}
            onSubmit={async (v) => !!(await act(() => add(v), `${v.name} was added to the list.`))}
          />
        ) : (
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setAdding(true)}>
            Add someone
          </Button>
        ))}
      <ErrorText error={error} />
    </Card>
  );
}
