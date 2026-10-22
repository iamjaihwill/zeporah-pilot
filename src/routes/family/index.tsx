import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { dateTime, isDenied } from "@/lib/client";
import {
  Stamp,
  Badge,
  ButtonLink,
  Card,
  EmergencyNotice,
  EmptyState,
  Notice,
  PageHeader,
  Stat,
} from "@/components/ui";
import { useHome } from "@/lib/family-home";

export const Route = createFileRoute("/family/")({
  // Households in bereavement support land on Continuing support (interaction review, item 13).
  loader: async ({ parentMatchPromise }) => {
    const parent = (await parentMatchPromise).loaderData;
    if (parent && !isDenied(parent) && parent.household.lifecycle === "bereavement")
      throw redirect({ to: "/family/bereavement", replace: true });
  },
  component: Dashboard,
});

/** What the person can actually do with a consent that names them (item 8). */
function namedConsentActions(c: {
  confirm: boolean;
  correct: boolean;
  withdraw: boolean;
  askToWithdraw: boolean;
}) {
  const verbs = [
    c.confirm && "confirm",
    c.correct && "request a correction",
    c.withdraw && "withdraw it",
    c.askToWithdraw && "ask the care team to withdraw it",
  ].filter(Boolean) as string[];
  if (!verbs.length) return "See what it covers";
  const list = verbs.length === 1 ? verbs[0] : `${verbs.slice(0, -1).join(", ")} or ${verbs.at(-1)}`;
  return `See what it covers, and ${list}`;
}

