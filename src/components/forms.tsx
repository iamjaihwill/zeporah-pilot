import { CADENCE_HINTS } from "@/domain/claims";
import { useEffect, useState } from "react";
import { inviteContact, saveCommunication, savePreferences } from "@/functions/family";
import { useAction } from "@/lib/client";
import { Button, Card, Check, ChoiceGroup, ErrorText, Field, Notice, inputClass } from "@/components/ui";
import { ROLE_EXPLANATIONS } from "@/domain/model";
import { EMAIL_SETTINGS_NOTE, OUT_OF_APP_NOTE } from "@/domain/claims";

type Prefs = {
  language: string;
  textSize: "standard" | "larger" | "largest";
  contactMethod: "in_app" | "phone" | "email";
  notificationCadence: "as_it_happens" | "daily_summary" | "essential_only";
  quietHoursStart: string;
  quietHoursEnd: string;
  emailNotices: boolean;
};

/** Where email nudges are offered (decision 23): the address they go to. Null = not available here. */
export type EmailOffer = { to: string } | null;

export const DEFAULT_PREFS: Prefs = {
  language: "en",
  textSize: "standard",
  contactMethod: "in_app",
  notificationCadence: "as_it_happens",
  quietHoursStart: "21:00",
  quietHoursEnd: "08:00",
  emailNotices: false,
};

