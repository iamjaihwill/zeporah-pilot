import { authorityAppliesIn } from "./lifecycle";
import type { AuthorityType, HouseholdRole, LifecycleState } from "./model";

/**
 * Consent moves through three required stages:
 *   1. a care-team member records the proposed consent (version 1, or a new version after any change);
 *   2. the named household grantor confirms that exact version in the app;
 *   3. a different person with the reviewer permission activates it.
 * Only then is it active. Any material change starts again at stage 2.
 */

/** Shown to the grantor and stored with every confirmation. */
export const CONSENT_CONFIRMATION_STATEMENT =
  "I confirm this sharing: the named recipient may receive only the listed information, for the stated purpose, between the dates shown. I understand I can withdraw it at any time.";

export const CONSENT_CONFIRMATION_METHOD = "in-app self-confirmation";

/**
 * Authority workflows that explicitly allow their holder to confirm consent for the household,
 * while the workflow is active and applies at the household's current stage. Holding a household
 * role alone never allows it.
 */
export const CONSENT_CONFIRMING_AUTHORITY: readonly AuthorityType[] = [
  "healthcare_agent",
  "guardian",
  "patient_designated_proxy",
  "personal_representative",
];

/**
 * Can this named grantor confirm a consent themselves in the app? The patient can while they are
 * an active member and the household isn't in bereavement (capacity is never inferred). Anyone else
 * needs an active authority workflow, linked to them, that permits it at this stage. If not,
 * the consent is held and routed to human review — never auto-confirmed.
 */
export function canSelfConfirm(input: {
  roles: readonly HouseholdRole[];
  lifecycle: LifecycleState;
  activeAuthorityTypes: readonly AuthorityType[];
}): boolean {
  if (input.lifecycle === "closed") return false;
  if (input.roles.includes("patient") && input.lifecycle !== "bereavement") return true;
  return input.activeAuthorityTypes.some(
    (t) => CONSENT_CONFIRMING_AUTHORITY.includes(t) && authorityAppliesIn(t, input.lifecycle),
  );
}

/**
 * Why a named person can't confirm in the app, in plain words for staff — or null if they can.
 * Mirrors canSelfConfirm; never infers capacity.
 */
export function selfConfirmBlocker(input: {
  member: boolean;
  roles: readonly HouseholdRole[];
  lifecycle: LifecycleState;
  activeAuthorityTypes: readonly AuthorityType[];
}): string | null {
  if (!input.member) return "They aren't a current member of this household.";
  if (input.lifecycle === "closed") return "This household's workspace is closed.";
  if (canSelfConfirm(input)) return null;
  if (input.roles.includes("patient") && input.lifecycle === "bereavement")
    return "The patient's own access has ended.";
  if (input.activeAuthorityTypes.length)
    return "Their authority workflow doesn't allow confirming consent at this stage of care.";
  return "Being in the household isn't enough: they need an active authority workflow that allows confirming consent.";
}

/** Why someone might ask for a consent to be corrected. "Something else" pairs with optional words. */
export const CORRECTION_CATEGORIES = ["recipient", "purpose", "scope", "dates", "person", "other"] as const;
export type CorrectionCategory = (typeof CORRECTION_CATEGORIES)[number];
export const CORRECTION_CATEGORY_LABELS: Record<CorrectionCategory, string> = {
  recipient: "Who receives it",
  purpose: "Why it's being shared",
  scope: "What's included",
  dates: "The dates",
  person: "The person named as giving consent",
  other: "Something else",
};

export type ConsentStage =
  | "awaiting_confirmation"
  | "needs_review"
  | "awaiting_activation"
  | "active"
  | "scheduled"
  | "revoked"
  | "expired";

/** Where a consent is in its workflow. Only `active` (or `scheduled`, once started) can support a release. */
export function consentStage(c: {
  state: string;
  version: number;
  activatedVersion: number | null;
  confirmedVersion: number | null;
  startsAt: Date;
  expiresAt: Date;
  grantorCanConfirm: boolean;
  now?: Date;
}): ConsentStage {
  const now = c.now ?? new Date();
  if (c.state === "revoked") return "revoked";
  if (c.state === "expired" || c.expiresAt.getTime() <= now.getTime()) return "expired";
  const confirmed = c.confirmedVersion === c.version;
  if (c.state === "active" && confirmed && c.activatedVersion === c.version)
    return c.startsAt.getTime() > now.getTime() ? "scheduled" : "active";
  if (!confirmed) return c.grantorCanConfirm ? "awaiting_confirmation" : "needs_review";
  return "awaiting_activation";
}

export const CONSENT_STAGE_LABELS: Record<ConsentStage, string> = {
  awaiting_confirmation: "Waiting for household confirmation",
  needs_review: "Held — the named person can't confirm in the app; a person on the care team must review",
  awaiting_activation: "Confirmed — waiting for a reviewer to activate",
  active: "Active",
  scheduled: "Confirmed and activated — starts later",
  revoked: "Withdrawn",
  expired: "Ended",
};
