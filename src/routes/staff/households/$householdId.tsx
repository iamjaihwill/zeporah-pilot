import { GettingStarted } from "@/components/staff/enrollment";
import { ContactsCard, type Contact } from "@/components/contacts";
import { StaffPending } from "@/components/staff/pending";
import { BackFromHousehold, useOpensHouseholds } from "@/components/staff/back-from-household";
import { Link, createFileRoute, getRouteApi } from "@tanstack/react-router";
import { REPLY_TIME_UNSET } from "@/components/expectation";
import { Fragment, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  activateConsent,
  amendConsent,
  addStaffNote,
  cancelBereavement,
  closeHousehold,
  completeStaffTask,
  composeUpdate,
  confirmBereavement,
  createPacket,
  createTask,
  getAuthority,
  getConsents,
  getHouseholdOverview,
  linkEvidenceHolder,
  dismissConsentCorrection,
  proposeBereavement,
  recordConsent,
  reviewEvidence,
  revokeConsentOnRequest,
  sendStaffMessage,
  submitEvidence,
  getHouseholdContacts,
  addHouseholdContact,
  updateHouseholdContact,
  removeHouseholdContact,
} from "@/functions/staff";
import {
  cx,
  dateOnly,
  dateTime,
  isDenied,
  stamp,
  UNCONFIRMED_SEND,
  unwrap,
  useAction,
  useSubmission,
} from "@/lib/client";
import {
  Stamp,
  Badge,
  Button,
  ButtonLink,
  Card,
  Check,
  ChoiceGroup,
  ConfirmDialog,
  DeniedView,
  EmptyState,
  ErrorText,
  Field,
  Notice,
  PageHeader,
  StateBadge,
  Visibility,
  inputClass,
  Coded,
} from "@/components/ui";
import { reasonLabel, auditLabel } from "@/domain/labels";
import {
  AUTHORITY_TYPES,
  AUTHORITY_TYPE_LABELS,
  SHARE_CATEGORIES,
  SHARE_CATEGORY_LABELS,
  type AuthorityType,
  type ShareCategory,
} from "@/domain/model";
import { REVOCATION_NOTE } from "@/domain/claims";
import { OneLineNote, StatusChip, useScrollFade } from "@/components/staff";
import { HIGHLIGHT, useHashTarget } from "@/lib/use-hash-target";
import { AssignCareGuide, EndAssignment } from "@/components/assignments";
import { BereavementPlanCard } from "@/components/bereavement";
import { CatchMeUp, ContextColumn, OpenItems, RecordTimeline } from "@/components/staff/record";
import { HandOver } from "@/components/staff/coverage";
import { PreparedDraft } from "@/components/staff/prepared";
import {
  AUTHORITY_STATUS_NOTE,
  IDENTITY_LINK_BASES,
  IDENTITY_LINK_BASIS_LABELS,
  type IdentityLinkBasis,
} from "@/domain/authority-identity";

// Staff rework, section 5: the record's tabs, in working order. Each keeps its existing permissions.
const TABS = [
  "overview",
  "messages",
  "updates",
  "tasks",
  "vault",
  "sharing",
  "packets",
  "notes",
  "lifecycle",
  "timeline",
] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  messages: "Messages",
  updates: "Updates",
  tasks: "Tasks",
  vault: "Vault",
  sharing: "Authority & consent",
  packets: "Packets",
  notes: "Internal notes",
  lifecycle: "Lifecycle",
  timeline: "Audit",
};

const staffLayout = getRouteApi("/staff");

