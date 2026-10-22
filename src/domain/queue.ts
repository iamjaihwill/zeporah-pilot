/**
 * The staff coordination queue's shared row model: every kind of work answers the same questions —
 * who owns it, what state it's in, what last happened, what to do next, how long it has waited and
 * how urgent it is — with explicit wording when something isn't known.
 */
export const QUEUE_KINDS = [
  "correction",
  "escalation",
  "authority",
  "consent",
  "transition",
  "packet",
  "message",
  "acknowledgement",
  "task",
  "onboarding",
  // Exceptions (decision 58): deterministic rules added to the queue's own kinds.
  "missing_consent",
  "access_ending",
  "recipient_unopened",
  "handoff",
  "coverage",
  "checkin",
  "risk",
] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export const QUEUE_LABELS: Record<QueueKind, string> = {
  correction: "Consent correction",
  escalation: "Escalation",
  authority: "Authority review",
  consent: "Consent activation",
  transition: "Transition",
  packet: "Packet",
  message: "Message",
  acknowledgement: "Acknowledgement",
  task: "Task",
  onboarding: "Setup",
  missing_consent: "Missing consent",
  access_ending: "Access ending",
  recipient_unopened: "Recipient hasn't opened",
  handoff: "Stalled handoff",
  coverage: "Coverage gap",
  checkin: "Bereavement check-in",
  risk: "Coordination risk",
};

/**
 * Exception categories (decision 58; spec 1.4): what the work is about, for views and filters.
 * Escalations take their category from the escalation's own kind.
 */
