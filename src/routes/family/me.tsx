import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { addPrivateNote, editPrivateNote, getPatientView, requestHumanSupport } from "@/functions/family";
import { isDenied, unwrap, UNCONFIRMED_SEND, useAction, useSubmission } from "@/lib/client";
import {
  Button,
  ButtonLink,
  Card,
  DeniedView,
  EmergencyNotice,
  EmptyState,
  ErrorText,
  Field,
  PageHeader,
  Stamp,
  inputClass,
} from "@/components/ui";

/**
 * The patient's own view (founder decision 46). Everything here is theirs to know; nothing here is
 * the care team's internal working (no staff notes, priorities, triage or audit detail).
 */
export const Route = createFileRoute("/family/me")({
  loader: async () => unwrap(await getPatientView()),
  component: MyCare,
});

const CONTACT: Record<string, string> = { in_app: "In Zeporah", phone: "By phone", email: "By email" };
const CONCERN_TOPIC = "A concern I want to raise";

function MyCare() {
  const v = Route.useLoaderData();
  if (isDenied(v)) return <DeniedView d={v} back={<ButtonLink to="/family">Back to home</ButtonLink>} />;
  return (
    <>
      <PageHeader
        eyebrow="My care"
        title="Your care, in one place"
        lede={`${v.stage}. This is yours: what matters to you, who's involved, and what's coming up.`}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="What matters to you">
          {v.wishes.whatMatters ? (
            <p>{v.wishes.whatMatters}</p>
          ) : (
            <p className="text-ink-soft">Nothing written down yet.</p>
          )}
          <dl className="mt-3 grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
            <dt className="text-ink-soft">Support you asked for</dt>
            <dd>{v.wishes.support.length ? v.wishes.support.join("; ") : "None yet"}</dd>
            <dt className="text-ink-soft">Spiritual care</dt>
            <dd>{v.wishes.spiritualCare ? "Yes, please" : "Not asked for"}</dd>
            <dt className="text-ink-soft">Best way to reach you</dt>
            <dd>
              {CONTACT[v.wishes.contactMethod] ?? v.wishes.contactMethod}
              {v.wishes.contactTime ? ` · ${v.wishes.contactTime}` : ""}
            </dd>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink to="/family/settings" variant="secondary" size="sm">
              Your preferences
            </ButtonLink>
            <ButtonLink to="/family/support" variant="secondary" size="sm">
              Support you'd like
            </ButtonLink>
          </div>
        </Card>

        <Card title="Your care team">
          <p>
            {v.careTeam.guides.length
              ? `Care guide: ${v.careTeam.guides.join(", ")}`
              : "Your care guide is being chosen."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink to="/family/messages" variant="secondary" size="sm">
              Message your care team
            </ButtonLink>
          </div>
          <div className="mt-3">
            <EmergencyNotice line={v.careTeam.hotline} />
          </div>
        </Card>

        <Card title="People involved">
          {v.people.length ? (
            <ul className="space-y-1">
              {v.people.map((p) => (
                <li key={p.name}>
                  {p.name} <span className="text-ink-soft">· {p.roles.join(", ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-soft">No one else yet.</p>
          )}
        </Card>

        <Card title="Coming up">
          {v.milestones.length ? (
            <ul className="space-y-1">
              {v.milestones.map((m, i) => (
                <li key={i}>
                  {m.what}
                  {m.when && (
                    <span className="text-ink-soft">
                      {" "}
                      · <Stamp at={m.when} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-soft">Nothing scheduled in the next two weeks.</p>
          )}
        </Card>

        <Card title="Tasks shared with you">
          {v.tasks.length ? (
            <ul className="space-y-1">
              {v.tasks.map((t) => (
                <li key={t.id}>
                  {t.title}
                  <span className="text-ink-soft">
                    {t.with ? ` · with ${t.with.split(" ")[0]}` : " · not assigned yet"}
                    {t.dueAt && (
                      <>
                        {" "}
                        · due <Stamp at={t.dueAt} />
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-soft">None open.</p>
          )}
        </Card>

        <Card title="What's shared, and with whom">
          {v.sharing.length ? (
            <ul className="space-y-1.5">
              {v.sharing.map((c) => (
                <li key={c.id}>
                  {c.recipient}{" "}
                  <span className="text-ink-soft">
                    · {c.purpose} · {c.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-soft">Nothing is shared outside your household.</p>
          )}
          {v.packets.length > 0 && (
            <>
              <h3 className="mt-3 font-medium">Packets</h3>
              <ul className="mt-1 space-y-1.5">
                {v.packets.map((p) => (
                  <li key={p.id}>
                    {p.recipient}{" "}
                    <span className="text-ink-soft">
                      · {p.purpose} · {p.status}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-3">
            <ButtonLink to="/family/sharing" variant="secondary" size="sm">
              Manage sharing
            </ButtonLink>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <PrivateNotes notes={v.notes} />
        <FlagConcern />
      </div>
    </>
  );
}

function PrivateNotes({ notes }: { notes: { id: string; body: string; at: Date }[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const { act, pending, error } = useAction();
  return (
    <Card title="Your private notes">
      <p className="mb-3 text-sm text-ink-soft">
        Only you can read these — not your household, not your care team.
      </p>
      {notes.length === 0 && <EmptyState title="No notes yet" />}
      <ul className="space-y-2">
        {notes.map((n) =>
          editing?.id === n.id ? (
            <li key={n.id}>
              <form
                className="space-y-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await act(() => editPrivateNote({ data: editing }), "Note saved.");
                  if (r) {
                    setEditing(null);
                    await router.invalidate();
                  }
                }}
              >
                <Field label="Edit note">
                  {(id) => (
                    <textarea
                      id={id}
                      rows={3}
                      maxLength={2000}
                      className={inputClass}
                      value={editing.body}
                      onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                    />
                  )}
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={pending}>
                    Save
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </li>
          ) : (
            <li key={n.id} className="rounded-lg border p-3">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 flex items-center justify-between text-sm text-ink-soft">
                <Stamp at={n.at} />
                <Button size="sm" variant="secondary" onClick={() => setEditing({ id: n.id, body: n.body })}>
                  Edit<span className="sr-only"> note</span>
                </Button>
              </p>
            </li>
          ),
        )}
      </ul>
      <form
        className="mt-3 space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() => addPrivateNote({ data: { body: draft } }), "Note saved.");
          if (r) {
            setDraft("");
            await router.invalidate();
          }
        }}
      >
        <Field label="New note">
          {(id) => (
            <textarea
              id={id}
              rows={3}
              maxLength={2000}
              className={inputClass}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          )}
        </Field>
        <ErrorText error={error} />
        <Button type="submit" size="sm" disabled={pending || !draft.trim()}>
          Save note
        </Button>
      </form>
    </Card>
  );
}

/** Decision 46: a clear way to flag a concern. It reaches a person on the care team. */
function FlagConcern() {
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const { act, pending, error } = useAction();
  const submission = useSubmission();
  return (
    <Card title="Ask for help or flag a concern">
      {sent ? (
        <p>Your care team has it. A person will decide how to follow up.</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const submissionId = submission.idFor(message);
            const r = await act(
              () =>
                requestHumanSupport({
                  data: { category: CONCERN_TOPIC, message, contactTime: "", submissionId },
                }),
              "Sent to your care team.",
              undefined,
              UNCONFIRMED_SEND,
            );
            if (r) {
              submission.done();
              setSent(true);
            }
          }}
        >
          <Field
            label="What's on your mind"
            hint="It goes to your care team. For anything urgent, call the 24-hour line."
          >
            {(id, d) => (
              <textarea
                id={id}
                aria-describedby={d}
                rows={3}
                maxLength={1000}
                required
                className={inputClass}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            )}
          </Field>
          <ErrorText error={error} />
          <Button type="submit" disabled={pending || !message.trim()}>
            Send to my care team
          </Button>
        </form>
      )}
    </Card>
  );
}
