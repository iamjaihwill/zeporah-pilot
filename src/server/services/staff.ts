/**
 * The hospice care-team workspace. Internal staff notes are read and written only here; nothing
 * in this file returns them to a family-facing caller.
 */
import { orgSettings } from "./org-settings";
import { and, desc, eq, gt, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { closeOpenCorrection } from "./corrections";
import { currentMessageExpectation } from "./settings";
import { careGuideNames, careTeam } from "./assignments";
import { recordContext, timelineEvents } from "./record";
import { commandCenter } from "./command-center";
import { preparedDrafts, usedPreparedDraft } from "./prepared";
import { ESCALATION_STATUS_LABELS } from "@/domain/labels";
import { bereavementWorkload, createPlanInTx, staffPlan } from "./bereavement";
import { careGuideMayComplete, markFamilyTaskDone } from "./tasks";
import {
  AccessError,
  loadContext,
  requireStaffPermission,
  staffScope,
  staffSeesHousehold,
  staffVisibleHouseholds,
  type ActorContext,
} from "../context";
import {
  actorNames,
  careGuidesFor,
  consentWorkflow,
  effectiveConsentState,
  staffMaySeeVaultItem,
  householdEvidence,
  householdMembers,
  markLinkRead,
  membersWho,
  notify,
  onboardingState,
  staffWithRole,
  organizationHotline,
} from "./common";
import { can } from "@/domain/permissions";
import { effectiveAuthorityState } from "@/domain/authority-identity";
import {
  DEFAULT_NEXT,
  NOT_DISMISSABLE,
  categoryOf,
  actionLabel,
  ageLabel,
  byPriorityThenAge,
  dueFirst,
  shortAgeLabel,
  type QueueRow,
} from "@/domain/queue";
import { CONSENT_STAGE_LABELS, CORRECTION_CATEGORY_LABELS, type CorrectionCategory } from "@/domain/consent";
import { canTransition, LIFECYCLE_LABELS } from "@/domain/lifecycle";
import {
  AUTHORITY_TYPE_LABELS,
  CARE_PERIOD_ONLY,
  ENDS_AT_DEATH,
  ROLE_LABELS,
  type AuthorityType,
  type HouseholdRole,
  type LifecycleState,
  type ShareCategory,
} from "@/domain/model";

const CONTACT_LABELS = { in_app: "In Zeporah", phone: "Phone call", email: "Email" } as const;

function requireStaff(ctx: ActorContext) {
  if (ctx.kind !== "staff") throw new AccessError("NOT_PERMITTED", "This area is for the hospice care team.");
}

async function visibleHouseholds(db: DB, ctx: ActorContext) {
  requireStaff(ctx);
  return staffVisibleHouseholds(db, ctx);
}

/** Households this person may draft a packet for (the Packets page's "Draft a packet…" picker). */
export async function packetDraftHouseholds(db: DB, ctx: ActorContext) {
  const hh = await visibleHouseholds(db, ctx);
  return hh
    .filter((h) => can(ctx.staffRoles, "packet.draft", h.lifecycleState as LifecycleState))
    .map((h) => ({ id: h.id, name: h.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ queue */

/** "overdue" before now, "today" later today (pilot time zone), otherwise null. */
function dueState(dueAt: Date | null, now: Date): "overdue" | "today" | null {
  if (!dueAt) return null;
  if (dueAt.getTime() < now.getTime()) return "overdue";
  const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  return day(dueAt) === day(now) ? "today" : null;
}
export { dueState };

export type QueueItem = QueueRow;

export { ESCALATION_WHAT } from "@/domain/queue";
import { ESCALATION_WHAT } from "@/domain/queue";
/**
 * For escalations the system opens, the record it's about. The app records why the escalation exists
 * on that record (a detected conflict, an identity review, a held release, a recorded consent), so the
 * queue reads the last action from both. Family-raised escalations have their own events.
 */
const ESCALATION_SOURCE: Record<string, string> = {
  authority_conflict: "authority_evidence",
  identity_review: "authority_evidence",
  policy_hold: "packet",
  consent_review: "consent",
};
/** Events that explain why a consent is ready to activate, newest first. */
const ACTIVATION_ACTIONS = ["consent.confirmed", "consent.amended", "consent.recorded"];
const ESCALATION_NEXT: Record<string, string> = {
  authority_conflict: "Review both records with the family",
  identity_review: "Link the record to a household person",
  consent_review: "Review how the named person can give consent",
  policy_hold: "Resolve the hold, then run the release check again",
};

/**
 * One list of what needs a person. Every row answers the same questions (see QueueRow) from real
 * records only: owners come from assignments, last actions from the audit log, and anything not
 * recorded is said plainly rather than guessed. Care guides see their households; operations and
 * reviewers see the hospice's.
 */
export async function coordinationQueue(db: DB, ctx: ActorContext): Promise<QueueRow[]> {
  const hh = await visibleHouseholds(db, ctx);
  if (!hh.length) return [];
  const ids = hh.map((h) => h.id);
  const name = (id: string) => hh.find((h) => h.id === id)?.displayName ?? "";
  const T = ctx.tenantId;
  const now = new Date();
  type Draft = Omit<
    QueueRow,
    | "lastAction"
    | "age"
    | "ageShort"
    | "ownerIds"
    | "mine"
    | "takeEscalationId"
    | "id"
    | "subjectId"
    | "deepLink"
    | "action"
    | "assignable"
    | "dueAt"
    | "due"
    | "category"
    | "source"
    | "dueBy"
    | "dismissable"
    | "claimable"
    | "claimed"
    | "waitingOn"
    | "waitingNote"
    | "basis"
  > & {
    basis?: QueueRow["basis"];
    /** Escalations: their kind decides the category (decision 58). */
    escalationKind?: string;
    source?: QueueRow["source"];
    dueBy?: Date | null;
    /** A fixed row key (`category:subjectType:subjectId`) for rule-derived exceptions. */
    key?: string;
    dueAt?: Date | null;
    ownerIds?: string[];
    takeEscalationId?: string | null;
    subjectId?: string | null;
    deepLink?: string;
    action?: QueueRow["action"];
    assignable?: boolean;
    /** "Waiting" counts from the last state change; false keeps the original time (e.g. first unanswered message). */
    sinceFromLastAction?: boolean;
    subject: {
      ids?: string[];
      /** Keep only the events that explain this row (for example, this correction request's own events). */
      only?: (e: typeof s.auditEvents.$inferSelect) => boolean;
      household?: string;
      actions?: string[];
    };
  };
  const items: Draft[] = [];
  // Direction refinement D-2: the consent a sharing row rests on, in the Sharing tab's own words.
  const consentLine = async (c: typeof s.consents.$inferSelect) =>
    `Consent for ${c.recipientName}, version ${c.version}: ${CONSENT_STAGE_LABELS[
      (await consentWorkflow(db, c, now)).stage
    ].toLowerCase()}`;

  // Care guides assigned to each household: the recorded owner of its routine follow-up.
  const guideOf = new Map<string, { label: string | null; ids: string[] }>();
  for (const id of ids) {
    const g = await careGuidesFor(db, T, id);
    guideOf.set(id, {
      label: g.length ? g.map((x) => x.name).join(", ") : null,
      ids: g.map((x) => x.actorId),
    });
  }

  // Family messages that haven't had a care-team reply since.
  const msgs = await db
    .select()
    .from(s.messages)
    .where(and(eq(s.messages.tenantId, T), inArray(s.messages.householdId, ids)))
    .orderBy(s.messages.createdAt);
  for (const id of ids) {
    const thread = msgs.filter((m) => m.householdId === id);
    const lastStaff =
      thread
        .filter((m) => m.authorSide === "staff")
        .at(-1)
        ?.createdAt.getTime() ?? 0;
    const waiting = thread.filter((m) => m.authorSide === "family" && m.createdAt.getTime() > lastStaff);
    if (waiting.length)
      items.push({
        kind: "message",
        householdId: id,
        household: name(id),
        summary: "Household thread",
        owner: guideOf.get(id)?.label ?? null,
        ownerIds: guideOf.get(id)?.ids ?? [],
        state: `${waiting.length} family message${waiting.length > 1 ? "s" : ""} without a reply`,
        status: { domain: "task", value: "open" },
        subjectId: waiting.at(-1)!.id,
        deepLink: `/staff/households/${id}?tab=messages#message-${waiting.at(-1)!.id}`,
        action: can(ctx.staffRoles, "staff.thread.send") ? { type: "reply", label: "Reply" } : null,
        next: "Reply in the household thread",
        why: "The household's latest message has no care-team reply yet.",
        source: "family",
        since: waiting[0]!.createdAt,
        priority: "normal",
        priorityReason: "A household is waiting for a reply",
        link: `/staff/households/${id}?tab=messages`,
        subject: { household: id, actions: ["message.sent"] },
      });
  }

  // Updates that asked for acknowledgement and are still missing some.
  const updates = await db
    .select()
    .from(s.familyUpdates)
    .where(
      and(
        eq(s.familyUpdates.tenantId, T),
        inArray(s.familyUpdates.householdId, ids),
        eq(s.familyUpdates.requiresAck, true),
      ),
    );
  const acks = await db
    .select()
    .from(s.acknowledgements)
    .where(and(eq(s.acknowledgements.tenantId, T), eq(s.acknowledgements.subjectType, "update")));
  // People someone recorded reaching by phone about an update (exception E-8): each counts for the
  // person reached only, so the row stays while anyone else still hasn't acknowledged.
  const reachedCalls = updates.length
    ? await db
        .select({ updateId: s.auditEvents.subjectId, context: s.auditEvents.context })
        .from(s.auditEvents)
        .where(
          and(
            eq(s.auditEvents.tenantId, T),
            inArray(s.auditEvents.householdId, ids),
            eq(s.auditEvents.action, "update.reached_by_phone"),
          ),
        )
    : [];
  const reachedPerson = new Set(
    reachedCalls.map((c) => `${c.updateId}:${(c.context as { person?: string }).person ?? ""}`),
  );
  for (const u of updates) {
    const members = await membersWho(
      db,
      T,
      u.householdId,
      hh.find((h) => h.id === u.householdId)!.lifecycleState as LifecycleState,
      { permission: "updates.acknowledge" },
    );
    const missing = members.filter(
      (m) =>
        !acks.some((a) => a.subjectId === u.id && a.actorId === m.actorId) &&
        !reachedPerson.has(`${u.id}:${m.actorId}`),
    );
    if (missing.length)
      items.push({
        kind: "acknowledgement",
        householdId: u.householdId,
        household: name(u.householdId),
        summary: `Update: “${u.title}”`,
        owner: guideOf.get(u.householdId)?.label ?? null,
        ownerIds: guideOf.get(u.householdId)?.ids ?? [],
        state: `Waiting on ${missing.map((m) => m.name.split(" ")[0]).join(", ")}`,
        status: { domain: "task", value: "open" },
        subjectId: u.id,
        deepLink: `/staff/households/${u.householdId}?tab=updates#update-${u.id}`,
        next: "Check in with them if it matters; otherwise no action is needed",
        why: "An update asked for acknowledgement, and some people haven't acknowledged it yet.",
        source: "rule",
        since: u.createdAt,
        priority: "routine",
        priorityReason: "Routine follow-up",
        link: `/staff/households/${u.householdId}?tab=updates`,
        subject: { ids: [u.id] },
      });
  }

  // Care-team tasks.
  const tasks = await db
    .select()
    .from(s.tasks)
    .where(
      and(
        eq(s.tasks.tenantId, T),
        inArray(s.tasks.householdId, ids),
        eq(s.tasks.status, "open"),
        eq(s.tasks.audience, "staff"),
      ),
    );
  const taskNames = await actorNames(
    db,
    T,
    tasks.map((t) => t.assigneeActorId),
  );
  for (const t of tasks)
    items.push({
      kind: "task",
      householdId: t.householdId,
      household: name(t.householdId),
      summary: t.title,
      owner: t.assigneeActorId ? (taskNames.get(t.assigneeActorId) ?? null) : null,
      ownerIds: t.assigneeActorId ? [t.assigneeActorId] : [],
      state: "Open",
      status: { domain: "task", value: "open" },
      subjectId: t.id,
      deepLink: `/staff/households/${t.householdId}?tab=tasks#task-${t.id}`,
      next: DEFAULT_NEXT.task!,
      why:
        t.dueAt && t.dueAt.getTime() < now.getTime()
          ? "An open care-team task is past its due time."
          : "An open care-team task.",
      source: "rule",
      dueBy: t.dueAt,
      since: t.createdAt,
      dueAt: t.dueAt,
      // Overdue work moves up the queue.
      priority: t.dueAt && t.dueAt.getTime() < now.getTime() ? "normal" : "routine",
      priorityReason:
        t.dueAt && t.dueAt.getTime() < now.getTime() ? "Past its due date" : "Routine follow-up",
      link: `/staff/households/${t.householdId}?tab=tasks`,
      subject: { ids: [t.id] },
    });

  // Escalations (correction requests are listed as their own kind below, not twice).
  const esc = await db
    .select()
    .from(s.escalations)
    .where(
      and(
        eq(s.escalations.tenantId, T),
        inArray(s.escalations.householdId, ids),
        ne(s.escalations.status, "resolved"),
        ne(s.escalations.kind, "consent_correction"),
      ),
    );
  const escNames = await actorNames(
    db,
    T,
    esc.map((e) => e.ownerActorId),
  );
  for (const e of esc) {
    const taken = e.status === "acknowledged";
    items.push({
      kind: "escalation",
      householdId: e.householdId,
      household: name(e.householdId),
      summary: ESCALATION_WHAT[e.kind] ?? "Needs a person",
      owner: e.ownerActorId ? (escNames.get(e.ownerActorId) ?? null) : null,
      ownerIds: e.ownerActorId ? [e.ownerActorId] : [],
      takeEscalationId: !taken && can(ctx.staffRoles, "staff.escalation.manage") ? e.id : null,
      state: ESCALATION_STATUS_LABELS[e.status] ?? e.status,
      status: { domain: "escalation", value: e.status },
      subjectId: e.id,
      deepLink: `/staff/exceptions?view=all&sel=escalation:${e.id}`,
      action:
        !taken && can(ctx.staffRoles, "staff.escalation.manage")
          ? { type: "take", label: "Take ownership" }
          : null,
      assignable: true,
      next: taken ? (ESCALATION_NEXT[e.kind] ?? "Resolve it with a note") : "Take ownership",
      escalationKind: e.kind,
      why:
        e.kind === "packet_clarification"
          ? "A packet's named recipient asked the care team a question."
          : e.sourceType === "support_request"
            ? "Someone in the household asked for a person to follow up."
            : "A sharing or authority check needs a person to look at it.",
      source:
        e.kind === "packet_clarification"
          ? "partner"
          : e.sourceType === "support_request"
            ? "family"
            : "rule",
      // Waiting counts from the escalation's last change of state (raised, taken, released).
      since: e.stateChangedAt ?? e.createdAt,
      priority: taken ? "normal" : "high",
      priorityReason: taken ? "Owned, not resolved yet" : "Needs an owner",
      link: "/staff/exceptions?view=all&kind=escalation",
      subject: {
        ids: e.sourceId && ESCALATION_SOURCE[e.kind] === e.sourceType ? [e.id, e.sourceId] : [e.id],
      },
    });
  }

  // Consent correction requests: they hold activation and release until resolved.
  if (can(ctx.staffRoles, "consent.record")) {
    const corrections = await db
      .select({
        r: s.consentCorrectionRequests,
        recipient: s.consents.recipientName,
        version: s.consents.version,
      })
      .from(s.consentCorrectionRequests)
      .innerJoin(
        s.consents,
        and(
          eq(s.consents.tenantId, s.consentCorrectionRequests.tenantId),
          eq(s.consents.id, s.consentCorrectionRequests.consentId),
        ),
      )
      .where(
        and(
          eq(s.consentCorrectionRequests.tenantId, T),
          inArray(s.consentCorrectionRequests.householdId, ids),
          eq(s.consentCorrectionRequests.status, "open"),
        ),
      );
    for (const { r, recipient, version } of corrections) {
      const labels = (r.categories as CorrectionCategory[]).map((k) => CORRECTION_CATEGORY_LABELS[k] ?? k);
      items.push({
        kind: "correction",
        householdId: r.householdId,
        household: name(r.householdId),
        summary: `Consent for ${recipient}`,
        owner: null,
        state: `Correction requested${labels.length ? `: ${labels.join(", ").toLowerCase()}` : ""}`,
        status: { domain: "correction", value: "open" },
        subjectId: r.consentId,
        deepLink: `/staff/households/${r.householdId}/consents/${r.consentId}`,
        sinceFromLastAction: true,
        next: "Change the terms, withdraw it, or dismiss the request with an explanation",
        why: "The named person asked for a correction. Nothing is shared under this consent until it's resolved.",
        basis: {
          text: `Consent for ${recipient}, version ${version}: a correction is open, so nothing is shared under it`,
          until: null,
        },
        source: "family",
        since: r.createdAt,
        priority: "high",
        priorityReason: "Holds sharing until resolved",
        link: `/staff/households/${r.householdId}?tab=sharing`,
        subject: {
          ids: [r.consentId],
          only: (ev) =>
            ev.action.startsWith("consent.correction_") &&
            (ev.context as { requestId?: string }).requestId === r.id,
        },
      });
    }
  }

  if (can(ctx.staffRoles, "packet.release")) {
    const packets = await db
      .select()
      .from(s.packets)
      .where(
        and(
          eq(s.packets.tenantId, T),
          inArray(s.packets.householdId, ids),
          or(eq(s.packets.state, "draft"), eq(s.packets.state, "held")),
        ),
      );
    for (const p of packets) {
      const held = p.state === "held";
      items.push({
        kind: "packet",
        householdId: p.householdId,
        household: name(p.householdId),
        summary: `Packet for ${p.recipientName || "an unnamed recipient"}`,
        owner: null,
        state: held
          ? `Held (${p.lastReasonCode ?? "reason not recorded"})`
          : "Draft — release not checked yet",
        status: { domain: "packet", value: p.state },
        subjectId: p.id,
        deepLink: `/staff/packets/${p.id}`,
        next: held ? "Resolve the hold, then run the release check again" : "Run the release check",
        why: held
          ? "The last release check held this packet, so nothing was released."
          : "This packet is drafted and hasn't been released.",
        since: p.updatedAt,
        priority: "normal",
        priorityReason: held ? "Sharing is held" : "Sharing waits on a release check",
        link: `/staff/packets/${p.id}`,
        subject: { ids: [p.id] },
      });
    }
  }

  if (can(ctx.staffRoles, "authority.review")) {
    // Uses the effective state, so records whose holder identity is unresolved are listed too.
    for (const hid of ids) {
      const ev = await householdEvidence(db, T, hid);
      for (const e of ev) {
        const eff = effectiveAuthorityState(e, ev);
        if (eff !== "review_pending" && eff !== "conflict" && eff !== "identity_unresolved") continue;
        const blocking = eff !== "review_pending";
        items.push({
          kind: "authority",
          householdId: e.householdId,
          household: name(e.householdId),
          summary: `${e.holderName}'s authority record`,
          owner: null,
          status: { domain: "authority", value: eff === "identity_unresolved" ? "conflict" : eff },
          subjectId: e.id,
          deepLink: `/staff/households/${e.householdId}?tab=sharing#authority-${e.id}`,
          sinceFromLastAction: true,
          state:
            eff === "conflict"
              ? "Conflict — sharing held"
              : eff === "identity_unresolved"
                ? "Holder identity unresolved — sharing held"
                : "Waiting for review",
          next:
            eff === "conflict"
              ? "Review both records with the family"
              : eff === "identity_unresolved"
                ? "Link the record to a household person"
                : "Review the evidence",
          why: blocking
            ? "An authority record is in conflict or its holder is unresolved; sharing that depends on it is held."
            : "An authority record is waiting for a reviewer.",
          basis: {
            text: `${e.holderName}: ${AUTHORITY_TYPE_LABELS[e.authorityType as AuthorityType] ?? "authority"} record. The app records the workflow; it doesn't decide legal authority`,
            until: null,
          },
          since: e.updatedAt,
          priority: blocking ? "high" : "normal",
          priorityReason: blocking ? "Holds sharing until resolved" : "Sharing waits on this review",
          link: `/staff/households/${e.householdId}?tab=sharing`,
          subject: { ids: [e.id] },
        });
      }
    }
  }

  if (can(ctx.staffRoles, "consent.activate")) {
    const drafts = await db
      .select()
      .from(s.consents)
      .where(
        and(eq(s.consents.tenantId, T), inArray(s.consents.householdId, ids), eq(s.consents.state, "draft")),
      );
    const recorders = await actorNames(
      db,
      T,
      drafts.map((c) => c.recordedByActorId),
    );
    for (const c of drafts) {
      const wf = await consentWorkflow(db, c);
      if (wf.stage !== "awaiting_activation" || wf.correction) continue;
      const mine = c.recordedByActorId === ctx.actorId;
      items.push({
        kind: "consent",
        householdId: c.householdId,
        household: name(c.householdId),
        summary: `Consent for ${c.recipientName}`,
        owner: null,
        state: "Confirmed by the household — waiting for activation",
        status: { domain: "consent", value: "awaiting_activation" },
        subjectId: c.id,
        deepLink: `/staff/households/${c.householdId}/consents/${c.id}`,
        action: mine ? null : { type: "activate", label: "Activate…" },
        sinceFromLastAction: true,
        next: mine ? "Another reviewer activates it (you recorded it)" : "Activate it",
        why: "The household confirmed this consent; a reviewer who didn't record it activates it.",
        basis: {
          text: `${await consentLine(c)}. Recorded by ${recorders.get(c.recordedByActorId) ?? "someone on the care team"}, so a different reviewer activates it`,
          until: c.expiresAt,
        },
        since: c.createdAt,
        priority: "normal",
        priorityReason: "Ready to activate",
        link: `/staff/households/${c.householdId}?tab=sharing`,
        subject: { ids: [c.id], only: (ev) => ACTIVATION_ACTIONS.includes(ev.action) },
      });
    }
  }

  if (can(ctx.staffRoles, "lifecycle.confirm")) {
    const tr = await db
      .select()
      .from(s.bereavementTransitions)
      .where(
        and(
          eq(s.bereavementTransitions.tenantId, T),
          inArray(s.bereavementTransitions.householdId, ids),
          eq(s.bereavementTransitions.state, "proposed"),
        ),
      );
    for (const t of tr)
      items.push({
        kind: "transition",
        householdId: t.householdId,
        household: name(t.householdId),
        summary: "Move to bereavement support",
        owner: null,
        state: "Proposed — waiting for a second person",
        status: { domain: "transition", value: "proposed" },
        subjectId: t.id,
        deepLink: `/staff/households/${t.householdId}?tab=lifecycle`,
        next:
          t.proposedByActorId === ctx.actorId
            ? "A different operations user confirms (you proposed it)"
            : "Confirm or cancel it",
        why: "A move to bereavement support needs a second person to confirm it.",
        since: t.proposedAt,
        priority: "high",
        priorityReason: "A household change is waiting for a second person",
        link: `/staff/households/${t.householdId}?tab=lifecycle`,
        subject: { ids: [t.id] },
      });
  }

  for (const h of hh) {
    if (h.lifecycleState !== "enrolled") continue;
    const on = await onboardingState(db, T, h.id);
    items.push({
      kind: "onboarding",
      householdId: h.id,
      household: h.displayName,
      summary: "Household setup",
      owner: guideOf.get(h.id)?.label ?? null,
      ownerIds: guideOf.get(h.id)?.ids ?? [],
      state: `Setup ${on.steps.filter((x) => x.done).length} of 4 steps done`,
      status: { domain: "household", value: "enrolled" },
      subjectId: null,
      deepLink: `/staff/households/${h.id}?tab=overview`,
      next: "Offer help with setup if the household asks",
      why: "The household hasn't finished setup.",
      since: h.enrolledAt,
      priority: "routine",
      priorityReason: "Routine follow-up",
      link: `/staff/households/${h.id}?tab=overview`,
      subject: { household: h.id, actions: ["onboarding.step_completed", "onboarding.completed"] },
    });
  }

  // ---------------------------------------------------------------- exception rules (decision 58)
  // Deterministic, from the records themselves; thresholds are the hospice's settings.
  const ex = (await orgSettings(db, T, ctx.organizationId)).exceptions;
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const guideRow = (id: string) => ({
    owner: guideOf.get(id)?.label ?? null,
    ownerIds: guideOf.get(id)?.ids ?? [],
  });

  // Missing consent: an outside organization asked (a logged partner request) and no active consent
  // covers them yet.
  const allConsents = await db
    .select()
    .from(s.consents)
    .where(and(eq(s.consents.tenantId, T), inArray(s.consents.householdId, ids)));
  const activeFor = (hid: string, org: string) =>
    allConsents.some(
      (c) =>
        c.householdId === hid &&
        c.recipientName.trim().toLowerCase() === org.trim().toLowerCase() &&
        effectiveConsentState(c) === "active" &&
        c.expiresAt.getTime() > now.getTime(),
    );
  const requests = await db
    .select()
    .from(s.partnerEvents)
    .where(
      and(
        eq(s.partnerEvents.tenantId, T),
        inArray(s.partnerEvents.householdId, ids),
        eq(s.partnerEvents.kind, "request"),
      ),
    );
  for (const r of requests) {
    if (activeFor(r.householdId, r.organizationLabel)) continue;
    // The newest consent for this organization that could still become active, if there is one.
    const pending = allConsents
      .filter(
        (c) =>
          c.householdId === r.householdId &&
          c.recipientName.trim().toLowerCase() === r.organizationLabel.trim().toLowerCase() &&
          !["revoked", "expired"].includes(effectiveConsentState(c, now)),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    // The chip follows that consent's own stage, so it moves on as the household confirms.
    const pendingStage = pending ? (await consentWorkflow(db, pending, now)).stage : null;
    items.push({
      kind: "missing_consent",
      key: `missing_consent:partner_event:${r.id}`,
      householdId: r.householdId,
      household: name(r.householdId),
      summary: `Consent to share with ${r.organizationLabel}`,
      ...guideRow(r.householdId),
      state: "No active consent covers this request",
      status: { domain: "consent", value: pendingStage ?? "awaiting_confirmation" },
      subjectId: r.id,
      deepLink: `/staff/households/${r.householdId}?tab=sharing`,
      next: `Ask the household to confirm sharing with ${r.organizationLabel}`,
      why: `${r.organizationLabel} asked for information (a simulated partner request), and no active consent covers sharing with them.`,
      basis: pending
        ? { text: `${await consentLine(pending)}. It must be active before anything is shared`, until: null }
        : { text: `No consent for ${r.organizationLabel} is recorded`, until: null },
      source: "partner",
      since: r.occurredAt,
      priority: "normal",
      priorityReason: "An outside request waits on consent",
      link: `/staff/households/${r.householdId}?tab=sharing`,
      subject: { ids: [r.id] },
    });
  }

  // Access ending: consents, outside recipients' packet access and helper access ending soon.
  const soon = now.getTime() + ex.accessEndingDays * DAY;
  const ending = (when: Date) => when.getTime() > now.getTime() && when.getTime() <= soon;
  const endingRow = (
    key: string,
    hid: string,
    summary: string,
    until: Date,
    deepLink: string,
    subjectId: string,
  ): Draft => ({
    kind: "access_ending",
    key,
    householdId: hid,
    household: name(hid),
    summary,
    ...guideRow(hid),
    state: "Ends soon",
    status: { domain: "consent", value: "active" },
    subjectId,
    deepLink,
    next: "Ask the household whether to renew, or let it end",
    why: `It ends within ${ex.accessEndingDays} days (hospice setting). Renewing needs the household's confirmation; letting it end is recorded.`,
    source: "rule",
    dueBy: until,
    since: new Date(until.getTime() - ex.accessEndingDays * DAY),
    priority: "routine",
    priorityReason: "Access ends soon",
    link: deepLink,
    subject: { ids: [subjectId] },
  });
  for (const c of allConsents)
    if (effectiveConsentState(c) === "active" && ending(c.expiresAt))
      items.push({
        ...endingRow(
          `access_ending:consent:${c.id}`,
          c.householdId,
          `Consent to share with ${c.recipientName}`,
          c.expiresAt,
          `/staff/households/${c.householdId}/consents/${c.id}`,
          c.id,
        ),
        basis: { text: await consentLine(c), until: c.expiresAt },
      });
  const releasedPackets = await db
    .select()
    .from(s.packets)
    .where(and(eq(s.packets.tenantId, T), inArray(s.packets.householdId, ids)));
  const access = releasedPackets.length
    ? await db
        .select()
        .from(s.packetRecipientAccess)
        .where(
          and(
            eq(s.packetRecipientAccess.tenantId, T),
            inArray(
              s.packetRecipientAccess.packetId,
              releasedPackets.map((p) => p.id),
            ),
            isNull(s.packetRecipientAccess.revokedAt),
          ),
        )
    : [];
  const views = access.length
    ? await db
        .select()
        .from(s.packetAccessLog)
        .where(
          and(
            eq(s.packetAccessLog.tenantId, T),
            inArray(
              s.packetAccessLog.packetId,
              access.map((a) => a.packetId),
            ),
            eq(s.packetAccessLog.action, "viewed"),
          ),
        )
    : [];
  for (const a of access) {
    const p = releasedPackets.find((x) => x.id === a.packetId)!;
    if (ending(a.expiresAt))
      items.push(
        endingRow(
          `access_ending:packet:${p.id}`,
          p.householdId,
          `${p.recipientName}'s access to “${p.purpose}”`,
          a.expiresAt,
          `/staff/packets/${p.id}`,
          p.id,
        ),
      );
    // Waiting on a partner: released, still open, and not opened after the hospice's threshold.
    const opened = views.some((v) => v.packetId === a.packetId && v.actorId === a.recipientActorId);
    if (
      !opened &&
      a.expiresAt.getTime() > now.getTime() &&
      now.getTime() - a.grantedAt.getTime() >= ex.recipientUnopenedHours * HOUR
    )
      items.push({
        kind: "recipient_unopened",
        key: `recipient_unopened:packet:${p.id}`,
        householdId: p.householdId,
        household: name(p.householdId),
        summary: `${p.recipientName} hasn't opened “${p.purpose}”`,
        ...guideRow(p.householdId),
        state: "Released, not opened",
        status: { domain: "packet", value: "released" },
        subjectId: p.id,
        deepLink: `/staff/packets/${p.id}`,
        next: `Call ${p.recipientName}, or check the named contact`,
        why: `Released more than ${ex.recipientUnopenedHours} hours ago (hospice setting) and not opened by the named recipient.`,
        source: "partner",
        since: new Date(a.grantedAt.getTime() + ex.recipientUnopenedHours * HOUR),
        priority: "routine",
        priorityReason: "Waiting on an outside organization",
        link: `/staff/packets/${p.id}`,
        subject: { ids: [p.id] },
      });
  }
  const helpers = await db
    .select({ m: s.memberships, name: s.actors.displayName })
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, T),
        inArray(s.memberships.householdId, ids),
        eq(s.memberships.status, "active"),
        eq(s.actors.kind, "family"),
      ),
    );
  for (const { m, name: who } of helpers)
    if (m.expiresAt && ending(m.expiresAt))
      items.push(
        endingRow(
          `access_ending:membership:${m.id}`,
          m.householdId!,
          `${who}'s access as ${ROLE_LABELS[m.roleCode as HouseholdRole]?.toLowerCase() ?? "a helper"}`,
          m.expiresAt,
          `/staff/households/${m.householdId}?tab=overview`,
          m.id,
        ),
      );

  // Team coverage (operations): stalled handoffs, and households without an available care guide.
  if (can(ctx.staffRoles, "staff.assignment.manage")) {
    const hos = await db
      .select()
      .from(s.handoffs)
      .where(and(eq(s.handoffs.tenantId, T), inArray(s.handoffs.householdId, ids)));
    const hoNames = await actorNames(
      db,
      T,
      hos.map((h) => h.toActorId),
    );
    for (const h of hos) {
      const later = hos.some(
        (x) =>
          x.householdId === h.householdId &&
          x.id !== h.id &&
          x.offeredAt > h.offeredAt &&
          x.state !== "withdrawn",
      );
      const stalled =
        (h.state === "offered" && h.acceptBy.getTime() < now.getTime()) ||
        (h.state === "declined" && !later && (h.respondedAt?.getTime() ?? 0) > now.getTime() - 14 * DAY);
      if (!stalled) continue;
      const to = hoNames.get(h.toActorId) ?? "the care guide";
      items.push({
        kind: "handoff",
        key: `handoff:handoff:${h.id}`,
        householdId: h.householdId,
        household: name(h.householdId),
        summary: `${h.kind === "cover" ? "Cover" : "Handoff"} offered to ${to}`,
        owner: null,
        state:
          h.state === "declined"
            ? `Declined: ${h.declineReason ?? "no reason recorded"}`
            : "Not accepted yet",
        status: { domain: "transition", value: "proposed" },
        subjectId: h.id,
        deepLink: "/staff/team",
        next: h.state === "declined" ? "Offer it to someone else" : `Reassign, or ask ${to} to accept`,
        why:
          h.state === "declined"
            ? `${to} declined it (decision 61).`
            : `Not accepted within ${ex.handoffAcceptHours} hours (hospice setting).`,
        source: "rule",
        dueBy: h.acceptBy,
        since: h.state === "declined" ? (h.respondedAt ?? h.offeredAt) : h.acceptBy,
        priority: "normal",
        priorityReason: "A household's handoff is stuck",
        link: "/staff/team",
        subject: { ids: [h.id] },
      });
    }
    const absences = await db
      .select()
      .from(s.staffAbsences)
      .where(and(eq(s.staffAbsences.tenantId, T), isNull(s.staffAbsences.cancelledAt)));
    const away = (actorId: string) =>
      absences.find(
        (a) =>
          a.actorId === actorId &&
          a.endsAt.getTime() > now.getTime() &&
          a.startsAt.getTime() <= now.getTime() + 3 * DAY,
      );
    for (const h of hh) {
      if (h.lifecycleState === "closed") continue;
      const guides = await careGuidesFor(db, T, h.id);
      const absent = guides.map((g) => ({ g, a: away(g.actorId) }));
      const covered = hos.some(
        (x) => x.householdId === h.id && x.state === "accepted" && (x.endsAt?.getTime() ?? 0) > now.getTime(),
      );
      const gap = guides.length === 0 || (!covered && absent.every((x) => x.a));
      if (!gap) continue;
      const first = absent[0];
      items.push({
        kind: "coverage",
        key: `coverage:household:${h.id}`,
        householdId: h.id,
        household: h.displayName,
        // "Will be away" until the absence starts; its exact start is the row's Due by.
        summary: guides.length
          ? `${first!.g.name} ${first!.a!.startsAt.getTime() > now.getTime() ? "will be away soon" : "is away"}; no cover accepted`
          : "No care guide assigned",
        owner: null,
        state: guides.length ? "Cover needed" : "Not assigned",
        status: { domain: "household", value: h.lifecycleState },
        subjectId: null,
        deepLink: `/staff/households/${h.id}?tab=overview#care-team`,
        next: guides.length ? "Offer cover" : "Assign a care guide",
        why: guides.length
          ? "Every care guide for this household is away (or will be within 3 days), and no cover has been accepted."
          : "No care guide is assigned to this household.",
        source: "rule",
        dueBy: first?.a?.startsAt ?? null,
        since: first?.a?.createdAt ?? h.enrolledAt,
        priority: "high",
        priorityReason: "A household has no available care guide",
        link: `/staff/households/${h.id}?tab=overview#care-team`,
        subject: { household: h.id, actions: ["assignment.created", "assignment.ended"] },
      });
    }
  }

  // Bereavement check-ins whose planned date has arrived (contact not paused).
  if (hh.some((h) => h.lifecycleState === "bereavement")) {
    const w = await bereavementWorkload(db, ctx, now);
    for (const c of w.open)
      if (!c.paused && c.dueOn.getTime() <= now.getTime())
        items.push({
          kind: "checkin",
          key: `checkin:bereavement_contact:${c.id}`,
          householdId: c.householdId,
          household: c.household,
          summary: c.label,
          ...guideRow(c.householdId),
          state: "Planned date reached",
          status: { domain: "checkIn", value: "planned" },
          subjectId: c.id,
          deepLink: `/staff/households/${c.householdId}?tab=overview#checkin-${c.id}`,
          next: "Log the check-in",
          why: "A planned bereavement check-in's date has arrived, and the household hasn't paused contact.",
          source: "rule",
          dueBy: c.dueOn,
          since: c.dueOn,
          priority: "routine",
          priorityReason: "A planned check-in is due",
          link: `/staff/bereavement`,
          subject: { ids: [c.id] },
        });
  }

  // Last action: the most recent audit event that explains each item — its kind, actor and time only.
  const subjectIds = [...new Set(items.flatMap((i) => i.subject.ids ?? []))];
  const bySubject = new Map<string, (typeof s.auditEvents.$inferSelect)[]>();
  if (subjectIds.length)
    for (const e of await db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.tenantId, T), inArray(s.auditEvents.subjectId, subjectIds)))
      .orderBy(desc(s.auditEvents.seq)))
      if (e.subjectId) bySubject.set(e.subjectId, [...(bySubject.get(e.subjectId) ?? []), e]);
  const householdActions = [...new Set(items.flatMap((i) => i.subject.actions ?? []))];
  const byHouseholdAction = new Map<string, typeof s.auditEvents.$inferSelect>();
  if (householdActions.length)
    for (const e of await db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.tenantId, T),
          inArray(s.auditEvents.householdId, ids),
          inArray(s.auditEvents.action, householdActions),
        ),
      )
      .orderBy(desc(s.auditEvents.seq))) {
      const key = `${e.householdId}|${e.action}`;
      if (!byHouseholdAction.has(key)) byHouseholdAction.set(key, e);
    }
  const lastFor = (i: Draft) => {
    if (i.subject.ids) {
      const keep = i.subject.only ?? (() => true);
      const found = i.subject.ids
        .flatMap((id) => bySubject.get(id) ?? [])
        .filter(keep)
        .sort((a, b) => b.seq - a.seq);
      return found[0] ?? null;
    }
    const found = (i.subject.actions ?? [])
      .map((a) => byHouseholdAction.get(`${i.subject.household}|${a}`))
      .filter((e): e is typeof s.auditEvents.$inferSelect => !!e)
      .sort((a, b) => b.seq - a.seq);
    return found[0] ?? null;
  };
  const lasts = items.map(lastFor);
  const actorNameMap = await actorNames(
    db,
    T,
    lasts.map((e) => e?.actorId ?? null),
  );
  // The hospice's queue thresholds (decision 39): off unless operations set them.
  const thresholds = (await orgSettings(db, T, ctx.organizationId)).queue;
  const raised = (kind: string, priority: QueueRow["priority"], reason: string, since: Date) => {
    const hours = (now.getTime() - since.getTime()) / 3_600_000;
    if (
      kind === "message" &&
      thresholds.messageHighAfterHours !== null &&
      hours >= thresholds.messageHighAfterHours
    )
      return {
        priority: "high" as const,
        priorityReason: `Waiting longer than ${thresholds.messageHighAfterHours} hours (hospice setting)`,
      };
    if (
      priority === "routine" &&
      thresholds.routineNormalAfterDays !== null &&
      hours >= thresholds.routineNormalAfterDays * 24
    )
      return {
        priority: "normal" as const,
        priorityReason: `Waiting longer than ${thresholds.routineNormalAfterDays} days (hospice setting)`,
      };
    return { priority, priorityReason: reason };
  };
  // Packets rest on the consent they were drafted under (direction refinement D-2).
  const consentById = new Map(allConsents.map((c) => [c.id, c]));
  for (const i of items) {
    const isPacket =
      i.kind === "packet" ||
      i.kind === "recipient_unopened" ||
      (i.kind === "access_ending" && i.key?.startsWith("access_ending:packet:"));
    if (!isPacket || i.basis) continue;
    const p = releasedPackets.find((x) => x.id === i.subjectId);
    const c = p?.consentId ? consentById.get(p.consentId) : undefined;
    i.basis = c
      ? {
          // A draft or held packet hasn't shared anything yet.
          text: `${i.kind === "packet" ? "Drafted under" : "Shared under"}: ${await consentLine(c)}`,
          until: c.expiresAt,
        }
      : { text: "No consent is linked to this packet yet", until: null };
  }
  // People's part of rule-derived exceptions: owner, waiting, dismissal (decision 58).
  const claims = new Map(
    (
      await db
        .select()
        .from(s.exceptionClaims)
        .where(and(eq(s.exceptionClaims.tenantId, T), inArray(s.exceptionClaims.householdId, ids)))
    ).map((c) => [c.key, c]),
  );
  const claimNames = await actorNames(
    db,
    T,
    [...claims.values()].map((c) => c.ownerActorId),
  );
  const rows: QueueRow[] = [];
  items.forEach(({ subject: _subject, sinceFromLastAction, escalationKind, key, ...i }, k) => {
    const e = lasts[k];
    // "Waiting" counts from the last change of state where one is recorded (section 3).
    const since = sinceFromLastAction && e && e.createdAt > i.since ? e.createdAt : i.since;
    const id = key ?? `${i.kind}:${i.subjectId ?? i.householdId}`;
    const category = categoryOf(i.kind, escalationKind);
    const claimable = i.kind !== "escalation" && i.kind !== "task";
    const claim = claimable ? claims.get(id) : undefined;
    // A dismissal covers the occurrence it was made on: the row comes back if what raised it has
    // happened again since (a packet held after its draft row was dismissed, access renewed and ending
    // again). Coordination risk comes back after 7 days.
    if (
      claim?.dismissedAt &&
      (i.kind === "risk"
        ? claim.dismissedAt.getTime() > now.getTime() - 7 * DAY
        : claim.dismissedAt.getTime() >= since.getTime())
    )
      return;
    let urgency = raised(i.kind, i.priority, i.priorityReason, since);
    let next = i.next;
    let dueBy = i.dueBy ?? null;
    // Unread critical update: unacknowledged past the hospice's threshold.
    if (i.kind === "acknowledgement") {
      dueBy = new Date(i.since.getTime() + ex.ackOverdueHours * HOUR);
      if (now.getTime() >= dueBy.getTime()) {
        urgency = {
          priority: "normal",
          priorityReason: `Unacknowledged for more than ${ex.ackOverdueHours} hours (hospice setting)`,
        };
        next = "Call them; then record that you reached them";
      }
    }
    if (i.kind === "message" && thresholds.messageHighAfterHours !== null)
      dueBy = new Date(i.since.getTime() + thresholds.messageHighAfterHours * HOUR);
    const owner = claim?.ownerActorId ? (claimNames.get(claim.ownerActorId) ?? "Someone") : i.owner;
    const ownerIds = claim?.ownerActorId ? [claim.ownerActorId] : (i.ownerIds ?? []);
    const waitingOn = claim?.state === "waiting" ? (claim.waitingOn ?? null) : null;
    rows.push({
      ...i,
      ...urgency,
      next,
      owner,
      state: waitingOn
        ? `Waiting on ${waitingOn === "partner" ? "a partner" : waitingOn === "family" ? "the family" : "staff"}${claim?.waitingNote ? `: ${claim.waitingNote}` : ""}`
        : i.state,
      since,
      id,
      dueAt: i.dueAt ?? null,
      due: dueState(i.dueAt ?? null, now),
      subjectId: i.subjectId ?? null,
      deepLink: i.deepLink ?? i.link,
      action: i.action ?? null,
      assignable: i.assignable ?? false,
      lastAction: e
        ? {
            actor: e.actorId ? (actorNameMap.get(e.actorId) ?? "Someone") : "The system",
            did: actionLabel(e.action),
            at: e.createdAt,
          }
        : null,
      age: ageLabel(since, now),
      ageShort: shortAgeLabel(since, now),
      ownerIds,
      mine: ownerIds.includes(ctx.actorId),
      takeEscalationId: i.takeEscalationId ?? null,
      category,
      source: i.source ?? "rule",
      dueBy,
      dismissable: !NOT_DISMISSABLE.includes(category),
      claimable,
      claimed: !!claim?.ownerActorId,
      waitingOn,
      waitingNote: waitingOn ? (claim?.waitingNote ?? null) : null,
      basis: i.basis ?? null,
    });
  });

  // Coordination risk (operations): named operational signals only, never a score about a person.
  if (can(ctx.staffRoles, "staff.lifecycle.manage")) {
    const contact = await db
      .select({ householdId: s.auditEvents.householdId, at: s.auditEvents.createdAt })
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.tenantId, T),
          inArray(s.auditEvents.householdId, ids),
          inArray(s.auditEvents.action, ["message.sent", "update.posted", "update.reached_by_phone"]),
          gt(s.auditEvents.createdAt, new Date(now.getTime() - ex.noTeamContactDays * DAY)),
        ),
      );
    const staffContact = new Set(contact.map((c) => c.householdId));
    for (const h of hh) {
      if (h.lifecycleState !== "active_hospice") continue;
      const open = rows.filter((r) => r.householdId === h.id && r.category !== "setup");
      const signals = [
        open.length >= ex.coordinationRiskOpenCount ? `${open.length} open exceptions` : null,
        !staffContact.has(h.id)
          ? `no message, update or call recorded in ${ex.noTeamContactDays} days`
          : null,
      ].filter((x): x is string => !!x);
      if (!signals.length) continue;
      const rid = `risk:household:${h.id}`;
      const claim = claims.get(rid);
      if (claim?.dismissedAt && claim.dismissedAt.getTime() > now.getTime() - 7 * DAY) continue;
      const since = open.reduce((m, r) => (r.since < m ? r.since : m), now);
      rows.push({
        kind: "risk",
        householdId: h.id,
        household: h.displayName,
        summary: "Several things are stuck for this household",
        owner: claim?.ownerActorId ? (claimNames.get(claim.ownerActorId) ?? "Someone") : null,
        ownerIds: claim?.ownerActorId ? [claim.ownerActorId] : [],
        mine: claim?.ownerActorId === ctx.actorId,
        state: signals.join("; "),
        status: { domain: "household", value: h.lifecycleState },
        subjectId: null,
        deepLink: `/staff/households/${h.id}?tab=overview`,
        link: `/staff/households/${h.id}?tab=overview`,
        next: "Open the record",
        why: `Coordination risk lists the operational signals that tripped it: ${signals.join("; ")}. It is not a score about the patient or family.`,
        since,
        priority: "normal",
        priorityReason: "Operational signals for one household",
        id: rid,
        dueAt: null,
        due: null,
        action: null,
        assignable: false,
        lastAction: null,
        age: ageLabel(since, now),
        ageShort: shortAgeLabel(since, now),
        takeEscalationId: null,
        category: "risk",
        source: "rule",
        dueBy: null,
        dismissable: true,
        claimable: true,
        claimed: !!claim?.ownerActorId,
        waitingOn: null,
        waitingNote: null,
        basis: null,
      });
    }
  }
  return rows.sort(byPriorityThenAge);
}