export const EXCEPTION_CATEGORIES = [
  "missing_consent",
  "consent_held",
  "release_incomplete",
  "family_contact",
  "family_request",
  "partner_waiting",
  "stalled_handoff",
  "unread_update",
  "task",
  "access_ending",
  "coverage_gap",
  "checkin_due",
  "risk",
  "setup",
  "transition",
] as const;
export type ExceptionCategory = (typeof EXCEPTION_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<ExceptionCategory, string> = {
  missing_consent: "Missing consent",
  consent_held: "Consent held or correction",
  release_incomplete: "Release incomplete",
  family_contact: "Family contact unresolved",
  family_request: "Family request",
  partner_waiting: "Waiting on partner",
  stalled_handoff: "Stalled handoff",
  unread_update: "Unread critical update",
  task: "Care-team task",
  access_ending: "Access ending",
  coverage_gap: "Coverage gap",
  checkin_due: "Bereavement contact due",
  risk: "Coordination risk",
  setup: "Setup",
  transition: "Transition",
};
const KIND_CATEGORY: Record<Exclude<QueueKind, "escalation">, ExceptionCategory> = {
  correction: "consent_held",
  authority: "consent_held",
  consent: "consent_held",
  transition: "transition",
  packet: "release_incomplete",
  message: "family_contact",
  acknowledgement: "unread_update",
  task: "task",
  onboarding: "setup",
  missing_consent: "missing_consent",
  access_ending: "access_ending",
  recipient_unopened: "partner_waiting",
  handoff: "stalled_handoff",
  coverage: "coverage_gap",
  checkin: "checkin_due",
  risk: "risk",
};
/** Escalations about sharing are consent work; a recipient's question waits on a partner. */
const ESCALATION_CATEGORY: Record<string, ExceptionCategory> = {
  authority_conflict: "consent_held",
  identity_review: "consent_held",
  consent_review: "consent_held",
  policy_hold: "consent_held",
  packet_clarification: "partner_waiting",
};
export function categoryOf(kind: QueueKind, escalationKind?: string | null): ExceptionCategory {
  if (kind === "escalation") return ESCALATION_CATEGORY[escalationKind ?? ""] ?? "family_request";
  return KIND_CATEGORY[kind];
}
/**
 * Consent and authority work is resolved through its own workflow, never dismissed; so are work
 * that has an owner of record (tasks), a person's request (escalations) and team coverage.
 */
export const NOT_DISMISSABLE: readonly ExceptionCategory[] = [
  "missing_consent",
  "consent_held",
  "stalled_handoff",
  "task",
  "coverage_gap",
  "checkin_due",
  "family_request",
  "transition",
];
/** Where an exception came from (decision 58). */
export type ExceptionSource = "rule" | "family" | "partner" | "staff";

/** Three plain levels with a stated reason on every row. No hidden scores. */
export const PRIORITIES = ["high", "normal", "routine"] as const;
export type Priority = (typeof PRIORITIES)[number];
/** Urgency (decision 58): Now / Today / This week. It orders the work; it isn't clinical triage. */
export const PRIORITY_LABELS: Record<Priority, string> = {
  high: "Now",
  normal: "Today",
  routine: "This week",
};

export type QueueRow = {
  kind: QueueKind;
  householdId: string;
  household: string;
  /** Identifies the item without private content (never message or note text). */
  summary: string;
  /** Null means no owner is recorded; screens say so rather than guess. */
  owner: string | null;
  /** The item's state in plain words. */
  state: string;
  /** From the audit log only: who did which kind of action, and when. Null if nothing is recorded. */
  lastAction: { actor: string; did: string; at: Date } | null;
  next: string;
  since: Date;
  /** Care-team tasks with a due date: when, and whether it's overdue or due today. */
  dueAt: Date | null;
  due: "overdue" | "today" | null;
  /** "3 days", computed once on the server so the page never changes after it loads. */
  age: string;
  /** The same in a few characters ("3 d") for narrow columns; screens keep `age` for screen readers. */
  ageShort: string;
  priority: Priority;
  priorityReason: string;
  link: string;
  /** Who owns it (for the "Assigned to me" and "Unassigned" filters). */
  ownerIds: string[];
  /** True when the viewer is one of the owners. */
  mine: boolean;
  /** When the next step is to take ownership and the viewer may: the escalation to take. */
  takeEscalationId: string | null;
  /** Stable row key: kind plus the record it's about (staff rework, section 3). */
  id: string;
  /** The record the row is about (escalation, consent, packet, authority record, task…), if any. */
  subjectId: string | null;
  /** Status for the StatusChip (domain/status.ts). */
  status: {
    domain:
      | "escalation"
      | "consent"
      | "authority"
      | "packet"
      | "task"
      | "household"
      | "transition"
      | "correction"
      | "checkIn";
    value: string;
  };
  /** Opens the exact object (its own page, or its household tab with an anchor). */
  deepLink: string;
  /** The single next action, when there is one the viewer may take inline. */
  action: { type: "take" | "activate" | "reply"; label: string } | null;
  /** True for rows that can be bulk-assigned (escalations). */
  assignable: boolean;
  /** Exception fields (decision 58; spec 1.3). */
  category: ExceptionCategory;
  /** "Why this is here": the rule, in plain words. */
  why: string;
  source: ExceptionSource;
  /** When it crosses its next threshold, or the task's due time; null when there isn't one. */
  dueBy: Date | null;
  /** Can be dismissed with a reason (consent, authority and owned work can't). */
  dismissable: boolean;
  /** Ownership, waiting and dismissal held in exception_claims (not for escalations or tasks). */
  claimable: boolean;
  /** Someone took or was assigned it (an exception claim), rather than its default owner. */
  claimed: boolean;
  waitingOn: "family" | "partner" | "staff" | null;
  waitingNote: string | null;
  /**
   * The consent or authority record a sharing row rests on, in plain words, with its end time where
   * it has one (direction refinement D-2). Null when the row doesn't rest on one. Every viewer of these
   * rows can already open the household's sharing records, so it shows nothing new.
   */
  basis: { text: string; until: Date | null } | null;
};
/** The exception model's name for a row (decision 58). */
export type ExceptionRow = QueueRow;

export const NO_OWNER = "No owner assigned";
export const NO_ACTION = "No recorded action yet";

/** What an audit action means, in a few words. The audit summary itself is never shown in the queue. */
export const ACTION_LABELS: Record<string, string> = {
  "message.sent": "sent a message",
  "update.posted": "posted the update",
  "update.acknowledged": "acknowledged it",
  "task.created": "created the task",
  "task.completed": "completed a task",
  "escalation.raised": "raised it",
  "escalation.owned": "took ownership",
  "escalation.owner_released": "released ownership",
  "escalation.owner_transferred": "handed it to the new care guide",
  "escalation.owner_assigned": "gave it to an owner",
  "escalation.taken_over": "took it over",
  "escalation.resolved": "resolved it",
  "task.unassigned": "unassigned it",
  "task.reassigned": "handed it to the new care guide",
  "authority.submitted": "submitted evidence",
  "authority.reviewed": "recorded a review",
  "authority.identity_review_opened": "opened an identity review",
  "authority.identity_linked": "linked the holder",
  "authority.conflict_detected": "detected a conflict",
  "consent.recorded": "recorded the consent",
  "consent.confirmed": "confirmed it",
  "consent.amended": "changed the terms",
  "consent.activated": "activated it",
  "consent.correction_requested": "asked for a correction",
  "consent.correction_cancelled": "cancelled their correction request",
  "consent.correction_dismissed": "reviewed a correction request",
  "consent.correction_resolved": "closed a correction request",
  "consent.revoked": "withdrew it",
  "packet.drafted": "drafted the packet",
  "packet.manifest_changed": "changed its contents",
  "packet.release_requested": "ran the release check",
  "lifecycle.bereavement_proposed": "proposed the transition",
  "onboarding.step_completed": "completed a setup step",
  "onboarding.completed": "finished setup",
  "exception.taken": "took ownership",
  "exception.assigned": "assigned it",
  "exception.waiting": "marked it as waiting",
  "exception.owner_released": "released ownership",
  "exception.dismissed": "dismissed it",
  "partner_event.logged": "logged the partner event",
  "update.reached_by_phone": "reached them by phone",
  "handoff.offered": "offered the handoff",
  "handoff.accepted": "accepted the handoff",
  "coverage.granted": "started covering",
  "coverage.ended": "ended the cover",
  "absence.recorded": "recorded an absence",
  "handoff.declined": "declined the handoff",
  "handoff.withdrawn": "withdrew the handoff",
  "packet.released": "released it",
  "packet.recipient_access_granted": "gave the recipient access",
  "packet.recipient_contact_set": "confirmed the named recipient",
  "packet.recipient_viewed": "opened it",
  "packet.recipient_acknowledged": "acknowledged it",
};
export const actionLabel = (action: string) => ACTION_LABELS[action] ?? "updated it";

/** How long something has waited, as a stable duration ("under an hour", "5 hours", "3 days", "2 weeks"). */
export function ageLabel(since: Date, now: Date) {
  const h = Math.max(0, (now.getTime() - since.getTime()) / 3_600_000);
  if (h < 1) return "under an hour";
  if (h < 24) return `${Math.floor(h)} hour${Math.floor(h) === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"}`;
  const w = Math.floor(d / 7);
  return `${w} weeks`;
}

/** The short form of ageLabel ("<1 h", "5 h", "3 d", "2 wk"). */
export function shortAgeLabel(since: Date, now: Date) {
  const h = Math.max(0, (now.getTime() - since.getTime()) / 3_600_000);
  if (h < 1) return "<1 h";
  if (h < 24) return `${Math.floor(h)} h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} d`;
  return `${Math.floor(d / 7)} wk`;
}

/**
 * The next step every row of a kind shares. My work leaves it out (it would repeat on most rows) and
 * shows only steps that say something about the item.
 */
export const DEFAULT_NEXT: Partial<Record<QueueKind, string>> = { task: "Complete the task" };

/** Due work first (overdue, then due today), then the queue's own order. Used by My work. */
export const dueFirst = (a: QueueRow, b: QueueRow) => {
  const r = (q: QueueRow) => (q.due === "overdue" ? 0 : q.due === "today" ? 1 : 2);
  return r(a) - r(b) || (r(a) < 2 ? a.dueAt!.getTime() - b.dueAt!.getTime() : 0) || byPriorityThenAge(a, b);
};

const RANK: Record<Priority, number> = { high: 0, normal: 1, routine: 2 };
/** High before normal before routine; within a level, whatever has waited longest comes first. */
export const byPriorityThenAge = (a: QueueRow, b: QueueRow) =>
  RANK[a.priority] - RANK[b.priority] || a.since.getTime() - b.since.getTime();

/** Escalations are named by kind in the queue; their summaries (which can quote a family) stay on the Escalations page. */
export const ESCALATION_WHAT: Record<string, string> = {
  authority_conflict: "Authority conflict",
  identity_review: "Authority identity unresolved",
  consent_review: "Consent held: named person can't confirm in the app",
  policy_hold: "Sharing hold needs review",
  family_request: "Family asked for a person to follow up",
  privacy_concern: "Privacy request from the household",
  clinical_question: "Clinical question to route",
  legal_ambiguity: "Legal ambiguity",
  packet_clarification: "A packet recipient asked a question",
};
