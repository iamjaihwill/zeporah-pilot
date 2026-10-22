/**
 * Whether two authority records name the same person is decided only from linked household
 * people — never from how a name is spelled. If either record isn't linked to a verified person,
 * the answer is "unknown" and a person on the care team must review it. A link is a workflow
 * association, not a legal determination.
 */
export type HolderComparison = "same" | "different" | "unknown";

export function compareHolders(
  a: { holderActorId: string | null },
  b: { holderActorId: string | null },
): HolderComparison {
  if (!a.holderActorId || !b.holderActorId) return "unknown";
  return a.holderActorId === b.holderActorId ? "same" : "different";
}

export const IDENTITY_LINK_BASES = [
  "submitted_evidence",
  "household_confirmation",
  "reviewer_documented",
] as const;
export type IdentityLinkBasis = (typeof IDENTITY_LINK_BASES)[number];

export const IDENTITY_LINK_BASIS_LABELS: Record<IdentityLinkBasis, string> = {
  submitted_evidence: "Named in the submitted evidence",
  household_confirmation: "Confirmed by the household",
  reviewer_documented: "Reviewer's documented basis",
};

export const AUTHORITY_STATUS_NOTE = "This is a workflow status, not a legal determination.";

const LIVE = ["workflow_active", "review_pending", "conflict"];

export type EffectiveAuthorityState =
  | "not_submitted"
  | "review_pending"
  | "workflow_active"
  | "conflict"
  | "superseded"
  | "withdrawn"
  | "identity_unresolved";

type Ev = { id: string; authorityType: string; state: string; holderActorId: string | null };

/**
 * The state that sharing and protected access should act on, given every authority record in the
 * household. Fails closed: a different-person conflict wins; otherwise any record of the same type
 * whose holder can't be compared (not linked to a verified person) leaves identity unresolved.
 */
export function effectiveAuthorityState(ev: Ev, householdEvidence: readonly Ev[]): EffectiveAuthorityState {
  if (!LIVE.includes(ev.state)) return ev.state as EffectiveAuthorityState;
  const rivals = householdEvidence.filter(
    (s) => s.id !== ev.id && s.authorityType === ev.authorityType && LIVE.includes(s.state),
  );
  if (
    ev.state === "conflict" ||
    rivals.some((s) => s.state === "conflict" && compareHolders(ev, s) === "different")
  )
    return "conflict";
  if (!ev.holderActorId || rivals.some((s) => compareHolders(ev, s) === "unknown"))
    return "identity_unresolved";
  return ev.state as EffectiveAuthorityState;
}
