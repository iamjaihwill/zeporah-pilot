import { z } from "zod";
import { StaffPending } from "@/components/staff/pending";
import { StaffPageHeader, ViewTabs } from "@/components/staff";
import {
  AdminSettings,
  LastChanged,
  OperationsSettings,
  SaveBar,
  UnsavedGuard,
  UnsavedTag,
  useUnsavedEdit,
} from "@/components/staff/org-settings-forms";
import { StaffInvites } from "@/components/staff/staff-invites";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  getHospiceDetails,
  getOrgSettings,
  getMessageSettings,
  getStaffInvitations,
  setHospiceDetails,
  setMessageExpectation,
} from "@/functions/staff";
import { cx, isDenied, unwrap, useAction } from "@/lib/client";
import { PILOT_DISPLAY } from "@/domain/display-config";
import { ExpectationNote, REPLY_TIME_UNSET, ReplyTimeMissing } from "@/components/expectation";
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
  Stamp,
  inputClass,
} from "@/components/ui";

const SECTIONS = [
  ["messaging", "Messaging"],
  ["workflow", "Workflow"],
  ["organization", "Organization"],
  ["controls", "Organization controls"],
  ["invitations", "Invitations"],
] as const;
type Section = (typeof SECTIONS)[number][0];

/** What each section covers, for the section list and each section's heading. */
const ABOUT: Record<Section, string> = {
  messaging: "What families are told about routine messages and reply times.",
  workflow: "Queue order, assigning care guides, common tasks, notifications, reports and status wording.",
  organization: "The 24-hour line and email sender name, and what's fixed in the app.",
  controls: "How long outside access can last, and how long records are kept.",
  invitations: "Invite care-team members to this hospice.",
};

/** "You can change" or "View only", for the section list and headings. */
function Access({ canEdit }: { canEdit: boolean }) {
  return (
    <span
      className={cx(
        "inline-block rounded-full border px-2 text-[0.6875rem] font-semibold",
        canEdit ? "border-moss/30 bg-moss-soft text-moss" : "border-line bg-sunk text-ink-soft",
      )}
    >
      {canEdit ? "You can change" : "View only"}
    </span>
  );
}

