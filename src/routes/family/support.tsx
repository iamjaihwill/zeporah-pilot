import { SUPPORT_CATEGORIES } from "@/domain/model";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useState } from "react";
import {
  getSupport,
  reopenRequest,
  requestHumanSupport,
  saveSupportPreferences,
  withdrawRequest,
} from "@/functions/family";
import { isDenied, unwrap, unconfirmedSend, useAction, useSubmission } from "@/lib/client";
import { supportConfirmation } from "@/domain/claims";
import {
  Stamp,
  Button,
  Card,
  Check,
  ConfirmDialog,
  DeniedView,
  EmergencyNotice,
  ErrorText,
  Field,
  Notice,
  PageHeader,
  StateBadge,
  inputClass,
} from "@/components/ui";
import { ExpectationNote } from "@/components/expectation";

export const Route = createFileRoute("/family/support")({
  // ?about=<update id>: "Ask about this" on an update (interaction review, item 8).
  validateSearch: z.object({ about: z.string().max(100).optional() }),
  loaderDeps: ({ search }) => ({ about: search.about }),
  loader: async ({ deps }) =>
    unwrap(await getSupport({ data: deps.about ? { aboutUpdateId: deps.about } : {} })),
  component: Support,
});

const CATEGORIES = SUPPORT_CATEGORIES;

type FamilyRequest = {
  id: string;
  status: string;
  at: Date;
  topic: string | null;
  label: string;
  explanation: string;
  nextUpdateBy: Date | null;
  reopenedAt: Date | null;
  canWithdraw: boolean;
  canReopen: boolean;
  reopenUntil: Date | null;
};

/**
 * One of "Your requests" in the shared lifecycle words (decisions 80–82), with withdraw while it's
 * open and reopen for 7 days after it's resolved (decision 81).
 */
