import { CADENCE_HINTS } from "@/domain/claims";
import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getOnboarding, saveCommunication, savePreferences } from "@/functions/family";
import { isDenied, unwrap, useAction } from "@/lib/client";
import {
  Button,
  Card,
  Check,
  ChoiceGroup,
  DeniedView,
  ErrorText,
  Field,
  Notice,
  PageHeader,
  inputClass,
} from "@/components/ui";
import { DEFAULT_PREFS, type EmailOffer } from "@/components/forms";
import { EMAIL_SETTINGS_NOTE, OUT_OF_APP_NOTE } from "@/domain/claims";

export const Route = createFileRoute("/family/settings")({
  loader: async () => unwrap(await getOnboarding()),
  component: Settings,
});

type Prefs = typeof DEFAULT_PREFS;

function Settings() {
  const d = Route.useLoaderData();
  if (isDenied(d)) return <DeniedView d={d} />;
  const saved = { ...DEFAULT_PREFS, ...d.prefDefaults, ...(d.prefs ?? {}) } as Prefs;
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Your preferences"
        lede="These are yours alone. Changing them doesn't change anything for the rest of your household."
      />
      <SettingsForm saved={saved} email={d.email} />
    </>
  );
}

const same = (a: Prefs, b: Prefs) =>
  (Object.keys(a) as (keyof Prefs)[]).every(
    (k) => a[k] === b[k] || (k === "emailNotices" && !a[k] === !b[k]),
  );

/**
 * One page, one Save (interaction review, item 12): edits in both sections are saved together, and
 * leaving with unsaved changes asks first. Text size previews as soon as it's chosen; it's kept only
 * when saved, and it's this person's own setting (stored on their account, never in the browser).
 */
function SettingsForm({ saved, email }: { saved: Prefs; email: EmailOffer }) {
  const [v, setV] = useState<Prefs>(saved);
  const [base, setBase] = useState<Prefs>(saved);
  const { act, pending, sending, error } = useAction();
  const dirty = !same(v, base);

  // Preview text size now; put the saved size back if the page is left without saving.
  useEffect(() => {
    document.documentElement.dataset["text"] = v.textSize;
  }, [v.textSize]);
  useEffect(() => () => void (document.documentElement.dataset["text"] = base.textSize), [base.textSize]);

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const a = await act(() =>
          savePreferences({
            data: { language: v.language, textSize: v.textSize, contactMethod: v.contactMethod },
          }),
        );
        if (!a) return;
        const b = await act(
          () =>
            saveCommunication({
              data: {
                notificationCadence: v.notificationCadence,
                quietHoursStart: v.quietHoursStart,
                quietHoursEnd: v.quietHoursEnd,
                emailNotices: !!email && v.emailNotices,
              },
            }),
          "Saved.",
        );
        if (b) setBase(v);
      }}
    >
      <Card title="Language and accessibility">
        <div className="space-y-6">
          <Field label="Language" hint="Screens are in English for now. Other languages are coming.">
            {(id, h) => (
              <select
                id={id}
                aria-describedby={h}
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
            hint="You'll see it change straight away. It's kept when you save."
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
                ? "Your care guide will see how you'd like to be contacted. Zeporah's own email notices are a separate setting, below."
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
        </div>
      </Card>

      <Card title="Notifications">
        <div className="space-y-6">
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
            Notifications never include names, health details or message text — just “there's a new update”.
            You read the details after you sign in.
          </Notice>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <ErrorText error={error} />
        <Button type="submit" disabled={pending || !dirty}>
          {sending ? "Saving…" : "Save settings"}
        </Button>
        <span className="text-sm text-ink-soft" aria-live="polite" data-testid="settings-state">
          {dirty ? "You have unsaved changes." : "All changes saved."}
        </span>
      </div>

      {blocker.status === "blocked" && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="unsaved-title"
          className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md rounded-xl border border-ochre/40 bg-ochre-soft p-4 shadow-xl md:bottom-6"
        >
          <h2 id="unsaved-title" className="font-sans text-base font-semibold">
            Leave without saving?
          </h2>
          <p className="mt-1">Your changes to these settings haven't been saved.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                // Put the saved text size back before leaving.
                document.documentElement.dataset["text"] = base.textSize;
                blocker.proceed();
              }}
            >
              Leave without saving
            </Button>
            <Button variant="secondary" autoFocus onClick={() => blocker.reset()}>
              Stay on this page
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