export const Route = createFileRoute("/staff/households/$householdId")({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  loaderDeps: ({ search }) => ({ tab: search.tab ?? "overview" }),
  loader: async ({ params, deps }) => {
    const overview = unwrap(await getHouseholdOverview({ data: { householdId: params.householdId } }));
    if (isDenied(overview)) return { overview, authority: null, consents: null, contacts: null };
    // Decision 74: the household's listed contacts, on the overview.
    if (!deps.tab || deps.tab === "overview") {
      const contacts = unwrap(await getHouseholdContacts({ data: { householdId: params.householdId } }));
      return { overview, authority: null, consents: null, contacts: isDenied(contacts) ? null : contacts };
    }
    if (deps.tab !== "sharing" && deps.tab !== "packets")
      return { overview, authority: null, consents: null, contacts: null };
    const [authority, consents] = await Promise.all([
      getAuthority({ data: { householdId: params.householdId } }),
      getConsents({ data: { householdId: params.householdId } }),
    ]);
    return { overview, authority: unwrap(authority), consents: unwrap(consents), contacts: null };
  },
  component: Household,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

type Overview = Extract<Awaited<ReturnType<typeof getHouseholdOverview>>, { ok: true }>["data"];

function Household() {
  const { overview: o, authority, consents, contacts } = Route.useLoaderData();
  const { tab = "overview" } = Route.useSearch();
  // Tablets: the tab row scrolls; a fade shows there are more tabs. (Before any early return.)
  const tabsRef = useScrollFade<HTMLElement>();
  const opensHouseholds = useOpensHouseholds();
  if (isDenied(o)) return <DeniedView d={o} back={<BackFromHousehold />} generalNote={opensHouseholds} />;
  const waitingReplies = (() => {
    const lastStaff =
      o.messages
        .filter((m) => m.authorSide === "staff")
        .at(-1)
        ?.createdAt.getTime() ?? 0;
    return o.messages.filter((m) => m.authorSide === "family" && m.createdAt.getTime() > lastStaff).length;
  })();
  const badge: Partial<Record<Tab, number>> = {
    messages: waitingReplies,
    updates: o.updates.filter((u) => u.waitingOn.length).length,
    tasks: o.tasks.filter((t) => t.status === "open" && t.audience === "staff").length,
  };
  return (
    <>
      {/* Section 5: the record's header stays in view while scrolling. */}
      <div className="sticky top-12 z-20 -mx-4 mb-3 border-b bg-paper/95 px-4 pt-2 backdrop-blur lg:-mx-6 lg:px-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h1 className="truncate">{o.household.name}</h1>
            <p className="text-[0.8125rem] text-ink-soft">
              Patient {o.household.patientName} · enrolled {dateOnly(o.household.enrolledAt)} · care team{" "}
              {o.context.careTeam.current.length
                ? o.context.careTeam.current
                    .map((g) =>
                      g.coverFor && g.until ? `${g.name} covering until ${stamp(g.until)}` : g.name,
                    )
                    .join(", ")
                : "not assigned"}
              {o.canReassign && (
                <>
                  {" "}
                  ·{" "}
                  <Link
                    to="/staff/households/$householdId"
                    params={{ householdId: o.household.id }}
                    search={{ tab: "overview" }}
                    hash="care-team"
                    className="text-harbor underline"
                  >
                    Reassign
                  </Link>
                </>
              )}
              {/* Also under After hours on Overview; kept out of the header on tablets so it fits. */}
              {o.hotline && <span className="hidden xl:inline"> · 24-hour line {o.hotline}</span>}
            </p>
            {o.context.careTeam.handoffsOffered.map((h) => (
              <p key={h.id} className="text-[0.75rem] text-ochre">
                {h.kind === "cover" ? "Cover" : "Handoff"} offered to {h.to}, waiting since{" "}
                {stamp(h.offeredAt)}
              </p>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {(() => {
              // The household's open items (the queue's rows); Exceptions replace these in Phase 2.
              const n = o.context.openItems.length;
              return (
                <Link
                  to="/staff/households/$householdId"
                  params={{ householdId: o.household.id }}
                  search={{ tab: "overview" }}
                  hash="open-items"
                  className="text-[0.75rem] text-ink-soft underline-offset-2 hover:underline"
                >
                  {n ? `${n} open item${n === 1 ? "" : "s"}` : "No open items"}
                </Link>
              );
            })()}
            <CatchMeUp householdId={o.household.id} />
            <StatusChip domain="household" value={o.household.lifecycle} />
          </div>
        </div>
        <nav
          ref={tabsRef}
          data-scroll-fade
          aria-label="Household sections"
          className="relative -mx-1 mt-1 overflow-x-auto"
        >
          <ul className="flex gap-1 px-1">
            {TABS.map((t) => (
              <li key={t}>
                <Link
                  to="/staff/households/$householdId"
                  params={{ householdId: o.household.id }}
                  search={{ tab: t }}
                  aria-current={tab === t ? "page" : undefined}
                  className={cx(
                    "-mb-px flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-[0.8125rem] whitespace-nowrap",
                    tab === t
                      ? "border-harbor font-semibold text-ink"
                      : "border-transparent text-ink-soft hover:text-ink",
                  )}
                >
                  {TAB_LABELS[t]}
                  {!!badge[t] && <Badge tone="ochre">{badge[t]}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      {tab === "overview" && <OverviewTab o={o} contacts={contacts} />}
      {tab === "messages" && <MessagesTab o={o} />}
      {tab === "updates" && <UpdatesTab o={o} />}
      {tab === "notes" && <NotesTab o={o} />}
      {tab === "tasks" && <TasksTab o={o} />}
      {tab === "vault" && <VaultTab o={o} />}
      {tab === "sharing" &&
        (authority && consents && !isDenied(authority) && !isDenied(consents) ? (
          <SharingTab o={o} authority={authority} consents={consents} />
        ) : (
          <DeniedView
            d={
              authority && isDenied(authority)
                ? authority
                : consents && isDenied(consents)
                  ? consents
                  : {
                      denied: true,
                      code: "NOT_PERMITTED",
                      message: "Authority and sharing details aren't available to your role.",
                    }
            }
          />
        ))}
      {tab === "packets" &&
        (authority && consents && !isDenied(authority) && !isDenied(consents) ? (
          <PacketSection o={o} authority={authority} consents={consents} />
        ) : (
          <PacketList o={o} />
        ))}
      {tab === "lifecycle" && <LifecycleTab o={o} />}
      {tab === "timeline" && <TimelineTab o={o} />}
    </>
  );
}

/* ------------------------------------------------------------------ overview */

/**
 * Who on the hospice team works with this household. Everyone who can open the household sees the
 * assigned care guides; hospice operations can assign another and end an assignment (with a
 * reason only staff see). Ending one takes the household out of that guide's view.
 */
function CareTeamCard({ o }: { o: Overview }) {
  const t = o.careTeam;
  // Cover (decision 59) and the full assignment history, from the record's context.
  const cover = new Map(o.context.careTeam.current.map((g) => [g.membershipId, g]));
  const history = o.context.careTeam.history;
  return (
    <Card title="Care team" className="lg:col-span-1">
      {t.guides.length ? (
        <ul className="space-y-3">
          {t.guides.map((g) => (
            <li key={g.membershipId} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{g.name}</span>{" "}
                <span className="text-sm text-ink-soft">· Care guide since {dateOnly(g.since)}</span>
                {cover.get(g.membershipId)?.coverFor && (
                  <span className="block text-sm text-ochre">
                    Covering for {cover.get(g.membershipId)!.coverFor} until{" "}
                    {stamp(cover.get(g.membershipId)!.until!)}
                  </span>
                )}
              </span>
              {t.canManage && !t.closed && (
                <span className="flex flex-wrap gap-1">
                  {!cover.get(g.membershipId)?.coverFor && (
                    <HandOver
                      householdId={o.household.id}
                      householdName={o.household.name}
                      from={{ actorId: g.actorId, name: g.name }}
                      guides={t.eligible}
                    />
                  )}
                  <EndAssignment membershipId={g.membershipId} name={g.name} />
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-soft">No care guide assigned.</p>
      )}
      {history.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-ink-soft">Assignment history ({history.length})</summary>
          <ol className="mt-2 space-y-1.5" aria-label="Care-guide assignments, newest first">
            {history.map((h) => (
              <li key={h.membershipId}>
                <span className="font-medium">{h.name}</span>
                {h.coverFor ? ` · cover for ${h.coverFor}` : " · care guide"}
                <span className="block text-ink-soft">
                  From {stamp(h.since)}
                  {h.endedAt
                    ? ` to ${stamp(h.endedAt)}${h.endReason ? `: ${h.endReason}` : ""}`
                    : h.until
                      ? `, until ${stamp(h.until)}`
                      : ", current"}
                </span>
                {h.reason && <span className="block text-ink-soft">Reason: {h.reason}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {t.canManage &&
        (t.closed ? (
          <p className="mt-3 text-sm text-ink-soft">
            This household is closed, so its care team can't change.
          </p>
        ) : t.eligible.length ? (
          <div className="mt-4 border-t pt-4">
            <AssignCareGuide
              householdId={o.household.id}
              eligible={t.eligible}
              caseloadWarnAt={t.defaults.caseloadWarnAt}
              hint="They'll see this household the next time a page loads."
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-soft">
            Every care guide at this hospice is already assigned here.
          </p>
        ))}
    </Card>
  );
}

/**
 * Coordination Record v2 (decision 58): the unified timeline beside a fixed context column. Below
 * 1024px the column stacks under the timeline, with open items first.
 */
function OverviewTab({
  o,
  contacts,
}: {
  o: Overview;
  contacts: { canAdd: boolean; canAddPrivate: boolean; contacts: Contact[] } | null;
}) {
  const { me } = staffLayout.useLoaderData();
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18.75rem] xl:grid-cols-[minmax(0,1fr)_21.25rem]">
      <div className="min-w-0 space-y-6">
        <div className="lg:hidden">
          <OpenItems o={o} />
        </div>
        {o.bereavementPlan && <BereavementPlanCard plan={o.bereavementPlan} />}
        <RecordTimeline o={o} />
      </div>
      <aside aria-label="Household context" className="min-w-0">
        <ContextColumn o={o} careTeam={<CareTeamCard o={o} />} />
        {contacts && (
          <div className="mt-4">
            <ContactsCard
              data={contacts}
              audience="staff"
              add={(v) => addHouseholdContact({ data: { householdId: o.household.id, ...v } })}
              update={(id, v) => updateHouseholdContact({ data: { householdId: o.household.id, id, ...v } })}
              remove={(id) => removeHouseholdContact({ data: { householdId: o.household.id, id } })}
            />
          </div>
        )}
        {!o.activation.activated && (
          <GettingStarted
            householdId={o.household.id}
            activation={o.activation}
            canInvite={me.roleCodes.some((r) => r === "hospice_ops" || r === "care_guide")}
          />
        )}
        {o.onboarding.some((x) => !x.done) && (
          <Card title="Household setup" className="mt-4">
            <ul className="space-y-1 text-sm">
              {o.onboarding.map((x) => (
                <li key={x.step} className="flex items-center gap-2">
                  <StateBadge state={x.done ? "done" : "pending"} label={x.done ? "Done" : "Not yet"} />{" "}
                  {x.step.replace(/_/g, " ")}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ messages */

function MessagesTab({ o }: { o: Overview }) {
  const [draft, setDraft] = useState("");
  // Started from the synthetic prepared draft (decision 58): recorded with the message.
  const [usedPrepared, setUsedPrepared] = useState(false);
  const { act, pending, error } = useAction();
  const submission = useSubmission();
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section aria-labelledby="thread">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="thread" className="text-2xl">
            Care-guide thread
          </h2>
          <Visibility who="household" />
        </div>
        {o.messages.length ? (
          <ol className="space-y-3">
            {o.messages.map((m) => (
              <li
                key={m.id}
                className={cx(
                  "max-w-[85%] rounded-2xl px-4 py-3",
                  m.authorSide === "staff"
                    ? "ml-auto bg-harbor-soft"
                    : "bg-surface shadow-[var(--shadow-card)]",
                )}
              >
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  {m.author} {m.authorSide === "staff" ? "(care team)" : "(household)"} ·{" "}
                  {dateTime(m.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title="No messages yet" />
        )}
        {o.can.message && (
          <form
            className="mt-4 rounded-[var(--radius-card)] border border-harbor/30 bg-surface p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const sent = draft;
              const submissionId = submission.idFor(sent);
              if (
                await act(
                  () =>
                    sendStaffMessage({
                      data: { householdId: o.household.id, body: sent, prepared: usedPrepared, submissionId },
                    }),
                  "Message sent to the household.",
                  undefined,
                  UNCONFIRMED_SEND,
                )
              ) {
                submission.done();
                setDraft((d) => (d === sent ? "" : d));
              }
            }}
          >
            {o.prepared && !usedPrepared && (
              <div className="mb-3">
                <PreparedDraft
                  label={o.prepared.label}
                  text={o.prepared.message}
                  suggests="A reply to the household."
                  approve="Nothing yet. You can edit it; Send sends it to the household from you."
                  onUse={() => {
                    setDraft(o.prepared!.message);
                    setUsedPrepared(true);
                  }}
                />
              </div>
            )}
            <Field
              label="Reply to the household"
              hint="The household will see this. For internal notes, use the Internal notes tab."
            >
              {(id, d) => (
                <textarea
                  id={id}
                  aria-describedby={d}
                  rows={3}
                  className={inputClass}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              )}
            </Field>
            <ErrorText error={error} />
            <Button type="submit" className="mt-3" disabled={pending || !draft.trim()}>
              Send to household
            </Button>
          </form>
        )}
      </section>
      <aside>
        <Notice tone="quiet" title="Routine coordination only">
          This thread isn't monitored around the clock and isn't for clinical triage. Clinical concerns follow
          the hospice's own procedures.
        </Notice>
        <div className="mt-4">
          <Notice tone="quiet" title="What families are told about replies">
            {o.expectation ? (
              <>
                <p>
                  {o.expectation.replyTime
                    ? `Your care team usually replies ${o.expectation.replyTime}.`
                    : REPLY_TIME_UNSET}
                </p>
                <p className="mt-1">{o.expectation.expectation}</p>
                {o.expectation.handlingHours && (
                  <p className="mt-1">Handled: {o.expectation.handlingHours}</p>
                )}
                {o.expectation.fallback && <p className="mt-1">{o.expectation.fallback}</p>}
                <p className="mt-1 text-xs">
                  Hospice wording, version {o.expectation.version}, since{" "}
                  <Stamp at={o.expectation.effectiveFrom} full />.
                </p>
              </>
            ) : (
              <p>
                Your hospice hasn't set a reply time, so families see the standard sentence: “
                {REPLY_TIME_UNSET}
                For anything urgent, call [24-hour line].”
              </p>
            )}
          </Notice>
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ updates */

function UpdatesTab({ o }: { o: Overview }) {
  const [v, setV] = useState({ title: "", body: "", requiresAck: false });
  const [previewing, setPreviewing] = useState(false);
  const { act, pending, error } = useAction();
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <section aria-labelledby="ups" className="space-y-3">
        <h2 id="ups" className="text-2xl">
          Family-visible updates
        </h2>
        {o.updates.length ? (
          o.updates.map((u) => (
            <Card key={u.id} as="article" tone="harbor">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-lg">{u.title}</h3>
                <span className="text-sm text-ink-soft">
                  {u.author} · <Stamp at={u.createdAt} />
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{u.body}</p>
              {u.audienceNames && (
                <p className="mt-2 text-sm text-ink-soft" data-testid="update-audience">
                  Posted by the system when cover started (decision 62). Seen by: {u.audienceNames.join(", ")}
                  .
                </p>
              )}
              {u.requiresAck && (
                <p className="mt-2 text-sm">
                  {u.waitingOn.length ? (
                    <StateBadge state="pending" label={`Waiting on ${u.waitingOn.join(", ")}`} />
                  ) : (
                    <StateBadge state="done" label="Everyone acknowledged" />
                  )}
                  {u.ackedBy.length > 0 && (
                    <span className="ml-2 text-ink-soft">Acknowledged by {u.ackedBy.join(", ")}</span>
                  )}
                </p>
              )}
            </Card>
          ))
        ) : (
          <EmptyState title="No updates yet" />
        )}
      </section>
      {o.can.compose && (
        <Card title="Compose an update" tone="plain">
          <div className="mb-3">
            <Visibility who="household" />
          </div>
          {!previewing ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setPreviewing(true);
              }}
            >
              <Field label="Title">
                {(id) => (
                  <input
                    id={id}
                    required
                    className={inputClass}
                    value={v.title}
                    onChange={(e) => setV({ ...v, title: e.target.value })}
                    maxLength={140}
                  />
                )}
              </Field>
              <Field
                label="Message"
                hint="Plain language. No clinical details that belong in the clinical record."
              >
                {(id, d) => (
                  <textarea
                    id={id}
                    aria-describedby={d}
                    required
                    rows={5}
                    className={inputClass}
                    value={v.body}
                    onChange={(e) => setV({ ...v, body: e.target.value })}
                  />
                )}
              </Field>
              <Check
                label="Ask the household to acknowledge"
                checked={v.requiresAck}
                onChange={(requiresAck) => setV({ ...v, requiresAck })}
              />
              <Button type="submit" variant="secondary">
                Preview
              </Button>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-soft">
                Everyone in the household who can read updates will see:
              </p>
              <div className="rounded-lg border border-harbor/25 bg-harbor-soft p-3">
                <p className="font-display text-lg">{v.title}</p>
                <p className="whitespace-pre-wrap">{v.body}</p>
              </div>
              <p className="text-sm text-ink-soft">
                They'll get a notification that says only “There's a new update from your care team”.
              </p>
              <ErrorText error={error} />
              <div className="flex gap-2">
                <Button
                  disabled={pending}
                  onClick={async () => {
                    if (
                      await act(
                        () => composeUpdate({ data: { householdId: o.household.id, ...v } }),
                        "Update posted to the household.",
                      )
                    ) {
                      setV({ title: "", body: "", requiresAck: false });
                      setPreviewing(false);
                    }
                  }}
                >
                  Post to household
                </Button>
                <Button variant="secondary" onClick={() => setPreviewing(false)}>
                  Edit
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ internal notes */

function NotesTab({ o }: { o: Overview }) {
  const [draft, setDraft] = useState("");
  const { act, pending, error } = useAction();
  return (
    <section aria-labelledby="notes" className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="notes" className="text-2xl">
          Internal notes
        </h2>
        <Visibility who="staff" />
      </div>
      <Notice tone="staff">
        Notes here are for the care team only. They never appear in the family app, notifications or activity,
        and their text is never copied into the audit log.
      </Notice>
      {o.can.note && (
        <form
          className="rounded-[var(--radius-card)] border border-staff/30 bg-staff-soft p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const saved = draft;
            if (
              await act(
                () => addStaffNote({ data: { householdId: o.household.id, body: saved } }),
                "Internal note saved.",
              )
            )
              setDraft((d) => (d === saved ? "" : d));
          }}
        >
          <Field label="Add an internal note">
            {(id) => (
              <textarea
                id={id}
                rows={3}
                className={inputClass}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            )}
          </Field>
          <ErrorText error={error} />
          <Button type="submit" className="mt-3" disabled={pending || !draft.trim()}>
            Save internal note
          </Button>
        </form>
      )}
      <ul className="space-y-3">
        {o.notes.map((n) => (
          <li key={n.id} className="rounded-xl border border-staff/25 bg-staff-soft p-4">
            <p className="whitespace-pre-wrap">{n.body}</p>
            <p className="mt-1 text-xs text-ink-soft">
              {n.author} · {dateTime(n.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ tasks */

function TasksTab({ o }: { o: Overview }) {
  const [v, setV] = useState({
    title: "",
    detail: "",
    audience: "family" as "family" | "staff",
    assigneeActorId: "",
    whenLabel: "",
    requiresAck: false,
    dueAt: null as string | null,
  });
  const { act, pending, error } = useAction();
  // Care-team tasks link here as #task-… (Care-team tasks page): scroll to it and tint its row
  // (a ring doesn't draw cleanly around a table row).
  const target = useHashTarget();
  const people = v.audience === "family" ? o.members.map((m) => ({ id: m.actorId, name: m.name })) : [];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section aria-labelledby="tasks" className="space-y-3">
        <h2 id="tasks" className="text-2xl">
          Tasks
        </h2>
        <ErrorText error={error} />
        <div className="relative overflow-x-auto rounded-[var(--radius-card)] border bg-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Tasks for this household</caption>
            <thead className="border-b bg-sunk text-xs tracking-wide text-ink-soft uppercase">
              <tr>
                <th className="px-3 py-2" scope="col">
                  Task
                </th>
                <th className="px-3 py-2" scope="col">
                  Who sees it
                </th>
                <th className="px-3 py-2" scope="col">
                  With
                </th>
                <th className="px-3 py-2" scope="col">
                  Status
                </th>
                <th className="px-3 py-2" scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {o.tasks.map((t) => (
                <tr
                  key={t.id}
                  id={`task-${t.id}`}
                  tabIndex={-1}
                  className={cx("outline-none", target === `task-${t.id}` && "bg-harbor-soft")}
                >
                  <td className="px-3 py-2">
                    <span className="font-medium">{t.title}</span>
                    {t.whenLabel && <span className="block text-ink-soft">{t.whenLabel}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {t.audience === "family" ? (
                      <Badge tone="harbor">Household</Badge>
                    ) : (
                      <Badge tone="staff">Care team only</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">{t.assignee ?? "—"}</td>
                  <td className="px-3 py-2">
                    <StateBadge state={t.status} />
                  </td>
                  <td className="px-3 py-2">
                    {t.canMarkDone && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() =>
                          act(
                            () => completeStaffTask({ data: { id: t.id } }),
                            t.audience === "family" && t.assignee
                              ? `Marked done for ${t.assignee.split(" ")[0]}.`
                              : "Task marked done.",
                          )
                        }
                      >
                        {t.audience === "family" && t.assignee
                          ? `Mark done for ${t.assignee.split(" ")[0]}`
                          : "Done"}
                        <span className="sr-only">: {t.title}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {o.can.tasks && (
        <Card title="Add a task">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  () =>
                    createTask({
                      data: { householdId: o.household.id, ...v, assigneeActorId: v.assigneeActorId || null },
                    }),
                  "Task added.",
                )
              )
                setV({ ...v, title: "", detail: "", whenLabel: "", dueAt: null });
            }}
          >
            {o.taskCatalog.length > 0 && (
              <Field label="Start from a common task (optional)" hint="Your hospice's task catalog.">
                {(id, d) => (
                  <select
                    id={id}
                    aria-describedby={d}
                    className={inputClass}
                    value=""
                    onChange={(e) => {
                      const t = o.taskCatalog.find((x) => x.id === e.target.value);
                      if (t)
                        setV({
                          ...v,
                          title: t.title,
                          detail: t.detail,
                          audience: t.audience,
                          assigneeActorId: "",
                          dueAt:
                            t.dueInDays === null
                              ? null
                              : new Date(Date.now() + t.dueInDays * 86_400_000).toISOString(),
                        });
                    }}
                  >
                    <option value="">Choose a common task</option>
                    {o.taskCatalog.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                        {t.audience === "staff" ? " (care team)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <ChoiceGroup
              legend="Who is it for?"
              name="aud"
              value={v.audience}
              onChange={(audience) => setV({ ...v, audience, assigneeActorId: "" })}
              options={[
                { value: "family", label: "The household", hint: "Visible to the household" },
                { value: "staff", label: "The care team", hint: "Care team only" },
              ]}
            />
            <Field label="Title">
              {(id) => (
                <input
                  id={id}
                  required
                  className={inputClass}
                  value={v.title}
                  onChange={(e) => setV({ ...v, title: e.target.value })}
                />
              )}
            </Field>
            <Field label="Details (optional)">
              {(id) => (
                <textarea
                  id={id}
                  rows={2}
                  className={inputClass}
                  value={v.detail}
                  onChange={(e) => setV({ ...v, detail: e.target.value })}
                />
              )}
            </Field>
            {v.audience === "family" && (
              <Field label="Assign to">
                {(id) => (
                  <select
                    id={id}
                    className={inputClass}
                    value={v.assigneeActorId}
                    onChange={(e) => setV({ ...v, assigneeActorId: e.target.value })}
                  >
                    <option value="">Not assigned</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field label="When" hint="Gentle timing, like “this week”. Never “overdue”.">
              {(id, d) => (
                <input
                  id={id}
                  aria-describedby={d}
                  className={inputClass}
                  value={v.whenLabel}
                  onChange={(e) => setV({ ...v, whenLabel: e.target.value })}
                />
              )}
            </Field>
            {v.audience === "family" && (
              <Check
                label="Ask to be told when it's done"
                checked={v.requiresAck}
                onChange={(requiresAck) => setV({ ...v, requiresAck })}
              />
            )}
            <Button type="submit" disabled={pending}>
              Add task
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ vault */

function VaultTab({ o }: { o: Overview }) {
  return (
    <section aria-labelledby="vault" className="space-y-3">
      <h2 id="vault" className="text-2xl">
        Vault status
      </h2>
      <p className="text-ink-soft">Metadata and review status only. Zeporah stores no documents.</p>
      <div className="relative overflow-x-auto rounded-[var(--radius-card)] border bg-surface">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Vault items</caption>
          <thead className="border-b bg-sunk text-xs tracking-wide text-ink-soft uppercase">
            <tr>
              <th className="px-3 py-2" scope="col">
                Item
              </th>
              <th className="px-3 py-2" scope="col">
                Status
              </th>
              <th className="px-3 py-2" scope="col">
                Kept
              </th>
              <th className="px-3 py-2" scope="col">
                Reviewed
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {o.vault.map((v) => (
              <tr key={v.id}>
                <td className="px-3 py-2">
                  {v.title} {v.sensitivity === "protected" && <Badge tone="clay">Protected</Badge>}
                </td>
                <td className="px-3 py-2">
                  <StateBadge state={v.status} />
                </td>
                <td className="px-3 py-2 text-ink-soft">{v.keptWhere ?? "—"}</td>
                <td className="px-3 py-2 text-ink-soft">
                  {v.reviewedAt ? (
                    <>
                      {v.reviewedBy ? `${v.reviewedBy}, ` : ""}
                      <Stamp at={v.reviewedAt} />
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ authority, consent, packets */

type AuthorityData = Extract<Awaited<ReturnType<typeof getAuthority>>, { ok: true }>["data"];
type ConsentData = Extract<Awaited<ReturnType<typeof getConsents>>, { ok: true }>["data"];

function SharingTab({
  o,
  authority,
  consents,
}: {
  o: Overview;
  authority: AuthorityData;
  consents: ConsentData;
}) {
  return (
    <div className="space-y-8">
      <OneLineNote more="Authority records hold metadata, versions and reviewer decisions only. Zeporah never decides who has legal authority; conflicts are held for a person to review with the family.">
        Workflow state, not a legal determination
      </OneLineNote>
      <AuthoritySection o={o} a={authority} />
      <ConsentSection o={o} c={consents} />
    </div>
  );
}

function AuthoritySection({ o, a }: { o: Overview; a: AuthorityData }) {
  const [adding, setAdding] = useState<string | "new" | null>(null);
  return (
    <section aria-labelledby="auth" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="auth" className="text-2xl">
          Authority evidence
        </h2>
        {a.canSubmit && (
          <Button variant="secondary" size="sm" onClick={() => setAdding("new")}>
            Record new evidence
          </Button>
        )}
      </div>
      {adding && (
        <EvidenceForm
          o={o}
          evidence={adding === "new" ? null : (a.evidence.find((e) => e.id === adding) ?? null)}
          onDone={() => setAdding(null)}
        />
      )}
      {a.evidence.length === 0 && <EmptyState title="No authority evidence recorded" />}
      {a.evidence.map((e) => (
        <Card
          key={e.id}
          tone={
            e.effectiveState === "conflict" || e.effectiveState === "identity_unresolved" ? "rose" : "plain"
          }
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-lg">
                {e.holderName} · {e.typeLabel}
              </h3>
              <p className="text-sm text-ink-soft">
                {e.versions.length} version{e.versions.length > 1 ? "s" : ""} ·{" "}
                {e.linkedPerson ? (
                  <>Linked to household person: {e.linkedPerson}</>
                ) : (
                  <>Not linked to a household person</>
                )}
              </p>
            </div>
            <StateBadge state={e.effectiveState} />
          </div>
          <p className="mt-2 text-sm text-ink-soft">{AUTHORITY_STATUS_NOTE}</p>
          {e.effectiveState === "identity_unresolved" && (
            <p className="mt-2 text-sm">
              Who this record names can't be matched to one household person, so it's held. Competing records
              can't be activated and protected release is held until a reviewer links it with a stated basis.
            </p>
          )}
          {e.links.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer">Identity link history ({e.links.length})</summary>
              <ul className="mt-2 space-y-1">
                {e.links.map((l) => (
                  <li key={l.id}>
                    {l.person} — {l.basisLabel}
                    {l.note && <>: {l.note}</>} · linked by {l.linkedBy || "initial setup"},{" "}
                    <Stamp at={l.linkedAt} full />
                    {l.superseded && <span className="text-ink-soft"> (superseded, kept for history)</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <ol className="mt-3 space-y-1 border-l-2 pl-4 text-sm">
            {e.versions.map((v) => (
              <li key={v.id}>
                <span className="font-medium">v{v.versionNo}</span> {v.documentLabel}
                {v.effectiveDate ? `, dated ${v.effectiveDate}` : ""} · submitted by {v.submittedBy}{" "}
                <Stamp at={v.submittedAt} full /> {v.current && <Badge tone="harbor">current</Badge>}
                {v.previousVersionId && <span className="text-ink-soft"> (replaces v{v.versionNo - 1})</span>}
                {v.note && <span className="block text-ink-soft">{v.note}</span>}
              </li>
            ))}
          </ol>
          {e.reviews.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer">Review history ({e.reviews.length})</summary>
              <ul className="mt-2 space-y-1">
                {e.reviews.map((r) => (
                  <li key={r.id}>
                    <StateBadge
                      state={r.outcome === "needs_more_information" ? "review_pending" : r.outcome}
                    />{" "}
                    {r.reviewer}, <Stamp at={r.createdAt} full />: {r.rationale}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {a.canSubmit && e.state !== "superseded" && (
              <Button size="sm" variant="secondary" onClick={() => setAdding(e.id)}>
                Add a new version
              </Button>
            )}
            {a.canReview && ["review_pending", "conflict", "workflow_active"].includes(e.state) && (
              <ReviewForm evidenceId={e.id} holder={e.holderName} />
            )}
            {a.canReview && e.state !== "superseded" && e.state !== "withdrawn" && (
              <LinkForm
                evidenceId={e.id}
                holder={e.holderName}
                current={e.holderActorId}
                members={a.members}
              />
            )}
          </div>
        </Card>
      ))}
    </section>
  );
}

function EvidenceForm({
  o,
  evidence,
  onDone,
}: {
  o: Overview;
  evidence: { id: string; holderName: string; type: AuthorityType } | null;
  onDone: () => void;
}) {
  const [v, setV] = useState({
    holderActorId: "",
    holderName: evidence?.holderName ?? "",
    authorityType: (evidence?.type ?? "healthcare_agent") as AuthorityType,
    documentLabel: "",
    effectiveDate: "",
    note: "",
  });
  const { act, pending, error } = useAction();
  return (
    <Card
      tone="quiet"
      title={evidence ? `New version for ${evidence.holderName}` : "Record authority evidence"}
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(
            () =>
              submitEvidence({
                data: {
                  householdId: o.household.id,
                  evidenceId: evidence?.id,
                  holderName: v.holderName,
                  holderActorId: v.holderActorId || null,
                  authorityType: v.authorityType,
                  documentLabel: v.documentLabel,
                  effectiveDate: v.effectiveDate || undefined,
                  note: v.note || undefined,
                },
              }),
            "Evidence recorded and sent for review.",
          );
          if (r) onDone();
        }}
      >
        {!evidence && (
          <>
            <Field label="Who it names">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={v.holderActorId}
                  onChange={(e) => {
                    const m = o.members.find((x) => x.actorId === e.target.value);
                    setV({ ...v, holderActorId: e.target.value, holderName: m?.name ?? v.holderName });
                  }}
                >
                  <option value="">Someone not in the household app</option>
                  {o.members.map((m) => (
                    <option key={m.actorId} value={m.actorId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Name as written">
              {(id) => (
                <input
                  id={id}
                  required
                  className={inputClass}
                  value={v.holderName}
                  onChange={(e) => setV({ ...v, holderName: e.target.value })}
                />
              )}
            </Field>
            <Field label="Type">
              {(id) => (
                <select
                  id={id}
                  className={inputClass}
                  value={v.authorityType}
                  onChange={(e) => setV({ ...v, authorityType: e.target.value as AuthorityType })}
                >
                  {AUTHORITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {AUTHORITY_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </>
        )}
        <Field label="Document label" hint="A description only — never upload or paste the document.">
          {(id, d) => (
            <input
              id={id}
              aria-describedby={d}
              required
              className={inputClass}
              value={v.documentLabel}
              onChange={(e) => setV({ ...v, documentLabel: e.target.value })}
            />
          )}
        </Field>
        <Field label="Date on the document (optional)">
          {(id) => (
            <input
              id={id}
              type="date"
              className={inputClass}
              value={v.effectiveDate}
              onChange={(e) => setV({ ...v, effectiveDate: e.target.value })}
            />
          )}
        </Field>
        <Field label="Note (optional)">
          {(id) => (
            <input
              id={id}
              className={inputClass}
              value={v.note}
              onChange={(e) => setV({ ...v, note: e.target.value })}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <ErrorText error={error} />
          <div className="mt-2 flex gap-2">
            <Button type="submit" disabled={pending}>
              Record for review
            </Button>
            <Button variant="secondary" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function ReviewForm({ evidenceId, holder }: { evidenceId: string; holder: string }) {
  const [outcome, setOutcome] = useState<
    "workflow_active" | "conflict" | "needs_more_information" | "withdrawn"
  >("workflow_active");
  const [rationale, setRationale] = useState("");
  const { act, pending, error } = useAction();
  return (
    <ConfirmDialog
      title={`Record a review for ${holder}`}
      confirmLabel="Record review"
      disabled={pending}
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Review
        </Button>
      )}
      onConfirm={() =>
        act(() => reviewEvidence({ data: { evidenceId, outcome, rationale } }), "Review recorded.")
      }
    >
      <p>This records a workflow status, not a legal determination.</p>
      <ChoiceGroup
        legend="Outcome"
        name={`o-${evidenceId}`}
        value={outcome}
        onChange={setOutcome}
        options={[
          { value: "workflow_active", label: "Workflow active" },
          { value: "needs_more_information", label: "Needs more information" },
          { value: "conflict", label: "Conflict — hold for review" },
          { value: "withdrawn", label: "Withdrawn" },
        ]}
      />
      <Field label="Rationale">
        {(id) => (
          <textarea
            id={id}
            rows={2}
            className={inputClass}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        )}
      </Field>
      <ErrorText error={error} />
    </ConfirmDialog>
  );
}

function LinkForm({
  evidenceId,
  holder,
  current,
  members,
}: {
  evidenceId: string;
  holder: string;
  current: string | null;
  members: { actorId: string; name: string }[];
}) {
  const [actorId, setActorId] = useState("");
  const [basis, setBasis] = useState<IdentityLinkBasis>("submitted_evidence");
  const [note, setNote] = useState("");
  const { act, pending, error } = useAction();
  const choices = members.filter((m) => m.actorId !== current);
  if (!choices.length) return null;
  return (
    <ConfirmDialog
      title={`Link “${holder}” to a household person`}
      confirmLabel="Record link"
      disabled={pending || !actorId || (basis === "reviewer_documented" && !note.trim())}
      trigger={(open) => (
        <Button size="sm" variant="secondary" onClick={open}>
          {current ? "Change identity link" : "Link to a household person"}
        </Button>
      )}
      onConfirm={() =>
        act(
          () => linkEvidenceHolder({ data: { evidenceId, actorId, basis, note } }),
          "Identity link recorded. Earlier links are kept in the history.",
        )
      }
    >
      <p>
        A link is a workflow association, not a legal determination. Earlier links are kept, not overwritten.
      </p>
      <Field label="Household person">
        {(id) => (
          <select
            id={id}
            required
            className={inputClass}
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
          >
            <option value="">Choose…</option>
            {choices.map((m) => (
              <option key={m.actorId} value={m.actorId}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <ChoiceGroup
        legend="Basis for the link"
        name={`basis-${evidenceId}`}
        value={basis}
        onChange={setBasis}
        options={IDENTITY_LINK_BASES.map((b) => ({ value: b, label: IDENTITY_LINK_BASIS_LABELS[b] }))}
      />
      <Field label={basis === "reviewer_documented" ? "Documented basis (required)" : "Note (optional)"}>
        {(id) => (
          <textarea
            id={id}
            rows={2}
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      <ErrorText error={error} />
    </ConfirmDialog>
  );
}

function ConsentSection({ o, c }: { o: Overview; c: ConsentData }) {
  // Deep links (/staff/households/:id/consents/:consentId) land here and highlight the consent.
  const target = useHashTarget();
  const [adding, setAdding] = useState(false);
  const [amending, setAmending] = useState<string | null>(null);
  const { act, pending, error } = useAction();
  const amend = c.consents.find((x) => x.id === amending);
  return (
    <section aria-labelledby="cons" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cons" className="text-2xl">
          Consent
        </h2>
        {c.canRecord && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            Record a consent
          </Button>
        )}
      </div>
      <OneLineNote more="A care-team member records it, the named household person confirms that exact version, and a different reviewer activates it. Any change to the purpose, recipient, scope, dates or withdrawal terms starts again at confirmation.">
        Record → household confirms → a different reviewer activates
      </OneLineNote>
      {adding && <ConsentForm o={o} grantors={c.grantorOptions} onDone={() => setAdding(false)} />}
      {amend && (
        <ConsentForm o={o} grantors={c.grantorOptions} consent={amend} onDone={() => setAmending(null)} />
      )}
      <ErrorText error={error} />
      {c.consents.length === 0 ? (
        <EmptyState title="No consents recorded">
          Record one when the household agrees to share something.
        </EmptyState>
      ) : (
        // Item 18: cards, not a cramped table — everything readable without scrolling sideways.
        <ul className="space-y-3" aria-label="Consents">
          {c.consents.map((x) => (
            <li
              key={x.id}
              id={`consent-${x.id}`}
              tabIndex={-1}
              className={cx(
                "rounded-[var(--s-radius)] border bg-surface p-[var(--s-pad)] outline-none",
                target === `consent-${x.id}` && HIGHLIGHT,
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-[0.9375rem]">{x.recipientName}</h3>
                  <p className="text-ink-soft">{x.purpose}</p>
                </div>
                <div className="text-right">
                  <StatusChip domain="consent" value={x.correction ? "needs_review" : x.stage} />
                  {/* The full stage sentence (e.g. why it's held), next to the chip. */}
                  <p className="mt-1 max-w-xs text-[0.75rem] text-ink-soft">{x.stageLabel}</p>
                </div>
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-[0.8125rem] sm:grid-cols-[8rem_1fr]">
                <dt className="text-ink-soft">What's included</dt>
                <dd>
                  <ul className="flex flex-wrap gap-1">
                    {x.scopeLabels.map((l) => (
                      <li key={l} className="rounded bg-sunk px-1.5 py-0.5">
                        {l}
                      </li>
                    ))}
                  </ul>
                </dd>
                <dt className="text-ink-soft">Dates</dt>
                <dd>
                  {dateOnly(x.startsAt)} – {dateOnly(x.expiresAt)}
                </dd>
                <dt className="text-ink-soft">Named grantor</dt>
                <dd>
                  {x.grantedByName} · version {x.version} · recorded by {x.recordedBy}
                </dd>
                {x.confirmation && (
                  <>
                    <dt className="text-ink-soft">Confirmed</dt>
                    <dd>
                      Version {x.confirmation.consentVersion}, <Stamp at={x.confirmation.confirmedAt} full />
                    </dd>
                  </>
                )}
                {x.activatedBy && x.stage !== "revoked" && (
                  <>
                    <dt className="text-ink-soft">Activated</dt>
                    <dd>
                      {x.activatedBy}
                      {x.activatedAt && (
                        <>
                          , <Stamp at={x.activatedAt} full />
                        </>
                      )}
                    </dd>
                  </>
                )}
                {x.stage === "revoked" && x.revokedAt && (
                  <>
                    <dt className="text-ink-soft">Withdrawn</dt>
                    <dd>
                      <Stamp at={x.revokedAt} full />
                    </dd>
                  </>
                )}
              </dl>
              {x.grantorEligibility &&
                !x.grantorEligibility.canConfirm &&
                x.stage !== "revoked" &&
                x.stage !== "expired" && (
                  <p className="mt-2 rounded bg-sunk p-2 text-[0.8125rem]">
                    <strong>{x.grantedByName} can't confirm this in the app:</strong>{" "}
                    {x.grantorEligibility.reason} They can still see it under “Consents for you” and request a
                    correction. Next step: follow up with the household directly. If someone else should give
                    consent, withdraw this one and record a new one naming them.
                  </p>
                )}
              {x.correction && (
                <div className="mt-2">
                  <CorrectionPanel
                    consentRecipient={x.recipientName}
                    correction={x.correction}
                    canResolve={c.canResolveCorrections}
                  />
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {c.canActivate && x.stage === "awaiting_activation" && !x.activateBlockedReason && (
                  <ActivateConsent x={x} />
                )}
                {x.activateBlockedReason && (
                  <span className="text-[0.75rem] text-ink-soft">{x.activateBlockedReason}</span>
                )}
                {c.canRecord && x.stage !== "revoked" && x.stage !== "expired" && (
                  <Button size="sm" variant="secondary" onClick={() => setAmending(x.id)}>
                    Change terms
                  </Button>
                )}
                {c.canRevoke && x.stage !== "revoked" && x.stage !== "expired" && (
                  <RevokeConsent id={x.id} recipient={x.recipientName} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Item 18: activating a consent confirms first, restating it the way the packet-release dialog
 * does — recipient, purpose, what's included, dates, and who confirmed it and when.
 */
function ActivateConsent({ x }: { x: ConsentData["consents"][number] }) {
  const { act, pending, error } = useAction();
  return (
    <ConfirmDialog
      title={`Activate the consent for ${x.recipientName}?`}
      confirmLabel="Activate consent"
      disabled={pending}
      error={error}
      trigger={(open) => (
        <Button size="sm" disabled={pending} onClick={open}>
          Activate…
        </Button>
      )}
      onConfirm={() => act(() => activateConsent({ data: { id: x.id } }), "Consent activated.")}
    >
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="font-medium text-ink">Recipient</dt>
          <dd>{x.recipientName}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Purpose</dt>
          <dd>{x.purpose}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">What's included</dt>
          <dd>{x.scopeLabels.join(", ")}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Dates</dt>
          <dd>
            {dateOnly(x.startsAt)} – {dateOnly(x.expiresAt)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Confirmed by</dt>
          <dd>
            {x.grantedByName}
            {x.confirmation ? (
              <>
                , version {x.confirmation.consentVersion}, <Stamp at={x.confirmation.confirmedAt} full />
              </>
            ) : null}
          </dd>
        </div>
      </dl>
      <p>
        Once active, packets within this consent can be released until the end date. Activating doesn't share
        anything.
      </p>
    </ConfirmDialog>
  );
}

/** An open correction request on a consent, with the person's own words (care team only). */
function CorrectionPanel({
  consentRecipient,
  correction,
  canResolve,
}: {
  consentRecipient: string;
  correction: {
    id: string;
    at: Date;
    requestedBy: string;
    categories: string[];
    detail: string;
    version: number;
  };
  canResolve: boolean;
}) {
  const [explanation, setExplanation] = useState("");
  const { act, error } = useAction();
  return (
    <div
      className="mt-2 rounded-lg border border-rose/30 bg-rose-soft p-3 text-sm"
      data-testid="staff-correction"
    >
      <p>
        <strong>Correction requested</strong> by {correction.requestedBy} on <Stamp at={correction.at} full />{" "}
        (version {correction.version})
        {correction.categories.length ? <>: {correction.categories.join(", ").toLowerCase()}</> : null}.
      </p>
      {correction.detail && (
        <p className="mt-1">
          <Visibility who="staff" /> “{correction.detail}”
        </p>
      )}
      <p className="mt-1 text-ink-soft">
        Activation and release are held until this is resolved. Resolve it by changing the terms (a new
        version goes back to the household), withdrawing the consent, or dismissing the request with an
        explanation.
      </p>
      {canResolve && (
        <div className="mt-2">
          <ConfirmDialog
            title={`Dismiss the correction request for ${consentRecipient}?`}
            confirmLabel="Dismiss with this explanation"
            disabled={!explanation.trim()}
            error={error}
            trigger={(open) => (
              <Button size="sm" variant="secondary" onClick={open}>
                Dismiss with an explanation
              </Button>
            )}
            onConfirm={() =>
              act(
                () => dismissConsentCorrection({ data: { requestId: correction.id, explanation } }),
                "Correction request dismissed. The household is told no change was made; your reason stays with the care team.",
              )
            }
          >
            <p>Use this only when no change is needed. The consent stays exactly as it is.</p>
            <Field
              label="Reason (care team only)"
              hint="Required. Kept with the care team; the household is only told that no change was made."
            >
              {(id, d) => (
                <textarea
                  id={id}
                  aria-describedby={d}
                  rows={3}
                  maxLength={1000}
                  className={inputClass}
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                />
              )}
            </Field>
          </ConfirmDialog>
        </div>
      )}
    </div>
  );
}

function RevokeConsent({ id, recipient }: { id: string; recipient: string }) {
  const [reason, setReason] = useState("");
  const { act, error } = useAction();
  return (
    <ConfirmDialog
      title={`Withdraw consent for ${recipient}?`}
      tone="danger"
      disabled={!reason.trim()}
      confirmLabel="Withdraw on the household's request"
      trigger={(open) => (
        <Button size="sm" variant="danger" onClick={open}>
          Withdraw
        </Button>
      )}
      onConfirm={() =>
        act(
          () => revokeConsentOnRequest({ data: { consentId: id, reason } }),
          `Consent withdrawn. Dependent packets are held. ${REVOCATION_NOTE}`,
        )
      }
    >
      <p>Only do this at the household's request. Any packet that depends on it will be held.</p>
      <p>{REVOCATION_NOTE}</p>
      <Field label="Who asked, and why">
        {(fid) => (
          <textarea
            id={fid}
            rows={2}
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <ErrorText error={error} />
    </ConfirmDialog>
  );
}

function CategoryPicker({
  value,
  onChange,
  legend,
}: {
  value: ShareCategory[];
  onChange: (v: ShareCategory[]) => void;
  legend: string;
}) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="mb-2 font-medium">{legend}</legend>
      {SHARE_CATEGORIES.map((c) => (
        <Check
          key={c}
          label={SHARE_CATEGORY_LABELS[c]}
          checked={value.includes(c)}
          onChange={(on) => onChange(on ? [...value, c] : value.filter((x) => x !== c))}
        />
      ))}
    </fieldset>
  );
}

function ConsentForm({
  o,
  grantors,
  consent,
  onDone,
}: {
  o: Overview;
  grantors: { actorId: string; name: string; canConfirm: boolean; reason: string | null }[];
  /** When set, this records a new version of an existing consent. */
  consent?: ConsentData["consents"][number];
  onDone: () => void;
}) {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const [v, setV] = useState({
    grantedByActorId: consent?.grantedByActorId ?? "",
    purpose: consent?.purpose ?? "",
    recipientName: consent?.recipientName ?? "",
    scope: (consent?.scope ?? []) as ShareCategory[],
    startsAt: consent ? day(consent.startsAt) : day(new Date()),
    expiresAt: consent ? day(consent.expiresAt) : day(new Date(Date.now() + 30 * 86_400_000)),
    revocationPath:
      consent?.revocationPath ?? "Withdraw any time in Zeporah under Sharing, or tell your care guide.",
  });
  const { act, pending, error } = useAction();
  /** Keep the exact stored instant when a date wasn't edited, so an unchanged field isn't a "change". */
  const asDate = (s: string, was?: Date) => (was && day(was) === s ? was : new Date(s));
  return (
    <Card
      tone="quiet"
      title={
        consent
          ? `Change terms for ${consent.recipientName} (creates version ${consent.version + 1})`
          : "Record a consent (nothing is shared until the named person confirms and a different reviewer activates it)"
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const terms = {
            purpose: v.purpose,
            recipientName: v.recipientName,
            scope: v.scope,
            startsAt: asDate(v.startsAt, consent?.startsAt),
            expiresAt: asDate(v.expiresAt, consent?.expiresAt),
            revocationPath: v.revocationPath,
          };
          const r = consent
            ? await act(
                () => amendConsent({ data: { consentId: consent.id, ...terms } }),
                "New version recorded. It needs the household's confirmation and a different reviewer's activation.",
              )
            : await act(
                () =>
                  recordConsent({
                    data: { householdId: o.household.id, grantedByActorId: v.grantedByActorId, ...terms },
                  }),
                "Consent recorded. Nothing is shared until the named person confirms it and a different reviewer activates it.",
              );
          if (r) onDone();
        }}
      >
        {consent ? (
          <p className="text-sm sm:col-span-2">
            Named grantor: <strong>{consent.grantedByName}</strong>. Any change here clears the current
            confirmation and activation
            {consent.correction ? ", and closes the open correction request" : ""}.
            {consent.grantorEligibility && !consent.grantorEligibility.canConfirm && (
              <span className="mt-1 block text-ochre">
                {consent.grantedByName} can't confirm in the app: {consent.grantorEligibility.reason} The new
                version will be held for review.
              </span>
            )}
          </p>
        ) : (
          <Field label="Named grantor" hint="The household person who will confirm this consent.">
            {(id, d) => (
              <select
                id={id}
                aria-describedby={d}
                required
                className={inputClass}
                value={v.grantedByActorId}
                onChange={(e) => setV({ ...v, grantedByActorId: e.target.value })}
              >
                <option value="">Choose…</option>
                {grantors.map((m) => (
                  <option key={m.actorId} value={m.actorId}>
                    {m.name} — {m.canConfirm ? "can confirm in the app" : "can't confirm in the app"}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {!consent &&
          (() => {
            const g = grantors.find((m) => m.actorId === v.grantedByActorId);
            return g && !g.canConfirm ? (
              <div className="sm:col-span-2" role="status">
                <Notice tone="ochre" title={`${g.name} can't confirm this in the app`}>
                  <p>{g.reason}</p>
                  <p className="mt-1">
                    You can still record it. It will be held for review, and {g.name} will see it under
                    “Consents for you”, where they can request a correction. Next step: follow up with the
                    household directly about who should give consent.
                  </p>
                </Notice>
              </div>
            ) : null;
          })()}
        <Field label="Named recipient">
          {(id) => (
            <input
              id={id}
              required
              className={inputClass}
              value={v.recipientName}
              onChange={(e) => setV({ ...v, recipientName: e.target.value })}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Purpose">
            {(id) => (
              <input
                id={id}
                required
                className={inputClass}
                value={v.purpose}
                onChange={(e) => setV({ ...v, purpose: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <CategoryPicker
            legend="What may be shared (only what's needed)"
            value={v.scope}
            onChange={(scope) => setV({ ...v, scope })}
          />
        </div>
        <Field label="Starts">
          {(id) => (
            <input
              id={id}
              type="date"
              required
              className={inputClass}
              value={v.startsAt}
              onChange={(e) => setV({ ...v, startsAt: e.target.value })}
            />
          )}
        </Field>
        <Field label="Ends">
          {(id) => (
            <input
              id={id}
              type="date"
              required
              className={inputClass}
              value={v.expiresAt}
              onChange={(e) => setV({ ...v, expiresAt: e.target.value })}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="How they can withdraw it">
            {(id) => (
              <input
                id={id}
                required
                className={inputClass}
                value={v.revocationPath}
                onChange={(e) => setV({ ...v, revocationPath: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <ErrorText error={error} />
          <div className="mt-2 flex gap-2">
            <Button type="submit" disabled={pending}>
              {consent ? "Record new version" : "Record consent"}
            </Button>
            <Button variant="secondary" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function PacketSection({
  o,
  authority,
  consents,
}: {
  o: Overview;
  authority: AuthorityData;
  consents: ConsentData;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section aria-labelledby="pk" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pk" className="text-2xl">
          Packets
        </h2>
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          Draft a packet
        </Button>
      </div>
      {adding && (
        <PacketForm o={o} authority={authority} consents={consents} onDone={() => setAdding(false)} />
      )}
      <PacketList o={o} />
    </section>
  );
}

/** The household's packets (shown on the Packets tab, with or without drafting). */
function PacketList({ o }: { o: Overview }) {
  useHashTarget();
  return (
    <>
      {o.packets.length === 0 ? (
        <EmptyState title="No packets">Draft one from a consent that's active.</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {o.packets.map((p) => (
            <li key={p.id}>
              <Link
                to="/staff/packets/$packetId"
                params={{ packetId: p.id }}
                className="block rounded-xl border bg-surface p-4 hover:border-harbor"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="font-medium">{p.recipientName || "No recipient yet"}</span>
                  <StatusChip domain="packet" value={p.state} />
                </span>
                <span className="block text-sm text-ink-soft">{p.purpose || "No purpose yet"}</span>
                {p.lastReasonCode && (
                  <Coded
                    className="mt-2 inline-block rounded bg-sunk px-1.5 py-0.5 text-xs"
                    label={reasonLabel(p.lastReasonCode)}
                    code={p.lastReasonCode}
                  />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PacketForm({
  o,
  authority,
  consents,
  onDone,
}: {
  o: Overview;
  authority: AuthorityData;
  consents: ConsentData;
  onDone: () => void;
}) {
  const [v, setV] = useState({
    purpose: "",
    recipientName: "",
    consentId: "",
    authorityEvidenceId: "",
    days: 7,
    categories: [] as ShareCategory[],
  });
  const [usedPrepared, setUsedPrepared] = useState(false);
  const { act, pending, error } = useAction();
  const chosen = consents.consents.find((c) => c.id === v.consentId);
  return (
    <Card tone="quiet" title="Draft a packet">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(
            () =>
              createPacket({
                data: {
                  householdId: o.household.id,
                  purpose: v.purpose,
                  recipientName: v.recipientName,
                  consentId: v.consentId || null,
                  authorityEvidenceId: v.authorityEvidenceId || null,
                  expiresAt: new Date(Date.now() + v.days * 86_400_000),
                  categories: v.categories,
                  prepared: usedPrepared,
                },
              }),
            "Packet drafted. Operations has been asked to run the release check.",
          );
          if (r) onDone();
        }}
      >
        <Field label="Consent it relies on">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={v.consentId}
              onChange={(e) => {
                const c = consents.consents.find((x) => x.id === e.target.value);
                setV({
                  ...v,
                  consentId: e.target.value,
                  purpose: c?.purpose ?? v.purpose,
                  recipientName: c?.recipientName ?? v.recipientName,
                });
              }}
            >
              <option value="">None (release will be held)</option>
              {consents.consents.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.recipientName} — {c.purpose} ({c.stageLabel})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Authority workflow it relies on">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={v.authorityEvidenceId}
              onChange={(e) => setV({ ...v, authorityEvidenceId: e.target.value })}
            >
              <option value="">None (release will be held)</option>
              {authority.evidence.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.holderName} — {a.typeLabel} ({a.effectiveState})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Named recipient">
          {(id) => (
            <input
              id={id}
              className={inputClass}
              value={v.recipientName}
              onChange={(e) => setV({ ...v, recipientName: e.target.value })}
            />
          )}
        </Field>
        <Field label="Purpose">
          {(id) => (
            <input
              id={id}
              className={inputClass}
              value={v.purpose}
              onChange={(e) => setV({ ...v, purpose: e.target.value })}
            />
          )}
        </Field>
        {o.prepared && !usedPrepared && (
          <div className="sm:col-span-2">
            <PreparedDraft
              label={o.prepared.label}
              text={`Include only: ${o.prepared.manifest
                .map((c) => SHARE_CATEGORY_LABELS[c as ShareCategory] ?? c)
                .join(", ")}.`}
              suggests="The packet's contents: the least it needs for its purpose."
              approve="Only the contents. Releasing the packet is a separate step with its own checks."
              onUse={() => {
                setV({ ...v, categories: o.prepared!.manifest as ShareCategory[] });
                setUsedPrepared(true);
              }}
            />
          </div>
        )}
        <div className="sm:col-span-2">
          <CategoryPicker
            legend="Minimum necessary: what goes in the packet"
            value={v.categories}
            onChange={(categories) => setV({ ...v, categories })}
          />
          {chosen && (
            <p className="mt-2 text-sm text-ink-soft">The consent covers: {chosen.scopeLabels.join("; ")}.</p>
          )}
        </div>
        <Field label="Shareable for (days)">
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              max={90}
              className={inputClass}
              value={v.days}
              onChange={(e) => setV({ ...v, days: Number(e.target.value) })}
            />
          )}
        </Field>
        <div className="sm:col-span-2">
          <ErrorText error={error} />
          <div className="mt-2 flex gap-2">
            <Button type="submit" disabled={pending}>
              Save draft
            </Button>
            <Button variant="secondary" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ lifecycle */

/** Operations closes a household after bereavement support; it becomes read-only. */
function CloseHousehold({ o }: { o: Overview }) {
  const [reason, setReason] = useState("");
  const { act, pending, error } = useAction();
  const ends = o.bereavementPlan?.supportEndsAt ?? null;
  const early = ends ? new Date(ends).getTime() > Date.now() : false;
  return (
    <Card title="Close this household">
      <p className="text-ink-soft">
        {ends ? (
          <>
            Bereavement support runs until <Stamp at={ends} />.{" "}
            {early ? "Closing before then ends the follow-up plan now." : "That date has passed."}
          </>
        ) : (
          "Closing ends bereavement support for this household."
        )}{" "}
        The household space becomes read-only. Nothing is deleted, and the family isn't sent anything.
      </p>
      <div className="mt-3">
        <ConfirmDialog
          title={`Close ${o.household.name}?`}
          confirmLabel="Close household"
          tone="danger"
          disabled={pending || !reason.trim()}
          error={error}
          trigger={(open) => (
            <Button variant="secondary" onClick={open}>
              Close household…
            </Button>
          )}
          onConfirm={() =>
            act(
              () => closeHousehold({ data: { householdId: o.household.id, reason } }),
              "The household was closed.",
            )
          }
        >
          <p>
            {early ? "Its bereavement support window hasn't ended yet. " : ""}It becomes read-only for the
            family and the care team. Open check-ins leave the follow-up workload.
          </p>
          <Field label="Reason" hint="Required. Only staff will see it.">
            {(id, d) => (
              <textarea
                id={id}
                aria-describedby={d}
                rows={2}
                maxLength={500}
                className={inputClass}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </ConfirmDialog>
      </div>
    </Card>
  );
}

function LifecycleTab({ o }: { o: Overview }) {
  const [contact, setContact] = useState(o.members.find((m) => !m.roles.includes("Patient"))?.actorId ?? "");
  const [note, setNote] = useState("");
  const { act, pending, error } = useAction();
  const proposed = o.transitions.find((t) => t.state === "proposed");
  const confirmed = o.transitions.find((t) => t.state === "confirmed");
  return (
    <div className="max-w-3xl space-y-6">
      <Notice tone="quiet" title="An explicit, two-person transition">
        Moving a household to bereavement support is never automatic. One person proposes it; a different
        hospice operations user confirms. Practical coordination continues; protected access narrows by
        policy.
      </Notice>
      <ErrorText error={error} />
      {o.household.lifecycle === "closed" && (
        <Notice tone="quiet" title="Closed">
          This household was closed after bereavement support. It's read-only.
        </Notice>
      )}
      {o.household.lifecycle === "bereavement" && o.can.confirm && <CloseHousehold o={o} />}
      {confirmed && (
        <Card tone="moss" title="Bereavement support confirmed">
          <p>
            Confirmed by {confirmed.confirmedBy}{" "}
            {confirmed.confirmedAt ? <Stamp at={confirmed.confirmedAt} full /> : null}. Surviving contact:{" "}
            {confirmed.survivingContact ?? "—"}{" "}
            {confirmed.survivingContactConfirmedAt ? (
              <StateBadge state="confirmed" label="confirmed by them" />
            ) : (
              <StateBadge state="pending" label="waiting for them to confirm" />
            )}
          </p>
        </Card>
      )}
      {proposed && (
        <Card tone="ochre" title="Waiting for confirmation">
          <p>
            Proposed by {proposed.proposedBy} <Stamp at={proposed.proposedAt} full />. Surviving contact:{" "}
            {proposed.survivingContact}.
          </p>
          {proposed.note && <p className="mt-1 text-ink-soft">{proposed.note}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {o.can.confirm && (
              <ConfirmDialog
                title="Confirm the move to bereavement support?"
                confirmLabel="Confirm transition"
                error={error}
                trigger={(open) => (
                  <Button onClick={open} disabled={pending}>
                    Confirm transition
                  </Button>
                )}
                onConfirm={() =>
                  act(
                    () => confirmBereavement({ data: { id: proposed.id } }),
                    "The household moved to bereavement support.",
                  )
                }
              >
                <p>This will, in one step:</p>
                <ul className="list-disc pl-5">
                  <li>end the patient's own access and archive the coordination record;</li>
                  <li>
                    supersede authority that only applies while the patient is living, which closes protected
                    access that depended on it;
                  </li>
                  <li>end consents for care-period information and hold open packets;</li>
                  <li>
                    keep messages, updates, tasks and support going, and ask the surviving contact to confirm.
                  </li>
                </ul>
                <p>The household gets a notification with no details in it.</p>
              </ConfirmDialog>
            )}
            <ConfirmDialog
              title="Cancel this proposal?"
              confirmLabel="Cancel the proposal"
              error={error}
              trigger={(open) => (
                <Button variant="secondary" disabled={pending} onClick={open}>
                  Cancel proposal
                </Button>
              )}
              onConfirm={() =>
                act(
                  () => cancelBereavement({ data: { id: proposed.id } }),
                  "Proposal cancelled. Nothing changed for the household.",
                )
              }
            >
              <p>
                The household stays as it is, and nothing is sent to them. Anyone can propose again later.
              </p>
            </ConfirmDialog>
          </div>
        </Card>
      )}
      {!proposed && !confirmed && o.can.propose && (
        <Card title="Propose bereavement support">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                () =>
                  proposeBereavement({
                    data: { householdId: o.household.id, survivingContactActorId: contact, note },
                  }),
                "Transition proposed. Operations has been asked to confirm.",
              );
            }}
          >
            <Field
              label="Surviving contact"
              hint="The household member the care team will keep in touch with."
            >
              {(id, d) => (
                <select
                  id={id}
                  aria-describedby={d}
                  className={inputClass}
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                >
                  {o.members
                    .filter((m) => !m.roles.includes("Patient"))
                    .map((m) => (
                      <option key={m.actorId} value={m.actorId}>
                        {m.name} · {m.roles.join(", ")}
                      </option>
                    ))}
                </select>
              )}
            </Field>
            <Field label="Note for the confirming person (care team only)">
              {(id) => (
                <textarea
                  id={id}
                  rows={2}
                  className={inputClass}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" disabled={pending || !contact}>
              Propose transition
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ timeline */

const VIS: Record<string, ReactNode> = {
  family: <Badge tone="harbor">Household</Badge>,
  sharing: <Badge tone="harbor">Sharing</Badge>,
  protected: <Badge tone="clay">Protected</Badge>,
  staff: <Badge tone="staff">Care team</Badge>,
};

function TimelineTab({ o }: { o: Overview }) {
  return (
    <section aria-labelledby="tl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="tl" className="text-2xl">
          Audit timeline
        </h2>
        <p className="text-sm text-ink-soft">Append-only. Summaries never include message or note text.</p>
      </div>
      <div className="relative overflow-x-auto rounded-[var(--radius-card)] border bg-surface">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <caption className="sr-only">Audit events, newest first</caption>
          <thead className="border-b bg-sunk text-xs tracking-wide text-ink-soft uppercase">
            <tr>
              <th className="px-3 py-2" scope="col">
                When
              </th>
              <th className="px-3 py-2" scope="col">
                Who
              </th>
              <th className="px-3 py-2" scope="col">
                Event
              </th>
              <th className="px-3 py-2" scope="col">
                Decision
              </th>
              <th className="px-3 py-2" scope="col">
                Visible to
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {o.audit.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2 whitespace-nowrap text-ink-soft">
                  <Stamp at={a.at} full />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{a.actor}</td>
                <td className="px-3 py-2">
                  <Coded className="font-medium" label={auditLabel(a.action)} code={a.action} />
                  <span className="block">{a.summary}</span>
                </td>
                <td className="px-3 py-2">
                  {a.decision ? (
                    <>
                      <StateBadge state={a.decision} />{" "}
                      {a.reasonCode && (
                        <Coded
                          className="block text-xs"
                          label={reasonLabel(a.reasonCode)}
                          code={a.reasonCode}
                        />
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">{VIS[a.visibility]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
