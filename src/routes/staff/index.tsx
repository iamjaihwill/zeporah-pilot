import { HandoffsForMe } from "@/components/staff/coverage";
import { WidgetGrid } from "@/components/staff/command-center";
import { getMyHandoffs } from "@/functions/staff-shell";
import { StaffPending } from "@/components/staff/pending";
import { GettingStarted } from "@/components/staff/guide";
import { getGuide } from "@/functions/staff-shell";
import { withGuide } from "@/lib/guide";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getStaffHome } from "@/functions/staff";
import { isDenied, unwrap } from "@/lib/client";
import { DeniedView, EmptyState } from "@/components/ui";
import { ReplyTimeMissing } from "@/components/expectation";
import { StaffPageHeader } from "@/components/staff";

/**
 * "My work": each role's home (decision 58, workstream 4). Widgets built from the exceptions the
 * person sees: a number that opens its list, and the three oldest items. Read-only; work happens in
 * Exceptions, the record or the workflow. Handoffs offered to me and the getting-started guide sit
 * above them.
 */
export const Route = createFileRoute("/staff/")({
  loader: async ({ parentMatchPromise }) => {
    // Administrators have no household work (decision 39): their landing page is Team & coverage.
    const parent = await parentMatchPromise;
    const roles = parent.loaderData?.me.roleCodes ?? [];
    if (roles.length && roles.every((r) => r === "hospice_admin")) throw redirect({ to: "/staff/admin" });
    const [home, guide, handoffs] = await Promise.all([getStaffHome(), getGuide(), getMyHandoffs()]);
    const page = withGuide(unwrap(home), guide);
    // Households offered to me (decision 58, workstream 3): names and notes only, until I accept.
    return isDenied(page) ? page : { ...page, handoffs: handoffs.ok ? handoffs.data : [] };
  },
  component: MyWork,
  // Staff rework, section 7: a skeleton instead of a blank page while it loads.
  pendingComponent: StaffPending,
});

function MyWork() {
  const h = Route.useLoaderData();
  if (isDenied(h)) return <DeniedView d={h} />;
  if (h.unassigned)
    return (
      <>
        <StaffPageHeader title="My work" />
        {"guide" in h && h.guide && <GettingStarted guide={h.guide} />}
        <HandoffsForMe items={h.handoffs} />
        <EmptyState title="You aren't assigned to any households yet">
          Hospice operations assigns households to care guides. Until then you won't see any household's
          people, messages, tasks or records.
        </EmptyState>
      </>
    );
  const roleNote: Record<string, string> = {
    care_guide: "Your households: what needs you, what's due and what's waiting.",
    hospice_ops: "Across the hospice: what has no owner, coverage and what's waiting.",
    privileged_reviewer: "Reviews, consent and releases across the hospice.",
  };
  return (
    <>
      <StaffPageHeader title="My work" description={roleNote[h.center.role]} />
      <HandoffsForMe items={h.handoffs} />
      {h.replyTimeMissing && <ReplyTimeMissing />}
      {/* Decision 58, workstream 4: a number that opens its list, and the three oldest items. */}
      <WidgetGrid widgets={h.center.widgets} label="What needs attention" />
      {h.pilot && (
        <p className="mt-4 text-[0.75rem] text-ink-soft">
          Pilot: {h.pilot.enrolled} of {h.pilot.cap} households · setup complete {h.pilot.onboardingComplete}/
          {h.pilot.enrolled}
        </p>
      )}
    </>
  );
}
