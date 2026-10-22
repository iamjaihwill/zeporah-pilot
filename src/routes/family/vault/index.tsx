import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { addVaultItem, getVault, setVaultAudience } from "@/functions/family";
import { isDenied, unwrap, useAction } from "@/lib/client";
import {
  Stamp,
  Badge,
  Button,
  ButtonLink,
  Card,
  ChoiceGroup,
  ConfirmDialog,
  DeniedView,
  EmptyState,
  ErrorText,
  Field,
  Notice,
  PageHeader,
  StateBadge,
  inputClass,
} from "@/components/ui";
import { VAULT_STATUSES, VAULT_STATUS_LABELS } from "@/domain/model";
import { AUTHORITY_STATUS_NOTE } from "@/domain/authority-identity";

export const Route = createFileRoute("/family/vault/")({
  loader: async () => unwrap(await getVault()),
  component: Vault,
});

function Vault() {
  const v = Route.useLoaderData();
  if (isDenied(v)) return <DeniedView d={v} back={<ButtonLink to="/family">Back to home</ButtonLink>} />;
  const counts = VAULT_STATUSES.map((s) => [s, v.items.filter((i) => i.status === s).length] as const);
  return (
    <>
      <PageHeader
        eyebrow="Vault"
        title="What exists, and where it's kept"
        lede="A plain record of important papers and their status. Zeporah keeps track of them — it never stores the documents, clinical records or legal originals."
        actions={
          <ButtonLink to="/family" variant="secondary">
            Back to home
          </ButtonLink>
        }
      />
      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map(([s, n]) => (
          <div key={s} className="rounded-xl border bg-surface p-3">
            <dt className="text-sm text-ink-soft">{VAULT_STATUS_LABELS[s]}</dt>
            <dd className="font-display text-2xl" data-testid={`vault-count-${s}`}>
              {n}
            </dd>
          </div>
        ))}
      </dl>
      {v.items.length === 0 && (
        <EmptyState title="Nothing in the vault is shared with you yet.">
          Items appear here when someone makes them visible to the household or shares them with you.
        </EmptyState>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {v.items.map((i) => (
          <Card as="li" key={i.id}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg">{i.title}</h2>
              <StateBadge state={i.status} />
            </div>
            <p className="mt-1 text-sm text-ink-soft">{i.description}</p>
            {i.keptWhere && <p className="mt-2 text-sm">Kept: {i.keptWhere}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm" data-testid="vault-audience">
                <span className="text-ink-soft">Who can see it:</span> {i.audienceLabel}
              </span>
              {i.reviewedAt && (
                <Badge tone="neutral">
                  {i.reviewedBy ? `Reviewed by ${i.reviewedBy.split(" ")[0]}` : "Reviewed"}{" "}
                  <Stamp at={i.reviewedAt} />
                </Badge>
              )}
            </div>
            {i.canChangeAudience && (
              <div className="mt-3">
                <AudienceDialog
                  item={{
                    id: i.id,
                    title: i.title,
                    audience: i.audience,
                    sharedWith: i.sharedWith ?? [],
                    mine: i.mine,
                  }}
                  members={v.members}
                />
              </div>
            )}
            {v.canReview && (
              <ButtonLink
                className="mt-4"
                to="/family/vault/$itemId"
                params={{ itemId: i.id }}
                search={{ from: "vault" }}
                variant="secondary"
                size="sm"
              >
                {i.status === "needs_review" ? "Review" : "Update"}
              </ButtonLink>
            )}
          </Card>
        ))}
      </ul>
      {v.canAdd && <AddItem members={v.members} />}
      <div className="mt-6">
        <Notice tone="quiet" title="About protected items">
          <p>
            {v.protectedAccess
              ? "You can see protected items because of your role or an active authority workflow."
              : "Some items are protected and only visible to the patient or to someone with an active, reviewed authority workflow. Coordinating the household doesn't by itself open them."}
          </p>
          <p className="mt-1">{AUTHORITY_STATUS_NOTE}</p>
        </Notice>
      </div>
    </>
  );
}

type Audience = "private" | "selected" | "household" | "staff";
type Member = { actorId: string; name: string };

const AUDIENCE_OPTIONS = (mine: boolean): { value: Audience; label: string; hint: string }[] => [
  ...(mine ? [{ value: "private" as const, label: "Private to me", hint: "Only you." }] : []),
  {
    value: "selected",
    label: "Shared with selected people",
    hint: "Only the people you pick. Not the care team.",
  },
  {
    value: "household",
    label: "Visible to the household",
    hint: "Everyone in the household, and your care team.",
  },
  {
    value: "staff",
    label: "Shared with staff",
    hint: "The patient, coordinator and proxy, and your care team.",
  },
];

function PeoplePicker({
  members,
  value,
  onChange,
}: {
  members: Member[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="font-medium">Who to share it with</legend>
      <p className="text-sm text-ink-soft">You're always included.</p>
      {members.map((m) => (
        <label key={m.actorId} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.includes(m.actorId)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, m.actorId] : value.filter((x) => x !== m.actorId))
            }
          />
          {m.name}
        </label>
      ))}
    </fieldset>
  );
}

