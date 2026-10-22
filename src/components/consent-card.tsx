import { useState, type ReactNode } from "react";
import {
  askToWithdrawConsent,
  cancelConsentCorrection,
  confirmConsent,
  getConsentsForMe,
  requestConsentCorrection,
  withdrawConsent,
} from "@/functions/family";
import { cx, dateOnly, useAction } from "@/lib/client";
import { REVOCATION_NOTE } from "@/domain/claims";
import {
  CORRECTION_CATEGORIES,
  CORRECTION_CATEGORY_LABELS,
  type ConsentStage,
  type CorrectionCategory,
} from "@/domain/consent";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Check,
  ConfirmDialog,
  ErrorText,
  Field,
  Stamp,
  StateBadge,
  inputClass,
} from "@/components/ui";

export type FamilyConsent = Extract<
  Awaited<ReturnType<typeof getConsentsForMe>>,
  { ok: true }
>["data"][number];

/** Short badge text for the household; the full stage explanation is shown beside it. */
export const FAMILY_BADGE: Record<ConsentStage, string> = {
  awaiting_confirmation: "Waiting for confirmation",
  needs_review: "Held for care-team review",
  awaiting_activation: "Confirmed — waiting for activation",
  active: "Active",
  scheduled: "Starts later",
  revoked: "Withdrawn",
  expired: "Ended",
};

const STAGE_EXPLAINED: Partial<Record<ConsentStage, string>> = {
  awaiting_confirmation:
    "Your care team recorded this. Nothing is shared until the named person confirms it and a different reviewer on the care team activates it.",
  needs_review: "It's held, and nothing is shared meanwhile.",
  awaiting_activation:
    "Confirmed. A reviewer on the care team still needs to activate it. Nothing is shared until then.",
};

const CHANGE_LABELS: Record<string, string> = {
  purpose: "Why it's shared",
  recipient: "Who receives it",
  scope: "What's included",
  start: "Start date",
  expiry: "End date",
  "revocation terms": "How to withdraw it",
};

const FIELD_WORDS: Record<string, string> = {
  purpose: "why it's shared",
  recipient: "who receives it",
  scope: "what's included",
  start: "the start date",
  expiry: "the end date",
  "revocation terms": "how to withdraw it",
};

/** Recorded → confirmed by the named person → activated by a different reviewer. */
function Steps({ stage }: { stage: ConsentStage }) {
  if (stage === "revoked" || stage === "expired") return null;
  const done = stage === "active" || stage === "scheduled" ? 3 : stage === "awaiting_activation" ? 2 : 1;
  const steps = ["Recorded by the care team", "Confirmed by the named person", "Activated by a reviewer"];
  return (
    <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Consent steps">
      {steps.map((label, i) => {
        const complete = i < done;
        const current = i === done;
        return (
          <li
            key={label}
            className={cx(
              "flex items-center gap-1.5",
              complete ? "text-moss" : current ? "font-medium" : "text-ink-faint",
            )}
            aria-current={current ? "step" : undefined}
          >
            <span aria-hidden>{complete ? "✓" : current ? "→" : "○"}</span>
            {label}
            <span className="sr-only">{complete ? " (done)" : current ? " (next)" : " (not yet)"}</span>
          </li>
        );
      })}
    </ol>
  );
}