/* ------------------------------------------------------------------ dashboard and search */

export async function staffHome(db: DB, ctx: ActorContext) {
  const hh = await visibleHouseholds(db, ctx);
  const queue = await coordinationQueue(db, ctx);
  const byKind = (k: QueueItem["kind"]) => queue.filter((q) => q.kind === k).length;
  const lifecycleCounts = Object.fromEntries(
    (["enrolled", "active_hospice", "bereavement", "closed"] as LifecycleState[]).map((l) => [
      l,
      hh.filter((h) => h.lifecycleState === l).length,
    ]),
  );
  let onboarded = 0;
  for (const h of hh) if ((await onboardingState(db, ctx.tenantId, h.id)).complete) onboarded++;
  const recent = await recentlyUpdated(db, ctx, hh);
  return {
    me: { name: ctx.displayName, roles: ctx.staffRoles.map((r) => ROLE_LABELS[r]) },
    /** A care guide with no household assignments yet: they see an explanation, not empty counts. */
    unassigned:
      ctx.staffRoles.length > 0 && ctx.staffRoles.every((r) => r === "care_guide") && hh.length === 0,
    canReview: can(ctx.staffRoles, "authority.review"),
    canActivate: can(ctx.staffRoles, "consent.activate"),
    canConfirmTransitions: can(ctx.staffRoles, "lifecycle.confirm"),
    canResolveCorrections: can(ctx.staffRoles, "consent.record"),
    /**
     * Decision 29b: operations are told until their hospice sets an expected reply time; until then
     * families see the fixed decision-24 sentence.
     */
    replyTimeMissing:
      can(ctx.staffRoles, "org.settings.manage") && !!ctx.organizationId
        ? !(await currentMessageExpectation(db, ctx.tenantId, ctx.organizationId))?.replyTime
        : false,
    households: hh.map((h) => ({
      id: h.id,
      name: h.displayName,
      lifecycle: h.lifecycleState as LifecycleState,
      lifecycleLabel: LIFECYCLE_LABELS[h.lifecycleState as LifecycleState],
      waiting: queue.filter((q) => q.householdId === h.id).length,
    })),
    counts: {
      messages: byKind("message"),
      acknowledgements: byKind("acknowledgement"),
      tasks: byKind("task"),
      escalations: byKind("escalation"),
      packets: byKind("packet"),
      authority: byKind("authority"),
      transitions: byKind("transition"),
      consents: byKind("consent"),
      corrections: byKind("correction"),
    },
    /** The top five; the dashboard links to the full queue for the rest. */
    queue: queue.slice(0, 5),
    queueTotal: queue.length,
    /** "My work" (staff rework, section 2): my open items (top 10) and unassigned escalations (top 5). */
    // Due work first, so an overdue task isn't buried under older items.
    mine: queue
      .filter((q) => q.mine)
      .sort(dueFirst)
      .slice(0, 10),
    mineTotal: queue.filter((q) => q.mine).length,
    unowned: queue.filter((q) => q.kind === "escalation" && q.ownerIds.length === 0).slice(0, 5),
    unownedTotal: queue.filter((q) => q.kind === "escalation" && q.ownerIds.length === 0).length,
    /** Households by their latest recorded activity (kind and time only; never content). */
    recent,
    /** The role home (decision 58, workstream 4): widgets built from the same exceptions. */
    center: await commandCenter(db, ctx, queue, recent),
    /** Operations view: enrollment and workflow health for the pilot (10–25 households). */
    pilot: ctx.staffRoles.includes("hospice_ops")
      ? { enrolled: hh.length, cap: 25, lifecycleCounts, onboardingComplete: onboarded }
      : null,
  };
}