/** Decision 43: changing who sees an item is confirmed and audit-logged. */
function AudienceDialog({
  item,
  members,
}: {
  item: { id: string; title: string; audience: Audience; sharedWith: string[]; mine: boolean };
  members: Member[];
}) {
  const [audience, setAudience] = useState<Audience>(item.audience);
  const [shared, setShared] = useState<string[]>(item.sharedWith);
  const { act, pending, error } = useAction();
  const label = AUDIENCE_OPTIONS(item.mine).find((o) => o.value === audience)?.label ?? "";
  return (
    <ConfirmDialog
      title={`Change who can see “${item.title}”?`}
      confirmLabel="Change who can see it"
      disabled={pending || (audience === "selected" && shared.length === 0 && !item.mine)}
      error={error}
      trigger={(open) => (
        <Button size="sm" variant="secondary" onClick={open}>
          Change who can see it…<span className="sr-only">: {item.title}</span>
        </Button>
      )}
      onConfirm={() =>
        act(
          () =>
            setVaultAudience({
              data: { id: item.id, audience, sharedWith: audience === "selected" ? shared : [] },
            }),
          "Who can see it was changed.",
        )
      }
    >
      <ChoiceGroup
        legend="Who can see it"
        name={`audience-${item.id}`}
        value={audience}
        onChange={setAudience}
        options={AUDIENCE_OPTIONS(item.mine)}
      />
      {audience === "selected" && <PeoplePicker members={members} value={shared} onChange={setShared} />}
      <p className="text-sm">
        It will be: <strong>{label}</strong>. This is recorded. Zeporah never stores the document itself.
      </p>
    </ConfirmDialog>
  );
}

function AddItem({ members }: { members: Member[] }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ title: "", keptWhere: "" });
  const [audience, setAudience] = useState<Audience | null>(null);
  const [shared, setShared] = useState<string[]>([]);
  const { act, pending, error } = useAction();
  if (!open)
    return (
      <div className="mt-6">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Add an item
        </Button>
      </div>
    );
  return (
    <Card className="mt-6" title="Add an item">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!audience) return;
          const r = await act(
            () =>
              addVaultItem({ data: { ...v, audience, sharedWith: audience === "selected" ? shared : [] } }),
            "Item added.",
          );
          if (r) {
            setOpen(false);
            setV({ title: "", keptWhere: "" });
            setAudience(null);
          }
        }}
      >
        <p className="text-sm text-ink-soft">
          A name and where it's kept — never the document. You choose who can see it; nothing is assumed.
        </p>
        <Field label="What it is">
          {(id) => (
            <input
              id={id}
              required
              maxLength={120}
              className={inputClass}
              value={v.title}
              onChange={(e) => setV({ ...v, title: e.target.value })}
            />
          )}
        </Field>
        <Field label="Where it's kept (optional)">
          {(id) => (
            <input
              id={id}
              maxLength={200}
              className={inputClass}
              value={v.keptWhere}
              onChange={(e) => setV({ ...v, keptWhere: e.target.value })}
            />
          )}
        </Field>
        <ChoiceGroup
          legend="Who can see it"
          name="new-item-audience"
          required
          value={audience}
          onChange={setAudience}
          options={AUDIENCE_OPTIONS(true)}
        />
        {audience === "selected" && <PeoplePicker members={members} value={shared} onChange={setShared} />}
        <ErrorText error={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || !audience || !v.title.trim()}>
            Add item
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
