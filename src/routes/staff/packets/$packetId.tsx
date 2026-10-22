import { StaffPending } from "@/components/staff/pending";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  getPacket,
  requestRelease,
  revokePacket,
  setManifest,
  setPacketRecipientContact,
} from "@/functions/staff";
import { dateOnly, isDenied, unwrap, useAction } from "@/lib/client";
import {
  Stamp,
  Badge,
  Button,
  ButtonLink,
  Card,
  Check,
  ConfirmDialog,
  DeniedView,
  ErrorText,
  Field,
  Notice,
  StateBadge,
  inputClass,
  Coded,
  CodeDetails,
} from "@/components/ui";
import { reasonLabel } from "@/domain/labels";
import { StaffPageHeader, StatusChip } from "@/components/staff";
import { type ShareCategory } from "@/domain/model";
import { REVOCATION_NOTE } from "@/domain/claims";
import { LIFECYCLE_LABELS } from "@/domain/lifecycle";
import { AUTHORITY_STATUS_NOTE } from "@/domain/authority-identity";

export const Route = createFileRoute("/staff/packets/$packetId")({
  loader: async ({ params }) => unwrap(await getPacket({ data: { id: params.packetId } })),
  component: Packet,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

type Outcome = { decision: string; reasonCode: string; explanation: string };

function Packet() {
  const p = Route.useLoaderData();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const { act, pending, error } = useAction();
  if (isDenied(p))
    return <DeniedView d={p} back={<ButtonLink to="/staff/packets">Back to packets</ButtonLink>} />;
  const pk = p.packet;
  const releasable = pk.state === "draft" || pk.state === "held";
  return (
    <>
      <StaffPageHeader
        title={pk.recipientName || "No recipient named"}
        description={`${pk.purpose ? `For: ${pk.purpose}` : "No purpose stated"} · ${p.household.name}`}
        actions={<StatusChip domain="packet" value={pk.state} />}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card title="Minimum-necessary manifest">
            {p.manifest.length ? (
              <ul className="list-disc space-y-1 pl-5">
                {p.manifest.map((m) => (
                  <li key={m.category}>{m.label}</li>
                ))}
              </ul>
            ) : (
              <p className="text-ochre">Nothing listed. A packet must list what it shares.</p>
            )}
            {releasable && p.canDraft && (
              <ManifestEditor
                packetId={pk.id}
                current={p.manifest.map((m) => m.category)}
                all={p.allCategories}
              />
            )}
            <p className="mt-3 text-sm text-ink-soft">
              Shareable until {dateOnly(pk.expiresAt)}. Packets carry categories of coordination information —
              never clinical charts or legal originals.
            </p>
          </Card>
          <div className="grid gap-6 sm:grid-cols-2">
            <Card title="Consent">
              {p.consent ? (
                <>
                  <p className="font-medium">{p.consent.recipientName}</p>
                  <p className="text-sm text-ink-soft">{p.consent.purpose}</p>
                  <p className="mt-2">
                    <StateBadge state={p.consent.state} label={p.consent.stageLabel} />{" "}
                    <span className="text-sm text-ink-soft">until {dateOnly(p.consent.expiresAt)}</span>
                  </p>
                  <p className="mt-2 text-sm text-ink-soft">Covers: {p.consent.scope.join("; ")}</p>
                  <p className="mt-1 text-xs text-ink-faint">Version {p.consent.version}</p>
                </>
              ) : (
                <p className="text-ochre">No consent linked.</p>
              )}
            </Card>
            <Card title="Authority workflow">
              {p.authority ? (
                <>
                  <p className="font-medium">{p.authority.holderName}</p>
                  <p className="text-sm text-ink-soft">{p.authority.type}</p>
                  <p className="mt-2">
                    <StateBadge state={p.authority.state} />
                  </p>
                  <Link
                    to="/staff/households/$householdId"
                    params={{ householdId: p.household.id }}
                    search={{ tab: "sharing" }}
                    className="mt-2 inline-block text-sm text-harbor underline"
                  >
                    See evidence and reviews
                  </Link>
                </>
              ) : (
                <p className="text-ochre">No authority workflow linked.</p>
              )}
              <p className="mt-2 text-xs text-ink-faint">{AUTHORITY_STATUS_NOTE}</p>
            </Card>
          </div>
          <Card title="Packet history">
            <ol className="space-y-2 text-sm">
              {p.events.map((e) => (
                <li key={e.id}>
                  <span className="text-ink-soft">
                    <Stamp at={e.at} full />
                  </span>{" "}
                  · {e.actor}: {e.summary} {e.decision && <StateBadge state={e.decision} />}{" "}
                  {e.reasonCode && (
                    <Coded
                      className="text-xs text-ink-soft"
                      label={reasonLabel(e.reasonCode)}
                      code={e.reasonCode}
                    />
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="space-y-4">
          {/* Item 19: after release (or withdrawal) the preview no longer applies — one summary instead. */}
          {!releasable ? (
            <Card
              title={pk.state === "released" ? "Released" : "Access withdrawn"}
              tone={pk.state === "released" ? "moss" : "plain"}
            >
              <div data-testid="release-outcome">
                <p className="font-medium">{pk.state === "released" ? p.releaseNote : REVOCATION_NOTE}</p>
                <p className="mt-2 text-sm text-ink-soft">
                  {p.recipientAccess.length
                    ? "The named recipient reads it in Zeporah, signed in and read-only, until it expires — never as an attachment."
                    : "No recipient contact was set, so no one outside the hospice can read it in Zeporah."}{" "}
                  This records that release was permitted, what it covered and until when.
                </p>
              </div>
            </Card>
          ) : (
            <Card
              title="Release check"
              tone={
                p.preview.decision === "allow" ? "moss" : p.preview.decision === "hold" ? "ochre" : "rose"
              }
            >
              <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
                Preview if you asked now
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <StateBadge state={p.preview.decision} />{" "}
                <Coded
                  className="text-sm font-medium"
                  label={reasonLabel(p.preview.reasonCode)}
                  code={p.preview.reasonCode}
                />
              </p>
              <p className="mt-2">{p.preview.explanation}</p>
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer">Checks</summary>
                <ul className="mt-2 space-y-0.5">
                  {p.preview.auditContext.checks.map((c) => (
                    <li key={c.check}>
                      <span aria-hidden>{c.passed ? "✓" : "✗"}</span> {c.check.replace(/_/g, " ")}{" "}
                      <span className="sr-only">{c.passed ? "passed" : "failed"}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          )}

          {releasable && (
            <Card>
              <p className="text-sm text-ink-soft">
                Requesting release runs every check again and records the outcome — allow, hold or deny — in
                the audit log. If every check passes, the packet is recorded as released and you get a
                receipt. The named recipient can then read it in Zeporah, read-only; they get an email with a
                link and nothing else.
              </p>
              <ErrorText error={error} />
              <div className="mt-3">
                <ConfirmDialog
                  title={`Request release to ${pk.recipientName || "this recipient"}?`}
                  confirmLabel="Request release"
                  disabled={pending}
                  error={error}
                  trigger={(open) => (
                    <Button className="w-full" disabled={pending} onClick={open}>
                      Request release…
                    </Button>
                  )}
                  onConfirm={async () => {
                    const r = await act(() => requestRelease({ data: { id: pk.id } }));
                    if (r) setOutcome(r.data);
                    return true;
                  }}
                >
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="font-medium text-ink">To</dt>
                      <dd>{pk.recipientName || "No recipient named"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-ink">For</dt>
                      <dd>{pk.purpose || "No purpose stated"}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-ink">What's included</dt>
                      <dd>
                        {p.manifest.length ? p.manifest.map((m) => m.label).join(", ") : "Nothing listed"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-ink">Until</dt>
                      <dd>{dateOnly(pk.expiresAt)}</dd>
                    </div>
                  </dl>
                  <p>
                    Every check runs again. If one doesn't pass, it's held or denied and nothing is released.
                  </p>
                </ConfirmDialog>
              </div>
              {!p.canRelease && (
                <p className="mt-2 text-xs text-ink-soft">
                  Your role can't release packets; the request will be denied and recorded.
                </p>
              )}
            </Card>
          )}

          {/* A held or denied outcome is shown here; a release shows as the summary above. */}
          {outcome && outcome.decision !== "allow" && (
            <div role="status" aria-live="polite" data-testid="release-outcome">
              <Notice
                tone={
                  outcome.decision === "allow" ? "harbor" : outcome.decision === "hold" ? "ochre" : "rose"
                }
                title={
                  outcome.decision === "allow" ? "Released" : outcome.decision === "hold" ? "Held" : "Denied"
                }
              >
                <p>{outcome.decision === "allow" ? p.releaseNote : outcome.explanation}</p>
                <p className="mt-1 font-medium">{reasonLabel(outcome.reasonCode)}</p>
                <CodeDetails code={outcome.reasonCode} />
              </Notice>
            </div>
          )}

          {p.receipts.map((r) => (
            <Card key={r.id} id="receipt" title="Release receipt" className="scroll-mt-16">
              <dl className="space-y-1 text-sm">
                <div>
                  <dt className="inline font-medium">Released</dt>{" "}
                  <dd className="inline">
                    <Stamp at={r.releasedAt} full /> by {r.releasedBy}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium">To</dt> <dd className="inline">{r.recipientName}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">For</dt> <dd className="inline">{r.purpose}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Until</dt>{" "}
                  <dd className="inline">{dateOnly(r.expiresAt)}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Audit event</dt>{" "}
                  <dd className="inline font-mono text-xs">{r.auditEventId.slice(0, 8)}…</dd>
                </div>
              </dl>
            </Card>
          ))}

          <RecipientCard
            packetId={pk.id}
            contact={
              pk.recipientContactName
                ? { name: pk.recipientContactName, email: pk.recipientEmail ?? "" }
                : null
            }
            canEdit={releasable && p.canDraft}
            access={p.recipientAccess}
          />
          {pk.state === "released" && p.canRevoke && <Revoke packetId={pk.id} />}
          <p className="text-sm text-ink-soft">
            Last updated <Stamp at={pk.updatedAt} full /> · drafted by {pk.createdBy}
          </p>
          <p className="text-sm text-ink-soft">
            Household stage:{" "}
            {LIFECYCLE_LABELS[p.household.lifecycle as keyof typeof LIFECYCLE_LABELS] ??
              p.household.lifecycle}
          </p>
        </aside>
      </div>
    </>
  );
}

function ManifestEditor({
  packetId,
  current,
  all,
}: {
  packetId: string;
  current: ShareCategory[];
  all: { category: ShareCategory; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<ShareCategory[]>(current);
  const { act, pending, error } = useAction();
  if (!open)
    return (
      <Button className="mt-3" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Change contents
      </Button>
    );
  return (
    <div className="mt-4 space-y-2">
      {all.map((c) => (
        <Check
          key={c.category}
          label={c.label}
          checked={v.includes(c.category)}
          onChange={(on) => setV(on ? [...v, c.category] : v.filter((x) => x !== c.category))}
        />
      ))}
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={async () =>
            (await act(
              () => setManifest({ data: { packetId, categories: v } }),
              "Packet contents updated.",
            )) && setOpen(false)
          }
        >
          Save contents
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Revoke({ packetId }: { packetId: string }) {
  const [reason, setReason] = useState("");
  const { act, error } = useAction();
  return (
    <ConfirmDialog
      title="Revoke this release?"
      tone="danger"
      confirmLabel="Revoke"
      trigger={(open) => (
        <Button variant="danger" className="w-full" onClick={open}>
          Revoke release
        </Button>
      )}
      onConfirm={() => act(() => revokePacket({ data: { packetId, reason } }), REVOCATION_NOTE)}
    >
      <p>{REVOCATION_NOTE}</p>
      <Field label="Reason">
        {(id) => (
          <textarea
            id={id}
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

const DID: Record<string, string> = {
  viewed: "Opened it",
  acknowledged: "Acknowledged receipt",
  clarification_requested: "Asked a question",
};

/** Decision 45: who reads it at the recipient, their access, and what they've done with it. */
function RecipientCard({
  packetId,
  contact,
  canEdit,
  access,
}: {
  packetId: string;
  contact: { name: string; email: string } | null;
  canEdit: boolean;
  access: {
    id: string;
    name: string;
    expiresAt: Date;
    statusText: string;
    status: string;
    acknowledgedAt: Date | null;
    accountSetUp: boolean;
    history: { id: string; action: string; at: Date }[];
  }[];
}) {
  const [v, setV] = useState({ name: contact?.name ?? "", email: contact?.email ?? "" });
  const [editing, setEditing] = useState(false);
  const { act, pending, error } = useAction();
  return (
    <Card title="Recipient access">
      {contact ? (
        <p className="text-sm">
          <span className="font-medium">{contact.name}</span> · {contact.email}
        </p>
      ) : (
        <p className="text-sm text-ink-soft">
          No one named yet. Without a contact, no one outside the hospice can read it.
        </p>
      )}
      {canEdit && !editing && (
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => setEditing(true)}>
          {contact ? "Change recipient contact" : "Set recipient contact"}
        </Button>
      )}
      {editing && (
        <form
          className="mt-3 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act(
              () => setPacketRecipientContact({ data: { packetId, ...v } }),
              "Recipient contact saved.",
            );
            if (r) setEditing(false);
          }}
        >
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
          <Field label="Their email" hint="Gets a link to sign in, never the contents.">
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                type="email"
                required
                className={inputClass}
                value={v.email}
                onChange={(e) => setV({ ...v, email: e.target.value })}
              />
            )}
          </Field>
          <ErrorText error={error} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {access.map((a) => (
        <div key={a.id} className="mt-3 border-t pt-3 text-sm" data-testid="recipient-access">
          <p>
            <span className="font-medium">{a.name}</span> · {a.statusText}
          </p>
          <p className="text-ink-soft">
            Until <Stamp at={a.expiresAt} full />
            {!a.accountSetUp && " · hasn't set up their sign-in yet"}
          </p>
          {a.history.length ? (
            <ol className="mt-1 space-y-0.5">
              {a.history.map((h) => (
                <li key={h.id}>
                  <Stamp at={h.at} /> · {DID[h.action] ?? h.action}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1 text-ink-soft">Not opened yet.</p>
          )}
        </div>
      ))}
    </Card>
  );
}