export async function searchHouseholds(db: DB, ctx: ActorContext, q: string) {
  const hh = await visibleHouseholds(db, ctx);
  const needle = q.trim().toLowerCase();
  const ids = hh.map((h) => h.id);
  const people =
    needle && ids.length
      ? await db
          .select({ householdId: s.memberships.householdId })
          .from(s.memberships)
          .innerJoin(
            s.actors,
            and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
          )
          .where(
            and(
              eq(s.memberships.tenantId, ctx.tenantId),
              inArray(s.memberships.householdId, ids),
              ilike(s.actors.displayName, `%${needle}%`),
            ),
          )
      : [];
  const guides = await careGuideNames(db, ctx.tenantId, ids);
  // At a glance: open coordination items (the same queue the viewer sees) and latest activity.
  const queue = await coordinationQueue(db, ctx);
  const latest = ids.length
    ? await db
        .select({ householdId: s.auditEvents.householdId, at: sql<Date>`max(${s.auditEvents.createdAt})` })
        .from(s.auditEvents)
        .where(and(eq(s.auditEvents.tenantId, ctx.tenantId), inArray(s.auditEvents.householdId, ids)))
        .groupBy(s.auditEvents.householdId)
    : [];
  return hh
    .filter(
      (h) =>
        !needle ||
        h.displayName.toLowerCase().includes(needle) ||
        h.patientName.toLowerCase().includes(needle) ||
        people.some((p) => p.householdId === h.id),
    )
    .map((h) => ({
      id: h.id,
      name: h.displayName,
      patientName: h.patientName,
      lifecycle: h.lifecycleState as LifecycleState,
      lifecycleLabel: LIFECYCLE_LABELS[h.lifecycleState as LifecycleState],
      careGuides: guides.get(h.id) ?? [],
      openItems: queue.filter((q) => q.householdId === h.id).length,
      lastActivity: (() => {
        const at = latest.find((l) => l.householdId === h.id)?.at;
        return at ? new Date(at) : null;
      })(),
    }));
}

