import { ENDS_AT_DEATH, type AuthorityType, type HouseholdRole, type LifecycleState } from "./model";

/** Allowed household lifecycle transitions. Anything else is refused. */
const TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  enrolled: ["active_hospice", "bereavement"],
  active_hospice: ["bereavement"],
  bereavement: ["closed"],
  closed: [],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

export const LIFECYCLE_LABELS: Record<LifecycleState, string> = {
  enrolled: "Getting started",
  active_hospice: "Receiving hospice care",
  bereavement: "Bereavement support",
  closed: "Closed",
};

/** Is an authority type still meaningful in this lifecycle state? */
export function authorityAppliesIn(type: AuthorityType, lifecycle: LifecycleState): boolean {
  if (lifecycle === "closed") return false;
  if (lifecycle === "bereavement") return !ENDS_AT_DEATH.includes(type);
  return type !== "personal_representative";
}

/**
 * Who may see protected household items. Household roles alone never open protected access:
 * the patient sees their own (while living), and anyone else needs an authority workflow that is
 * active *and* applies in the current lifecycle state. This is a workflow rule, not a legal one.
 */
export function hasProtectedAccess(input: {
  roles: readonly HouseholdRole[];
  lifecycle: LifecycleState;
  activeAuthorityTypes: readonly AuthorityType[];
}): boolean {
  if (input.lifecycle === "closed") return false;
  if (input.roles.includes("patient") && input.lifecycle !== "bereavement") return true;
  return input.activeAuthorityTypes.some((t) => authorityAppliesIn(t, input.lifecycle));
}
