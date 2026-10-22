/**
 * One status vocabulary for the staff workspace (staff rework, section 4). Every status the app
 * stores or derives maps to a label, a tone and an optional icon, and every staff screen renders
 * statuses through StatusChip (components/staff/status-chip.tsx) using this map — never a raw code.
 *
 * Each domain is typed against its source enum, so adding a value without a mapping fails the
 * typecheck; tests/unit/status-map.test.ts also checks the runtime arrays.
 */
import type * as schema from "@/server/db/schema";
import type { ConsentStage } from "./consent";
import {
  AUTHORITY_STATES,
  LIFECYCLE_STATES,
  PACKET_STATES,
  VAULT_STATUSES,
  type AuthorityState,
  type LifecycleState,
  type PacketState,
  type VaultStatus,
} from "./model";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export type StatusDef = { label: string; tone: Tone; icon?: "dot" | "check" | "alert" | "clock" | "lock" };

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];
type EscalationStatus = Row<typeof schema.escalations>["status"];
type TaskStatus = Row<typeof schema.tasks>["status"];
type InvitationStatus = Row<typeof schema.invitations>["status"];
type StaffInvitationStatus = Row<typeof schema.staffInvitations>["status"] | "expired";
type TransitionState = Row<typeof schema.bereavementTransitions>["state"];
type CheckInStatus = Row<typeof schema.bereavementContacts>["status"];
type CorrectionStatus = Row<typeof schema.consentCorrectionRequests>["status"];
type MembershipStatus = Row<typeof schema.memberships>["status"];
type Decision = "allow" | "hold" | "deny";

export const ESCALATION_STATUSES = [
  "open",
  "acknowledged",
  "resolved",
] as const satisfies readonly EscalationStatus[];
export const CONSENT_STAGES = [
  "awaiting_confirmation",
  "needs_review",
  "awaiting_activation",
  "active",
  "scheduled",
  "revoked",
  "expired",
] as const satisfies readonly ConsentStage[];
export const TASK_STATUSES = ["open", "done", "closed"] as const satisfies readonly TaskStatus[];
export const INVITATION_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "expired",
] as const satisfies readonly InvitationStatus[];
export const STAFF_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "cancelled",
  "expired",
] as const satisfies readonly StaffInvitationStatus[];
export const TRANSITION_STATES = [
  "proposed",
  "confirmed",
  "cancelled",
] as const satisfies readonly TransitionState[];
export const CHECK_IN_STATUSES = ["planned", "done"] as const satisfies readonly CheckInStatus[];
export const CORRECTION_STATUSES = [
  "open",
  "cancelled",
  "resolved",
] as const satisfies readonly CorrectionStatus[];
export const MEMBERSHIP_STATUSES = ["active", "ended"] as const satisfies readonly MembershipStatus[];
export const DECISIONS = ["allow", "hold", "deny"] as const satisfies readonly Decision[];
/** Packets also show "expired" when their shareable-until date has passed (derived, not stored). */
export const PACKET_DISPLAY_STATES = [...PACKET_STATES, "expired"] as const;