/* ------------------------------------------------------------------ household overview */

export async function householdOverview(db: DB, ctx: ActorContext, householdId: string) {
  const scope = await staffScope(db, ctx, householdId, "staff.household.view");
  const T = ctx.tenantId;
  const H = scope.householdId;
  const [h] = await db
    .select()
    .from(s.households)
    .where(and(eq(s.households.tenantId, T), eq(s.households.id, H)));
  const members = await householdMembers(db, T, H);
  // How each member asked their care guide to reach them (Settings). Shown to the care team only.
  const contactPrefs = members.length
    ? await db
        .select({ actorId: s.preferences.actorId, method: s.preferences.contactMethod })
        .from(s.preferences)
        .where(
          and(
            eq(s.preferences.tenantId, T),
            inArray(
              s.preferences.actorId,
              members.map((m) => m.actorId),
            ),
          ),
        )
    : [];
  const ended = await db
    .select({
      actorId: s.memberships.actorId,
      role: s.memberships.roleCode,
      reason: s.memberships.endReason,
      name: s.actors.displayName,
    })
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(eq(s.memberships.tenantId, T), eq(s.memberships.householdId, H), eq(s.memberships.status, "ended")),
    );
  const guides = await careGuidesFor(db, T, H);
  const [record] = await db
    .select()
    .from(s.careCoordinationRecords)
    .where(and(eq(s.careCoordinationRecords.tenantId, T), eq(s.careCoordinationRecords.householdId, H)));
  const on = await onboardingState(db, T, H);
  const tasks = await db
    .select()
    .from(s.tasks)
    .where(and(eq(s.tasks.tenantId, T), eq(s.tasks.householdId, H)))
    .orderBy(s.tasks.status, desc(s.tasks.createdAt));
  const updates = await db
    .select()
    .from(s.familyUpdates)
    .where(and(eq(s.familyUpdates.tenantId, T), eq(s.familyUpdates.householdId, H)))
    .orderBy(desc(s.familyUpdates.createdAt));
  const acks = await db
    .select()
    .from(s.acknowledgements)
    .where(and(eq(s.acknowledgements.tenantId, T), eq(s.acknowledgements.householdId, H)));
  const msgs = await db
    .select()
    .from(s.messages)
    .where(and(eq(s.messages.tenantId, T), eq(s.messages.householdId, H)))
    .orderBy(s.messages.createdAt);
  const notes = can(ctx.staffRoles, "staff.note.view")
    ? await db
        .select()
        .from(s.staffNotes)
        .where(and(eq(s.staffNotes.tenantId, T), eq(s.staffNotes.householdId, H)))
        .orderBy(desc(s.staffNotes.createdAt))
    : [];
  // Decision 43: the care team sees items shared with staff or the household — never one that's
  // private to someone or shared only with selected people.
  const vault = (
    await db
      .select()
      .from(s.vaultItems)
      .where(and(eq(s.vaultItems.tenantId, T), eq(s.vaultItems.householdId, H)))
      .orderBy(s.vaultItems.createdAt, s.vaultItems.id)
  ).filter(staffMaySeeVaultItem);
  const consents = await db
    .select()
    .from(s.consents)
    .where(and(eq(s.consents.tenantId, T), eq(s.consents.householdId, H)));
  const packets = await db
    .select()
    .from(s.packets)
    .where(and(eq(s.packets.tenantId, T), eq(s.packets.householdId, H)))
    .orderBy(desc(s.packets.updatedAt));
  const escalations = await db
    .select()
    .from(s.escalations)
    .where(and(eq(s.escalations.tenantId, T), eq(s.escalations.householdId, H)))
    .orderBy(desc(s.escalations.createdAt));
  const transitions = await db
    .select()
    .from(s.bereavementTransitions)
    .where(and(eq(s.bereavementTransitions.tenantId, T), eq(s.bereavementTransitions.householdId, H)))
    .orderBy(desc(s.bereavementTransitions.proposedAt));
  const audit = await db
    .select()
    .from(s.auditEvents)
    .where(and(eq(s.auditEvents.tenantId, T), eq(s.auditEvents.householdId, H)))
    .orderBy(desc(s.auditEvents.seq))
    .limit(200);
  const names = await actorNames(db, T, [
    ...tasks.flatMap((t) => [t.assigneeActorId, t.ownerActorId]),
    ...updates.map((u) => u.authorActorId),
    ...updates.flatMap((u) => u.audienceActorIds ?? []),
    ...msgs.map((m) => m.authorActorId),
    ...notes.map((n) => n.authorActorId),
    ...acks.map((a) => a.actorId),
    ...audit.map((a) => a.actorId),
    ...escalations.map((e) => e.ownerActorId),
    ...transitions.flatMap((t) => [t.proposedByActorId, t.confirmedByActorId, t.survivingContactActorId]),
    ...vault.map((v) => v.reviewedByActorId),
  ]);
  const n = (id: string | null) => (id ? (names.get(id) ?? "") : null);
  const ackers = await membersWho(db, T, H, scope.lifecycle, { permission: "updates.acknowledge" });
  await markLinkRead(db, T, ctx.actorId, `/staff/households/${H}`);
  const [hh] = await db
    .select({ org: s.households.organizationId })
    .from(s.households)
    .where(and(eq(s.households.tenantId, ctx.tenantId), eq(s.households.id, scope.householdId)));
  const expectation = hh ? await currentMessageExpectation(db, ctx.tenantId, hh.org) : null;
  return {
    /** What families of this hospice are told about routine messages (null: nothing is promised). */
    expectation,
    household: {
      id: h!.id,
      name: h!.displayName,
      patientName: h!.patientName,
      lifecycle: scope.lifecycle,
      lifecycleLabel: LIFECYCLE_LABELS[scope.lifecycle],
      enrolledAt: h!.enrolledAt,
    },
    members: members.map((m) => ({
      actorId: m.actorId,
      name: m.name,
      roles: m.roles.map((r) => ROLE_LABELS[r]),
      contactPreference:
        CONTACT_LABELS[contactPrefs.find((p) => p.actorId === m.actorId)?.method ?? "in_app"],
    })),
    endedMembers: ended.map((e) => ({
      name: e.name,
      role: ROLE_LABELS[e.role as HouseholdRole],
      reason: e.reason,
    })),
    careGuides: guides.map((g) => g.name),
    careTeam: await careTeam(db, ctx, scope),
    /** The hospice's task catalog (decision 39): common tasks to start from. */
    taskCatalog: (await orgSettings(db, T, ctx.organizationId)).taskCatalog,
    bereavementPlan: await staffPlan(db, ctx, H),
    record: record ?? null,
    onboarding: on.steps,
    tasks: tasks.map((t) => ({
      ...t,
      assignee: n(t.assigneeActorId),
      owner: n(t.ownerActorId),
      // Decision 25: the household's care guide can mark a household task done for its assignee.
      canMarkDone:
        t.status === "open" &&
        (t.audience === "staff"
          ? can(ctx.staffRoles, "staff.task.manage", scope.lifecycle)
          : can(ctx.staffRoles, "staff.task.manage", scope.lifecycle) &&
            guides.some((g) => g.actorId === ctx.actorId)),
    })),
    updates: updates.map((u) => ({
      ...u,
      // A system update (decision 62) has no author; staff see who it was addressed to.
      author: u.authorActorId ? n(u.authorActorId) : "System",
      audienceNames: u.audienceActorIds ? u.audienceActorIds.map((id) => n(id) ?? "") : null,
      ackedBy: acks
        .filter((a) => a.subjectType === "update" && a.subjectId === u.id)
        .map((a) => n(a.actorId)),
      waitingOn: u.requiresAck
        ? ackers
            .filter((m) => !acks.some((a) => a.subjectId === u.id && a.actorId === m.actorId))
            .map((m) => m.name)
        : [],
    })),
    messages: msgs.map((m) => ({ ...m, author: n(m.authorActorId) })),
    notes: notes.map((x) => ({ ...x, author: n(x.authorActorId) })),
    vault: vault.map((v) => ({
      id: v.id,
      title: v.title,
      status: v.status,
      sensitivity: v.sensitivity,
      audience: v.audience,
      keptWhere: v.keptWhere,
      reviewedAt: v.reviewedAt,
      reviewedBy: n(v.reviewedByActorId),
    })),
    consents: consents.map((c) => ({
      id: c.id,
      purpose: c.purpose,
      recipientName: c.recipientName,
      state: effectiveConsentState(c),
      expiresAt: c.expiresAt,
    })),
    packets: packets.map((p) => ({
      id: p.id,
      purpose: p.purpose,
      recipientName: p.recipientName,
      state: p.state,
      lastReasonCode: p.lastReasonCode,
    })),
    escalations: escalations.map((e) => ({ ...e, owner: n(e.ownerActorId) })),
    transitions: transitions.map((t) => ({
      ...t,
      proposedBy: n(t.proposedByActorId),
      confirmedBy: n(t.confirmedByActorId),
      survivingContact: n(t.survivingContactActorId),
    })),
    // Coordination Record v2 (decision 58): role at the time, source and the record each event is about.
    audit: await timelineEvents(db, T, H, audit),
    /** The record's context column: participants, care team and history, organizations, open items. */
    context: await recordContext(db, ctx, scope),
    /** Synthetic prepared drafts, only while a demo snapshot is loaded (decision 58, workstream 5). */
    prepared: await preparedDrafts(db, ctx, H),
    /** For the record header (staff rework, section 5). */
    hotline: h?.organizationId ? await organizationHotline(db, T, h.organizationId) : null,
    canReassign: can(ctx.staffRoles, "staff.assignment.manage"),
    can: {
      compose: can(ctx.staffRoles, "staff.update.compose", scope.lifecycle),
      message: can(ctx.staffRoles, "staff.thread.send", scope.lifecycle),
      note: can(ctx.staffRoles, "staff.note.write", scope.lifecycle),
      tasks: can(ctx.staffRoles, "staff.task.manage", scope.lifecycle),
      propose:
        can(ctx.staffRoles, "lifecycle.propose", scope.lifecycle) &&
        canTransition(scope.lifecycle, "bereavement"),
      confirm: can(ctx.staffRoles, "lifecycle.confirm", scope.lifecycle),
      escalations: can(ctx.staffRoles, "staff.escalation.manage", scope.lifecycle),
    },
  };
}

