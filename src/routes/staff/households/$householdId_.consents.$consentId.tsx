import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * A shareable link to one consent inside its household (staff rework, section 5; interaction
 * review item 17). It opens the household's Authority & consent tab, which scrolls to and
 * highlights the consent. Access is decided there, by the household's own checks: this route only
 * redirects and reveals nothing itself.
 */
export const Route = createFileRoute("/staff/households/$householdId_/consents/$consentId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/staff/households/$householdId",
      params: { householdId: params.householdId },
      search: { tab: "sharing" },
      hash: `consent-${params.consentId}`,
      replace: true,
    });
  },
});
