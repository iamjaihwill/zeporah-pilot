import { StaffPending } from "@/components/staff/pending";
import { StaffPageHeader } from "@/components/staff";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getReviewQueue } from "@/functions/staff";
import { ActivateConsentButton } from "@/components/staff/queue-detail";
import { isDenied, unwrap, useAction } from "@/lib/client";
import {
  Stamp,
  Button,
  Card,
  DeniedView,
  EmptyState,
  ErrorText,
  Notice,
  PageHeader,
  StateBadge,
} from "@/components/ui";

export const Route = createFileRoute("/staff/reviews")({
  loader: async () => unwrap(await getReviewQueue()),
  component: Reviews,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

function Reviews() {
  const q = Route.useLoaderData();
  const { act, pending, error } = useAction();
  if (isDenied(q)) return <DeniedView d={q} />;
  return (
    <>
      <StaffPageHeader
        title="Reviews"
        description="Authority evidence and consents waiting for a reviewer."
      />
      <div className="mb-6">
        <Notice tone="quiet">
          Reviews record workflow status. They are not legal determinations, and Zeporah never chooses between
          people named in conflicting records.
        </Notice>
      </div>
      <ErrorText error={error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Authority evidence">
          {q.authority.length === 0 ? (
            <EmptyState title="Nothing waiting" />
          ) : (
            <ul className="divide-y">
              {q.authority.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-medium">
                      {a.holderName} · {a.type}
                    </p>
                    <p className="text-sm text-ink-soft">
                      {a.household} · updated <Stamp at={a.updatedAt} full />
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    <StateBadge state={a.state} />
                    <Link
                      to="/staff/households/$householdId"
                      params={{ householdId: a.householdId }}
                      search={{ tab: "sharing" }}
                      className="text-sm text-harbor underline"
                    >
                      Review
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Consents not yet active">
          {q.consents.length === 0 ? (
            <EmptyState title="Nothing waiting" />
          ) : (
            <ul className="divide-y">
              {q.consents.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-medium">{c.recipientName}</p>
                    <p className="text-sm text-ink-soft">
                      {c.purpose} · {c.household}
                    </p>
                    <p className="mt-1">
                      <StateBadge state={c.stage} label={c.stageLabel} wrap />
                    </p>
                    {c.recordedByMe && c.stage === "awaiting_activation" && (
                      <p className="mt-1 text-xs text-ink-soft">
                        You recorded this consent, so a different reviewer must activate it.
                      </p>
                    )}
                  </div>
                  {c.canActivate ? (
                    // Item 18: activation confirms first, restating the consent.
                    <ActivateConsentButton
                      consentId={c.id}
                      householdId={c.householdId}
                      label={c.recipientName}
                    />
                  ) : (
                    <Link
                      to="/staff/households/$householdId"
                      params={{ householdId: c.householdId }}
                      search={{ tab: "sharing" }}
                      className="text-sm text-harbor underline"
                    >
                      Open
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