/* ------------------------------------------------------------------ family-visible communication */

export async function composeUpdate(
  db: DB,
  ctx: ActorContext,
  input: { householdId: string; title: string; body: string; requiresAck: boolean },
) {
  const scope = await staffScope(db, ctx, input.householdId, "staff.update.compose");
  if (!input.title.trim() || !input.body.trim())
    throw new AccessError("INVALID", "An update needs a title and a message.");
  await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(s.familyUpdates)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        authorActorId: ctx.actorId,
        title: input.title.trim(),
        body: input.body.trim(),
        requiresAck: input.requiresAck,
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "update.posted",
      subjectType: "family_update",
      subjectId: u!.id,
      summary: `The care team posted an update: “${u!.title}”.`,
      visibility: "family",
    });
    const members = await membersWho(tx, ctx.tenantId, scope.householdId, scope.lifecycle, {
      permission: "updates.view",
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: members.map((m) => m.actorId),
      kind: "update",
      title: "There's a new update from your care team",
      // Opens at that update (interaction review, item 9).
      link: `/family/messages#entry-${u!.id}`,
    });
  });
}

export async function sendStaffMessage(
  db: DB,
  ctx: ActorContext,
  input: { householdId: string; body: string; prepared?: boolean | undefined },
) {
  const scope = await staffScope(db, ctx, input.householdId, "staff.thread.send");
  // Started from a synthetic prepared draft (decision 58): the person is still the actor.
  const prepared = await usedPreparedDraft(db, ctx, scope.householdId, input.prepared);
  const text = input.body.trim();
  if (!text) throw new AccessError("INVALID", "Write a message first.");
  await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(s.messages)
      .values({
        tenantId: ctx.tenantId,
        threadId: `th-${scope.householdId}`,
        householdId: scope.householdId,
        authorActorId: ctx.actorId,
        authorSide: "staff",
        body: text,
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "message.sent",
      subjectType: "message",
      subjectId: m!.id,
      summary: "The care guide replied in the message thread.",
      visibility: "family",
      ...(prepared ? { prepared: true } : {}),
    });
    const readers = await membersWho(tx, ctx.tenantId, scope.householdId, scope.lifecycle, {
      permission: "thread.view",
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: readers.map((r) => r.actorId),
      kind: "message",
      title: "You have a new message from your care guide",
      link: `/family/messages#entry-${m!.id}`,
    });
    await markLinkRead(tx, ctx.tenantId, ctx.actorId, `/staff/households/${scope.householdId}?tab=messages`);
  });
}

