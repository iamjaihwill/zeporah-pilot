import type { HouseholdRole, LifecycleState, RoleCode, StaffRole } from "./model";

/**
 * Every action the app can take, named. A permission that is not listed for a role is denied.
 * Holding a permission is necessary but never sufficient for protected sharing — packet release
 * also runs the policy evaluator (see ./policy/evaluate-release.ts).
 */
export const PERMISSIONS = [
  // household side
  "household.view",
  "tasks.view",
  "tasks.complete_assigned",
  "tasks.create",
  "updates.view",
  "updates.acknowledge",
  "thread.view",
  "thread.send",
  "people.view",
  "people.invite",
  "onboarding.complete",
  "vault.view",
  "vault.review",
  "consent.view",
  "bereavement.confirm_contact",
  "support.request",
  // staff side
  "staff.household.view",
  "staff.update.compose",
  "staff.thread.send",
  "staff.note.view",
  "staff.note.write",
  "staff.task.manage",
  "staff.escalation.manage",
  "authority.submit",
  "authority.review",
  "consent.record",
  "consent.activate",
  "consent.revoke_on_request",
  "packet.draft",
  "packet.release",
  "packet.revoke",
  "lifecycle.propose",
  "lifecycle.confirm",
  "audit.view",
  /** Download audit review as CSV (founder decision 28). */
  "audit.export",
  // organization settings
  "org.settings.manage",
  "staff.invite",
  "staff.assignment.manage",
  // Decisions 66 and 67: enrolling a household, and inviting its patient or coordinator.
  "household.enroll",
  "household.invite_first",
  // Decision 71: reviewing who opened household records.
  "access_log.view",
  // Decision 72: calling and confirming the 24-hour line.
  "contact_line.confirm",
  "staff.lifecycle.manage",
  /** Change a staff member's role, reactivate them, or invite into a role other than care guide (decisions 38–39). */
  "staff.role.manage",
  /** Organization, security and access settings: the 24-hour line, sender name, export controls (decision 39). */
  "org.admin.settings",
  /** Bulk assign or reassign tasks in households you cover, to eligible care guides (decision 40). */
  "staff.task.bulk_assign",
  /** Record what an outside organization said, staff-entered and labelled simulated (decision 60). */
  "partner_event.log",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const HOUSEHOLD_MATRIX: Record<HouseholdRole, readonly Permission[]> = {
  patient: [
    "household.view",
    "tasks.view",
    "tasks.complete_assigned",
    "tasks.create",
    "updates.view",
    "updates.acknowledge",
    "thread.view",
    "thread.send",
    "people.view",
    "people.invite",
    "vault.view",
    "vault.review",
    "consent.view",
    "support.request",
  ],
  coordinator: [
    "household.view",
    "tasks.view",
    "tasks.complete_assigned",
    "tasks.create",
    "updates.view",
    "updates.acknowledge",
    "thread.view",
    "thread.send",
    "people.view",
    "people.invite",
    "onboarding.complete",
    "vault.view",
    "vault.review",
    "consent.view",
    "bereavement.confirm_contact",
    "support.request",
  ],
  proxy: [
    "household.view",
    "tasks.view",
    "tasks.complete_assigned",
    "updates.view",
    "updates.acknowledge",
    "thread.view",
    "thread.send",
    "people.view",
    "vault.view",
    "vault.review",
    "consent.view",
    "bereavement.confirm_contact",
    "support.request",
  ],
  family_member: [
    "household.view",
    "tasks.view",
    "tasks.complete_assigned",
    "updates.view",
    "updates.acknowledge",
    "people.view",
    "support.request",
  ],
  // Task-only helpers (decision 42) get no household-wide permission at all: what they can see is
  // decided task by task in services/helpers.ts.
  helper: [],
};

const STAFF_MATRIX: Record<StaffRole, readonly Permission[]> = {
  care_guide: [
    "staff.household.view",
    "staff.update.compose",
    "staff.thread.send",
    "staff.note.view",
    "staff.note.write",
    "staff.task.manage",
    "staff.escalation.manage",
    "authority.submit",
    "consent.record",
    "packet.draft",
    "lifecycle.propose",
    "audit.view",
    "staff.task.bulk_assign",
    "partner_event.log",
    "household.invite_first",
  ],
  hospice_ops: [
    "staff.household.view",
    "staff.note.view",
    "staff.note.write",
    "staff.task.manage",
    "staff.escalation.manage",
    "consent.revoke_on_request",
    "packet.draft",
    "packet.release",
    "packet.revoke",
    "lifecycle.propose",
    "lifecycle.confirm",
    "audit.view",
    "audit.export",
    "org.settings.manage",
    "staff.invite",
    "staff.assignment.manage",
    "staff.lifecycle.manage",
    "partner_event.log",
    "household.enroll",
    "household.invite_first",
    "contact_line.confirm",
  ],
  privileged_reviewer: [
    "staff.household.view",
    "staff.note.view",
    "staff.note.write",
    "authority.review",
    "consent.record",
    "consent.activate",
    "consent.revoke_on_request",
    "packet.release",
    "packet.revoke",
    "staff.escalation.manage",
    "audit.view",
    "audit.export",
    "access_log.view",
  ],
  // Decision 39: roles, organization and access settings. No household work: no household records,
  // queue, consent or packets. Sees the team roster and the audit trail.
  hospice_admin: [
    "audit.view",
    "audit.export",
    "org.settings.manage",
    "org.admin.settings",
    "staff.invite",
    "staff.assignment.manage",
    "staff.lifecycle.manage",
    "staff.role.manage",
    // Decision 66: enrolls, and then sees the household's name only (coverage).
    "household.enroll",
    "access_log.view",
    "contact_line.confirm",
  ],
};

/** Permissions that close for the whole household once it is closed. */
const CLOSED_ALLOWED: readonly Permission[] = [
  "household.view",
  "updates.view",
  "people.view",
  "audit.view",
  "staff.household.view",
  "staff.note.view",
];

/** Household roles that stop applying at bereavement (the patient's own membership ends). */
const ENDS_AT_BEREAVEMENT: readonly HouseholdRole[] = ["patient"];

export function roleAllows(role: RoleCode, permission: Permission): boolean {
  if (role in HOUSEHOLD_MATRIX) return HOUSEHOLD_MATRIX[role as HouseholdRole].includes(permission);
  if (role in STAFF_MATRIX) return STAFF_MATRIX[role as StaffRole].includes(permission);
  return false; // external_recipient and anything unknown: default deny
}

/**
 * Does any of these roles allow the permission, given the household's lifecycle?
 * `roles` must already be scoped to the right tenant and household by the caller.
 */
export function can(roles: readonly RoleCode[], permission: Permission, lifecycle?: LifecycleState): boolean {
  const live =
    lifecycle === "bereavement"
      ? roles.filter((r) => !ENDS_AT_BEREAVEMENT.includes(r as HouseholdRole))
      : roles;
  if (lifecycle === "closed" && !CLOSED_ALLOWED.includes(permission)) return false;
  return live.some((r) => roleAllows(r, permission));
}

export function permissionsFor(role: RoleCode): readonly Permission[] {
  if (role in HOUSEHOLD_MATRIX) return HOUSEHOLD_MATRIX[role as HouseholdRole];
  if (role in STAFF_MATRIX) return STAFF_MATRIX[role as StaffRole];
  return [];
}