export function PreferencesForm({
  initial,
  submitLabel,
  onSaved,
  email = null,
}: {
  initial: Prefs;
  submitLabel: string;
  onSaved?: () => void;
  email?: EmailOffer;
}) {
  const [v, setV] = useState(initial);
  const { act, pending, sending, error } = useAction();
  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await act(
          () =>
            savePreferences({
              data: {
                language: v.language,
                textSize: v.textSize,
                contactMethod: v.contactMethod,
              },
            }),
          "Your preferences were saved.",
        );
        if (r) onSaved?.();
      }}
    >
      <Field label="Language" hint="Screens are in English for now. Other languages are coming.">
        {(id, d) => (
          <select
            id={id}
            aria-describedby={d}
            className={inputClass}
            value={v.language}
            onChange={(e) => setV({ ...v, language: e.target.value })}
          >
            <option value="en">English</option>
            <option value="es" disabled>
              Español (coming soon)
            </option>
            <option value="vi" disabled>
              Tiếng Việt (coming soon)
            </option>
            <option value="ko" disabled>
              한국어 (coming soon)
            </option>
            <option value="zh" disabled>
              中文 (coming soon)
            </option>
          </select>
        )}
      </Field>
      <ChoiceGroup
        legend="Text size"
        hint="Why we ask: larger text can make long days easier. You can change this any time."
        name="textSize"
        value={v.textSize}
        onChange={(textSize) => setV({ ...v, textSize })}
        options={[
          { value: "standard", label: "Standard" },
          { value: "larger", label: "Larger" },
          { value: "largest", label: "Largest" },
        ]}
      />
      <ChoiceGroup
        legend="How should your care guide reach you?"
        hint={
          email
            ? "Your care guide will see how you'd like to be contacted. Zeporah's own email notices are a separate setting, under Notifications."
            : "Your care guide will see how you'd like to be contacted. Zeporah itself doesn't call or email you."
        }
        name="contact"
        value={v.contactMethod}
        onChange={(contactMethod) => setV({ ...v, contactMethod })}
        options={[
          { value: "in_app", label: "In Zeporah" },
          { value: "phone", label: "Phone call" },
          { value: "email", label: "Email" },
        ]}
      />
      <ErrorText error={error} />
      <Button type="submit" disabled={pending}>
        {sending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

export function CommunicationForm({
  initial,
  submitLabel,
  onSaved,
  email = null,
}: {
  initial: Prefs;
  submitLabel: string;
  onSaved?: () => void;
  email?: EmailOffer;
}) {
  const [v, setV] = useState(initial);
  const { act, pending, sending, error } = useAction();
  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await act(
          () =>
            saveCommunication({
              data: {
                notificationCadence: v.notificationCadence,
                quietHoursStart: v.quietHoursStart,
                quietHoursEnd: v.quietHoursEnd,
                emailNotices: !!email && v.emailNotices,
              },
            }),
          "Your communication settings were saved.",
        );
        if (r) onSaved?.();
      }}
    >
      {email && (
        <Check
          label="Email me when there's something new"
          hint={`A short note to ${email.to} saying there's an update — never names, health details or message text. Off unless you turn it on.`}
          checked={v.emailNotices}
          onChange={(emailNotices) => setV({ ...v, emailNotices })}
        />
      )}
      <ChoiceGroup
        legend="How often would you like to hear about updates?"
        hint={email ? EMAIL_SETTINGS_NOTE : OUT_OF_APP_NOTE}
        name="cadence"
        value={v.notificationCadence}
        onChange={(notificationCadence) => setV({ ...v, notificationCadence })}
        options={[
          // Decision 47: what each choice emails, said only where email exists.
          {
            value: "as_it_happens",
            label: "As things happen",
            ...(email ? { hint: CADENCE_HINTS.as_it_happens } : {}),
          },
          {
            value: "daily_summary",
            label: "A daily summary",
            ...(email ? { hint: CADENCE_HINTS.daily_summary } : {}),
          },
          {
            value: "essential_only",
            label: "Only essentials",
            ...(email ? { hint: CADENCE_HINTS.essential_only } : {}),
          },
        ]}
      />
      <fieldset className="space-y-2">
        <legend className="font-medium">Quiet hours</legend>
        <p className="text-sm text-ink-soft">{email ? EMAIL_SETTINGS_NOTE : OUT_OF_APP_NOTE}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From">
            {(id) => (
              <input
                id={id}
                type="time"
                className={inputClass}
                value={v.quietHoursStart}
                onChange={(e) => setV({ ...v, quietHoursStart: e.target.value })}
              />
            )}
          </Field>
          <Field label="Until">
            {(id) => (
              <input
                id={id}
                type="time"
                className={inputClass}
                value={v.quietHoursEnd}
                onChange={(e) => setV({ ...v, quietHoursEnd: e.target.value })}
              />
            )}
          </Field>
        </div>
      </fieldset>
      <Notice tone="quiet" title="Private by default">
        Notifications never include names, health details or message text — just “there's a new update”. You
        read the details after you sign in.
      </Notice>
      <ErrorText error={error} />
      <Button type="submit" disabled={pending}>
        {sending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

/** Invite one trusted person, with an access preview before it's recorded. */
/** `initial`: a listed contact being invited (decision 78); the person can still change anything. */
export function InviteForm({ initial }: { initial?: { name: string; contact: string } | undefined } = {}) {
  const [v, setV] = useState({
    name: initial?.name ?? "",
    contact: initial?.contact ?? "",
    role: "family_member" as "family_member" | "proxy" | "collaborator",
    relationship: "",
    scopeNote: "",
    endsOn: "",
  });
  const [reviewing, setReviewing] = useState(false);
  /** The one-time link for the last invitation, shown once. Only its hash is stored. */
  const [issued, setIssued] = useState<{ name: string; url: string } | null>(null);
  const { act, pending, error } = useAction();
  const can =
    v.role === "proxy"
      ? [
          "Assigned tasks and household updates",
          "The care-guide message thread",
          "Standard vault items (what exists and where)",
        ]
      : v.role === "collaborator"
        ? ["Household updates", "Tasks assigned to them", `Only until ${v.endsOn || "the date you choose"}`]
        : ["Household updates", "Tasks assigned to them"];
  const cannot =
    v.role === "proxy"
      ? [
          "Protected items, unless an authority workflow for them is reviewed and active",
          "Sharing decisions",
          "Care-team internal notes",
        ]
      : ["The vault", "The message thread", "Sharing choices", "Care-team internal notes"];
  return (
    <Card tone="quiet" title="Invite someone you trust">
      {issued && <IssuedLink name={issued.name} url={issued.url} />}
      {!reviewing ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setReviewing(true);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
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
            <Field label="Email" hint="They'll use this email to create their account.">
              {(id, d) => (
                <input
                  id={id}
                  aria-describedby={d}
                  type="email"
                  autoComplete="off"
                  required
                  className={inputClass}
                  value={v.contact}
                  onChange={(e) => setV({ ...v, contact: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Field label="Relationship (optional)">
            {(id) => (
              <input
                id={id}
                className={inputClass}
                value={v.relationship}
                onChange={(e) => setV({ ...v, relationship: e.target.value })}
              />
            )}
          </Field>
          <ChoiceGroup
            legend="Their role"
            name="role"
            value={v.role}
            onChange={(role) => setV({ ...v, role })}
            options={[
              { value: "family_member", label: "Family member", hint: ROLE_EXPLANATIONS.family_member },
              { value: "proxy", label: "Proxy", hint: ROLE_EXPLANATIONS.proxy },
              {
                value: "collaborator",
                label: "Helping the household for a while",
                hint: "Like a family member, for what you describe and until a date you choose. To ask someone for help with one task, use “Ask someone to help…” on that task instead.",
              },
            ]}
          />
          {v.role === "collaborator" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="What they'll help with" hint="They'll see this too.">
                {(id, d) => (
                  <input
                    id={id}
                    aria-describedby={d}
                    required
                    maxLength={300}
                    className={inputClass}
                    value={v.scopeNote}
                    onChange={(e) => setV({ ...v, scopeNote: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Access ends on">
                {(id) => (
                  <input
                    id={id}
                    type="date"
                    required
                    className={inputClass}
                    value={v.endsOn}
                    onChange={(e) => setV({ ...v, endsOn: e.target.value })}
                  />
                )}
              </Field>
            </div>
          )}
          <Button type="submit" variant="secondary">
            Review access
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <p>
            <strong>{v.name}</strong> would join as a{" "}
            <strong>{v.role === "proxy" ? "proxy" : "family member"}</strong>
            {v.role === "collaborator" && (
              <>
                {" "}
                until <strong>{v.endsOn}</strong>, to help with: {v.scopeNote}
              </>
            )}
            .
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-moss-soft p-3">
              <p className="font-medium text-moss">Will be able to see</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {can.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg bg-rose-soft p-3">
              <p className="font-medium text-rose">Won't be able to see</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {cannot.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-sm text-ink-soft">
            A role organizes access. It doesn't give anyone legal authority.
          </p>
          <ErrorText error={error} />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              onClick={async () => {
                const r = await act(
                  () =>
                    inviteContact({
                      data: {
                        name: v.name,
                        contact: v.contact,
                        role: v.role === "collaborator" ? "family_member" : v.role,
                        relationship: v.relationship || undefined,
                        ...(v.role === "collaborator"
                          ? {
                              accessModel: "collaboration" as const,
                              scopeNote: v.scopeNote,
                              accessEndsAt: new Date(`${v.endsOn}T23:59:00`).toISOString(),
                            }
                          : {}),
                      },
                    }),
                  // Nothing was sent: the person shares the link themselves (item 6).
                  `Invitation link ready for ${v.name}.`,
                );
                if (r) {
                  setIssued({ name: v.name, url: new URL(r.data.acceptUrl, window.location.origin).href });
                  setV({
                    name: "",
                    contact: "",
                    role: "family_member",
                    relationship: "",
                    scopeNote: "",
                    endsOn: "",
                  });
                  setReviewing(false);
                }
              }}
            >
              Record invitation
            </Button>
            <Button variant="secondary" onClick={() => setReviewing(false)}>
              Change something
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * A one-time invitation link, shown once (only its hash is stored). Copy it, or share it through
 * the device's own share sheet where there is one (item 7). Zeporah doesn't send it.
 */
export function IssuedLink({ name, url }: { name: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);
  return (
    <div className="mb-4" data-testid="invitation-link">
      <Notice tone="harbor" title={`Invitation link for ${name}`}>
        <p>
          Zeporah doesn't email invitations. Share this link with {name} yourself. It works once, for the
          email you entered, and expires in 7 days. It won't be shown again.
        </p>
        <p className="mt-2 break-all font-mono text-sm text-ink">{url}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            Copy link
          </Button>
          {canShare && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void navigator.share({ title: "Your Zeporah invitation", url }).catch(() => undefined)
              }
            >
              Share…
            </Button>
          )}
          <span role="status" aria-live="polite" className="text-sm font-medium text-moss">
            {copied ? "Copied" : ""}
          </span>
        </div>
      </Notice>
    </div>
  );
}