/** Internal note. Never shown to the household and never copied into notifications or summaries. */
export async function addStaffNote(db: DB, ctx: ActorContext, input: { householdId: string; body: string }) {
  const scope = await staffScope(db, ctx, input.householdId, "staff.note.write");
  if (!input.body.trim()) throw new AccessError("INVALID", "Write a note first.");
  await db.transaction(async (tx) => {
    const [n] = await tx
      .insert(s.staffNotes)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        authorActorId: ctx.actorId,
        body: input.body.trim(),
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "note.added",
      subjectType: "staff_note",
      subjectId: n!.id,
      summary: "An internal care-team note was added.",
      visibility: "staff",
    });
  });
}

/* ------------------------------------------------------------------ tasks */

export async function createTask(
  db: DB,
  ctx: ActorContext,
  input: {
    householdId: string;
    title: string;
    detail: string;
    audience: "family" | "staff";
    assigneeActorId: string | null;
    whenLabel: string;
    requiresAck: boolean;
    /** From a catalog task's "due in N days" (decision 39); optional. */
    dueAt?: string | null | undefined;
  },
) {
  const scope = await staffScope(db, ctx, input.householdId, "staff.task.manage");
  if (!input.title.trim()) throw new AccessError("INVALID", "A task needs a title.");
  if (input.assigneeActorId) {
    const ok =
      input.audience === "family"
        ? (await householdMembers(db, ctx.tenantId, scope.householdId)).some(
            (m) => m.actorId === input.assigneeActorId,
          )
        : (await careGuidesFor(db, ctx.tenantId, scope.householdId)).some(
            (g) => g.actorId === input.assigneeActorId,
          ) || input.assigneeActorId === ctx.actorId;
    if (!ok) throw new AccessError("INVALID", "The person you chose isn't part of this household's circle.");
  }
  await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(s.tasks)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        title: input.title.trim(),
        detail: input.detail.trim(),
        audience: input.audience,
        assigneeActorId: input.assigneeActorId,
        ownerActorId: ctx.actorId,
        whenLabel: input.whenLabel.trim() || null,
        requiresAck: input.requiresAck,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        source: "care_team",
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "task.created",
      subjectType: "task",
      subjectId: t!.id,
      summary:
        input.audience === "family"
          ? `The care team shared a task: “${t!.title}”.`
          : "An internal care-team task was added.",
      visibility: input.audience === "family" ? "family" : "staff",
    });
    if (input.assigneeActorId)
      await notify(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        recipients: [input.assigneeActorId],
        except: ctx.actorId,
        kind: "task",
        title: "A task was shared with you",
        link:
          input.audience === "family" ? "/family/tasks" : `/staff/households/${scope.householdId}?tab=tasks`,
      });
  });
}

export async function completeStaffTask(db: DB, ctx: ActorContext, taskId: string) {
  requireStaff(ctx);
  const [t] = await db
    .select()
    .from(s.tasks)
    .where(and(eq(s.tasks.tenantId, ctx.tenantId), eq(s.tasks.id, taskId)));
  if (!t) throw new AccessError("OUT_OF_SCOPE", "That task isn't available.");
  const scope = await staffScope(db, ctx, t.householdId, "staff.task.manage");
  if (t.audience === "family") {
    // Decision 25: only this household's care guide, on the assignee's behalf.
    if (!(await careGuideMayComplete(db, t, ctx.actorId)))
      throw new AccessError(
        "NOT_PERMITTED",
        "Household tasks are marked done by the person they're assigned to, the coordinator, the patient or the household's care guide.",
      );
    const assignee = t.assigneeActorId
      ? ((await actorNames(db, ctx.tenantId, [t.assigneeActorId])).get(t.assigneeActorId) ?? null)
      : null;
    await db.transaction(async (tx) => {
      const ok = await markFamilyTaskDone(
        tx,
        t,
        { actorId: ctx.actorId, name: ctx.displayName, kind: "staff" },
        assignee,
      );
      if (!ok) throw new AccessError("INVALID", "This task is already done.");
    });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(s.tasks)
      .set({ status: "done", completedAt: new Date(), completedByActorId: ctx.actorId })
      .where(eq(s.tasks.id, t.id));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "task.completed",
      subjectType: "task",
      subjectId: t.id,
      summary: "An internal care-team task was completed.",
      visibility: "staff",
    });
  });
}

/* ------------------------------------------------------------------ escalations */

