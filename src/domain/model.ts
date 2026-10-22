/**
 * Core vocabulary shared by the server, the UI and the tests.
 * Everything here is plain data — no I/O — so it can be tested directly.
 */

/** Roles a person can hold inside one household. */
export const HOUSEHOLD_ROLES = ["patient", "coordinator", "family_member", "proxy", "helper"] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

/** Roles a person can hold inside one hospice organization. */
export const STAFF_ROLES = ["care_guide", "hospice_ops", "privileged_reviewer", "hospice_admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** A named outside recipient of one released packet, read-only (founder decision 45). */
export const EXTERNAL_ROLES = ["external_recipient"] as const;
export type ExternalRole = (typeof EXTERNAL_ROLES)[number];

export type RoleCode = HouseholdRole | StaffRole | ExternalRole;

export const ACTOR_KINDS = ["family", "staff", "recipient"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * Household lifecycle. Moving to `bereavement` is always an explicit, staff-confirmed transition —
 * never inferred from time passing or from a partner record.
 */
export const LIFECYCLE_STATES = ["enrolled", "active_hospice", "bereavement", "closed"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** The four linked onboarding steps. */
export const ONBOARDING_STEPS = ["preferences", "trusted_contacts", "communication", "vault_review"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Categories of information that a consent may cover and a packet may carry.
 * Packets are built from categories, never from free-form record dumps.
 */
export const SHARE_CATEGORIES = [
  "contact_details",
  "care_coordination_summary",
  "visit_schedule",
  "vault_status",
  "authority_status",
  "bereavement_contact",
] as const;
export type ShareCategory = (typeof SHARE_CATEGORIES)[number];

export const SHARE_CATEGORY_LABELS: Record<ShareCategory, string> = {
  contact_details: "Household contact details",
  care_coordination_summary: "Care coordination summary (non-clinical)",
  visit_schedule: "Visit schedule",
  vault_status: "Which documents exist and where they are kept (not the documents)",
  authority_status: "Authority workflow status (not a legal determination)",
  bereavement_contact: "Bereavement support contact",
};

/** Categories that stop being shareable once a household moves to bereavement. */
export const CARE_PERIOD_ONLY: readonly ShareCategory[] = ["care_coordination_summary", "visit_schedule"];

export const AUTHORITY_TYPES = [
  "healthcare_agent",
  "guardian",
  "personal_representative",
  "patient_designated_proxy",
] as const;
export type AuthorityType = (typeof AUTHORITY_TYPES)[number];

export const AUTHORITY_TYPE_LABELS: Record<AuthorityType, string> = {
  healthcare_agent: "Healthcare agent",
  guardian: "Guardian",
  personal_representative: "Personal representative (after death)",
  patient_designated_proxy: "Patient-designated proxy",
};

/** Authority types that only apply while the patient is living. */
export const ENDS_AT_DEATH: readonly AuthorityType[] = [
  "healthcare_agent",
  "patient_designated_proxy",
  "guardian",
];

/**
 * Authority evidence is tracked as a workflow state. None of these states is a legal determination.
 */
export const AUTHORITY_STATES = [
  "not_submitted",
  "review_pending",
  "workflow_active",
  "conflict",
  "superseded",
  "withdrawn",
] as const;
export type AuthorityState = (typeof AUTHORITY_STATES)[number];

export const CONSENT_STATES = ["draft", "active", "revoked", "expired"] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

export const PACKET_STATES = ["draft", "held", "released", "denied", "revoked"] as const;
export type PacketState = (typeof PACKET_STATES)[number];

export const VAULT_STATUSES = ["needs_review", "reviewed", "not_available", "not_applicable"] as const;
export type VaultStatus = (typeof VAULT_STATUSES)[number];

export const VAULT_STATUS_LABELS: Record<VaultStatus, string> = {
  needs_review: "Needs a look",
  reviewed: "Reviewed",
  not_available: "Not found yet",
  not_applicable: "Doesn't apply",
};

/** Protected items are hidden — not just locked — from anyone without access. */
export const SENSITIVITY = ["standard", "protected"] as const;
export type Sensitivity = (typeof SENSITIVITY)[number];

export const AUDIT_VISIBILITY = ["family", "sharing", "protected", "staff"] as const;
/**
 * Who may see an audit event on a timeline. `family`: every household member. `sharing`: household
 * members who can view consents. `protected`: household members with protected access. `staff`:
 * the care team only. The care team sees every level.
 */
export type AuditVisibility = (typeof AUDIT_VISIBILITY)[number];

export const ROLE_LABELS: Record<RoleCode, string> = {
  patient: "Patient",
  coordinator: "Household coordinator",
  family_member: "Family member",
  proxy: "Proxy",
  helper: "Helper",
  care_guide: "Care guide",
  hospice_ops: "Hospice operations",
  privileged_reviewer: "Authority/consent reviewer",
  hospice_admin: "Hospice administrator",
  external_recipient: "Named external recipient",
};

export const ROLE_EXPLANATIONS: Record<RoleCode, string> = {
  patient:
    "The person receiving hospice care. Their wishes come first, and they can see everything about their own care coordination.",
  coordinator:
    "Organizes the household's tasks, people and preferences. Coordinating does not by itself give access to protected information or legal authority.",
  family_member: "Sees updates and tasks shared with the household. Does not see protected items.",
  proxy:
    "Someone the patient or household named to help act for them. Protected access opens only while an authority workflow for them is active — that is a workflow state, not a legal determination.",
  helper:
    "Someone helping with one task. Sees that task and what it needs to get done — not the household, its messages or its vault — until the task is done or their access ends.",
  care_guide: "Hospice staff member who coordinates with the household and writes family-visible updates.",
  hospice_ops:
    "Hospice operations staff with a limited operational view of queues, enrollment and workflow issues. Can release a reviewed packet only when every policy check passes.",
  privileged_reviewer:
    "Hospice staff member who reviews authority evidence and consent records. A review records a workflow decision, not a legal one.",
  hospice_admin:
    "Hospice staff member who manages staff roles, organization settings, security and access controls. Doesn't work on households.",
  external_recipient:
    "A named outside recipient of one released packet. Reads it in Zeporah, read-only, until the release ends.",
};

/** Kinds of support a household can ask for (Support page and the patient's own view). */
export const SUPPORT_CATEGORIES = [
  ["practical_caregiver_support", "Practical help at home"],
  ["respite", "A break for the main caregiver"],
  ["social_worker", "Talking with a social worker"],
  ["spiritual_care", "Chaplain or spiritual care"],
  ["bereavement_support", "Grief and bereavement support"],
  ["benefits_questions", "Benefits or paperwork questions"],
] as const;