export const Route = createFileRoute("/staff/settings")({
  // One section at a time (the page was one long scroll); the section is in the address.
  validateSearch: z.object({
    section: z.enum(["messaging", "workflow", "organization", "controls", "invitations"]).optional(),
  }),
  loader: async () => {
    const [settings, invites, details, org] = await Promise.all([
      getMessageSettings(),
      getStaffInvitations(),
      getHospiceDetails(),
      getOrgSettings(),
    ]);
    return {
      settings: unwrap(settings),
      invites: unwrap(invites),
      details: unwrap(details),
      org: unwrap(org),
    };
  },
  component: Settings,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

/**
 * The hospice's own words about routine messages, with its expected reply time (required;
 * decision 24). Zeporah supplies no reply time: if nothing is set (or it's turned off), families
 * see a fixed sentence that names no time, plus "not for emergencies" and the 24-hour line.
 */
function Settings() {
  const { settings: d, invites, details, org } = Route.useLoaderData();
  const { section = "messaging" } = Route.useSearch();
  if (isDenied(d)) return <DeniedView d={d} />;
  const show = (x: Section) => section === x;
  const sections = SECTIONS.map(([k]) => k).filter((k) => k !== "invitations" || !isDenied(invites));
  const LABEL = Object.fromEntries(SECTIONS) as Record<Section, string>;
  // Who can change each section (the server checks again on every save).
  const editable: Record<Section, boolean> = {
    messaging: !isDenied(org) && org.canEditOperations,
    workflow: !isDenied(org) && org.canEditOperations,
    organization: !isDenied(details) && details.canEdit,
    controls: !isDenied(org) && org.canEditAdmin,
    invitations: true,
  };
  return (
    <>
      <StaffPageHeader title="Hospice settings" />
      <UnsavedGuard />
      {!d.current?.replyTime && <ReplyTimeMissing onSettings />}
      <div className="xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-8">
        {/* Wide screens: the sections as a list, each with what it covers and whether you can change it. */}
        <nav aria-label="Settings sections" className="max-xl:hidden">
          <ul className="sticky top-4 space-y-1">
            {sections.map((key) => (
              <li key={key}>
                <Link
                  to="/staff/settings"
                  search={{ section: key }}
                  aria-current={section === key ? "page" : undefined}
                  aria-label={LABEL[key]}
                  aria-describedby={`about-${key}`}
                  className={cx(
                    "block rounded-[var(--s-radius)] border px-3 py-2",
                    section === key
                      ? "border-harbor bg-harbor-soft"
                      : "border-transparent hover:border-line hover:bg-surface",
                  )}
                >
                  <span className="flex items-center justify-between gap-2 font-semibold text-ink">
                    {LABEL[key]}
                  </span>
                  <span id={`about-${key}`} className="mt-0.5 block text-[0.75rem] text-ink-soft">
                    {ABOUT[key]}
                  </span>
                  <span className="mt-1 block" aria-hidden>
                    <Access canEdit={editable[key]} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          {/* Narrower screens: the same sections as tabs. */}
          <ViewTabs
            label="Settings sections"
            className="mb-4 xl:hidden"
            items={sections.map((key) => ({
              key,
              label: LABEL[key],
              active: section === key,
              render: (cls, children) => (
                <Link
                  to="/staff/settings"
                  search={{ section: key }}
                  aria-current={section === key ? "page" : undefined}
                  className={cls}
                >
                  {children}
                </Link>
              ),
            }))}
          />
          <div className="mb-4 border-b pb-3">
            <h2 className="flex flex-wrap items-center gap-2 text-2xl">
              {LABEL[section]} <Access canEdit={editable[section]} />
            </h2>
            <p className="mt-1 text-ink-soft">{ABOUT[section]}</p>
          </div>
          {show("organization") && !isDenied(details) && (
            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <HospiceDetails
                initial={details}
                canEdit={details.canEdit}
                change={isDenied(org) ? undefined : org.lastChanged.hospiceDetails}
              />
              <Card title="Set in code">
                <dl className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-1.5">
                  {details.defaults.map((x) => (
                    <div key={x.label} className="contents">
                      <dt className="text-ink-soft">{x.label}</dt>
                      <dd>
                        {x.value}
                        {x.note && <span className="block text-[0.75rem] text-ink-soft">{x.note}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-[0.75rem] text-ink-soft">
                  Read-only here. Changing these needs a product decision.
                </p>
              </Card>
            </div>
          )}
          {show("organization") && !isDenied(details) && <Responsibilities rows={details.responsibilities} />}
          {show("messaging") && (
            <>
              <ExpectationForm current={d.current} hotline={d.hotline ?? null} />
              {/* Earlier versions, folded away: the form and preview above are what matters day to day. */}
              <details className="mt-6 rounded-[var(--s-radius)] border bg-surface p-[var(--s-pad)]">
                <summary className="cursor-pointer font-semibold">
                  History · {d.history.length === 1 ? "1 version" : `${d.history.length} versions`}
                </summary>
                <section aria-label="History" className="mt-3">
                  {d.history.length === 0 ? (
                    <p className="text-ink-soft">
                      Nothing has been set. Families see: “{REPLY_TIME_UNSET} …”
                    </p>
                  ) : (
                    <ol className="space-y-3 text-sm">
                      {d.history.map((h, i) => (
                        <li key={h.version} className="border-l-2 pl-3">
                          <p>
                            <strong>Version {h.version}</strong>{" "}
                            {/* Newest first: only the first is what families see now. */}
                            {!h.enabled ? (
                              <Badge tone="neutral">Turned off</Badge>
                            ) : i === 0 ? (
                              <Badge tone="moss">Current</Badge>
                            ) : (
                              <Badge tone="neutral">
                                Replaced <Stamp at={d.history[i - 1]!.effectiveFrom} />
                              </Badge>
                            )}{" "}
                            · <Stamp at={h.effectiveFrom} full /> · {h.changedBy}
                          </p>
                          {h.enabled && (
                            <>
                              <p className="mt-1">{h.expectation}</p>
                              {h.replyTime && <p className="text-ink-soft">Expected reply: {h.replyTime}</p>}
                              {h.handlingHours && <p className="text-ink-soft">Handled: {h.handlingHours}</p>}
                              {h.fallback && <p className="text-ink-soft">{h.fallback}</p>}
                            </>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </details>
            </>
          )}
          {show("workflow") && !isDenied(org) && (
            <section aria-label="Workflow settings">
              <OperationsSettings
                values={org.values}
                canEdit={org.canEditOperations}
                changes={org.lastChanged}
              />
            </section>
          )}
          {show("controls") && !isDenied(org) && (
            <section aria-label="Organization controls">
              <AdminSettings values={org.values} canEdit={org.canEditAdmin} changes={org.lastChanged} />
            </section>
          )}
          {show("invitations") && !isDenied(invites) && (
            <>
              <p className="mt-6 text-[0.875rem] text-ink-soft">
                You can also invite people, and see who's waiting to join, on{" "}
                <Link to="/staff/team" className="text-harbor underline">
                  Team &amp; coverage
                </Link>
                .
              </p>
              <StaffInvites list={invites} canInviteAnyRole={!isDenied(details) && details.canEdit} />
            </>
          )}
          <SaveBar />
        </div>
      </div>
    </>
  );
}

/** Founder decision 39: who changes what, and where. */
function Responsibilities({ rows }: { rows: { area: string; who: string; where: string }[] }) {
  return (
    <details className="mb-6 rounded-[var(--s-radius)] border bg-surface p-[var(--s-pad)]">
      <summary className="cursor-pointer font-semibold">Who changes what</summary>
      <p className="mt-2 text-[0.8125rem] text-ink-soft">
        Operations manage day-to-day workflow settings. Only administrators change roles, organization,
        security and access settings — anything that changes who can see, share or approve sensitive
        information. No one can expand their own authority.
      </p>
      <table className="mt-3 w-full text-left text-[0.8125rem]">
        <caption className="sr-only">Who changes each kind of setting</caption>
        <thead className="text-ink-soft">
          <tr>
            <th scope="col" className="py-1 pr-3 font-semibold">
              Setting
            </th>
            <th scope="col" className="py-1 pr-3 font-semibold">
              Who
            </th>
            <th scope="col" className="py-1 font-semibold">
              Where
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.area} className="border-t">
              <td className="py-1 pr-3">{r.area}</td>
              <td className="py-1 pr-3">{r.who}</td>
              <td className="py-1 text-ink-soft">{r.where}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * Inviting a care-team member to this hospice. The organization is always the signed-in person's
 * own; the link is shown once (only its hash is stored) because this prototype sends no email.
 */
function ExpectationForm({
  current,
  hotline,
}: {
  current: {
    handlingHours: string;
    expectation: string;
    fallback: string;
    replyTime: string;
    effectiveFrom: Date;
  } | null;
  hotline: string | null;
}) {
  // The preview's "updated" time: the current version's, or now once the page is in the browser
  // (a time taken during the server render wouldn't match the browser's and breaks hydration).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const [v, setV] = useState({
    handlingHours: current?.handlingHours ?? "",
    expectation: current?.expectation ?? "",
    fallback: current?.fallback ?? "",
    replyTime: current?.replyTime ?? "",
  });
  const { act, pending, error } = useAction();
  const [saved, setSaved] = useState(v);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  const canSave = !!v.expectation.trim() && !!v.replyTime.trim();
  const save = async () => {
    const r = await act(
      () => setMessageExpectation({ data: { enabled: true, ...v } }),
      "Saved as a new version. Families now see this wording.",
    );
    if (r) setSaved(v);
    return !!r;
  };
  // The section's save bar and the leave-without-saving prompt count this form too.
  const edit = useMemo(
    () => (dirty && canSave ? { label: "Messaging wording", save, discard: () => setV(saved) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty, canSave, v, saved],
  );
  useUnsavedEdit("messaging", edit);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card
        title={current ? "Current wording" : "No wording is set"}
        actions={dirty ? <UnsavedTag /> : undefined}
      >
        {!current && (
          <p className="mb-4 text-ink-soft">
            Families currently see: “{REPLY_TIME_UNSET} For anything urgent, call your 24-hour line.” Save
            your own wording and reply time to replace it.
          </p>
        )}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field
            label="What families should expect"
            hint="Required. For example how your team handles routine messages. Don't promise a time your team can't keep."
          >
            {(id, d) => (
              <textarea
                id={id}
                aria-describedby={d}
                required
                rows={3}
                maxLength={400}
                className={inputClass}
                value={v.expectation}
                onChange={(e) => setV({ ...v, expectation: e.target.value })}
              />
            )}
          </Field>
          <Field
            label="Expected reply time"
            hint="Required. Families see “Your care team usually replies …” followed by this. For example “within 1 business day”."
          >
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                required
                maxLength={80}
                className={inputClass}
                value={v.replyTime}
                onChange={(e) => setV({ ...v, replyTime: e.target.value })}
              />
            )}
          </Field>
          <Field
            label="When messages are handled (optional)"
            hint="Your own words, including weekends and holidays."
          >
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                maxLength={200}
                className={inputClass}
                value={v.handlingHours}
                onChange={(e) => setV({ ...v, handlingHours: e.target.value })}
              />
            )}
          </Field>
          <Field
            label="If they haven't heard back (optional)"
            hint="For example which number to call for routine questions."
          >
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                maxLength={300}
                className={inputClass}
                value={v.fallback}
                onChange={(e) => setV({ ...v, fallback: e.target.value })}
              />
            )}
          </Field>
          <ErrorText error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || !v.expectation.trim() || !v.replyTime.trim()}>
              Save as a new version
            </Button>
            {current && (
              <ConfirmDialog
                title="Stop showing a response expectation?"
                confirmLabel="Turn it off"
                error={error}
                trigger={(open) => (
                  <Button variant="secondary" onClick={open} disabled={pending}>
                    Turn it off
                  </Button>
                )}
                onConfirm={() =>
                  act(
                    () =>
                      setMessageExpectation({
                        data: {
                          enabled: false,
                          handlingHours: "",
                          expectation: "",
                          fallback: "",
                          replyTime: "",
                        },
                      }),
                    "Turned off. Families see the standard sentence, with no reply time.",
                  )
                }
              >
                <p>
                  Families will see “{REPLY_TIME_UNSET}” instead, with no reply time. The emergency notice and
                  24-hour line stay.
                </p>
                <p>The current wording is kept in the history.</p>
              </ConfirmDialog>
            )}
          </div>
        </form>
      </Card>
      {/* What families see, as they'll see it, updating as you type. */}
      <aside className="space-y-4" aria-label="Preview">
        <div>
          <p className="mb-1.5 text-[0.75rem] font-semibold tracking-wide text-ink-soft uppercase">
            What families see
          </p>
          <ExpectationNote
            e={
              (v.expectation.trim() || v.replyTime.trim()) && (current?.effectiveFrom ?? now)
                ? { version: 0, ...v, effectiveFrom: (current?.effectiveFrom ?? now)! }
                : null
            }
            line={hotline}
          />
        </div>
        <Notice tone="quiet" title="Always shown, whatever you set">
          Messages aren't for emergencies: call 911 or your hospice's 24-hour line
          {hotline ? <>: {hotline}</> : null}. This wording can't replace that notice.
        </Notice>
        <Notice tone="quiet" title="What this isn't">
          It isn't a service-level agreement, a clinical commitment or an on-call promise. Write only what
          your team can actually do. Weekends, holidays and closures belong in your own words — the app
          doesn't work out opening hours for you.
        </Notice>
      </aside>
    </div>
  );
}

/** The 24-hour line and email sender name. Each change is audit-logged with before and after. */
function HospiceDetails({
  initial,
  canEdit,
  change,
}: {
  initial: { name: string; afterHoursLine: string; emailSenderName: string };
  canEdit: boolean;
  change?: { by: string; at: Date } | undefined;
}) {
  const [v, setV] = useState({
    afterHoursLine: initial.afterHoursLine,
    emailSenderName: initial.emailSenderName,
  });
  const { act, pending, error } = useAction();
  const dirty = v.afterHoursLine !== initial.afterHoursLine || v.emailSenderName !== initial.emailSenderName;
  // People who can't change these read them as text, not as locked boxes.
  if (!canEdit)
    return (
      <Card title="Hospice details">
        <LastChanged change={change} />
        <p className="mb-3 text-[0.8125rem] text-ink-soft">Only an administrator can change these.</p>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-[0.875rem]">
          <dt className="text-ink-soft">24-hour line</dt>
          <dd>{initial.afterHoursLine}</dd>
          <dt className="text-ink-soft">Email sender name</dt>
          <dd>{initial.emailSenderName || "Zeporah (the standard)"}</dd>
        </dl>
      </Card>
    );
  return (
    <Card title="Hospice details">
      <LastChanged change={change} />
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => setHospiceDetails({ data: v }), "Hospice details saved.");
        }}
      >
        <Field
          label="24-hour line"
          hint="Families are told to call this for anything urgent. Shown across the family app."
        >
          {(id, d) => (
            <input
              id={id}
              aria-describedby={d}
              required
              maxLength={80}
              readOnly={!canEdit}
              className={inputClass}
              value={v.afterHoursLine}
              onChange={(e) => setV({ ...v, afterHoursLine: e.target.value })}
            />
          )}
        </Field>
        <Field label="Email sender name" hint="Shown as the sender of email notices. Empty: “Zeporah”.">
          {(id, d) => (
            <input
              id={id}
              aria-describedby={d}
              maxLength={60}
              readOnly={!canEdit}
              className={inputClass}
              value={v.emailSenderName}
              onChange={(e) => setV({ ...v, emailSenderName: e.target.value })}
            />
          )}
        </Field>
        <ErrorText error={error} />
        {canEdit && (
          <Button type="submit" size="sm" disabled={pending || !dirty}>
            Save hospice details
          </Button>
        )}
      </form>
    </Card>
  );
}