function Dashboard() {
  const h = useHome();
  const on = h.onboarding;
  const done = on.steps.filter((s) => s.done).length;
  const waiting = h.sharing?.waitingForMe ?? 0;
  const named = h.namedConsents;
  // Unfinished setup the person can do comes first (item 10).
  const setupFirst = !on.complete && on.canComplete;
  const attention = [
    ...(h.newReply
      ? [
          {
            key: `reply-${h.newReply.id}`,
            text: `New reply from ${h.newReply.author}`,
            sub: "In your messages",
            to: "/family/messages" as const,
            hash: `entry-${h.newReply.id}`,
            label: "Message",
          },
        ]
      : []),
    ...(!h.flags.consent && named.open > 0
      ? [
          {
            key: "named-consents",
            text:
              named.waitingForMe > 0
                ? "A sharing consent that names you is waiting for your confirmation"
                : named.open === 1
                  ? "A sharing consent names you"
                  : `${named.open} sharing consents name you`,
            sub: namedConsentActions(named.can),
            to: "/family/consents" as const,
            label: "Sharing",
          },
        ]
      : []),
    ...(waiting > 0
      ? [
          {
            key: "consents",
            text:
              waiting === 1
                ? "A sharing consent is waiting for your confirmation"
                : `${waiting} sharing consents are waiting for your confirmation`,
            sub: "Nothing is shared until you confirm and a reviewer activates it",
            to: "/family/sharing" as const,
            hash: h.sharing?.firstWaitingForMe ? `consent-${h.sharing.firstWaitingForMe}` : undefined,
            label: "Sharing",
          },
        ]
      : []),
    ...h.myTasks.map((t) => ({
      key: t.id,
      text: t.title,
      sub: t.whenLabel ?? "When you can",
      to: "/family/tasks" as const,
      hash: `task-${t.id}`,
      label: "Task",
    })),
    ...h.updates
      .filter((u) => u.needsMyAck)
      .map((u) => ({
        key: u.id,
        text: `Please acknowledge: ${u.title}`,
        sub: `From ${u.author}`,
        to: "/family/messages" as const,
        hash: `entry-${u.id}`,
        label: "Update",
      })),
  ];

  return (
    <>
      <PageHeader
        eyebrow={h.household.name}
        title={`Hello, ${h.me.firstName}`}
        lede={
          h.household.lifecycle === "bereavement"
            ? "Your care team is still here. Take things at whatever pace feels right."
            : "Here's what matters today. Nothing here needs to be done all at once."
        }
      />

      <div className="space-y-6">
        {!on.complete && !setupFirst && <SetupProgress on={on} done={done} />}

        {h.bereavement?.needsMyConfirmation && (
          <Card tone="ochre" title="Your care team asked you to confirm something">
            <p className="text-ink-soft">
              They'd like to confirm you're the main contact for your household going forward.
            </p>
            <ButtonLink className="mt-3" to="/family/bereavement">
              Review and confirm
            </ButtonLink>
          </Card>
        )}

        <Card title="What needs your attention">
          {setupFirst && <SetupProgress on={on} done={done} first />}
          {attention.length ? (
            <ul className="divide-y">
              {attention.map((a) => (
                <li key={a.key} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <Badge tone="harbor">{a.label}</Badge>
                    <p className="mt-1 font-medium">{a.text}</p>
                    <p className="text-sm text-ink-soft">{a.sub}</p>
                  </div>
                  <ButtonLink
                    to={a.to}
                    {...("hash" in a && a.hash ? { hash: a.hash } : {})}
                    variant="secondary"
                    size="sm"
                  >
                    Open<span className="sr-only">: {a.text}</span>
                  </ButtonLink>
                </li>
              ))}
            </ul>
          ) : setupFirst ? null : (
            <p className="text-ink-soft">Nothing needs you right now. That's okay.</p>
          )}
        </Card>

        {h.isPatient && (
          // Item 13: the patient's own view starts from their wishes and their information.
          <Card tone="harbor" title="Your wishes and who can see your information">
            <p>
              This is your care. You decide what's shared outside your household, and you can see everyone
              who's part of it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {h.flags.consent && (
                <ButtonLink to="/family/sharing" variant="secondary">
                  What's shared, and with whom
                </ButtonLink>
              )}
              <ButtonLink to="/family/people" variant="secondary">
                Who's in your household
              </ButtonLink>
              <ButtonLink to="/family/me" variant="secondary">
                Your care, in one place
              </ButtonLink>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            label="Open tasks"
            value={h.openFamilyTasks}
            hint={
              h.myTasks.length === 1
                ? "1 is yours"
                : h.myTasks.length
                  ? `${h.myTasks.length} are yours`
                  : "None are yours"
            }
            to="/family/tasks"
          />
          {h.vault ? (
            <Stat
              label="Vault items need a look"
              value={h.vault.needsReview}
              hint={`${h.vault.reviewed} reviewed of ${h.vault.total}`}
              to="/family/vault"
            />
          ) : (
            <Stat
              label="Vault"
              value="—"
              hint={h.flags.vault ? "Shows after the starter vault review" : "Not part of your role"}
            />
          )}
          <Stat
            label="Unread notifications"
            value={h.unread}
            hint="Across everything"
            to="/family/notifications"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card
            title="Updates from your care team"
            actions={
              <Link to="/family/messages" className="text-sm text-harbor underline">
                See all
              </Link>
            }
          >
            {h.updates.length ? (
              <ul className="space-y-3">
                {h.updates.map((u) => (
                  <li key={u.id}>
                    <p className="font-medium">{u.title}</p>
                    <p className="text-sm text-ink-soft">
                      {u.author} · <Stamp at={u.at} />{" "}
                      {u.needsMyAck && <Badge tone="ochre">Needs your acknowledgement</Badge>}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-soft">No updates yet. Your care team will post here.</p>
            )}
          </Card>

          {h.flags.thread && (
            <Card title={`Messages with ${h.careGuide ?? "your care guide"}`}>
              {h.messagingOn ? (
                <>
                  <p className="text-ink-soft">
                    {h.lastMessage ? (
                      <>
                        Last message from {h.lastMessage.author}, <Stamp at={h.lastMessage.at} />.
                      </>
                    ) : (
                      "No messages yet."
                    )}
                  </p>
                  <ButtonLink className="mt-3" to="/family/messages" variant="secondary">
                    Open messages
                  </ButtonLink>
                </>
              ) : (
                <>
                  {/* Messages can be read before setup; only replying waits for it. */}
                  {h.lastMessage && (
                    <>
                      <p className="text-ink-soft">
                        Last message from {h.lastMessage.author}, <Stamp at={h.lastMessage.at} />. You can
                        read it now.
                      </p>
                      <ButtonLink className="mt-3 mb-3" to="/family/messages" variant="secondary">
                        Open messages
                      </ButtonLink>
                    </>
                  )}
                  <Notice tone="quiet">
                    {h.lastMessage ? "Replying" : "Messaging"} turns on once communication settings are chosen
                    in setup.{" "}
                    {on.canComplete && (
                      <Link to="/family/onboarding" search={{ step: "communication" }}>
                        Choose them now
                      </Link>
                    )}
                  </Notice>
                </>
              )}
            </Card>
          )}

          {h.flags.vault && (
            <Card
              title="Vault"
              actions={
                h.vault ? (
                  <Link to="/family/vault" className="text-sm text-harbor underline">
                    Open vault
                  </Link>
                ) : undefined
              }
            >
              {h.vault ? (
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {[
                    ["Need a look", h.vault.needsReview, "needs_review"],
                    ["Reviewed", h.vault.reviewed, "reviewed"],
                    ["Not found yet", h.vault.notAvailable, "not_available"],
                  ].map(([l, n, st]) => (
                    <div key={String(st)} className="rounded-lg bg-sunk p-3">
                      <dt className="text-xs text-ink-soft">{l}</dt>
                      <dd className="font-display text-2xl">{n}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-ink-soft">
                  The vault keeps track of which documents exist and where they are — never the documents
                  themselves.{" "}
                  {on.canComplete
                    ? "You'll review the starter items in setup."
                    : "It opens once setup is done."}
                </p>
              )}
            </Card>
          )}

          {h.flags.consent && (
            <Card title="Sharing outside your household">
              {!on.complete ? (
                <p className="text-ink-soft">Sharing choices appear here once setup is done.</p>
              ) : h.sharing && h.sharing.total > 0 ? (
                <>
                  <p className="text-ink-soft">
                    {h.sharing.active} active consent{h.sharing.active === 1 ? "" : "s"}. Each one names who
                    receives what, for what purpose, and until when.
                  </p>
                  {h.sharing.waitingForMe > 0 && (
                    <p className="mt-2 font-medium">
                      {h.sharing.waitingForMe === 1
                        ? "One consent is waiting for your confirmation. Nothing is shared until you confirm and a reviewer activates it."
                        : `${h.sharing.waitingForMe} consents are waiting for your confirmation. Nothing is shared until you confirm and a reviewer activates them.`}
                    </p>
                  )}
                  <ButtonLink
                    className="mt-3"
                    to="/family/sharing"
                    variant={h.sharing.waitingForMe > 0 ? "primary" : "secondary"}
                  >
                    {h.sharing.waitingForMe > 0 ? "Review and confirm sharing" : "Review sharing"}
                  </ButtonLink>
                </>
              ) : (
                <p className="text-ink-soft">Nothing is shared outside your household and care team.</p>
              )}
            </Card>
          )}

          <Card title="When things feel like a lot">
            <p className="text-ink-soft">
              You can pause, make something smaller, or ask your care team for support. A person on the team
              decides how to follow up.
            </p>
            <ButtonLink className="mt-3" to="/family/support" variant="secondary">
              Pause or get support
            </ButtonLink>
          </Card>
        </div>

        <Card title="Recent activity">
          {h.activity.length ? (
            <ol className="space-y-3" aria-label="Recent activity">
              {h.activity.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-harbor/60" />
                  <div>
                    <p>{a.summary}</p>
                    <p className="text-sm text-ink-soft">
                      <Stamp at={a.at} />
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="Nothing yet">Things you and your care team do will show up here.</EmptyState>
          )}
        </Card>

        {h.careRecord && (
          <Card tone="quiet" title="Your care team">
            <p>
              Care guide: <strong>{h.careGuide ?? "Being assigned"}</strong>
              {/* Decision 62: a covering guide is named only for the window, with its end. */}
              {h.careGuideUntil && (
                <span className="text-ink-soft" data-testid="care-guide-until">
                  , until {dateTime(h.careGuideUntil)}
                </span>
              )}
            </p>
            <p className="text-ink-soft">{h.careRecord.visitRhythm}</p>
          </Card>
        )}
        <EmergencyNotice line={h.hotline} />
      </div>
    </>
  );
}

/** Setup progress. As the first attention item when the person can do it (item 10). */
function SetupProgress({
  on,
  done,
  first = false,
}: {
  on: ReturnType<typeof useHome>["onboarding"];
  done: number;
  first?: boolean;
}) {
  const body = (
    <>
      <p className="text-ink-soft">
        {done} of 4 steps done.{" "}
        {on.canComplete
          ? "Each step turns on more of Zeporah for your household."
          : "Your household coordinator is setting this up."}
      </p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-4" aria-label="Setup steps">
        {on.steps.map((s, i) => (
          <li key={s.step} className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
            <span aria-hidden className={s.done ? "text-moss" : "text-ink-faint"}>
              {s.done ? "✓" : i + 1}
            </span>
            <span>{on.labels[s.step]}</span>
            <span className="sr-only">{s.done ? "done" : "not done yet"}</span>
          </li>
        ))}
      </ol>
      {on.canComplete && (
        <ButtonLink className="mt-4" to="/family/onboarding" search={{ step: on.next ?? "preferences" }}>
          {done === 0 ? "Start setup" : "Continue setup"}
        </ButtonLink>
      )}
    </>
  );
  return first ? (
    <div className="mb-3 rounded-xl border border-harbor/25 bg-harbor-soft p-4" data-testid="setup-attention">
      <Badge tone="harbor">Setup</Badge>
      <p className="mt-1 font-medium">Finish setting up your household space</p>
      <div className="mt-2">{body}</div>
    </div>
  ) : (
    <Card tone="harbor" title="Finish setting up your household space">
      {body}
    </Card>
  );
}