export async function listEscalations(db: DB, ctx: ActorContext) {
  const hh = await visibleHouseholds(db, ctx);
  if (!hh.length) return [];
  const rows = await db
    .select()
    .from(s.escalations)
    .where(
      and(
        eq(s.escalations.tenantId, ctx.tenantId),
        inArray(
          s.escalations.householdId,
          hh.map((h) => h.id),
        ),
      ),
    )
    .orderBy(s.escalations.status, desc(s.escalations.createdAt));
  const names = await actorNames(
    db,
    ctx.tenantId,
    rows.flatMap((r) => [r.ownerActorId, r.resolvedByActorId]),
  );
  // Operations can hand an open escalation to someone who can see that household and act on it.
  const canGive = can(ctx.staffRoles, "staff.assignment.manage");
  const candidates = canGive ? await escalationOwnerCandidates(db, ctx) : null;
  const now = new Date();
  return rows.map((r) => ({
    ...r,
    /** How long it has been open ("5 d"), fixed on the server so the page doesn't change after it loads. */
    openFor: ageLabel(r.createdAt, now),
    openForShort: shortAgeLabel(r.createdAt, now),
    household: hh.find((h) => h.id === r.householdId)?.displayName ?? "",
    owner: r.ownerActorId ? (names.get(r.ownerActorId) ?? null) : null,
    resolvedBy: r.resolvedByActorId ? (names.get(r.resolvedByActorId) ?? null) : null,
    canManage: can(ctx.staffRoles, "staff.escalation.manage"),
    /** For operations: people this open escalation could be given to (never its current owner). */
    owners:
      candidates && r.status !== "resolved"
        ? candidates
            .filter((c) => c.sees(r.householdId) && c.actorId !== r.ownerActorId)
            .map((c) => ({ actorId: c.actorId, name: c.name }))
        : [],
  }));
}

/**
 * Open escalations in the households this person can see: the sidebar's Escalations count, so it
 * matches the Escalations page (the queue lists consent-correction escalations as corrections).
 */
export async function openEscalationCount(db: DB, ctx: ActorContext) {
  const hh = await visibleHouseholds(db, ctx);
  if (!hh.length) return 0;
  const rows = await db
    .select({ id: s.escalations.id })
    .from(s.escalations)
    .where(
      and(
        eq(s.escalations.tenantId, ctx.tenantId),
        inArray(
          s.escalations.householdId,
          hh.map((h) => h.id),
        ),
        ne(s.escalations.status, "resolved"),
      ),
    );
  return rows.length;
}

/**
 * Active, non-deactivated staff of the caller's organization who may own escalations, each with
 * the same household-visibility rule the app uses everywhere.
 */
export async function escalationOwnerCandidates(conn: DB, ctx: ActorContext) {
  if (!ctx.organizationId) return [];
  const rows = await conn
    .select({ actorId: s.actors.id, name: s.actors.displayName })
    .from(s.memberships)
    .innerJoin(
      s.actors,
      and(eq(s.actors.id, s.memberships.actorId), eq(s.actors.tenantId, s.memberships.tenantId)),
    )
    .where(
      and(
        eq(s.memberships.tenantId, ctx.tenantId),
        eq(s.memberships.organizationId, ctx.organizationId),
        eq(s.memberships.status, "active"),
        eq(s.actors.kind, "staff"),
        isNull(s.actors.deactivatedAt),
      ),
    )
    .orderBy(s.actors.displayName);
  const out: { actorId: string; name: string; sees: (householdId: string) => boolean }[] = [];
  for (const r of [...new Map(rows.map((x) => [x.actorId, x])).values()]) {
    const c = await loadContext(conn, r.actorId, ctx.tenantId).catch(() => null);
    if (!c || !can(c.staffRoles, "staff.escalation.manage")) continue;
    out.push({
      ...r,
      sees: (householdId) =>
        staffSeesHousehold(c, {
          id: householdId,
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId!,
        }),
    });
  }
  return out;
}

/** Operations gives an open escalation to a named person who can see the household and act on it. */
export async function giveEscalation(db: DB, ctx: ActorContext, input: { id: string; actorId: string }) {
  requireStaffPermission(ctx, "staff.assignment.manage");
  const [e] = await db
    .select()
    .from(s.escalations)
    .where(and(eq(s.escalations.tenantId, ctx.tenantId), eq(s.escalations.id, input.id)));
  if (!e) throw new AccessError("OUT_OF_SCOPE", "That escalation isn't available.");
  const scope = await staffScope(db, ctx, e.householdId, "staff.escalation.manage");
  if (e.status === "resolved") throw new AccessError("INVALID", "This is already resolved.");
  const to = (await escalationOwnerCandidates(db, ctx)).find((c) => c.actorId === input.actorId);
  if (!to || !to.sees(e.householdId))
    throw new AccessError("INVALID", "Choose someone who can see this household and work on escalations.");
  if (e.ownerActorId === to.actorId) throw new AccessError("INVALID", `${to.name} already owns this.`);
  await db.transaction(async (tx) => {
    const done = await tx
      .update(s.escalations)
      .set({ ownerActorId: to.actorId, status: "acknowledged" })
      .where(
        and(
          eq(s.escalations.tenantId, ctx.tenantId),
          eq(s.escalations.id, e.id),
          ne(s.escalations.status, "resolved"),
        ),
      )
      .returning({ id: s.escalations.id });
    if (!done.length) throw new AccessError("CONFLICT", "This escalation was just resolved by someone else.");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "escalation.owner_assigned",
      subjectType: "escalation",
      subjectId: e.id,
      summary: `${ctx.displayName} gave this escalation to ${to.name}.`,
      visibility: "staff",
      context: { from: e.ownerActorId, to: to.actorId },
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      recipients: [to.actorId],
      householdId: scope.householdId,
      kind: "handoff",
      title: "An escalation was given to you",
      link: "/staff/exceptions?view=all&kind=escalation",
      except: ctx.actorId,
    });
  });
}

/** A person takes ownership, then resolves with a note. The system never closes these on its own except when a reviewer clears an authority conflict. */
export async function updateEscalation(
  db: DB,
  ctx: ActorContext,
  input: {
    id: string;
    action: "take" | "resolve";
    resolution?: string | undefined;
    /** Resolving someone else's escalation: they confirmed taking it over first (item 16). */
    takeOver?: boolean | undefined;
    /** "Let the family know": a short message to the household thread, shown in a preview first. */
    familyMessage?: string | undefined;
  },
) {
  requireStaff(ctx);
  const [e] = await db
    .select()
    .from(s.escalations)
    .where(and(eq(s.escalations.tenantId, ctx.tenantId), eq(s.escalations.id, input.id)));
  if (!e) throw new AccessError("OUT_OF_SCOPE", "That escalation isn't available.");
  const scope = await staffScope(db, ctx, e.householdId, "staff.escalation.manage");
  if (e.status === "resolved") throw new AccessError("INVALID", "This is already resolved.");
  if (input.action === "resolve" && e.kind === "consent_correction")
    throw new AccessError(
      "INVALID",
      "Resolve a correction request from the household's consent — change the terms, withdraw it, or dismiss it with an explanation — so the request and the consent stay in step.",
    );
  if (input.action === "resolve" && !input.resolution?.trim())
    throw new AccessError("INVALID", "Add a short note about how this was resolved.");
  // Item 16: resolve only what you own. Unowned: take ownership first. Someone else's: an explicit
  // take-over, recorded with who owned it before.
  const takingOver = input.action === "resolve" && !!e.ownerActorId && e.ownerActorId !== ctx.actorId;
  // Unowned: take ownership first — or, confirmed in one step, take it and resolve it.
  const takingUnowned = input.action === "resolve" && !e.ownerActorId;
  if (takingUnowned && !input.takeOver)
    throw new AccessError("INVALID", "Take ownership first, then resolve it.");
  if (takingOver && !input.takeOver) {
    const owner =
      (await actorNames(db, ctx.tenantId, [e.ownerActorId])).get(e.ownerActorId!) ?? "someone else";
    throw new AccessError("CONFLICT", `${owner} owns this. Take it over to resolve it.`);
  }
  const familyMessage = input.action === "resolve" ? input.familyMessage?.trim().slice(0, 600) : undefined;
  if (familyMessage) await staffScope(db, ctx, e.householdId, "staff.thread.send");
  await db.transaction(async (tx) => {
    if (input.action === "take")
      await tx
        .update(s.escalations)
        .set({ status: "acknowledged", ownerActorId: ctx.actorId })
        .where(
          and(
            eq(s.escalations.tenantId, ctx.tenantId),
            eq(s.escalations.id, e.id),
            eq(s.escalations.status, "open"),
          ),
        )
        .returning({ id: s.escalations.id })
        .then((r) => {
          if (!r.length)
            throw new AccessError(
              "CONFLICT",
              "Someone else just took or resolved this escalation. Refresh to see who.",
            );
        });
    else {
      if (takingUnowned)
        await appendAudit(tx, {
          tenantId: ctx.tenantId,
          householdId: scope.householdId,
          actorId: ctx.actorId,
          action: "escalation.owned",
          subjectType: "escalation",
          subjectId: e.id,
          summary: `${ctx.displayName} took ownership of an escalation.`,
          visibility: "staff",
        });
      if (takingOver)
        await appendAudit(tx, {
          tenantId: ctx.tenantId,
          householdId: scope.householdId,
          actorId: ctx.actorId,
          action: "escalation.taken_over",
          subjectType: "escalation",
          subjectId: e.id,
          summary: `${ctx.displayName} took over an escalation to resolve it.`,
          visibility: "staff",
          context: { previousOwner: e.ownerActorId },
        });
      await tx
        .update(s.escalations)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolvedByActorId: ctx.actorId,
          resolution: input.resolution!.trim(),
          ownerActorId: ctx.actorId,
        })
        .where(
          and(
            eq(s.escalations.tenantId, ctx.tenantId),
            eq(s.escalations.id, e.id),
            ne(s.escalations.status, "resolved"),
          ),
        )
        .returning({ id: s.escalations.id })
        .then((r) => {
          if (!r.length)
            throw new AccessError("CONFLICT", "This escalation was just resolved by someone else.");
        });
    }
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: input.action === "take" ? "escalation.owned" : "escalation.resolved",
      subjectType: "escalation",
      subjectId: e.id,
      summary:
        input.action === "take"
          ? `${ctx.displayName} took ownership of an escalation.`
          : "An escalation was resolved by a person.",
      visibility: "staff",
    });
    if (familyMessage) {
      const [m] = await tx
        .insert(s.messages)
        .values({
          tenantId: ctx.tenantId,
          threadId: `th-${scope.householdId}`,
          householdId: scope.householdId,
          authorActorId: ctx.actorId,
          authorSide: "staff",
          body: familyMessage,
        })
        .returning();
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        actorId: ctx.actorId,
        action: "message.sent",
        subjectType: "message",
        subjectId: m!.id,
        summary: "The care guide replied in the message thread.",
        visibility: "family",
      });
      const readers = await membersWho(tx, ctx.tenantId, scope.householdId, scope.lifecycle, {
        permission: "thread.view",
      });
      await notify(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        recipients: readers.map((r) => r.actorId),
        kind: "message",
        title: "You have a new message from your care guide",
        link: `/family/messages#entry-${m!.id}`,
      });
    }
    if (input.action === "resolve" && e.sourceType === "support_request") {
      const members = await householdMembers(tx, ctx.tenantId, scope.householdId);
      await notify(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        recipients: members.map((m) => m.actorId),
        kind: "support",
        title: "Your care team marked a request resolved",
        link: "/family/support",
      });
    }
  });
}

/* ------------------------------------------------------------------ bereavement transition */

/** A care guide or operations user proposes; a different operations user confirms. */
export async function proposeBereavement(
  db: DB,
  ctx: ActorContext,
  input: { householdId: string; survivingContactActorId: string; note: string },
) {
  const scope = await staffScope(db, ctx, input.householdId, "lifecycle.propose");
  if (!canTransition(scope.lifecycle, "bereavement"))
    throw new AccessError(
      "INVALID",
      "This household can't move to bereavement support from its current state.",
    );
  const members = await householdMembers(db, ctx.tenantId, scope.householdId);
  const contact = members.find((m) => m.actorId === input.survivingContactActorId);
  if (!contact || contact.roles.includes("patient"))
    throw new AccessError("INVALID", "Choose a household member (not the patient) as the surviving contact.");
  const open = await db
    .select({ id: s.bereavementTransitions.id })
    .from(s.bereavementTransitions)
    .where(
      and(
        eq(s.bereavementTransitions.tenantId, ctx.tenantId),
        eq(s.bereavementTransitions.householdId, scope.householdId),
        eq(s.bereavementTransitions.state, "proposed"),
      ),
    );
  if (open.length) throw new AccessError("INVALID", "A transition is already waiting for confirmation.");
  await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(s.bereavementTransitions)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        proposedByActorId: ctx.actorId,
        survivingContactActorId: contact.actorId,
        note: input.note.trim(),
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "lifecycle.bereavement_proposed",
      subjectType: "bereavement_transition",
      subjectId: t!.id,
      summary: "A move to bereavement support was proposed and is waiting for confirmation by operations.",
      visibility: "staff",
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: await staffWithRole(tx, ctx.tenantId, "hospice_ops"),
      except: ctx.actorId,
      kind: "lifecycle",
      title: "A household transition is waiting for confirmation",
      link: `/staff/households/${scope.householdId}?tab=lifecycle`,
    });
  });
}

