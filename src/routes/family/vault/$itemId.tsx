import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { getVaultItem, reviewVaultItem, undoVaultReview } from "@/functions/family";
import { announce, isDenied, pausedOffline, unwrap, useAction } from "@/lib/client";
import {
  Button,
  ButtonLink,
  Card,
  ChoiceGroup,
  DeniedView,
  ErrorText,
  Field,
  PageHeader,
  StateBadge,
  Visibility,
  inputClass,
} from "@/components/ui";
import { type VaultStatus } from "@/domain/model";

export const Route = createFileRoute("/family/vault/$itemId")({
  validateSearch: z.object({ from: z.enum(["vault", "onboarding", "home"]).optional() }),
  loader: async ({ params }) => unwrap(await getVaultItem({ data: { id: params.itemId } })),
  component: Item,
});

function Item() {
  const r = Route.useLoaderData();
  const { from = "vault" } = Route.useSearch();
  const navigate = useNavigate();
  const back = () =>
    from === "onboarding"
      ? navigate({ to: "/family/onboarding", search: { step: "vault_review" } })
      : from === "home"
        ? navigate({ to: "/family" })
        : navigate({ to: "/family/vault" });
  const backLabel =
    from === "onboarding" ? "Back to setup" : from === "home" ? "Back to home" : "Back to vault";
  if (isDenied(r))
    return <DeniedView d={r} back={<ButtonLink to="/family/vault">Back to vault</ButtonLink>} />;
  return <Form key={r.item.id} item={r.item} canReview={r.canReview} back={back} backLabel={backLabel} />;
}

function Form({
  item,
  canReview,
  back,
  backLabel,
}: {
  item: {
    id: string;
    title: string;
    description: string;
    status: string;
    keptWhere: string | null;
    sensitivity: string;
  };
  canReview: boolean;
  back: () => Promise<void> | void;
  backLabel: string;
}) {
  // Nothing is pre-selected for an item nobody has decided on yet — especially sensitive ones like
  // funeral wishes (interaction review, item 10). A person's earlier choice is shown as it was.
  const [status, setStatus] = useState<VaultStatus | null>(
    item.status === "needs_review" ? null : (item.status as VaultStatus),
  );
  const [missing, setMissing] = useState(false);
  const [kept, setKept] = useState(item.keptWhere ?? "");
  const { act, pending, sending, error } = useAction();
  const router = useRouter();
  return (
    <>
      <PageHeader eyebrow="Vault item" title={item.title} lede={item.description} />
      <div className="mb-6 flex flex-wrap gap-2">
        <StateBadge state={item.status} />
        <Visibility who={item.sensitivity === "protected" ? "protected" : "vault"} />
      </div>
      <Card>
        {canReview ? (
          <form
            className="space-y-6"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!status) {
                setMissing(true);
                document.getElementById("status-choice")?.querySelector("input")?.focus();
                return;
              }
              const ok = await act(() =>
                reviewVaultItem({ data: { id: item.id, status, keptWhere: kept || undefined } }),
              );
              if (!ok) return;
              await back();
              // Raised after arriving back, so the note isn't cleared by the navigation (item 4).
              announce("Saved.", "done", {
                run: async () => {
                  if (pausedOffline()) return false;
                  const u = await undoVaultReview({ data: { id: item.id } });
                  await router.invalidate();
                  if (!u.ok) announce(u.message, "problem");
                  return u.ok;
                },
              });
            }}
          >
            <div id="status-choice">
              <ChoiceGroup
                legend="What do you know about this?"
                hint="Choose one."
                name="status"
                value={status}
                onChange={(v) => {
                  setStatus(v);
                  setMissing(false);
                }}
                options={[
                  { value: "reviewed", label: "We have it", hint: "Note where it's kept below." },
                  {
                    value: "not_available",
                    label: "We haven't found it yet",
                    hint: "That's fine. It stays on the list.",
                  },
                  { value: "not_applicable", label: "This doesn't apply to us" },
                  { value: "needs_review", label: "Come back to this later" },
                ]}
              />
              {missing && <ErrorText error="Choose what you know about this before saving." />}
            </div>
            <Field
              label="Where is it kept? (optional)"
              hint="For example “kitchen drawer, blue folder”. Don't type account numbers or document contents."
            >
              {(id, d) => (
                <input
                  id={id}
                  aria-describedby={d}
                  className={inputClass}
                  value={kept}
                  onChange={(e) => setKept(e.target.value)}
                  maxLength={200}
                />
              )}
            </Field>
            <ErrorText error={error} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                {sending ? "Saving…" : "Save"}
              </Button>
              <Button variant="secondary" onClick={back}>
                {backLabel}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p className="text-ink-soft">Your role can see this item but not change it.</p>
            <Button className="mt-4" variant="secondary" onClick={back}>
              {backLabel}
            </Button>
          </>
        )}
      </Card>
    </>
  );
}