function RequestItem({ r }: { r: FamilyRequest }) {
  const [reason, setReason] = useState("");
  const withdraw = useAction();
  const reopen = useAction();
  return (
    <li className="py-3" data-testid="request-item">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-medium">{r.topic ?? "Support request"}</span>
          <span className="block text-ink-soft">
            Sent <Stamp at={r.at} />
            {r.reopenedAt && (
              <>
                {" "}
                · reopened <Stamp at={r.reopenedAt} />
              </>
            )}
          </span>
        </span>
        <StateBadge state={r.status} label={r.label} wrap />
      </div>
      <p className="mt-1">{r.explanation}</p>
      {r.nextUpdateBy && (
        <p className="mt-1 text-ink-soft">
          You'll hear about where it stands by <Stamp at={r.nextUpdateBy} />. This is about the request, not
          about care: for anything urgent, call the 24-hour line.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {r.canWithdraw && (
          <ConfirmDialog
            trigger={(open) => (
              <Button variant="quiet" size="sm" onClick={open}>
                Withdraw…
              </Button>
            )}
            title="Withdraw this request?"
            confirmLabel="Withdraw it"
            error={withdraw.error}
            onConfirm={() =>
              withdraw.act(() => withdrawRequest({ data: { id: r.id } }), "Your request was withdrawn.")
            }
          >
            Your care team stops working on it, and whoever has it is told. You can send a new request any
            time.
          </ConfirmDialog>
        )}
        {r.canReopen && (
          <ConfirmDialog
            trigger={(open) => (
              <Button variant="quiet" size="sm" onClick={open}>
                Reopen…
              </Button>
            )}
            title="Reopen this request?"
            confirmLabel="Reopen it"
            error={reopen.error}
            onConfirm={() =>
              reopen.act(
                () => reopenRequest({ data: { id: r.id, reason } }),
                "Your request was reopened. It went back to the person who resolved it.",
              )
            }
          >
            <p>It goes back to the person who resolved it.</p>
            <Field label="What still needs attention?">
              {(id) => (
                <textarea
                  id={id}
                  rows={3}
                  maxLength={300}
                  className={inputClass}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </Field>
            {r.reopenUntil && (
              <p className="mt-1 text-sm text-ink-soft">
                You can reopen it until <Stamp at={r.reopenUntil} />.
              </p>
            )}
          </ConfirmDialog>
        )}
      </div>
    </li>
  );
}

function Support() {
  const s = Route.useLoaderData();
  if (isDenied(s)) return <DeniedView d={s} />;
  return (
    <>
      <PageHeader
        eyebrow="Support"
        title="It's okay to pause"
        lede="You don't have to do everything today. Pick what would help right now."
      />
      <div className="space-y-6">
        <Pause smallestTask={s.smallestTask} canInvite={s.canInvite} canRequest={s.canRequest} />
        {s.canRequest && (
          <AskAPerson
            key={s.aboutUpdate?.id ?? "general"}
            requests={s.requests}
            about={s.aboutUpdate}
            confirmation={supportConfirmation(
              s.hotline ?? "your hospice's 24-hour line",
              s.expectation?.replyTime || null,
            )}
          />
        )}
        {s.canEditPrefs && <Prefs initial={s.prefs} />}
        <ExpectationNote e={s.expectation} line={s.hotline} />
        <EmergencyNotice line={s.hotline} />
      </div>
    </>
  );
}

/**
 * "Take a pause" (item 6). Every option does what it says: nothing here is saved or sent.
 */
function Pause({
  smallestTask,
  canInvite,
  canRequest,
}: {
  smallestTask: { id: string; title: string } | null;
  canInvite: boolean;
  canRequest: boolean;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const options: [string, string][] = [
    ["smaller", "Show me one smaller step"],
    ["away", "I need to step away"],
    ["someone", "Ask someone I trust to help"],
  ];
  return (
    <Card title="Take a pause" tone="harbor">
      <div className="flex flex-wrap gap-2">
        {options.map(([k, label]) => (
          <Button
            key={k}
            variant={choice === k ? "primary" : "secondary"}
            aria-pressed={choice === k}
            onClick={() => setChoice(k)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="mt-4" aria-live="polite">
        {choice === "smaller" &&
          (smallestTask ? (
            <p>
              Just one thing:{" "}
              <Link
                to="/family/tasks"
                hash={`task-${smallestTask.id}`}
                className="font-medium text-harbor underline"
              >
                {smallestTask.title}
              </Link>
              . You can stop after that.
            </p>
          ) : (
            <p>
              You don't have any open tasks right now. If something's on your mind, try writing down one
              question for your care guide
              {canRequest ? (
                <>
                  {" "}
                  — you can{" "}
                  <a href="#ask-a-person" className="text-harbor underline">
                    send it below
                  </a>{" "}
                  when you're ready
                </>
              ) : null}
              .
            </p>
          ))}
        {choice === "away" && (
          <p>
            That's okay. There's nothing to save here, and stepping away doesn't send or share anything. Come
            back whenever it feels right.
          </p>
        )}
        {choice === "someone" &&
          (canInvite ? (
            <p>
              You can{" "}
              <Link to="/family/people" className="text-harbor underline">
                invite someone you trust to your household
              </Link>
              . Before you create the invitation, it shows exactly what their role would let them see.
            </p>
          ) : (
            <p>
              Your household coordinator can invite someone you trust to the household. Before they do, it
              shows exactly what that person would be able to see.
            </p>
          ))}
        {!choice && (
          <p className="text-ink-soft">Choosing one of these doesn't tell anyone or send anything.</p>
        )}
      </div>
    </Card>
  );
}

function AskAPerson({
  requests,
  confirmation,
  about,
}: {
  requests: FamilyRequest[];
  confirmation: string;
  about: { id: string; title: string } | null;
}) {
  const [category, setCategory] = useState<string>(CATEGORIES[0][1]);
  const [message, setMessage] = useState("");
  const [time, setTime] = useState("");
  // Set when the server says "you sent this a moment ago": the next send is deliberate.
  const [duplicate, setDuplicate] = useState(false);
  const { act, pending, error, setError } = useAction();
  const submission = useSubmission();
  const send = async (sendAgain: boolean) => {
    const sent = message;
    // Choosing "send again" is a second request on purpose, so it gets its own ID.
    if (sendAgain) submission.done();
    const submissionId = submission.idFor(JSON.stringify([category, sent, time, about?.id ?? null]));
    const r = await act(
      async () => {
        const res = await requestHumanSupport({
          data: {
            category,
            message: sent,
            contactTime: time,
            ...(about ? { aboutUpdateId: about.id } : {}),
            ...(sendAgain ? { sendAgain: true } : {}),
            submissionId,
          },
        });
        // The same request a moment ago: ask before sending a second one.
        if (!res.ok && res.code === "CONFLICT") setDuplicate(true);
        return res;
      },
      confirmation,
      undefined,
      unconfirmedSend("request", submissionId),
    );
    if (r) {
      submission.done();
      setDuplicate(false);
      setMessage((m) => (m === sent ? "" : m));
      document.getElementById("your-requests")?.focus();
    }
  };
  return (
    <Card
      title={about ? "Ask your care team about this update" : "Ask a person on your care team for support"}
    >
      <div id="ask-a-person" />
      {about && (
        <p className="mb-3 rounded-lg bg-sunk px-3 py-2">
          About the update: <strong>{about.title}</strong>
        </p>
      )}
      <p className="mb-4 text-ink-soft">
        This sends a request to your care team. They'll see the topic and anything you choose to write —
        nothing else. A person decides whether and how to follow up.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(false);
        }}
      >
        {!about && (
          <Field label="What would you like help with?">
            {(id) => (
              <select
                id={id}
                className={inputClass}
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setDuplicate(false);
                }}
              >
                {CATEGORIES.map(([, l]) => (
                  <option key={l}>{l}</option>
                ))}
                <option>Something else</option>
              </select>
            )}
          </Field>
        )}
        <Field
          label={about ? "Your question (optional)" : "Anything you'd like them to know (optional)"}
          hint="Only what you write here is shared."
        >
          {(id, d) => (
            <textarea
              id={id}
              aria-describedby={d}
              rows={3}
              className={inputClass}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
            />
          )}
        </Field>
        <Field label="Best time to reach you (optional)">
          {(id) => (
            <input
              id={id}
              className={inputClass}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              maxLength={100}
            />
          )}
        </Field>
        {duplicate ? (
          <div className="rounded-lg border border-ochre/40 bg-ochre-soft p-3" role="alert">
            <p>You sent this a moment ago — send again?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button disabled={pending} onClick={() => void send(true)}>
                Send again
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setDuplicate(false);
                  setError(null);
                }}
              >
                Don't send
              </Button>
            </div>
          </div>
        ) : (
          <>
            <ErrorText error={error} />
            <Button type="submit" disabled={pending}>
              {about ? "Send my question" : "Send the request"}
            </Button>
          </>
        )}
      </form>
      <section className="mt-6" aria-labelledby="your-requests-title">
        <h3 id="your-requests-title" className="font-sans text-base font-semibold">
          Your requests
        </h3>
        <div id="your-requests" tabIndex={-1} className="outline-none">
          {requests.length === 0 ? (
            <p className="mt-1 text-sm text-ink-soft">None yet.</p>
          ) : (
            <ul className="mt-2 divide-y text-sm" data-testid="your-requests">
              {requests.map((r) => (
                <RequestItem key={r.id} r={r} />
              ))}
            </ul>
          )}
        </div>
      </section>
      <div className="mt-4">
        <Notice tone="quiet">This isn't watched around the clock and isn't for emergencies.</Notice>
      </div>
    </Card>
  );
}

function Prefs({
  initial,
}: {
  initial: {
    categories: string[];
    spiritualCare: boolean;
    preferredContactTime: string | null;
  } | null;
}) {
  const [v, setV] = useState({
    categories: initial?.categories ?? [],
    spiritualCare: initial?.spiritualCare ?? false,
    preferredContactTime: initial?.preferredContactTime ?? "",
  });
  const { act, pending, error } = useAction();
  const toggle = (k: string) =>
    setV({
      ...v,
      categories: v.categories.includes(k) ? v.categories.filter((c) => c !== k) : [...v.categories, k],
    });
  return (
    <Card title="Support preferences" tone="quiet">
      <p className="mb-4 text-ink-soft">
        Your care team can read these when deciding what support to offer. They're never shared outside your
        care team.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => saveSupportPreferences({ data: v }), "Support preferences saved.");
        }}
      >
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-2 font-medium">Kinds of support that might help</legend>
          {CATEGORIES.map(([k, l]) => (
            <Check key={k} label={l} checked={v.categories.includes(k)} onChange={() => toggle(k)} />
          ))}
        </fieldset>
        <Check
          label="Spiritual care is welcome"
          checked={v.spiritualCare}
          onChange={(spiritualCare) => setV({ ...v, spiritualCare })}
        />
        <Field label="Best time for a call">
          {(id) => (
            <input
              id={id}
              className={inputClass}
              value={v.preferredContactTime}
              onChange={(e) => setV({ ...v, preferredContactTime: e.target.value })}
              maxLength={100}
            />
          )}
        </Field>
        <ErrorText error={error} />
        <Button type="submit" variant="secondary" disabled={pending}>
          Save preferences
        </Button>
      </form>
    </Card>
  );
}
