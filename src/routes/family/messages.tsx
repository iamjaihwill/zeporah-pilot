import { Link, createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  acknowledgeUpdate,
  getThread,
  markThreadSeen,
  sendFamilyMessage,
  undoAcknowledgeUpdate,
} from "@/functions/family";
import { cx, dateTime, isDenied, unwrap, UNCONFIRMED_SEND, useAction, useSubmission } from "@/lib/client";
import {
  Badge,
  Button,
  ButtonLink,
  DeniedView,
  EmergencyLine,
  ErrorText,
  Field,
  Notice,
  PageHeader,
  inputClass,
} from "@/components/ui";
import { ExpectationNote, ReplyTimeLine } from "@/components/expectation";

export const Route = createFileRoute("/family/messages")({
  loader: async () => unwrap(await getThread()),
  component: Messages,
});

/** When this browser last marked the thread seen (see the arrival effect below). */
let lastMarkedSeen = 0;

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Messages() {
  const t = Route.useLoaderData();
  const { hash } = useLocation();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const { act, pending, error } = useAction();
  const submission = useSubmission();
  const formRef = useRef<HTMLFormElement>(null);
  // The divider stays where it was on arrival, even as new messages are sent (item 9).
  const [since] = useState(() => (isDenied(t) || !t.lastSeenAt ? null : new Date(t.lastSeenAt).getTime()));
  const [highlight, setHighlight] = useState<string | null>(null);
  const [mod, setMod] = useState("Ctrl");
  useEffect(() => {
    setMod(isMac() ? "⌘" : "Ctrl");
  }, []);

  // Arriving from a notification (#entry-…) opens at that item; otherwise at what's new.
  useEffect(() => {
    if (isDenied(t)) return;
    const target = hash ? document.getElementById(hash) : document.getElementById("new-since-last-visit");
    if (target) {
      target.scrollIntoView({ block: "center" });
      if (hash) {
        target.focus({ preventScroll: true });
        setHighlight(hash);
      }
    }
    // Opening the thread marks it seen: the home page's "new reply" item clears.
    // Then refresh once, so unread badges drop straight away. The refresh can remount this page,
    // so a short guard stops it from marking (and refreshing) again in a loop.
    if (Date.now() - lastMarkedSeen > 10_000) {
      lastMarkedSeen = Date.now();
      void markThreadSeen().then(() => router.invalidate());
    }
    // Only on arrival.
  }, []);

  if (isDenied(t)) return <DeniedView d={t} />;
  const firstNew =
    since === null ? -1 : t.entries.findIndex((e) => !("mine" in e && e.mine) && e.at.getTime() > since);

  return (
    <>
      <PageHeader
        eyebrow="Updates & messages"
        title={t.canView ? `With ${t.careGuide ?? "your care guide"}` : "Updates from your care team"}
        lede={
          t.canView
            ? "Updates from your care team and messages between your household and your care guide, in one place. For routine coordination only."
            : "Updates your care team shares with the whole household."
        }
      >
        {/* One sentence about who reads what; not repeated for people who only see updates. */}
        {t.canView && (
          <p className="mt-3 text-sm text-ink-soft" data-testid="thread-audience">
            <strong className="font-medium text-ink">Who can read messages here:</strong>{" "}
            {[...t.audience, `${t.careGuide ?? "your care guide"} and your care team`].join(", ")}. Updates
            are shared with everyone in your household.
          </p>
        )}
      </PageHeader>

      <ol className="space-y-4" aria-label="Updates and messages">
        {t.entries.map((e, i) => (
          <Fragment key={e.id}>
            {i === firstNew && (
              <li
                id="new-since-last-visit"
                tabIndex={-1}
                className="flex items-center gap-3 text-sm font-semibold text-clay outline-none"
                data-testid="new-divider"
              >
                <span aria-hidden className="h-px flex-1 bg-clay/40" />
                New since your last visit
                <span aria-hidden className="h-px flex-1 bg-clay/40" />
              </li>
            )}
            {e.type === "update" ? (
              <li
                id={`entry-${e.id}`}
                tabIndex={-1}
                className={cx(
                  "rounded-[var(--radius-card)] border border-harbor/25 bg-harbor-soft p-5 outline-none transition-shadow",
                  highlight === `entry-${e.id}` && "ring-2 ring-harbor ring-offset-2",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="harbor">Update from the care team</Badge>
                  <span className="text-sm text-ink-soft">
                    {e.author} · {dateTime(e.at)}
                  </span>
                </div>
                <h2 className="mt-2 text-xl">{e.title}</h2>
                <p className="mt-1 whitespace-pre-wrap">{e.body}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {e.requiresAck &&
                    (e.ackedByMe ? (
                      <Badge tone="moss">✓ You acknowledged this</Badge>
                    ) : (
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          act(
                            () => acknowledgeUpdate({ data: { id: e.id } }),
                            "Acknowledged. Your care team can see that you've read it.",
                            () => () => undoAcknowledgeUpdate({ data: { id: e.id } }),
                          )
                        }
                      >
                        Acknowledge
                      </Button>
                    ))}
                  {/* Item 8: anyone who reads an update can ask about it, routed like a support request. */}
                  {t.canAskAboutUpdates && (
                    <ButtonLink
                      to="/family/support"
                      search={{ about: e.id }}
                      hash="ask-a-person"
                      variant="secondary"
                      size="sm"
                    >
                      Ask about this<span className="sr-only">: {e.title}</span>
                    </ButtonLink>
                  )}
                  {e.requiresAck && e.ackedBy.length > 0 && (
                    <span className="text-sm text-ink-soft">Acknowledged by {e.ackedBy.join(", ")}</span>
                  )}
                </div>
              </li>
            ) : (
              <li
                id={`entry-${e.id}`}
                tabIndex={-1}
                className={cx(
                  "max-w-[85%] rounded-2xl px-4 py-3 outline-none",
                  e.mine
                    ? "ml-auto bg-harbor text-white"
                    : e.side === "staff"
                      ? "bg-surface shadow-[var(--shadow-card)]"
                      : "bg-sunk",
                  highlight === `entry-${e.id}` && "ring-2 ring-harbor ring-offset-2",
                )}
              >
                <p className="whitespace-pre-wrap">{e.body}</p>
                <p className={cx("mt-1 text-xs", e.mine ? "text-white/80" : "text-ink-soft")}>
                  {e.mine ? "You" : e.author}
                  {e.side === "staff" ? " (care team)" : ""} · {dateTime(e.at)}
                </p>
              </li>
            )}
          </Fragment>
        ))}
      </ol>

      <div className="mt-6 space-y-3">
        {/* Item 11: reply time and the emergency line sit together, right above the message box. */}
        <div className="space-y-2">
          <EmergencyLine line={t.hotline} />
          {t.canView && <ReplyTimeLine e={t.expectation} line={t.hotline} className="px-1 text-sm" />}
        </div>
        {t.canSend ? (
          <form
            ref={formRef}
            className="rounded-[var(--radius-card)] border bg-surface p-4"
            onSubmit={async (ev) => {
              ev.preventDefault();
              if (!draft.trim()) return;
              const sent = draft;
              const submissionId = submission.idFor(sent);
              if (
                await act(
                  () => sendFamilyMessage({ data: { body: sent, submissionId } }),
                  "Message sent to your care guide.",
                  undefined,
                  UNCONFIRMED_SEND,
                )
              ) {
                submission.done();
                // Clear only what was sent, so anything typed meanwhile is kept.
                setDraft((d) => (d === sent ? "" : d));
              }
            }}
          >
            <Field
              label={`Message ${t.careGuide ?? "your care guide"}`}
              hint={`Read by: ${[...t.audience, `${t.careGuide ?? "your care guide"} and your care team`].join(", ")}. Enter for a new line · ${mod}+Enter to send.`}
            >
              {(id, d) => (
                <textarea
                  id={id}
                  aria-describedby={d}
                  rows={3}
                  className={inputClass}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      formRef.current?.requestSubmit();
                    }
                  }}
                  maxLength={4000}
                />
              )}
            </Field>
            <ErrorText error={error} />
            <Button type="submit" className="mt-3" disabled={pending || !draft.trim()}>
              {pending ? "Sending…" : "Send message"}
            </Button>
          </form>
        ) : t.canView && !t.messagingOn ? (
          <Notice tone="quiet" title="Messaging isn't on yet">
            It turns on once communication settings are chosen in setup.{" "}
            {t.canCompleteSetup && (
              <Link to="/family/onboarding" search={{ step: "communication" }}>
                Choose them now
              </Link>
            )}
          </Notice>
        ) : !t.canView ? (
          <Notice tone="quiet">
            Your role can read household updates. Messages with the care guide are between them and the
            household coordinator, patient and proxy. To ask about an update, use “Ask about this”.
          </Notice>
        ) : null}
        {t.canView && <ExpectationNote e={t.expectation} line={t.hotline} withReplyTime={false} />}
        {t.canSend && (
          <p className="text-sm">
            Need a person to follow up about something?{" "}
            <Link to="/family/support" className="text-harbor underline">
              Ask your care team for support
            </Link>
            .
          </p>
        )}
      </div>
    </>
  );
}