/**
 * Confirm the move to bereavement. In one transaction:
 *  - the household's lifecycle becomes `bereavement`; the patient's membership ends;
 *  - authority that only applies while the patient is living (healthcare agent, proxy, guardian) is superseded;
 *  - active consents covering care-period information expire; open packets carrying it are held;
 *  - the care coordination record is archived; practical bereavement tasks are added;
 *  - the household is told gently, without detail in the notification, and the surviving contact is asked to confirm.
 * Practical coordination, messages, updates and support continue.
 */
export async function confirmBereavement(db: DB, ctx: ActorContext, transitionId: string) {
  requireStaff(ctx);
  const [t] = await db
    .select()
    .from(s.bereavementTransitions)
    .where(
      and(eq(s.bereavementTransitions.tenantId, ctx.tenantId), eq(s.bereavementTransitions.id, transitionId)),
    );
  if (!t) throw new AccessError("OUT_OF_SCOPE", "That transition isn't available.");
  const scope = await staffScope(db, ctx, t.householdId, "lifecycle.confirm");
  if (t.state !== "proposed")
    throw new AccessError("INVALID", "This transition isn't waiting for confirmation.");
  if (t.proposedByActorId === ctx.actorId)
    throw new AccessError(
      "NOT_PERMITTED",
      "A different person needs to confirm a transition they didn't propose.",
    );
  if (!canTransition(scope.lifecycle, "bereavement"))
    throw new AccessError(
      "INVALID",
      "This household can't move to bereavement support from its current state.",
    );
  const now = new Date();
  const T = ctx.tenantId;
  const H = scope.householdId;
  await db.transaction(async (tx) => {
    await tx
      .update(s.bereavementTransitions)
      .set({ state: "confirmed", confirmedAt: now, confirmedByActorId: ctx.actorId })
      .where(
        and(
          eq(s.bereavementTransitions.tenantId, T),
          eq(s.bereavementTransitions.id, t.id),
          eq(s.bereavementTransitions.state, "proposed"),
        ),
      )
      .returning({ id: s.bereavementTransitions.id })
      .then((r) => {
        // Confirmed (or cancelled) by someone else a moment ago: apply nothing a second time.
        if (!r.length)
          throw new AccessError("CONFLICT", "This transition was already confirmed or cancelled.");
      });
    await tx
      .update(s.households)
      .set({ lifecycleState: "bereavement", lifecycleChangedAt: now })
      .where(and(eq(s.households.tenantId, T), eq(s.households.id, H)));
    // The 13-month follow-up plan starts now (src/domain/bereavement.ts).
    await createPlanInTx(tx, { tenantId: T, householdId: H, transitionId: t.id, confirmedAt: now });
    await tx
      .update(s.memberships)
      .set({ status: "ended", endedAt: now, endReason: "bereavement_transition" })
      .where(
        and(
          eq(s.memberships.tenantId, T),
          eq(s.memberships.householdId, H),
          eq(s.memberships.roleCode, "patient"),
          eq(s.memberships.status, "active"),
        ),
      );
    const superseded = await tx
      .update(s.authorityEvidence)
      .set({ state: "superseded", updatedAt: now })
      .where(
        and(
          eq(s.authorityEvidence.tenantId, T),
          eq(s.authorityEvidence.householdId, H),
          inArray(s.authorityEvidence.authorityType, [...ENDS_AT_DEATH]),
          inArray(s.authorityEvidence.state, ["workflow_active", "review_pending", "conflict"]),
        ),
      )
      .returning({ id: s.authorityEvidence.id });
    const active = await tx
      .select()
      .from(s.consents)
      .where(and(eq(s.consents.tenantId, T), eq(s.consents.householdId, H), eq(s.consents.state, "active")));
    const expire = active.filter((c) =>
      (c.scope as ShareCategory[]).some((k) => CARE_PERIOD_ONLY.includes(k)),
    );
    // A correction request about a consent that has now ended has nothing left to correct.
    for (const c of expire) await closeOpenCorrection(tx, ctx, c.id, "closed");
    if (expire.length)
      await tx
        .update(s.consents)
        .set({ state: "expired" })
        .where(
          inArray(
            s.consents.id,
            expire.map((c) => c.id),
          ),
        );
    const open = await tx
      .select()
      .from(s.packets)
      .where(
        and(
          eq(s.packets.tenantId, T),
          eq(s.packets.householdId, H),
          or(eq(s.packets.state, "draft"), eq(s.packets.state, "held")),
        ),
      );
    if (open.length)
      await tx
        .update(s.packets)
        .set({ state: "held", lastReasonCode: "LIFECYCLE_SCOPE_NARROWED", updatedAt: now })
        .where(
          inArray(
            s.packets.id,
            open.map((p) => p.id),
          ),
        );
    await tx
      .update(s.careCoordinationRecords)
      .set({ archivedAt: now, visitRhythm: "Care visits ended", updatedAt: now })
      .where(and(eq(s.careCoordinationRecords.tenantId, T), eq(s.careCoordinationRecords.householdId, H)));
    const contact = t.survivingContactActorId;
    await tx.insert(s.tasks).values([
      {
        tenantId: T,
        householdId: H,
        title: "Choose whether you'd like bereavement support",
        detail: "Only if and when it feels right. There's no deadline.",
        audience: "family",
        assigneeActorId: contact,
        ownerActorId: ctx.actorId,
        whenLabel: "Whenever you're ready",
        source: "lifecycle",
      },
      {
        tenantId: T,
        householdId: H,
        title: "Gather any benefits letters in one place",
        detail: "Just collect them. A counselor can go through them with you later.",
        audience: "family",
        assigneeActorId: contact,
        ownerActorId: ctx.actorId,
        whenLabel: "No rush",
        source: "lifecycle",
      },
    ]);
    await appendAudit(tx, {
      tenantId: T,
      householdId: H,
      actorId: ctx.actorId,
      action: "lifecycle.bereavement_confirmed",
      subjectType: "household",
      subjectId: H,
      summary:
        "The household moved to bereavement support. Practical support continues; protected access was narrowed.",
      visibility: "family",
      context: {
        supersededAuthority: superseded.map((x) => x.id),
        expiredConsents: expire.map((c) => c.id),
        heldPackets: open.map((p) => p.id),
      },
      // Two people: who proposed it, and the different person who confirmed it.
      approval: { requestedBy: t.proposedByActorId, approvedBy: ctx.actorId },
    });
    const members = await householdMembers(tx, T, H);
    await notify(tx, {
      tenantId: T,
      householdId: H,
      recipients: members.map((m) => m.actorId).filter((a) => a !== contact),
      kind: "lifecycle",
      title: "Your care team updated your household space",
      link: "/family/bereavement",
    });
    if (contact)
      await notify(tx, {
        tenantId: T,
        householdId: H,
        recipients: [contact],
        kind: "lifecycle",
        title: "Your care team asked you to confirm something",
        link: "/family/bereavement",
      });
    const guides = await careGuidesFor(tx, T, H);
    await notify(tx, {
      tenantId: T,
      householdId: H,
      recipients: guides.map((g) => g.actorId),
      except: ctx.actorId,
      kind: "lifecycle",
      title: "A household transition was confirmed",
      link: `/staff/households/${H}?tab=lifecycle`,
    });
  });
}

export async function cancelBereavement(db: DB, ctx: ActorContext, transitionId: string) {
  requireStaff(ctx);
  const [t] = await db
    .select()
    .from(s.bereavementTransitions)
    .where(
      and(eq(s.bereavementTransitions.tenantId, ctx.tenantId), eq(s.bereavementTransitions.id, transitionId)),
    );
  if (!t) throw new AccessError("OUT_OF_SCOPE", "That transition isn't available.");
  const scope = await staffScope(db, ctx, t.householdId, "lifecycle.propose");
  if (t.state !== "proposed")
    throw new AccessError("INVALID", "Only a proposed transition can be cancelled.");
  await db.transaction(async (tx) => {
    await tx
      .update(s.bereavementTransitions)
      .set({ state: "cancelled" })
      .where(eq(s.bereavementTransitions.id, t.id));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "lifecycle.bereavement_cancelled",
      subjectType: "bereavement_transition",
      subjectId: t.id,
      summary: "A proposed transition was cancelled. Nothing changed for the household.",
      visibility: "staff",
    });
  });
}

/**
 * Bulk take or assign (staff rework, section 3). Each item goes through the same checks as one at
 * a time (updateEscalation / giveEscalation), and each result is reported. No bulk resolve,
 * activate or release, on purpose.
 */
export async function bulkEscalations(
  db: DB,
  ctx: ActorContext,
  input: { ids: string[]; action: "take" | "assign"; toActorId?: string | undefined },
) {
  requireStaff(ctx);
  if (input.action === "assign") requireStaffPermission(ctx, "staff.assignment.manage");
  if (input.ids.length > 50) throw new AccessError("INVALID", "Choose up to 50 at a time.");
  const results: { id: string; ok: boolean; message?: string }[] = [];
  for (const id of [...new Set(input.ids)]) {
    try {
      if (input.action === "take") await updateEscalation(db, ctx, { id, action: "take" });
      else await giveEscalation(db, ctx, { id, actorId: input.toActorId ?? "" });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({
        id,
        ok: false,
        message: e instanceof AccessError ? e.message : "That didn't go through.",
      });
    }
  }
  return results;
}

/** People open escalations can be given to, for "Assign to…" (operations only). */
export async function assignableOwners(db: DB, ctx: ActorContext) {
  requireStaffPermission(ctx, "staff.assignment.manage");
  return (await escalationOwnerCandidates(db, ctx)).map((c) => ({ actorId: c.actorId, name: c.name }));
}

/** Visible households ordered by their latest audit event, with what kind of thing happened. */
async function recentlyUpdated(
  db: DB,
  ctx: ActorContext,
  hh: { id: string; displayName: string; lifecycleState: string }[],
) {
  if (!hh.length) return [];
  const rows = await db
    .select({
      householdId: s.auditEvents.householdId,
      action: s.auditEvents.action,
      at: s.auditEvents.createdAt,
      actorId: s.auditEvents.actorId,
    })
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.tenantId, ctx.tenantId),
        inArray(
          s.auditEvents.householdId,
          hh.map((h) => h.id),
        ),
      ),
    )
    .orderBy(desc(s.auditEvents.seq))
    .limit(400);
  const seen = new Map<string, { action: string; at: Date; actorId: string | null }>();
  for (const r of rows)
    if (r.householdId && !seen.has(r.householdId))
      seen.set(r.householdId, { action: r.action, at: r.at, actorId: r.actorId });
  const latest = [...seen.entries()].slice(0, 6);
  // Staff may see who did what in households they can see (the audit tab shows the same).
  const names = await actorNames(
    db,
    ctx.tenantId,
    latest.map(([, e]) => e.actorId),
  );
  return latest.map(([id, e]) => {
    const h = hh.find((x) => x.id === id)!;
    return {
      id,
      name: h.displayName,
      lifecycle: h.lifecycleState,
      who: e.actorId ? (names.get(e.actorId) ?? "Someone") : "The system",
      last: actionLabel(e.action),
      at: e.at,
    };
  });
}