export const STATUS = {
  escalation: {
    open: { label: "Needs an owner", tone: "warning", icon: "alert" },
    acknowledged: { label: "Owned — in progress", tone: "info", icon: "clock" },
    resolved: { label: "Resolved", tone: "success", icon: "check" },
  } satisfies Record<EscalationStatus, StatusDef>,
  consent: {
    awaiting_confirmation: { label: "Waiting for household confirmation", tone: "warning", icon: "clock" },
    needs_review: { label: "Held — needs review", tone: "danger", icon: "alert" },
    awaiting_activation: { label: "Confirmed — ready to activate", tone: "info", icon: "clock" },
    active: { label: "Active", tone: "success", icon: "check" },
    scheduled: { label: "Scheduled", tone: "info", icon: "clock" },
    revoked: { label: "Withdrawn", tone: "neutral", icon: "lock" },
    // "Ended", as the consent's stage is named everywhere else (Sharing register: "Withdrawn or ended").
    expired: { label: "Ended", tone: "neutral", icon: "lock" },
  } satisfies Record<ConsentStage, StatusDef>,
  authority: {
    not_submitted: { label: "Not submitted", tone: "neutral" },
    review_pending: { label: "Waiting for review", tone: "warning", icon: "clock" },
    workflow_active: { label: "Workflow active", tone: "success", icon: "check" },
    conflict: { label: "Conflict — held for review", tone: "danger", icon: "alert" },
    superseded: { label: "Superseded", tone: "neutral" },
    withdrawn: { label: "Withdrawn", tone: "neutral", icon: "lock" },
  } satisfies Record<AuthorityState, StatusDef>,
  packet: {
    // Just "Draft": whether it would pass is the release check's job (shown beside it), so the chip
    // doesn't say "not checked" next to "Ready to release".
    draft: { label: "Draft", tone: "neutral" },
    held: { label: "Held", tone: "warning", icon: "alert" },
    released: { label: "Released", tone: "success", icon: "check" },
    denied: { label: "Denied", tone: "danger", icon: "alert" },
    revoked: { label: "Access withdrawn", tone: "neutral", icon: "lock" },
    expired: { label: "Expired", tone: "neutral", icon: "lock" },
  } satisfies Record<PacketState | "expired", StatusDef>,
  task: {
    open: { label: "Open", tone: "warning" },
    done: { label: "Done", tone: "success", icon: "check" },
    closed: { label: "Closed — not needed", tone: "neutral" },
  } satisfies Record<TaskStatus, StatusDef>,
  household: {
    enrolled: { label: "Getting started", tone: "info" },
    active_hospice: { label: "Receiving hospice care", tone: "success" },
    bereavement: { label: "Bereavement support", tone: "neutral" },
    closed: { label: "Closed", tone: "neutral", icon: "lock" },
  } satisfies Record<LifecycleState, StatusDef>,
  invitation: {
    pending: { label: "Waiting to be accepted", tone: "warning", icon: "clock" },
    accepted: { label: "Accepted", tone: "success", icon: "check" },
    declined: { label: "Declined", tone: "neutral" },
    cancelled: { label: "Revoked", tone: "neutral" },
    expired: { label: "Expired", tone: "neutral" },
  } satisfies Record<InvitationStatus, StatusDef>,
  staffInvitation: {
    pending: { label: "Waiting to be accepted", tone: "warning", icon: "clock" },
    accepted: { label: "Accepted", tone: "success", icon: "check" },
    cancelled: { label: "Cancelled", tone: "neutral" },
    expired: { label: "Expired", tone: "neutral" },
  } satisfies Record<StaffInvitationStatus, StatusDef>,
  transition: {
    proposed: { label: "Proposed — needs confirmation", tone: "warning", icon: "clock" },
    confirmed: { label: "Confirmed", tone: "success", icon: "check" },
    cancelled: { label: "Cancelled", tone: "neutral" },
  } satisfies Record<TransitionState, StatusDef>,
  checkIn: {
    planned: { label: "Planned", tone: "info", icon: "clock" },
    done: { label: "Done", tone: "success", icon: "check" },
  } satisfies Record<CheckInStatus, StatusDef>,
  correction: {
    open: { label: "Correction requested", tone: "danger", icon: "alert" },
    cancelled: { label: "Correction cancelled", tone: "neutral" },
    resolved: { label: "Correction resolved", tone: "success", icon: "check" },
  } satisfies Record<CorrectionStatus, StatusDef>,
  membership: {
    active: { label: "Active", tone: "success" },
    ended: { label: "Ended", tone: "neutral" },
  } satisfies Record<MembershipStatus, StatusDef>,
  vault: {
    needs_review: { label: "Needs a look", tone: "warning" },
    reviewed: { label: "Reviewed", tone: "success", icon: "check" },
    not_available: { label: "Not found yet", tone: "neutral" },
    not_applicable: { label: "Doesn't apply", tone: "neutral" },
  } satisfies Record<VaultStatus, StatusDef>,
  decision: {
    allow: { label: "Allowed", tone: "success", icon: "check" },
    hold: { label: "Held", tone: "warning", icon: "alert" },
    deny: { label: "Denied", tone: "danger", icon: "alert" },
  } satisfies Record<Decision, StatusDef>,
} as const;

export type StatusDomain = keyof typeof STATUS;

/** The source enums, for the coverage test. */
export const STATUS_SOURCES: Record<StatusDomain, readonly string[]> = {
  escalation: ESCALATION_STATUSES,
  consent: CONSENT_STAGES,
  authority: AUTHORITY_STATES,
  packet: PACKET_DISPLAY_STATES,
  task: TASK_STATUSES,
  household: LIFECYCLE_STATES,
  invitation: INVITATION_STATUSES,
  staffInvitation: STAFF_INVITATION_STATUSES,
  transition: TRANSITION_STATES,
  checkIn: CHECK_IN_STATUSES,
  correction: CORRECTION_STATUSES,
  membership: MEMBERSHIP_STATUSES,
  vault: VAULT_STATUSES,
  decision: DECISIONS,
};

/** Look up a status. An unknown value still gets a calm, readable chip (and the code in a tooltip). */
export function statusOf(domain: StatusDomain, value: string): StatusDef {
  const m = STATUS[domain] as Record<string, StatusDef>;
  return m[value] ?? { label: value.replaceAll("_", " "), tone: "neutral" };
}