function CorrectionDialog({ c, trigger }: { c: FamilyConsent; trigger: (open: () => void) => ReactNode }) {
  const [picked, setPicked] = useState<CorrectionCategory[]>([]);
  const [detail, setDetail] = useState("");
  const { act, error } = useAction();
  return (
    <ConfirmDialog
      title="Request a correction"
      confirmLabel="Send correction request"
      error={error}
      trigger={trigger}
      onConfirm={() =>
        act(
          () =>
            requestConsentCorrection({
              data: { consentId: c.id, version: c.version, categories: picked, detail },
            }),
          "Correction request sent to your care team. Nothing is shared under this consent while they look at it.",
        )
      }
    >
      <p>
        This asks your care team to fix something about this consent. It doesn't withdraw it, and nothing is
        shared under it until they resolve your request.
      </p>
      <fieldset className="space-y-2">
        <legend className="mb-1 font-medium text-ink">What isn't right? (optional)</legend>
        {CORRECTION_CATEGORIES.map((k) => (
          <Check
            key={k}
            label={CORRECTION_CATEGORY_LABELS[k]}
            checked={picked.includes(k)}
            onChange={(on) => setPicked(on ? [...picked, k] : picked.filter((x) => x !== k))}
          />
        ))}
      </fieldset>
      <Field
        label="Anything you'd like them to know (optional)"
        hint="Only your care team sees what you write here."
      >
        {(id, d) => (
          <textarea
            id={id}
            aria-describedby={d}
            rows={3}
            maxLength={1000}
            className={inputClass}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}

/**
 * One consent, as a household member sees it, with only the actions this person may take. Shared by
 * the Sharing page and the page for consents that name this person.
 */
export function ConsentCard({ c, extra }: { c: FamilyConsent; extra?: ReactNode }) {
  const { act, pending, error } = useAction();
  const open = c.stage !== "revoked" && c.stage !== "expired";
  return (
    <Card
      as="li"
      id={`consent-${c.id}`}
      tone={c.stage === "active" ? "plain" : "quiet"}
      className="scroll-mt-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl">{c.recipientName}</h2>
          <p className="text-ink-soft">For: {c.purpose}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StateBadge
            state={c.stage}
            label={
              c.stage === "awaiting_confirmation" && c.grantedByMe
                ? "Waiting for your confirmation"
                : FAMILY_BADGE[c.stage]
            }
          />
          {c.correction && <Badge tone="rose">Correction requested</Badge>}
        </div>
      </div>
      <Steps stage={c.stage} />
      {STAGE_EXPLAINED[c.stage] && <p className="mt-3 text-sm">{STAGE_EXPLAINED[c.stage]}</p>}
      {c.heldReason && <p className="mt-1 text-sm text-ink-soft">{c.heldReason}</p>}
      {c.changedInThisVersion.length > 0 && open && (
        <div className="mt-3 rounded-lg bg-ochre-soft px-3 py-2 text-sm">
          <p>
            <strong>What changed:</strong>
          </p>
          <ul className="mt-1 space-y-0.5">
            {c.changes.map((x) => (
              <li key={x.field}>
                {CHANGE_LABELS[x.field] ?? x.field}:{" "}
                {x.from !== null && x.to !== null ? (
                  <>
                    {x.kind === "date" ? dateOnly(new Date(x.from)) : x.from} <span aria-hidden>→</span>
                    <span className="sr-only">changed to</span>{" "}
                    {x.kind === "date" ? dateOnly(new Date(x.to)) : x.to}
                  </>
                ) : (
                  "changed"
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="font-medium">What's included</dt>
          <dd>
            <ul className="list-disc pl-5 text-ink-soft">
              {c.scope.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="font-medium">When</dt>
          <dd className="text-ink-soft">
            {dateOnly(c.startsAt)} to {dateOnly(c.expiresAt)}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Named as giving consent</dt>
          <dd className="text-ink-soft">{c.grantedByMe ? `${c.grantedBy} (you)` : c.grantedBy}</dd>
        </div>
      </dl>
      {c.confirmation && (
        <p className="mt-3 text-sm text-ink-soft">
          Confirmed in the app on <Stamp at={c.confirmation.at} full /> (version {c.confirmation.version}).
        </p>
      )}
      {c.stage === "revoked" && c.revokedAt && (
        <p className="mt-3 text-sm text-ink-soft">
          Withdrawn on <Stamp at={c.revokedAt} full />.
        </p>
      )}
      {extra}
      {c.correction && (
        <div
          className="mt-4 rounded-lg border border-rose/30 bg-rose-soft p-3 text-sm"
          data-testid="correction-pending"
        >
          <p>
            {c.correction.mine ? "You asked" : "The person named in this consent asked"} for a correction on{" "}
            <Stamp at={c.correction.at} full />
            {c.correction.categories.length ? (
              <>: {c.correction.categories.join(", ").toLowerCase()}</>
            ) : null}
            .
          </p>
          <p className="mt-1">
            Nothing is shared under this consent until a person on your care team resolves it. They can change
            the consent, withdraw it, or explain why no change is needed.
          </p>
          {c.canCancelCorrection && (
            <Button
              className="mt-2"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                act(
                  () => cancelConsentCorrection({ data: { id: c.id } }),
                  "Your correction request was cancelled.",
                )
              }
            >
              Cancel my correction request
            </Button>
          )}
        </div>
      )}
      {c.lastDismissal && (
        <p className="mt-3 text-sm text-ink-soft" data-testid="correction-reviewed">
          Your care team reviewed your correction request on <Stamp at={c.lastDismissal.at!} full /> and made
          no change. If you still have a concern, you can ask your care team for support.
        </p>
      )}
      {c.withdrawGuidance && <p className="mt-3 text-sm text-ink-soft">{c.withdrawGuidance}</p>}
      <ErrorText error={error} />
      {c.canConfirm && (
        <section
          aria-labelledby={`confirm-${c.id}`}
          className="mt-4 rounded-lg border border-line bg-paper p-4"
        >
          <h3 id={`confirm-${c.id}`} className="font-medium">
            Please check and confirm (version {c.version})
          </h3>
          <blockquote className="mt-2 border-l-4 border-harbor pl-3 text-sm">
            {c.confirmationStatement}
          </blockquote>
          <p className="mt-2 text-sm text-ink-soft">
            Confirming doesn't share anything by itself, and it isn't a legal signature. A different reviewer
            on the care team still has to activate it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                act(
                  () => confirmConsent({ data: { consentId: c.id, version: c.version } }),
                  "You confirmed this consent. It's waiting for a reviewer to activate it.",
                )
              }
            >
              Confirm this sharing
            </Button>
            {c.canRequestCorrection && (
              <CorrectionDialog
                c={c}
                trigger={(o) => (
                  <Button variant="secondary" size="sm" onClick={o} disabled={pending}>
                    Request a correction
                  </Button>
                )}
              />
            )}
          </div>
        </section>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {!c.canConfirm && c.canRequestCorrection && (
          <CorrectionDialog
            c={c}
            trigger={(o) => (
              <Button variant="secondary" size="sm" onClick={o} disabled={pending}>
                Request a correction
              </Button>
            )}
          />
        )}
        {c.canRaiseConcern && (
          // Goes to the existing Support request; it doesn't hold the consent.
          <ButtonLink to="/family/support" variant="secondary" size="sm">
            Something not right? Tell your care team
          </ButtonLink>
        )}
        {c.canWithdraw && (
          <ConfirmDialog
            title="Withdraw this consent?"
            confirmLabel="Withdraw consent"
            error={error}
            tone="danger"
            trigger={(o) => (
              <Button variant="danger" size="sm" onClick={o} disabled={pending}>
                Withdraw consent
              </Button>
            )}
            onConfirm={() =>
              act(
                () => withdrawConsent({ data: { id: c.id } }),
                `Consent to share with ${c.recipientName} was withdrawn. ${REVOCATION_NOTE}`,
              )
            }
          >
            <p>
              Nothing more will be released to <strong>{c.recipientName}</strong> through Zeporah, and
              anything waiting is held.
            </p>
            <p>{REVOCATION_NOTE}</p>
          </ConfirmDialog>
        )}
        {c.canAskToWithdraw && (
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() =>
              act(
                () => askToWithdrawConsent({ data: { id: c.id } }),
                "Escalation created in the care-team queue. A person decides whether and how to follow up.",
              )
            }
          >
            Ask the care team to withdraw this
          </Button>
        )}
      </div>
    </Card>
  );
}
