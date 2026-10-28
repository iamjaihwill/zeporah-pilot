/**
 * Everything a household member does. Each function takes the actor's context, re-checks the
 * permission against their household role and lifecycle, and writes an audit event for anything
 * meaningful. Family-facing reads never touch staff notes.
 */
import { alertedPackets } from "./recipient";
import { householdOrgSettings } from "./org-settings";
import { releaseNote } from "@/domain/claims";
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { activeCover, postCoverNotices } from "./coverage";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { closeOpenCorrection } from "./corrections";
import { createOnce, messageBySubmission } from "./send-once";
import { assertMayRemove } from "./retention";
import { hashToken, looksLikeEmail, newToken, normalizeEmail } from "../auth/crypto";
import { INVITATION_DAYS } from "./auth";
import { currentMessageExpectation } from "./settings";
import { emailAvailable } from "../mail";
import { addresses } from "../environment";
import { publicUrl } from "@/domain/addresses";
import { markExistingCovered } from "./email-notices";
import { familyMayComplete, familyMaySee, markFamilyTaskDone, reopenTask } from "./tasks";
import { AccessError, familyScope, protectedAccess, type ActorContext, type FamilyScope } from "../context";
import {
  actorNames,
  careGuidesFor,
  consentWorkflow,
  firstName,
  householdMembers,
  markLinkRead,
  membersWho,
  notify,
  onboardingState,
  organizationHotline,
  staffWithRole,
} from "./common";
import { memberChangeBlocker, SELF_MANAGED_ROLES } from "./household-admin";
import { contactPause, familyPlan } from "./bereavement";
import {
  CONSENT_CONFIRMATION_METHOD,
  CONSENT_CONFIRMATION_STATEMENT,
  CONSENT_STAGE_LABELS,
  CORRECTION_CATEGORIES,
  CORRECTION_CATEGORY_LABELS,
  type CorrectionCategory,
} from "@/domain/consent";
import { can } from "@/domain/permissions";
import { LIFECYCLE_LABELS } from "@/domain/lifecycle";
import {
  ROLE_EXPLANATIONS,
  ROLE_LABELS,
  SHARE_CATEGORY_LABELS,
  type AuditVisibility,
  type HouseholdRole,
  type OnboardingStep,
  type ShareCategory,
  type VaultStatus,
} from "@/domain/model";

const STEP_LABELS: Record<OnboardingStep, string> = {
  preferences: "Preferences",
  trusted_contacts: "Trusted contacts",
  communication: "Communication settings",
  vault_review: "Starter vault review",
};

/** Timeline levels this person may see. */
async function visibleLevels(conn: Conn, ctx: ActorContext, scope: FamilyScope): Promise<AuditVisibility[]> {
  const levels: AuditVisibility[] = ["family"];
  if (can(scope.roles, "consent.view", scope.lifecycle)) levels.push("sharing");
  if (await protectedAccess(conn, ctx, scope)) levels.push("protected");
  return levels;
}

type VaultRow = typeof s.vaultItems.$inferSelect;

/**
 * Who sees a vault item (founder decision 43). Membership alone grants nothing but items marked
 * visible to the household. Protected items keep their own rule (the patient and people with active
 * authority) whatever else is set. Items someone can't see are left out entirely, never shown locked.
 */
export function maySeeVaultItem(
  item: Pick<VaultRow, "sensitivity" | "audience" | "ownerActorId" | "sharedWith">,
  actorId: string,
  roles: readonly string[],
  lifecycle: string,
  protectedAccess: boolean,
) {
  if (roles.every((r) => r === "helper")) return false;
  const keeper = can(roles as HouseholdRole[], "vault.view", lifecycle as never);
  if (item.sensitivity === "protected") return protectedAccess;
  switch (item.audience) {
    case "private":
      return item.ownerActorId === actorId;
    case "selected":
      return item.sharedWith ? item.sharedWith.includes(actorId) || item.ownerActorId === actorId : keeper;
    case "household":
      return true;
    default:
      return keeper || item.ownerActorId === actorId;
  }
}

async function visibleVaultItems(conn: Conn, ctx: ActorContext, scope: FamilyScope) {
  const prot = await protectedAccess(conn, ctx, scope);
  const rows = await conn
    .select()
    .from(s.vaultItems)
    .where(and(eq(s.vaultItems.tenantId, ctx.tenantId), eq(s.vaultItems.householdId, scope.householdId)))
    .orderBy(s.vaultItems.createdAt, s.vaultItems.id);
  return rows.filter((r) => maySeeVaultItem(r, ctx.actorId, scope.roles, scope.lifecycle, prot));
}

/** Plain words for an item's audience, naming people (decision 43: "make its audience plain"). */
async function audienceLabels(conn: Conn, ctx: ActorContext, scope: FamilyScope) {
  const members = await householdMembers(conn, ctx.tenantId, scope.householdId);
  const nameOf = (id: string) =>
    id === ctx.actorId ? "you" : (members.find((m) => m.actorId === id)?.name.split(" ")[0] ?? "someone");
  // The patient first, then the coordinator and proxies, so labels read the same every time.
  const rank = (m: { roles: string[] }) =>
    Math.min(...m.roles.map((r) => ["patient", "coordinator", "proxy"].indexOf(r)).filter((i) => i >= 0), 9);
  const keepers = members
    .filter((m) => can(m.roles, "vault.view", scope.lifecycle))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map((m) => nameOf(m.actorId));
  const list = (xs: string[]) =>
    xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
  return (i: VaultRow) => {
    if (i.sensitivity === "protected") return "Protected: only the patient and people with active authority";
    switch (i.audience) {
      case "private":
        return i.ownerActorId === ctx.actorId ? "Private to you" : `Private to ${nameOf(i.ownerActorId!)}`;
      case "selected":
        return `Shared with selected people: ${list(i.sharedWith ? [...new Set([...(i.ownerActorId ? [i.ownerActorId] : []), ...i.sharedWith])].map(nameOf) : keepers)}`;
      case "household":
        return "Visible to the household and your care team";
      default:
        return `Shared with staff: ${list(keepers)} and your care team`;
    }
  };
}

/* ------------------------------------------------------------------ dashboard */

/**
 * Updates this person may see: everyone's, plus system updates addressed to them (decision 62: a cover
 * notice goes to the coordinator, proxies with active authority and the patient).
 */
const updateVisibleTo = (actorId: string) =>
  or(
    isNull(s.familyUpdates.audienceActorIds),
    sql`${s.familyUpdates.audienceActorIds} @> ${JSON.stringify([actorId])}::jsonb`,
  );

export async function familyHome(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "household.view");
  const T = ctx.tenantId;
  const H = scope.householdId;
  // Decision 62: a cover that has just started tells the household first (no timer; first load).
  await postCoverNotices(db, T);
  const on = await onboardingState(db, T, H);
  const flags = {
    vault: can(scope.roles, "vault.view", scope.lifecycle),
    thread: can(scope.roles, "thread.view", scope.lifecycle),
    consent: can(scope.roles, "consent.view", scope.lifecycle),
    onboarding: scope.maySetUp,
    invite: can(scope.roles, "people.invite", scope.lifecycle),
  };
  const [record] = await db
    .select()
    .from(s.careCoordinationRecords)
    .where(and(eq(s.careCoordinationRecords.tenantId, T), eq(s.careCoordinationRecords.householdId, H)));
  const guides = await careGuidesFor(db, T, H);
  const cover = await activeCover(db, T, H);
  const myTasks = await db
    .select()
    .from(s.tasks)
    .where(
      and(
        eq(s.tasks.tenantId, T),
        eq(s.tasks.householdId, H),
        eq(s.tasks.audience, "family"),
        eq(s.tasks.status, "open"),
        eq(s.tasks.assigneeActorId, ctx.actorId),
      ),
    )
    .orderBy(s.tasks.createdAt);
  const openFamilyTasks = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.tasks)
    .where(
      and(
        eq(s.tasks.tenantId, T),
        eq(s.tasks.householdId, H),
        eq(s.tasks.audience, "family"),
        eq(s.tasks.status, "open"),
      ),
    );
  const updates = await db
    .select()
    .from(s.familyUpdates)
    .where(
      and(eq(s.familyUpdates.tenantId, T), eq(s.familyUpdates.householdId, H), updateVisibleTo(ctx.actorId)),
    )
    .orderBy(desc(s.familyUpdates.createdAt))
    .limit(3);
  const myAcks = await db
    .select({ id: s.acknowledgements.subjectId })
    .from(s.acknowledgements)
    .where(
      and(
        eq(s.acknowledgements.tenantId, T),
        eq(s.acknowledgements.actorId, ctx.actorId),
        eq(s.acknowledgements.subjectType, "update"),
      ),
    );
  const acked = new Set(myAcks.map((a) => a.id));
  const vault = flags.vault ? await visibleVaultItems(db, ctx, scope) : [];
  // Decision 43: someone without vault access still gets the Vault page when an item is visible to the household.
  const vaultNav = flags.vault || (await visibleVaultItems(db, ctx, scope)).length > 0;
  const count = (st: VaultStatus) => vault.filter((v) => v.status === st).length;
  const levels = await visibleLevels(db, ctx, scope);
  const activity = await db
    .select({
      id: s.auditEvents.id,
      summary: s.auditEvents.summary,
      at: s.auditEvents.createdAt,
      action: s.auditEvents.action,
    })
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.tenantId, T),
        eq(s.auditEvents.householdId, H),
        inArray(s.auditEvents.visibility, levels),
      ),
    )
    .orderBy(desc(s.auditEvents.seq))
    .limit(8);
  const [lastMsg] = flags.thread
    ? await db
        .select()
        .from(s.messages)
        .where(and(eq(s.messages.tenantId, T), eq(s.messages.householdId, H)))
        .orderBy(desc(s.messages.createdAt))
        .limit(1)
    : [];
  const consents = flags.consent
    ? await db
        .select()
        .from(s.consents)
        .where(and(eq(s.consents.tenantId, T), eq(s.consents.householdId, H)))
    : [];
  const [transition] = await db
    .select()
    .from(s.bereavementTransitions)
    .where(
      and(
        eq(s.bereavementTransitions.tenantId, T),
        eq(s.bereavementTransitions.householdId, H),
        eq(s.bereavementTransitions.state, "confirmed"),
      ),
    );
  const names = await actorNames(db, T, [
    lastMsg?.authorActorId ?? null,
    ...updates.map((u) => u.authorActorId),
  ]);
  const namedRows = await db
    .select()
    .from(s.consents)
    .where(
      and(
        eq(s.consents.tenantId, T),
        eq(s.consents.householdId, H),
        eq(s.consents.grantedByActorId, ctx.actorId),
      ),
    );
  let namedOpen = 0;
  let namedWaiting = 0;
  for (const c of namedRows) {
    const wf = await consentWorkflow(db, c);
    if (wf.stage !== "revoked" && wf.stage !== "expired") namedOpen++;
    if (wf.stage === "awaiting_confirmation" && !wf.correction) namedWaiting++;
  }
  let activeConsents = 0;
  let consentsWaitingForMe = 0;
  let firstWaitingForMe: string | null = null;
  for (const c of consents) {
    const wf = await consentWorkflow(db, c);
    if (wf.stage === "active") activeConsents++;
    if (wf.stage === "awaiting_confirmation" && c.grantedByActorId === ctx.actorId && !wf.correction) {
      consentsWaitingForMe++;
      firstWaitingForMe ??= c.id;
    }
  }
  // A reply from the care team since this person last opened the thread (item 9).
  const seen = flags.thread ? await lastThreadVisit(db, T, ctx.actorId, H) : null;
  const [newReply] = flags.thread
    ? await db
        .select()
        .from(s.messages)
        .where(
          and(
            eq(s.messages.tenantId, T),
            eq(s.messages.householdId, H),
            eq(s.messages.authorSide, "staff"),
            seen ? gt(s.messages.createdAt, seen) : undefined,
          ),
        )
        .orderBy(desc(s.messages.createdAt))
        .limit(1)
    : [];
  const replyAuthor = newReply
    ? ((await actorNames(db, T, [newReply.authorActorId])).get(newReply.authorActorId) ?? "Your care guide")
    : null;
  // What this person can actually do with the consents that name them (item 8).
  const mine = namedRows.length ? await consentsForMe(db, ctx) : [];
  const [myPrefs] = await db
    .select({ textSize: s.preferences.textSize })
    .from(s.preferences)
    .where(and(eq(s.preferences.tenantId, T), eq(s.preferences.actorId, ctx.actorId)));
  const [{ unread } = { unread: 0 }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(s.notifications)
    .where(
      and(
        eq(s.notifications.tenantId, T),
        eq(s.notifications.recipientActorId, ctx.actorId),
        isNull(s.notifications.readAt),
      ),
    );

  return {
    me: {
      name: ctx.displayName,
      firstName: firstName(ctx.displayName),
      roles: scope.roles.map((r) => ROLE_LABELS[r]),
    },
    textSize: myPrefs?.textSize ?? "standard",
    household: {
      name: scope.householdName,
      patientName: scope.patientName,
      lifecycle: scope.lifecycle,
      lifecycleLabel: LIFECYCLE_LABELS[scope.lifecycle],
    },
    onboarding: { ...on, has: undefined, labels: STEP_LABELS, canComplete: flags.onboarding },
    flags: { ...flags, vaultNav },
    messagingOn: on.has("communication"),
    careGuide: cover?.name ?? guides[0]?.name ?? null,
    // Decision 62: while cover runs, Home and Messages name the covering guide, until its end.
    careGuideUntil: cover?.until ?? null,
    careRecord:
      record && !record.archivedAt
        ? { visitRhythm: record.visitRhythm, afterHoursRoute: record.afterHoursRoute }
        : null,
    afterHoursRoute: record?.afterHoursRoute ?? null,
    hotline: await organizationHotline(db, ctx.tenantId, scope.organizationId),
    myTasks: myTasks.map((t) => ({
      id: t.id,
      title: t.title,
      whenLabel: t.whenLabel,
      requiresAck: t.requiresAck,
    })),
    openFamilyTasks: openFamilyTasks[0]?.n ?? 0,
    updates: updates.map((u) => ({
      id: u.id,
      title: u.title,
      at: u.createdAt,
      author: (u.authorActorId && names.get(u.authorActorId)) || "Your care team",
      needsMyAck: u.requiresAck && !acked.has(u.id),
    })),
    vault:
      flags.vault && on.has("vault_review")
        ? {
            needsReview: count("needs_review"),
            reviewed: count("reviewed"),
            notAvailable: count("not_available"),
            total: vault.length,
          }
        : null,
    vaultStarted: flags.vault && vault.some((v) => v.status !== "needs_review"),
    unread,
    activity,
    lastMessage: lastMsg
      ? { author: names.get(lastMsg.authorActorId) ?? "", side: lastMsg.authorSide, at: lastMsg.createdAt }
      : null,
    sharing: flags.consent
      ? {
          active: activeConsents,
          waitingForMe: consentsWaitingForMe,
          /** For the Home "Open" link: jumps straight to the consent waiting for this person. */
          firstWaitingForMe,
          total: consents.length,
        }
      : null,
    /** Consents naming this person, so someone without a Sharing view is never left unaware. */
    namedConsents: {
      open: namedOpen,
      waitingForMe: namedWaiting,
      can: {
        confirm: mine.some((c) => c.canConfirm),
        correct: mine.some((c) => c.canRequestCorrection),
        withdraw: mine.some((c) => c.canWithdraw),
        askToWithdraw: mine.some((c) => c.canAskToWithdraw),
      },
    },
    newReply: newReply ? { id: newReply.id, author: replyAuthor!, at: newReply.createdAt } : null,
    /** The patient sees a section about their own wishes and who can see their information (item 13). */
    isPatient: scope.roles.includes("patient") && scope.lifecycle !== "bereavement",
    bereavement: transition
      ? {
          needsMyConfirmation:
            transition.survivingContactActorId === ctx.actorId && !transition.survivingContactConfirmedAt,
        }
      : null,
  };
}

/* ------------------------------------------------------------------ onboarding */

async function completeStep(tx: Conn, ctx: ActorContext, scope: FamilyScope, step: OnboardingStep) {
  const inserted = await tx
    .insert(s.onboardingSteps)
    .values({ tenantId: ctx.tenantId, householdId: scope.householdId, step, completedByActorId: ctx.actorId })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) return;
  await appendAudit(tx, {
    tenantId: ctx.tenantId,
    householdId: scope.householdId,
    actorId: ctx.actorId,
    action: "onboarding.step_completed",
    subjectType: "household",
    subjectId: scope.householdId,
    summary: `Setup step completed: ${STEP_LABELS[step]}.`,
    visibility: "family",
    context: { step },
  });
  const state = await onboardingState(tx, ctx.tenantId, scope.householdId);
  if (state.complete) {
    if (scope.lifecycle === "enrolled") {
      await tx
        .update(s.households)
        .set({ lifecycleState: "active_hospice", lifecycleChangedAt: new Date() })
        .where(and(eq(s.households.tenantId, ctx.tenantId), eq(s.households.id, scope.householdId)));
    }
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "onboarding.completed",
      subjectType: "household",
      subjectId: scope.householdId,
      summary: "Household setup was completed.",
      visibility: "family",
    });
    const guides = await careGuidesFor(tx, ctx.tenantId, scope.householdId);
    const members = await householdMembers(tx, ctx.tenantId, scope.householdId);
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: guides.map((g) => g.actorId),
      kind: "onboarding",
      title: "A household finished setup",
      link: `/staff/households/${scope.householdId}`,
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: members.map((m) => m.actorId),
      except: ctx.actorId,
      kind: "onboarding",
      title: "Your household space is set up",
      link: "/family",
    });
    await markLinkRead(tx, ctx.tenantId, ctx.actorId, "/family/onboarding");
  }
}

export async function getOnboarding(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "household.view");
  const state = await onboardingState(db, ctx.tenantId, scope.householdId);
  const [prefs] = await db
    .select()
    .from(s.preferences)
    .where(and(eq(s.preferences.tenantId, ctx.tenantId), eq(s.preferences.actorId, ctx.actorId)));
  const members = await householdMembers(db, ctx.tenantId, scope.householdId);
  const invites = await db
    .select()
    .from(s.invitations)
    .where(and(eq(s.invitations.tenantId, ctx.tenantId), eq(s.invitations.householdId, scope.householdId)))
    .orderBy(s.invitations.createdAt);
  const [me] = await db
    .select({ email: s.actors.email })
    .from(s.actors)
    .where(and(eq(s.actors.tenantId, ctx.tenantId), eq(s.actors.id, ctx.actorId)));
  const vault = can(scope.roles, "vault.view", scope.lifecycle)
    ? await visibleVaultItems(db, ctx, scope)
    : [];
  return {
    canComplete: scope.maySetUp,
    steps: state.steps.map((x) => ({ ...x, label: STEP_LABELS[x.step] })),
    complete: state.complete,
    next: state.next,
    prefs: prefs ?? null,
    /** The hospice's notification defaults (decision 39), for someone who hasn't chosen yet. */
    prefDefaults: await notificationDefaults(db, ctx.tenantId, scope.householdId),
    /** Email nudges (decision 23) are offered only where a mail channel exists. */
    email: emailAvailable() ? { to: me?.email ?? "" } : null,
    members: members.map((m) => ({ name: m.name, roles: m.roles.map((r) => ROLE_LABELS[r]) })),
    invitations: invites.map((i) => ({
      id: i.id,
      name: i.inviteeName,
      role: ROLE_LABELS[i.roleCode as HouseholdRole],
      status: i.status,
      relationship: i.relationship,
    })),
    starterVault: vault
      .filter((v) => v.starter)
      .map((v) => ({ id: v.id, title: v.title, status: v.status, sensitivity: v.sensitivity })),
  };
}

export type PreferencesInput = {
  language: string;
  textSize: "standard" | "larger" | "largest";
  contactMethod: "in_app" | "phone" | "email";
};

/** The hospice's starting notification choices (decision 39). Email itself stays opt-in. */
async function notificationDefaults(conn: Conn, tenantId: string, householdId: string) {
  const n = (await householdOrgSettings(conn, tenantId, householdId)).notifications;
  return { notificationCadence: n.cadence, quietHoursStart: n.quietStart, quietHoursEnd: n.quietEnd };
}

async function upsertPrefs(tx: Conn, ctx: ActorContext, patch: Partial<typeof s.preferences.$inferInsert>) {
  const household = ctx.householdRoles[0]?.householdId;
  // A first row starts from the hospice's defaults; later saves change only what was sent.
  const start = household ? await notificationDefaults(tx, ctx.tenantId, household) : {};
  await tx
    .insert(s.preferences)
    .values({ tenantId: ctx.tenantId, actorId: ctx.actorId, ...start, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({ target: s.preferences.actorId, set: { ...patch, updatedAt: new Date() } });
}

export async function savePreferences(db: DB, ctx: ActorContext, input: PreferencesInput) {
  const scope = await familyScope(db, ctx, "household.view");
  await db.transaction(async (tx) => {
    await upsertPrefs(tx, ctx, input);
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "preferences.updated",
      subjectType: "preferences",
      subjectId: ctx.actorId,
      summary: `${firstName(ctx.displayName)} updated their preferences.`,
      visibility: "family",
    });
    if (scope.maySetUp) await completeStep(tx, ctx, scope, "preferences");
  });
}

export type ContactInput = {
  name: string;
  contact: string;
  role: "family_member" | "proxy" | "helper";
  relationship?: string | undefined;
  /**
   * Helpers (decision 42). `task`: task-only access, the default for a helper; `collaboration`:
   * broader household access with a stated scope and an end date (joins as a family member).
   */
  accessModel?: "task" | "collaboration" | undefined;
  taskId?: string | undefined;
  accessEndsAt?: string | undefined;
  scopeNote?: string | undefined;
};

const DAY = 86_400_000;

async function helperTerms(db: DB, ctx: ActorContext, scope: FamilyScope, input: ContactInput) {
  if (input.role !== "helper" && input.accessModel !== "collaboration")
    return { accessModel: null, taskId: null, accessExpiresAt: null, scopeNote: null };
  const ends = input.accessEndsAt ? new Date(input.accessEndsAt) : null;
  if (ends && (Number.isNaN(ends.getTime()) || ends.getTime() <= Date.now()))
    throw new AccessError("INVALID", "Choose an end date in the future.");
  // The hospice's access limits (decisions 39 and 42), set by an administrator.
  const limits = (await householdOrgSettings(db, ctx.tenantId, scope.householdId)).access;
  if (input.role === "helper") {
    // Task-only: one open household task this person can see; access ends with it or on the date.
    if (input.accessModel && input.accessModel !== "task")
      throw new AccessError(
        "INVALID",
        "A helper is invited for one task. For more, invite them to collaborate.",
      );
    const task = (await listFamilyTasks(db, ctx)).find((t) => t.id === input.taskId && t.status === "open");
    if (!task) throw new AccessError("INVALID", "Choose an open task for them to help with.");
    if (ends && ends.getTime() > Date.now() + limits.taskHelperMaxDays * DAY)
      throw new AccessError("INVALID", `Task-only access can last up to ${limits.taskHelperMaxDays} days.`);
    return { accessModel: "task" as const, taskId: task.id, accessExpiresAt: ends, scopeNote: null };
  }
  // Collaboration: explicit scope and expiry, always.
  const scopeNote = input.scopeNote?.trim() ?? "";
  if (!scopeNote) throw new AccessError("INVALID", "Say what they'll help with.");
  if (scopeNote.length > 300) throw new AccessError("INVALID", "Keep the scope under 300 characters.");
  if (!ends) throw new AccessError("INVALID", "Choose when their access ends.");
  if (ends.getTime() > Date.now() + limits.collaborationMaxDays * DAY)
    throw new AccessError("INVALID", `Collaboration can last up to ${limits.collaborationMaxDays} days.`);
  if (input.role !== "family_member")
    throw new AccessError("INVALID", "Collaborators join as family members.");
  return { accessModel: "collaboration" as const, taskId: null, accessExpiresAt: ends, scopeNote };
}

export async function inviteContact(db: DB, ctx: ActorContext, input: ContactInput) {
  const scope = await familyScope(db, ctx, "people.invite");
  const email = normalizeEmail(input.contact);
  if (!input.name.trim()) throw new AccessError("INVALID", "Add their name.");
  if (!looksLikeEmail(email))
    throw new AccessError("INVALID", "Enter their email address. They'll use it to create their account.");
  const terms = await helperTerms(db, ctx, scope, input);
  const token = newToken();
  await db.transaction(async (tx) => {
    const [inv] = await tx
      .insert(s.invitations)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        invitedByActorId: ctx.actorId,
        inviteeName: input.name.trim(),
        inviteeContact: email,
        inviteeEmail: email,
        tokenHash: hashToken(token),
        roleCode: input.role,
        relationship: input.relationship?.trim() || null,
        expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
        ...terms,
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "invitation.created",
      subjectType: "invitation",
      subjectId: inv!.id,
      summary:
        terms.accessModel === "task"
          ? `${firstName(ctx.displayName)} asked ${input.name.trim()} to help with one task.`
          : terms.accessModel === "collaboration"
            ? `${firstName(ctx.displayName)} invited ${input.name.trim()} to collaborate with the household until a set date.`
            : `${firstName(ctx.displayName)} invited ${input.name.trim()} as a ${ROLE_LABELS[input.role].toLowerCase()}.`,
      visibility: "family",
      context: {
        role: input.role,
        accessModel: terms.accessModel,
        taskId: terms.taskId,
        accessExpiresAt: terms.accessExpiresAt?.toISOString() ?? null,
      },
    });
  });
  // The token is returned once, to the person who invited; only its hash is stored.
  // A household invitation opens on the family address, where the new member will sign in.
  return { acceptPath: `/invite/${token}`, acceptUrl: publicUrl(addresses(), `/invite/${token}`, "app") };
}

/**
 * "Create a new link" for an invitation that hasn't been accepted (item 7). The old link stops
 * working at once (its hash is replaced) and the new one gets a fresh 7 days. Audit-logged. The
 * new link is returned once, to the person who asked, as with a new invitation.
 */
export async function reissueInvitation(db: DB, ctx: ActorContext, invitationId: string) {
  const scope = await familyScope(db, ctx, "people.invite");
  const token = newToken();
  await db.transaction(async (tx) => {
    const done = await tx
      .update(s.invitations)
      .set({
        tokenHash: hashToken(token),
        status: "pending",
        expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
      })
      .where(
        and(
          eq(s.invitations.tenantId, ctx.tenantId),
          eq(s.invitations.householdId, scope.householdId),
          eq(s.invitations.id, invitationId),
          inArray(s.invitations.status, ["pending", "expired"]),
        ),
      )
      .returning();
    if (!done.length) throw new AccessError("INVALID", "That invitation has already been used or revoked.");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "invitation.reissued",
      subjectType: "invitation",
      subjectId: invitationId,
      summary: "A new invitation link was created. The earlier link no longer works.",
      visibility: "family",
    });
  });
  // A household invitation opens on the family address, where the new member will sign in.
  return { acceptPath: `/invite/${token}`, acceptUrl: publicUrl(addresses(), `/invite/${token}`, "app") };
}

export async function cancelInvitation(db: DB, ctx: ActorContext, invitationId: string) {
  const scope = await familyScope(db, ctx, "people.invite");
  await db.transaction(async (tx) => {
    const done = await tx
      .update(s.invitations)
      .set({ status: "cancelled", respondedAt: new Date() })
      .where(
        and(
          eq(s.invitations.tenantId, ctx.tenantId),
          eq(s.invitations.householdId, scope.householdId),
          eq(s.invitations.id, invitationId),
          eq(s.invitations.status, "pending"),
        ),
      )
      .returning();
    if (!done.length) throw new AccessError("INVALID", "That invitation is no longer pending.");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "invitation.cancelled",
      subjectType: "invitation",
      subjectId: invitationId,
      summary: "An invitation was cancelled.",
      visibility: "family",
    });
  });
}

/** Step 2 is done whether contacts were added or the coordinator chose to do it later. */
export async function finishContactsStep(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "onboarding.complete");
  await db.transaction((tx) => completeStep(tx, ctx, scope, "trusted_contacts"));
}

export type CommunicationInput = {
  notificationCadence: "as_it_happens" | "daily_summary" | "essential_only";
  quietHoursStart: string;
  quietHoursEnd: string;
  /** Opt in to generic email nudges (decision 23). Ignored as false where email isn't available. */
  emailNotices?: boolean | undefined;
};

export async function saveCommunication(db: DB, ctx: ActorContext, input: CommunicationInput) {
  const scope = await familyScope(db, ctx, "household.view");
  if (!/^\d\d:\d\d$/.test(input.quietHoursStart) || !/^\d\d:\d\d$/.test(input.quietHoursEnd))
    throw new AccessError("INVALID", "Choose quiet hours as times, like 21:00.");
  if (input.emailNotices && !emailAvailable())
    throw new AccessError("INVALID", "Email notices aren't available yet.");
  const [before] = await db
    .select({ on: s.preferences.emailNotices })
    .from(s.preferences)
    .where(and(eq(s.preferences.tenantId, ctx.tenantId), eq(s.preferences.actorId, ctx.actorId)));
  const emailNotices = !!input.emailNotices;
  await db.transaction(async (tx) => {
    await upsertPrefs(tx, ctx, {
      notificationCadence: input.notificationCadence,
      quietHoursStart: input.quietHoursStart,
      quietHoursEnd: input.quietHoursEnd,
      emailNotices,
    });
    // Turning email on starts from now: nothing already in the app triggers an email.
    if (emailNotices && !before?.on) await markExistingCovered(tx, ctx.tenantId, ctx.actorId);
    if (emailNotices !== !!before?.on)
      await appendAudit(tx, {
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        actorId: ctx.actorId,
        action: emailNotices ? "communication.email_on" : "communication.email_off",
        subjectType: "preferences",
        subjectId: ctx.actorId,
        summary: emailNotices
          ? `${firstName(ctx.displayName)} turned on email notices.`
          : `${firstName(ctx.displayName)} turned off email notices.`,
        visibility: "family",
      });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "communication.updated",
      subjectType: "preferences",
      subjectId: ctx.actorId,
      summary: `${firstName(ctx.displayName)} chose how to hear about updates.`,
      visibility: "family",
    });
    if (scope.maySetUp) await completeStep(tx, ctx, scope, "communication");
  });
}

export async function finishVaultStep(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "onboarding.complete");
  await db.transaction((tx) => completeStep(tx, ctx, scope, "vault_review"));
}

/* ------------------------------------------------------------------ vault */

export async function listVault(db: DB, ctx: ActorContext) {
  // Decision 43: family members open the vault too, and see only what's visible to the household.
  const scope = await familyScope(db, ctx, "household.view");
  const items = await visibleVaultItems(db, ctx, scope);
  const names = await actorNames(
    db,
    ctx.tenantId,
    items.map((i) => i.reviewedByActorId),
  );
  const canReview = can(scope.roles, "vault.review", scope.lifecycle);
  const label = await audienceLabels(db, ctx, scope);
  const members = (await householdMembers(db, ctx.tenantId, scope.householdId))
    .filter((m) => m.roles.some((r) => r !== "helper"))
    .map((m) => ({ actorId: m.actorId, name: m.name }));
  return {
    canReview,
    canAdd: canReview,
    members,
    protectedAccess: await protectedAccess(db, ctx, scope),
    items: items.map((i) => ({
      ...i,
      reviewedBy: i.reviewedByActorId ? (names.get(i.reviewedByActorId) ?? null) : null,
      audienceLabel: label(i),
      // Keepers change who sees standard items; protected items follow their own rule.
      canChangeAudience: canReview && i.sensitivity === "standard",
      mine: i.ownerActorId === ctx.actorId,
    })),
  };
}

const AUDIENCES = ["private", "selected", "household", "staff"] as const;
type Audience = (typeof AUDIENCES)[number];

async function checkAudience(
  conn: Conn,
  ctx: ActorContext,
  scope: FamilyScope,
  input: { audience: Audience; sharedWith: string[] },
  ownerActorId: string | null,
) {
  if (!AUDIENCES.includes(input.audience)) throw new AccessError("INVALID", "Choose who can see it.");
  if (input.audience === "private" && ownerActorId !== ctx.actorId)
    throw new AccessError("INVALID", "Only the person who added an item can make it private to them.");
  if (input.audience !== "selected") return null;
  const members = await householdMembers(conn, ctx.tenantId, scope.householdId);
  const picked = [...new Set(input.sharedWith)];
  if (picked.some((id) => !members.some((m) => m.actorId === id && m.roles.some((r) => r !== "helper"))))
    throw new AccessError("INVALID", "Share it only with people in this household.");
  // You never lock yourself out of something you're changing.
  return [...new Set([ctx.actorId, ...picked])];
}

/**
 * Change who sees a standard vault item (decision 43): the page confirms first; the change is
 * audit-logged with before and after. Its title isn't put in a family-visible summary.
 */
export async function setVaultAudience(
  db: DB,
  ctx: ActorContext,
  input: { id: string; audience: Audience; sharedWith: string[] },
) {
  const scope = await familyScope(db, ctx, "vault.review");
  const item = (await visibleVaultItems(db, ctx, scope)).find((i) => i.id === input.id);
  if (!item) throw new AccessError("OUT_OF_SCOPE", "This item isn't available.");
  if (item.sensitivity === "protected")
    throw new AccessError(
      "INVALID",
      "Protected items are only for the patient and people with active authority.",
    );
  const sharedWith = await checkAudience(db, ctx, scope, input, item.ownerActorId);
  if (
    item.audience === input.audience &&
    JSON.stringify(item.sharedWith ?? null) === JSON.stringify(sharedWith)
  )
    return;
  await db.transaction(async (tx) => {
    await tx
      .update(s.vaultItems)
      .set({ audience: input.audience, sharedWith })
      .where(and(eq(s.vaultItems.tenantId, ctx.tenantId), eq(s.vaultItems.id, item.id)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "vault.audience_changed",
      subjectType: "vault_item",
      subjectId: item.id,
      summary: `${firstName(ctx.displayName)} changed who can see a vault item.`,
      visibility: "staff",
      context: {
        before: { audience: item.audience, sharedWith: item.sharedWith ?? null },
        after: { audience: input.audience, sharedWith },
      },
    });
  });
}

/** Add an item to the vault (decision 43): its owner is whoever adds it, so "private to me" means them. */
export async function addVaultItem(
  db: DB,
  ctx: ActorContext,
  input: { title: string; keptWhere: string; audience: Audience; sharedWith: string[] },
) {
  const scope = await familyScope(db, ctx, "vault.review");
  const title = input.title.trim();
  if (!title || title.length > 120)
    throw new AccessError("INVALID", "Give it a short name (up to 120 characters).");
  const sharedWith = await checkAudience(db, ctx, scope, input, ctx.actorId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.vaultItems)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        title,
        category: "household_added",
        description: "Added by the household.",
        keptWhere: input.keptWhere.trim().slice(0, 200) || null,
        audience: input.audience,
        sharedWith,
        ownerActorId: ctx.actorId,
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "vault.item_added",
      subjectType: "vault_item",
      subjectId: row!.id,
      summary: `${firstName(ctx.displayName)} added an item to the vault.`,
      visibility: "staff",
      context: { audience: input.audience, sharedWith },
    });
    return { id: row!.id };
  });
}

export async function getVaultItem(db: DB, ctx: ActorContext, id: string) {
  const { items, canReview } = await listVault(db, ctx);
  const item = items.find((i) => i.id === id);
  // A protected item the person can't see is reported exactly like one that doesn't exist.
  if (!item) throw new AccessError("OUT_OF_SCOPE", "This item isn't available.");
  return { item, canReview };
}

export async function reviewVaultItem(
  db: DB,
  ctx: ActorContext,
  input: { id: string; status: VaultStatus; keptWhere?: string | undefined },
) {
  const scope = await familyScope(db, ctx, "vault.review");
  const items = await visibleVaultItems(db, ctx, scope);
  const item = items.find((i) => i.id === input.id);
  if (!item) throw new AccessError("OUT_OF_SCOPE", "This item isn't available.");
  await db.transaction(async (tx) => {
    await tx
      .update(s.vaultItems)
      .set({
        status: input.status,
        keptWhere: input.keptWhere?.trim() || item.keptWhere,
        reviewedByActorId: ctx.actorId,
        reviewedAt: new Date(),
      })
      .where(and(eq(s.vaultItems.tenantId, ctx.tenantId), eq(s.vaultItems.id, item.id)));
    const narrow = item.audience === "private" || item.audience === "selected";
    const visibility: AuditVisibility =
      item.sensitivity === "protected" ? "protected" : narrow ? "staff" : "family";
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "vault.reviewed",
      subjectType: "vault_item",
      subjectId: item.id,
      summary: narrow
        ? `${firstName(ctx.displayName)} reviewed a vault item.`
        : `${firstName(ctx.displayName)} reviewed “${item.title}”.`,
      visibility,
      // What it was before, so Undo can put it back exactly (interaction review, item 4).
      context: {
        status: input.status,
        previous: {
          status: item.status,
          keptWhere: item.keptWhere ?? null,
          reviewedByActorId: item.reviewedByActorId ?? null,
          reviewedAt: item.reviewedAt ? new Date(item.reviewedAt).toISOString() : null,
        },
      },
    });
    const viewers = (
      item.sensitivity === "protected"
        ? await membersWho(tx, ctx.tenantId, scope.householdId, scope.lifecycle, { protectedAccess: true })
        : await membersWho(tx, ctx.tenantId, scope.householdId, scope.lifecycle, {
            permission: "household.view",
          })
    ).filter((v) =>
      maySeeVaultItem(item, v.actorId, v.roles, scope.lifecycle, item.sensitivity === "protected"),
    );
    const guides = await careGuidesFor(tx, ctx.tenantId, scope.householdId);
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: viewers.map((v) => v.actorId),
      except: ctx.actorId,
      kind: "vault",
      title: "A vault item was reviewed",
      link: `/family/vault/${item.id}`,
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: guides.map((g) => g.actorId),
      kind: "vault",
      title: "A household reviewed a vault item",
      link: `/staff/households/${scope.householdId}?tab=vault`,
    });
    await markLinkRead(tx, ctx.tenantId, ctx.actorId, `/family/vault/${item.id}`);
  });
}

/** How long after an action its Undo is accepted (the toast offers it for 8 seconds). */
export const UNDO_WINDOW_MS = 60_000;

/**
 * Undo your own vault review: puts back exactly what was there before (status, where it's kept,
 * who reviewed it and when), taken from the audit record — never from the request. Only within
 * the undo window, and only if nobody has changed the item since.
 */
export async function undoVaultReview(db: DB, ctx: ActorContext, itemId: string, now = new Date()) {
  const scope = await familyScope(db, ctx, "vault.review");
  const item = (await visibleVaultItems(db, ctx, scope)).find((i) => i.id === itemId);
  if (!item) throw new AccessError("OUT_OF_SCOPE", "This item isn't available.");
  const [last] = await db
    .select()
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.tenantId, ctx.tenantId),
        eq(s.auditEvents.subjectId, itemId),
        eq(s.auditEvents.action, "vault.reviewed"),
      ),
    )
    .orderBy(desc(s.auditEvents.seq))
    .limit(1);
  const prev = (last?.context as { previous?: Record<string, string | null> } | null)?.previous;
  if (
    !last ||
    !prev ||
    last.actorId !== ctx.actorId ||
    now.getTime() - last.createdAt.getTime() > UNDO_WINDOW_MS ||
    item.reviewedByActorId !== ctx.actorId
  )
    throw new AccessError("CONFLICT", "This can't be undone any more. You can change it again instead.");
  await db.transaction(async (tx) => {
    await tx
      .update(s.vaultItems)
      .set({
        status: prev["status"] as VaultStatus,
        keptWhere: prev["keptWhere"] ?? null,
        reviewedByActorId: prev["reviewedByActorId"] ?? null,
        reviewedAt: prev["reviewedAt"] ? new Date(prev["reviewedAt"]) : null,
      })
      .where(and(eq(s.vaultItems.tenantId, ctx.tenantId), eq(s.vaultItems.id, itemId)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "vault.review_undone",
      subjectType: "vault_item",
      subjectId: itemId,
      summary: `${firstName(ctx.displayName)} undid their review of “${item.title}”.`,
      visibility: item.sensitivity === "protected" ? "protected" : "family",
    });
  });
}

/* ------------------------------------------------------------------ thread and updates */

/** When this person last opened the household thread, or null if never. */
async function lastThreadVisit(conn: Conn, tenantId: string, actorId: string, householdId: string) {
  const [v] = await conn
    .select({ at: s.threadVisits.seenAt })
    .from(s.threadVisits)
    .where(
      and(
        eq(s.threadVisits.tenantId, tenantId),
        eq(s.threadVisits.actorId, actorId),
        eq(s.threadVisits.householdId, householdId),
      ),
    );
  return v?.at ?? null;
}

/** Called when the person opens Messages: later replies count as new; the home item clears. */
export async function markThreadSeen(db: DB, ctx: ActorContext, now = new Date()) {
  const scope = await familyScope(db, ctx, "updates.view");
  await db
    .insert(s.threadVisits)
    .values({ tenantId: ctx.tenantId, actorId: ctx.actorId, householdId: scope.householdId, seenAt: now })
    .onConflictDoUpdate({
      target: [s.threadVisits.actorId, s.threadVisits.householdId],
      set: { seenAt: now },
    });
  // Opening the thread reads what's in it.
  await markLinkRead(db, ctx.tenantId, ctx.actorId, "/family/messages");
}

export async function getThread(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "updates.view");
  const T = ctx.tenantId;
  const H = scope.householdId;
  // Decision 62: a cover that has just started tells the household first (no timer; first load).
  await postCoverNotices(db, T);
  const threadAllowed = can(scope.roles, "thread.view", scope.lifecycle);
  const on = await onboardingState(db, T, H);
  const msgs = threadAllowed
    ? await db
        .select()
        .from(s.messages)
        .where(and(eq(s.messages.tenantId, T), eq(s.messages.householdId, H)))
        .orderBy(s.messages.createdAt)
    : [];
  const updates = await db
    .select()
    .from(s.familyUpdates)
    .where(
      and(eq(s.familyUpdates.tenantId, T), eq(s.familyUpdates.householdId, H), updateVisibleTo(ctx.actorId)),
    )
    .orderBy(s.familyUpdates.createdAt);
  const acks = await db
    .select()
    .from(s.acknowledgements)
    .where(
      and(
        eq(s.acknowledgements.tenantId, T),
        eq(s.acknowledgements.householdId, H),
        eq(s.acknowledgements.subjectType, "update"),
      ),
    );
  const names = await actorNames(db, T, [
    ...msgs.map((m) => m.authorActorId),
    ...updates.map((u) => u.authorActorId),
    ...acks.map((a) => a.actorId),
  ]);
  const entries = [
    ...msgs.map((m) => ({
      type: "message" as const,
      id: m.id,
      at: m.createdAt,
      author: names.get(m.authorActorId) ?? "",
      side: m.authorSide,
      mine: m.authorActorId === ctx.actorId,
      body: m.body,
    })),
    ...updates.map((u) => ({
      type: "update" as const,
      id: u.id,
      at: u.createdAt,
      author: (u.authorActorId && names.get(u.authorActorId)) || "Your care team",
      title: u.title,
      body: u.body,
      requiresAck: u.requiresAck,
      ackedByMe: acks.some((a) => a.subjectId === u.id && a.actorId === ctx.actorId),
      ackedBy: acks.filter((a) => a.subjectId === u.id).map((a) => names.get(a.actorId) ?? ""),
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const guides = await careGuidesFor(db, T, H);
  const cover = await activeCover(db, T, H);
  const audience = threadAllowed
    ? (await membersWho(db, T, H, scope.lifecycle, { permission: "thread.view" })).map((m) => m.name)
    : [];
  return {
    entries,
    /** For the "New since your last visit" divider (null: first visit, nothing is marked new). */
    lastSeenAt: await lastThreadVisit(db, T, ctx.actorId, H),
    canAskAboutUpdates: can(scope.roles, "support.request", scope.lifecycle),
    canView: threadAllowed,
    /** Exactly who in the household can read the care-guide thread (the care team also can). */
    audience,
    hotline: await organizationHotline(db, T, scope.organizationId),
    /** The hospice's own wording about routine messages, or null when it hasn't set any. */
    expectation: await currentMessageExpectation(db, T, scope.organizationId),
    canSend: can(scope.roles, "thread.send", scope.lifecycle) && on.has("communication"),
    messagingOn: on.has("communication"),
    canCompleteSetup: scope.maySetUp,
    careGuide: cover?.name ?? guides[0]?.name ?? null,
    // Decision 62: while cover runs, Home and Messages name the covering guide, until its end.
    careGuideUntil: cover?.until ?? null,
  };
}

/**
 * Sends a message to the care guide. With a submission ID, sending again (after a lost reply)
 * returns the first copy and notifies no one twice. Returns the server's ID and time: the screen
 * says "sent" only after this.
 */
export async function sendFamilyMessage(db: DB, ctx: ActorContext, body: string, submissionId?: string) {
  const scope = await familyScope(db, ctx, "thread.send");
  const text = body.trim();
  if (!text) throw new AccessError("INVALID", "Write a message first.");
  if (text.length > 4000)
    throw new AccessError("INVALID", "That message is too long. Try splitting it in two.");
  const on = await onboardingState(db, ctx.tenantId, scope.householdId);
  if (!on.has("communication"))
    throw new AccessError(
      "NOT_PERMITTED",
      "Messaging turns on once communication settings are chosen in setup.",
    );
  const { row, replayed } = await createOnce(
    submissionId,
    () => messageBySubmission(db, ctx, submissionId!),
    (m) => m.body === text && m.householdId === scope.householdId,
    () => insertFamilyMessage(db, ctx, scope, text, submissionId),
  );
  return { id: row.id, sentAt: row.createdAt, replayed };
}

async function insertFamilyMessage(
  db: DB,
  ctx: ActorContext,
  scope: FamilyScope,
  text: string,
  submissionId: string | undefined,
) {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .insert(s.messages)
      .values({
        tenantId: ctx.tenantId,
        threadId: `th-${scope.householdId}`,
        householdId: scope.householdId,
        authorActorId: ctx.actorId,
        authorSide: "family",
        body: text,
        submissionId: submissionId ?? null,
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "message.sent",
      subjectType: "message",
      subjectId: m!.id,
      summary: `${firstName(ctx.displayName)} sent a message to the care guide.`,
      visibility: "family",
    });
    const guides = await careGuidesFor(tx, ctx.tenantId, scope.householdId);
    const readers = await membersWho(tx, ctx.tenantId, scope.householdId, scope.lifecycle, {
      permission: "thread.view",
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: guides.map((g) => g.actorId),
      kind: "message",
      title: "A household sent a new message",
      link: `/staff/households/${scope.householdId}?tab=messages`,
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: readers.map((r) => r.actorId),
      except: ctx.actorId,
      kind: "message",
      title: "There's a new message from your care team",
      link: `/family/messages#entry-${m!.id}`,
    });
    return m!;
  });
}

export async function acknowledgeUpdate(db: DB, ctx: ActorContext, updateId: string) {
  const scope = await familyScope(db, ctx, "updates.acknowledge");
  const [u] = await db
    .select()
    .from(s.familyUpdates)
    .where(
      and(
        eq(s.familyUpdates.tenantId, ctx.tenantId),
        eq(s.familyUpdates.householdId, scope.householdId),
        eq(s.familyUpdates.id, updateId),
        updateVisibleTo(ctx.actorId),
      ),
    );
  if (!u) throw new AccessError("OUT_OF_SCOPE", "This update isn't available.");
  await db.transaction(async (tx) => {
    const done = await tx
      .insert(s.acknowledgements)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        subjectType: "update",
        subjectId: u.id,
        actorId: ctx.actorId,
      })
      .onConflictDoNothing()
      .returning();
    if (!done.length) return;
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "update.acknowledged",
      subjectType: "family_update",
      subjectId: u.id,
      summary: `${firstName(ctx.displayName)} acknowledged an update.`,
      visibility: "family",
    });
    await markLinkRead(tx, ctx.tenantId, ctx.actorId, "/family/messages");
  });
}

/** Undo your own acknowledgement, within the undo window only. The audit log keeps both events. */
export async function undoAcknowledgeUpdate(db: DB, ctx: ActorContext, updateId: string, now = new Date()) {
  const scope = await familyScope(db, ctx, "updates.acknowledge");
  await db.transaction(async (tx) => {
    await assertMayRemove(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      table: "acknowledgements",
      purpose: "correction",
    });
    const gone = await tx
      .delete(s.acknowledgements)
      .where(
        and(
          eq(s.acknowledgements.tenantId, ctx.tenantId),
          eq(s.acknowledgements.householdId, scope.householdId),
          eq(s.acknowledgements.subjectType, "update"),
          eq(s.acknowledgements.subjectId, updateId),
          eq(s.acknowledgements.actorId, ctx.actorId),
          gt(s.acknowledgements.createdAt, new Date(now.getTime() - UNDO_WINDOW_MS)),
        ),
      )
      .returning();
    if (!gone.length) throw new AccessError("CONFLICT", "This can't be undone any more.");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "update.acknowledgement_undone",
      subjectType: "family_update",
      subjectId: updateId,
      summary: `${firstName(ctx.displayName)} undid their acknowledgement of an update.`,
      visibility: "family",
    });
  });
}

/* ------------------------------------------------------------------ tasks */

export async function listFamilyTasks(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "tasks.view");
  const rows = (
    await db
      .select()
      .from(s.tasks)
      .where(
        and(
          eq(s.tasks.tenantId, ctx.tenantId),
          eq(s.tasks.householdId, scope.householdId),
          eq(s.tasks.audience, "family"),
        ),
      )
      .orderBy(s.tasks.status, s.tasks.createdAt)
  ).filter((t) => familyMaySee(t, ctx.actorId, scope.roles));
  // Decisions 44 and 48b: the coordinator and the patient manage tasks the household added.
  const isCoordinator =
    (scope.roles.includes("coordinator") ||
      (scope.roles.includes("patient") && scope.lifecycle !== "bereavement")) &&
    scope.lifecycle !== "closed";
  const names = await actorNames(
    db,
    ctx.tenantId,
    rows.flatMap((t) => [t.assigneeActorId, t.ownerActorId, t.completedByActorId, ...t.sharedWith]),
  );
  const acks = await db
    .select()
    .from(s.acknowledgements)
    .where(
      and(
        eq(s.acknowledgements.tenantId, ctx.tenantId),
        eq(s.acknowledgements.subjectType, "task"),
        eq(s.acknowledgements.actorId, ctx.actorId),
      ),
    );
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    detail: t.detail,
    whenLabel: t.whenLabel,
    dueAt: t.dueAt,
    visibility: t.visibility,
    sharedWith: t.visibility === "limited" ? t.sharedWith.map((id) => names.get(id) ?? "Someone") : [],
    assigneeActorId: t.assigneeActorId,
    sharedWithIds: t.visibility === "limited" ? t.sharedWith : [],
    closedReason: t.status === "closed" ? t.closedReason : null,
    // Decision 44: the coordinator edits and closes tasks the household added.
    canEdit: isCoordinator && t.status === "open" && t.source === "family",
    status: t.status,
    assignee: t.assigneeActorId ? (names.get(t.assigneeActorId) ?? null) : null,
    mine: t.assigneeActorId === ctx.actorId,
    owner: names.get(t.ownerActorId) ?? null,
    requiresAck: t.requiresAck,
    ackedByMe: acks.some((a) => a.subjectId === t.id),
    // Decisions 25 and 29c: the assignee, the coordinator or the patient (the care guide marks it
    // from the staff side).
    canComplete: familyMayComplete(t, ctx.actorId, scope.roles, scope.lifecycle),
    // The Done list shows "Done by <name> · <date>" (and "for <name>" when it was someone else's).
    done:
      t.status === "done"
        ? {
            by: t.completedByActorId ? (names.get(t.completedByActorId) ?? "Someone") : null,
            for:
              t.assigneeActorId && t.completedByActorId && t.assigneeActorId !== t.completedByActorId
                ? (names.get(t.assigneeActorId) ?? null)
                : null,
            at: t.completedAt,
          }
        : null,
    canReopen:
      t.status === "done" &&
      familyMayComplete({ ...t, status: "open" }, ctx.actorId, scope.roles, scope.lifecycle),
  }));
}

export async function completeFamilyTask(db: DB, ctx: ActorContext, taskId: string) {
  const scope = await familyScope(db, ctx, "tasks.complete_assigned");
  const task = (await listFamilyTasks(db, ctx)).find((t) => t.id === taskId);
  if (!task) throw new AccessError("OUT_OF_SCOPE", "This task isn't available.");
  if (!task.canComplete)
    throw new AccessError(
      "NOT_PERMITTED",
      "Only the person it's assigned to, the household coordinator, the patient or your care guide can mark this done.",
    );
  const [row] = await db
    .select()
    .from(s.tasks)
    .where(and(eq(s.tasks.tenantId, ctx.tenantId), eq(s.tasks.id, taskId)));
  await db.transaction(async (tx) => {
    const ok = await markFamilyTaskDone(
      tx,
      row!,
      { actorId: ctx.actorId, name: ctx.displayName, kind: "family" },
      task.assignee,
    );
    if (!ok) throw new AccessError("INVALID", "This task is already done.");
    const t = row;
    if (t!.requiresAck)
      await tx
        .insert(s.acknowledgements)
        .values({
          tenantId: ctx.tenantId,
          householdId: scope.householdId,
          subjectType: "task",
          subjectId: taskId,
          actorId: ctx.actorId,
        })
        .onConflictDoNothing();
    await markLinkRead(tx, ctx.tenantId, ctx.actorId, "/family/tasks");
  });
}

/**
 * Reopen a household task that was marked done (Undo, or "Reopen" in the Done list). The same
 * people who may mark it done may reopen it. Audit-logged; the care team is told.
 */
export async function reopenFamilyTask(db: DB, ctx: ActorContext, taskId: string) {
  const scope = await familyScope(db, ctx, "tasks.complete_assigned");
  const [t] = await db
    .select()
    .from(s.tasks)
    .where(
      and(
        eq(s.tasks.tenantId, ctx.tenantId),
        eq(s.tasks.householdId, scope.householdId),
        eq(s.tasks.id, taskId),
        eq(s.tasks.audience, "family"),
      ),
    );
  if (!t || !(await listFamilyTasks(db, ctx)).some((x) => x.id === taskId))
    throw new AccessError("OUT_OF_SCOPE", "This task isn't available.");
  if (t.status !== "done") throw new AccessError("INVALID", "This task is already open.");
  if (!familyMayComplete({ ...t, status: "open" }, ctx.actorId, scope.roles, scope.lifecycle))
    throw new AccessError(
      "NOT_PERMITTED",
      "Only the person it's assigned to, the household coordinator, the patient or your care guide can reopen this.",
    );
  await reopenTask(db, t, { actorId: ctx.actorId, name: ctx.displayName });
}

/* ------------------------------------------------------------------ people */

export async function listPeople(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "people.view");
  const members = await householdMembers(db, ctx.tenantId, scope.householdId);
  const invites = await db
    .select()
    .from(s.invitations)
    .where(and(eq(s.invitations.tenantId, ctx.tenantId), eq(s.invitations.householdId, scope.householdId)))
    .orderBy(desc(s.invitations.createdAt));
  const guides = await careGuidesFor(db, ctx.tenantId, scope.householdId);
  const canInvite = can(scope.roles, "people.invite", scope.lifecycle);
  const out = [];
  for (const m of members) {
    // What this person may change about someone else (see services/household-admin.ts).
    const selfManaged = m.roles.every((r) => (SELF_MANAGED_ROLES as readonly HouseholdRole[]).includes(r));
    const manage =
      canInvite && m.actorId !== ctx.actorId && selfManaged
        ? { blocker: await memberChangeBlocker(db, ctx.tenantId, scope.householdId, m.actorId) }
        : null;
    out.push({
      actorId: m.actorId,
      name: m.name,
      me: m.actorId === ctx.actorId,
      roles: m.roles.map((r) => ({ code: r, label: ROLE_LABELS[r], explanation: ROLE_EXPLANATIONS[r] })),
      manage,
    });
  }
  return {
    canInvite,
    members: out,
    invitations: invites.map((i) => ({
      id: i.id,
      name: i.inviteeName,
      contact: i.inviteeContact,
      relationship: i.relationship,
      role: ROLE_LABELS[i.roleCode as HouseholdRole],
      // A pending link past its date shows as expired (it can be given a new link).
      status: i.status === "pending" && i.expiresAt.getTime() <= Date.now() ? "expired" : i.status,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    })),
    careTeam: guides.map((g) => ({ name: g.name, role: ROLE_LABELS.care_guide })),
  };
}

/* ------------------------------------------------------------------ sharing (consent, family view) */

type ConsentRow = typeof s.consents.$inferSelect;

/** Plain words for why a named person can't confirm in the app right now. */
const FAMILY_HELD_REASON =
  "Confirming in the app needs the patient, or someone with an active authority workflow that allows it. A person on your care team will review this with you.";

/**
 * What a household member sees about one consent. Used by the Sharing page and by the
 * consent-specific page for the person named in it, so both say exactly the same thing.
 */
async function describeConsent(
  db: DB,
  ctx: ActorContext,
  c: ConsentRow,
  opts: { isPatient: boolean; canViewSharing: boolean },
) {
  const wf = await consentWorkflow(db, c);
  const mine = c.grantedByActorId === ctx.actorId;
  const open = wf.stage !== "revoked" && wf.stage !== "expired";
  const corr = wf.correction;
  const [amended] =
    c.version > 1
      ? await db
          .select({ context: s.auditEvents.context })
          .from(s.auditEvents)
          .where(
            and(
              eq(s.auditEvents.tenantId, ctx.tenantId),
              eq(s.auditEvents.subjectId, c.id),
              eq(s.auditEvents.action, "consent.amended"),
            ),
          )
          .orderBy(desc(s.auditEvents.seq))
          .limit(1)
      : [];
  const amendCtx = (amended?.context ?? {}) as { changed?: string[]; previous?: Record<string, unknown> };
  const changed = (amendCtx.changed ?? []).filter((x): x is string => typeof x === "string");
  const now: Record<string, string | string[]> = {
    purpose: c.purpose,
    recipient: c.recipientName,
    scope: c.scope as string[],
    start: c.startsAt.toISOString(),
    expiry: c.expiresAt.toISOString(),
    "revocation terms": c.revocationPath,
  };
  const asText = (f: string, v: unknown) =>
    f === "scope" && Array.isArray(v)
      ? (v as ShareCategory[]).map((k) => SHARE_CATEGORY_LABELS[k] ?? k).join(", ")
      : typeof v === "string"
        ? v
        : null;
  /** Old → new for each changed field, when the previous value was recorded. */
  const changes = changed.map((f) => ({
    field: f,
    kind: f === "start" || f === "expiry" ? ("date" as const) : ("text" as const),
    from: asText(f, amendCtx.previous?.[f]),
    to: asText(f, now[f]),
  }));
  const [lastDismissed] = await db
    .select()
    .from(s.consentCorrectionRequests)
    .where(
      and(
        eq(s.consentCorrectionRequests.tenantId, ctx.tenantId),
        eq(s.consentCorrectionRequests.consentId, c.id),
        eq(s.consentCorrectionRequests.outcome, "dismissed"),
        eq(s.consentCorrectionRequests.requestedByActorId, ctx.actorId),
      ),
    )
    .orderBy(desc(s.consentCorrectionRequests.resolvedAt))
    .limit(1);
  return {
    id: c.id,
    version: c.version,
    purpose: c.purpose,
    recipientName: c.recipientName,
    grantedBy: c.grantedByName,
    grantedByMe: mine,
    scope: (c.scope as ShareCategory[]).map((k) => SHARE_CATEGORY_LABELS[k] ?? k),
    startsAt: c.startsAt,
    expiresAt: c.expiresAt,
    stage: wf.stage,
    stageLabel: CONSENT_STAGE_LABELS[wf.stage],
    revocationPath: c.revocationPath,
    revokedAt: c.revokedAt,
    /** What changed in the latest version, so the person confirms knowingly. */
    changedInThisVersion: c.version > 1 ? changed : [],
    changes: c.version > 1 ? changes : [],
    confirmation: wf.confirmation
      ? { at: wf.confirmation.confirmedAt, version: wf.confirmation.consentVersion }
      : null,
    heldReason: wf.stage === "needs_review" ? FAMILY_HELD_REASON : null,
    // Only the person who asked sees what they asked about; others see that sharing is held.
    correction: corr
      ? {
          id: corr.id,
          at: corr.createdAt,
          categories:
            corr.requestedByActorId === ctx.actorId
              ? (corr.categories as CorrectionCategory[]).map((k) => CORRECTION_CATEGORY_LABELS[k] ?? k)
              : [],
          mine: corr.requestedByActorId === ctx.actorId,
        }
      : null,
    /**
     * When the care team last reviewed this person's request and made no change. The staff reason
     * stays with the care team; the household is shown a fixed, plain outcome instead.
     */
    lastDismissal: lastDismissed && !corr ? { at: lastDismissed.resolvedAt } : null,
    /** Only the named grantor, while able to confirm, for the current version, with no correction pending. */
    canConfirm: mine && wf.stage === "awaiting_confirmation" && !corr,
    confirmationStatement: CONSENT_CONFIRMATION_STATEMENT,
    /** Only the named grantor can place a correction request (which holds sharing). */
    canRequestCorrection: open && !corr && mine,
    /** Others who can see it raise a concern through Support, which holds nothing. */
    canRaiseConcern: open && opts.canViewSharing && !mine,
    canCancelCorrection: !!corr && corr.requestedByActorId === ctx.actorId,
    /** Withdrawal follows the existing policy: Sharing access, and the grantor or the patient. */
    canWithdraw: open && opts.canViewSharing && (mine || opts.isPatient),
    canAskToWithdraw: open && opts.canViewSharing && !(mine || opts.isPatient),
    /**
     * How this person can withdraw it, generated from what they can actually do (founder direction,
     * review observations 6–7) — never the free text staff typed when recording the consent.
     */
    withdrawGuidance: !open
      ? null
      : open && opts.canViewSharing && (mine || opts.isPatient)
        ? "You can withdraw this at any time with “Withdraw consent” below."
        : open && opts.canViewSharing
          ? "You can't withdraw this yourself. Use “Ask the care team to withdraw this” below."
          : "You can't withdraw this yourself. To stop it, ask your care guide.",
  };
}

/** What needs the viewer first, then held or in progress, then active, then ended. */
function byWhatNeedsYou<T extends { canConfirm: boolean; stage: string; correction: unknown }>(list: T[]) {
  const rank = (c: T) =>
    c.canConfirm
      ? 0
      : c.correction || !["active", "scheduled", "revoked", "expired"].includes(c.stage)
        ? 1
        : c.stage === "active" || c.stage === "scheduled"
          ? 2
          : 3;
  return [...list].sort((a, b) => rank(a) - rank(b));
}

export async function listHouseholdConsents(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "consent.view");
  const rows = await db
    .select()
    .from(s.consents)
    .where(and(eq(s.consents.tenantId, ctx.tenantId), eq(s.consents.householdId, scope.householdId)))
    .orderBy(desc(s.consents.createdAt));
  const receipts = await db
    .select({ r: s.packetReleaseReceipts, consentId: s.packets.consentId })
    .from(s.packetReleaseReceipts)
    .innerJoin(
      s.packets,
      and(
        eq(s.packets.id, s.packetReleaseReceipts.packetId),
        eq(s.packets.tenantId, s.packetReleaseReceipts.tenantId),
      ),
    )
    .where(
      and(eq(s.packetReleaseReceipts.tenantId, ctx.tenantId), eq(s.packets.householdId, scope.householdId)),
    );
  const isPatient = scope.roles.includes("patient");
  const alerted = await alertedPackets(db, ctx.tenantId, [...new Set(receipts.map((x) => x.r.packetId))]);
  const out = [];
  for (const c of rows)
    out.push({
      ...(await describeConsent(db, ctx, c, { isPatient, canViewSharing: true })),
      releases: receipts
        .filter((x) => x.consentId === c.id)
        .map((x) => ({
          at: x.r.releasedAt,
          // Decision 48c: which release note is true for this release.
          note: releaseNote(alerted.has(x.r.packetId)),
          manifest: (x.r.manifest as ShareCategory[]).map((k) => SHARE_CATEGORY_LABELS[k] ?? k),
        })),
    });
  return byWhatNeedsYou(out);
}

/**
 * Consents that name this person as the one giving consent — and only those. This is how a named
 * person who has no Sharing view still sees and acts on what concerns them: a check on the consent
 * itself (they are its named grantor, in their own household), not a broader role.
 */
export async function consentsForMe(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "household.view");
  const rows = await db
    .select()
    .from(s.consents)
    .where(
      and(
        eq(s.consents.tenantId, ctx.tenantId),
        eq(s.consents.householdId, scope.householdId),
        eq(s.consents.grantedByActorId, ctx.actorId),
      ),
    )
    .orderBy(desc(s.consents.createdAt));
  const opts = {
    isPatient: scope.roles.includes("patient"),
    canViewSharing: can(scope.roles, "consent.view", scope.lifecycle),
  };
  const out = [];
  for (const c of rows) out.push(await describeConsent(db, ctx, c, opts));
  return byWhatNeedsYou(out);
}

export async function getConsentForMe(db: DB, ctx: ActorContext, consentId: string) {
  const c = (await consentsForMe(db, ctx)).find((x) => x.id === consentId);
  // Same answer whether it doesn't exist or isn't theirs: nothing about other consents leaks.
  if (!c)
    throw new AccessError("OUT_OF_SCOPE", "This consent request isn't for you, or it's no longer available.");
  return c;
}

/** A consent this person may act on: theirs by name, or visible to them on the Sharing page. */
async function consentInMyHousehold(db: DB, ctx: ActorContext, consentId: string) {
  const scope = await familyScope(db, ctx, "household.view");
  const [c] = await db
    .select()
    .from(s.consents)
    .where(
      and(
        eq(s.consents.tenantId, ctx.tenantId),
        eq(s.consents.householdId, scope.householdId),
        eq(s.consents.id, consentId),
      ),
    );
  const canViewSharing = can(scope.roles, "consent.view", scope.lifecycle);
  if (!c || (c.grantedByActorId !== ctx.actorId && !canViewSharing))
    throw new AccessError("OUT_OF_SCOPE", "This consent isn't available.");
  return { scope, c, canViewSharing };
}

export async function requestConsentCorrection(
  db: DB,
  ctx: ActorContext,
  input: { consentId: string; version: number; categories: CorrectionCategory[]; detail: string },
) {
  const { scope, c } = await consentInMyHousehold(db, ctx, input.consentId);
  if (c.grantedByActorId !== ctx.actorId)
    throw new AccessError(
      "NOT_PERMITTED",
      "Only the person named as giving this consent can request a correction. If something about it concerns you, you can ask your care team for support.",
    );
  if (c.version !== input.version)
    throw new AccessError(
      "CONFLICT",
      "This consent changed since you opened it. Please look at the current version.",
    );
  const wf = await consentWorkflow(db, c);
  if (wf.stage === "revoked" || wf.stage === "expired")
    throw new AccessError("INVALID", "This consent has already ended, so there's nothing to correct.");
  const categories = [...new Set(input.categories)].filter((k) => CORRECTION_CATEGORIES.includes(k));
  const detail = input.detail.trim().slice(0, 1000);
  await db.transaction(async (tx) => {
    const [req] = await tx
      .insert(s.consentCorrectionRequests)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        consentId: c.id,
        consentVersion: c.version,
        requestedByActorId: ctx.actorId,
        categories,
        detail,
      })
      .onConflictDoNothing()
      .returning();
    if (!req)
      throw new AccessError(
        "CONFLICT",
        "A correction request is already open for this consent. The care team has it.",
      );
    const labels = categories.map((k) => CORRECTION_CATEGORY_LABELS[k]);
    const [esc] = await tx
      .insert(s.escalations)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        kind: "consent_correction",
        sourceType: "consent_correction",
        sourceId: req.id,
        // Categories only: the person's own words stay on the correction request, for the care team.
        summary: `A correction was requested for consent to share with ${c.recipientName}${labels.length ? ` (${labels.join(", ").toLowerCase()})` : ""}.`,
      })
      .returning();
    await tx
      .update(s.consentCorrectionRequests)
      .set({ escalationId: esc!.id })
      .where(eq(s.consentCorrectionRequests.id, req.id));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "consent.correction_requested",
      subjectType: "consent",
      subjectId: c.id,
      decision: "hold",
      reasonCode: "CONSENT_CORRECTION_PENDING",
      summary: `${firstName(ctx.displayName)} asked for a correction to a sharing consent. Nothing is shared under it until the care team resolves the request.`,
      visibility: "sharing",
      context: { requestId: req.id, version: c.version, categories },
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: [
        ...(await careGuidesFor(tx, ctx.tenantId, scope.householdId)).map((g) => g.actorId),
        ...(await staffWithRole(tx, ctx.tenantId, "privileged_reviewer")),
      ],
      kind: "consent",
      title: "A household asked for a consent correction",
      link: `/staff/households/${scope.householdId}?tab=sharing`,
    });
  });
}

export async function cancelConsentCorrection(db: DB, ctx: ActorContext, consentId: string) {
  const { scope } = await consentInMyHousehold(db, ctx, consentId);
  await db.transaction(async (tx) => {
    const [r] = await tx
      .update(s.consentCorrectionRequests)
      .set({ status: "cancelled", resolvedByActorId: ctx.actorId, resolvedAt: new Date() })
      .where(
        and(
          eq(s.consentCorrectionRequests.tenantId, ctx.tenantId),
          eq(s.consentCorrectionRequests.consentId, consentId),
          eq(s.consentCorrectionRequests.requestedByActorId, ctx.actorId),
          eq(s.consentCorrectionRequests.status, "open"),
        ),
      )
      .returning();
    if (!r) throw new AccessError("CONFLICT", "There's no open correction request of yours to cancel.");
    if (r.escalationId)
      await tx
        .update(s.escalations)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolvedByActorId: ctx.actorId,
          resolution: "Cancelled by the person who asked.",
        })
        .where(and(eq(s.escalations.tenantId, ctx.tenantId), eq(s.escalations.id, r.escalationId)));
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "consent.correction_cancelled",
      subjectType: "consent",
      subjectId: consentId,
      summary: `${firstName(ctx.displayName)} cancelled their correction request.`,
      visibility: "sharing",
      context: { requestId: r.id },
    });
  });
}

/**
 * Stage 2: the named grantor confirms the exact current version in the app. Allowed only while
 * they can self-confirm (the patient while active, or an applicable active authority workflow);
 * otherwise the consent is held for human review — never auto-confirmed. The audit records who,
 * when, how, which version and the statement they confirmed.
 */
export async function confirmConsent(
  db: DB,
  ctx: ActorContext,
  input: { consentId: string; version: number },
) {
  const scope = await familyScope(db, ctx, "household.view");
  const [c] = await db
    .select()
    .from(s.consents)
    .where(
      and(
        eq(s.consents.tenantId, ctx.tenantId),
        eq(s.consents.householdId, scope.householdId),
        eq(s.consents.id, input.consentId),
      ),
    );
  if (!c) throw new AccessError("OUT_OF_SCOPE", "This consent isn't available.");
  if (c.grantedByActorId !== ctx.actorId)
    throw new AccessError("NOT_PERMITTED", "Only the person named as giving this consent can confirm it.");
  if (c.version !== input.version)
    throw new AccessError(
      "CONFLICT",
      "This consent changed since you opened it. Please review the current version.",
    );
  const wf = await consentWorkflow(db, c);
  if (wf.stage === "needs_review")
    throw new AccessError(
      "NOT_PERMITTED",
      "You can't confirm this in the app under the current workflow. It's held, and a person on your care team will review it.",
    );
  if (wf.stage !== "awaiting_confirmation")
    throw new AccessError("INVALID", "This consent isn't waiting for confirmation.");
  if (wf.correction)
    throw new AccessError(
      "INVALID",
      "A correction was requested for this consent. Once the care team resolves it, you can confirm the result.",
    );
  await db.transaction(async (tx) => {
    const [conf] = await tx
      .insert(s.consentConfirmations)
      .values({
        tenantId: ctx.tenantId,
        consentId: c.id,
        consentVersion: c.version,
        actorId: ctx.actorId,
        method: CONSENT_CONFIRMATION_METHOD,
        statement: CONSENT_CONFIRMATION_STATEMENT,
      })
      .onConflictDoNothing()
      .returning();
    // Already confirmed (for example, a double tap): say so plainly and write nothing else.
    if (!conf)
      throw new AccessError("CONFLICT", "You've already confirmed this version. Nothing else is needed.");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "consent.confirmed",
      subjectType: "consent",
      subjectId: c.id,
      summary: `${firstName(ctx.displayName)} confirmed the consent to share with ${c.recipientName}. A care-team reviewer still has to approve it.`,
      visibility: "sharing",
      context: {
        confirmationId: conf!.id,
        consentVersion: c.version,
        method: CONSENT_CONFIRMATION_METHOD,
        statement: CONSENT_CONFIRMATION_STATEMENT,
        confirmedAt: conf!.confirmedAt.toISOString(),
      },
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: await staffWithRole(tx, ctx.tenantId, "privileged_reviewer"),
      kind: "consent",
      title: "A household confirmed a consent; it's ready for activation",
      link: "/staff/reviews",
    });
    await markLinkRead(tx, ctx.tenantId, ctx.actorId, "/family/sharing");
  });
}

/** The person who gave consent (or the patient) can withdraw it directly. Anything held is re-checked. */
export async function withdrawConsent(db: DB, ctx: ActorContext, consentId: string) {
  const { scope, c: row, canViewSharing } = await consentInMyHousehold(db, ctx, consentId);
  const c = await describeConsent(db, ctx, row, {
    isPatient: scope.roles.includes("patient"),
    canViewSharing,
  });
  if (!c) throw new AccessError("OUT_OF_SCOPE", "This consent isn't available.");
  if (!c.canWithdraw)
    throw new AccessError(
      "NOT_PERMITTED",
      "Only the person who gave this consent, or the patient, can withdraw it here. You can ask the care team instead.",
    );
  await db.transaction(async (tx) => {
    await tx
      .update(s.consents)
      .set({
        state: "revoked",
        revokedAt: new Date(),
        revokedByActorId: ctx.actorId,
        revokeReason: "Withdrawn by the household in Zeporah.",
      })
      .where(
        and(
          eq(s.consents.tenantId, ctx.tenantId),
          eq(s.consents.id, consentId),
          ne(s.consents.state, "revoked"),
        ),
      )
      .returning({ id: s.consents.id })
      .then((r) => {
        // Already withdrawn a moment ago (for example, a double tap): record nothing twice.
        if (!r.length) throw new AccessError("CONFLICT", "This consent was already withdrawn.");
      });
    await closeOpenCorrection(tx, ctx, consentId, "withdrawn");
    const held = await tx
      .update(s.packets)
      .set({ state: "held", lastReasonCode: "CONSENT_REVOKED", updatedAt: new Date() })
      .where(
        and(
          eq(s.packets.tenantId, ctx.tenantId),
          eq(s.packets.consentId, consentId),
          or(eq(s.packets.state, "draft"), eq(s.packets.state, "held")),
        ),
      )
      .returning({ id: s.packets.id });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "consent.revoked",
      subjectType: "consent",
      subjectId: consentId,
      decision: held.length ? "hold" : null,
      reasonCode: held.length ? "CONSENT_REVOKED" : null,
      summary: `Consent to share with ${c.recipientName} was withdrawn. Future access through Zeporah is revoked. Nothing is recalled, and no external recipient was contacted.`,
      visibility: "sharing",
      context: { heldPackets: held.map((p) => p.id) },
    });
    const staff = [
      ...(await careGuidesFor(tx, ctx.tenantId, scope.householdId)).map((g) => g.actorId),
      ...(await staffWithRole(tx, ctx.tenantId, "privileged_reviewer")),
      ...(await staffWithRole(tx, ctx.tenantId, "hospice_ops")),
    ];
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: staff,
      kind: "consent",
      title: "A household withdrew a consent",
      link: `/staff/households/${scope.householdId}?tab=sharing`,
    });
    const others = await membersWho(tx, ctx.tenantId, scope.householdId, scope.lifecycle, {
      permission: "consent.view",
    });
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: others.map((o) => o.actorId),
      except: ctx.actorId,
      kind: "consent",
      title: "A sharing choice changed",
      link: "/family/sharing",
    });
  });
}

/** Anyone who can view consents can ask the care team to withdraw one; a person decides. */
export async function askToWithdrawConsent(db: DB, ctx: ActorContext, consentId: string) {
  const scope = await familyScope(db, ctx, "consent.view");
  const c = (await listHouseholdConsents(db, ctx)).find((x) => x.id === consentId);
  if (!c) throw new AccessError("OUT_OF_SCOPE", "This consent isn't available.");
  await raiseFamilyRequest(db, ctx, scope, {
    kind: "privacy_concern",
    sourceType: "consent",
    sourceId: consentId,
    summary: `${firstName(ctx.displayName)} asked the care team to withdraw consent to share with ${c.recipientName}.`,
  });
}

/* ------------------------------------------------------------------ support */

export async function getSupport(
  db: DB,
  ctx: ActorContext,
  opts: { aboutUpdateId?: string | undefined } = {},
) {
  const scope = await familyScope(db, ctx, "household.view");
  const [prefs] = await db
    .select()
    .from(s.supportPreferences)
    .where(
      and(
        eq(s.supportPreferences.tenantId, ctx.tenantId),
        eq(s.supportPreferences.householdId, scope.householdId),
      ),
    );
  const [record] = await db
    .select()
    .from(s.careCoordinationRecords)
    .where(
      and(
        eq(s.careCoordinationRecords.tenantId, ctx.tenantId),
        eq(s.careCoordinationRecords.householdId, scope.householdId),
      ),
    );
  const mine = await db
    .select()
    .from(s.escalations)
    .where(
      and(
        eq(s.escalations.tenantId, ctx.tenantId),
        eq(s.escalations.householdId, scope.householdId),
        eq(s.escalations.sourceType, "support_request"),
        // "Your requests": this person's own (older rows recorded no requester, so they still show).
        or(eq(s.escalations.raisedByActorId, ctx.actorId), isNull(s.escalations.raisedByActorId)),
      ),
    )
    .orderBy(desc(s.escalations.createdAt))
    .limit(10);
  // "Show me one smaller step" (item 6): the viewer's own open task with the least to it.
  const myOpen = await db
    .select({ id: s.tasks.id, title: s.tasks.title, detail: s.tasks.detail })
    .from(s.tasks)
    .where(
      and(
        eq(s.tasks.tenantId, ctx.tenantId),
        eq(s.tasks.householdId, scope.householdId),
        eq(s.tasks.audience, "family"),
        eq(s.tasks.status, "open"),
        eq(s.tasks.assigneeActorId, ctx.actorId),
      ),
    );
  const smallest = myOpen.sort(
    (a, b) => a.title.length + a.detail.length - (b.title.length + b.detail.length),
  )[0];
  const [about] = opts.aboutUpdateId
    ? await db
        .select({ id: s.familyUpdates.id, title: s.familyUpdates.title })
        .from(s.familyUpdates)
        .where(
          and(
            eq(s.familyUpdates.tenantId, ctx.tenantId),
            eq(s.familyUpdates.householdId, scope.householdId),
            eq(s.familyUpdates.id, opts.aboutUpdateId),
            updateVisibleTo(ctx.actorId),
          ),
        )
    : [];
  return {
    lifecycle: scope.lifecycle,
    smallestTask: smallest ? { id: smallest.id, title: smallest.title } : null,
    canInvite: can(scope.roles, "people.invite", scope.lifecycle),
    aboutUpdate: about ?? null,
    prefs: prefs ?? null,
    canRequest: can(scope.roles, "support.request", scope.lifecycle),
    canEditPrefs: scope.maySetUp,
    afterHoursRoute: record?.afterHoursRoute ?? null,
    hotline: await organizationHotline(db, ctx.tenantId, scope.organizationId),
    expectation: await currentMessageExpectation(db, ctx.tenantId, scope.organizationId),
    requests: mine.map((e) => ({ id: e.id, status: e.status, at: e.createdAt, topic: e.topic })),
  };
}

export async function saveSupportPreferences(
  db: DB,
  ctx: ActorContext,
  input: {
    categories: string[];
    spiritualCare: boolean;
    preferredContactTime: string;
  },
) {
  const scope = await familyScope(db, ctx, "onboarding.complete");
  const values = {
    categories: input.categories,
    spiritualCare: input.spiritualCare,
    preferredContactTime: input.preferredContactTime || null,
    updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    await tx
      .insert(s.supportPreferences)
      .values({ tenantId: ctx.tenantId, householdId: scope.householdId, ...values })
      .onConflictDoUpdate({ target: s.supportPreferences.householdId, set: values });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "support_preferences.updated",
      subjectType: "support_preferences",
      subjectId: scope.householdId,
      summary: "Support preferences were updated.",
      visibility: "family",
    });
  });
}

async function raiseFamilyRequest(
  db: DB,
  ctx: ActorContext,
  scope: FamilyScope,
  e: {
    kind: string;
    sourceType: string;
    sourceId: string | null;
    summary: string;
    topic?: string | null;
    submissionId?: string | null;
  },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.escalations)
      .values({ tenantId: ctx.tenantId, householdId: scope.householdId, raisedByActorId: ctx.actorId, ...e })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "escalation.raised",
      subjectType: "escalation",
      subjectId: row!.id,
      // Family-visible, so it uses the family wording (founder decision 26).
      summary: "A request went to the care team.",
      visibility: "family",
      context: { kind: e.kind },
    });
    const guides = await careGuidesFor(tx, ctx.tenantId, scope.householdId);
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: guides.map((g) => g.actorId),
      kind: "escalation",
      title: "A household asked for a person to follow up",
      link: "/staff/exceptions?view=all&kind=escalation",
    });
    return row!;
  });
}

/**
 * A request for a person to follow up. It only ever goes to the household's own care team,
 * contains only what the person typed, and is never routed as an emergency.
 */
export const ABOUT_UPDATE_TOPIC = "A question about an update";
/** Asking again about the same topic this soon gets a "send again?" check (item 6). */
export const DUPLICATE_WINDOW_MS = 2 * 60_000;
export const DUPLICATE_MESSAGE = "You sent this a moment ago — send again?";

export async function requestHumanSupport(
  db: DB,
  ctx: ActorContext,
  input: {
    category: string;
    message: string;
    contactTime: string;
    /** "Ask about this" on an update (item 8): routed the same way, naming the update. */
    aboutUpdateId?: string | undefined;
    /** The person saw the duplicate check and chose to send again. */
    sendAgain?: boolean | undefined;
    /** The device's ID for this request: a retry after a lost reply isn't sent twice. */
    submissionId?: string | undefined;
  },
  now = new Date(),
) {
  const scope = await familyScope(db, ctx, "support.request");
  const sid = input.submissionId;
  const body = input.message.trim().slice(0, 1000);
  let about: { id: string; title: string } | null = null;
  if (input.aboutUpdateId) {
    const [u] = await db
      .select({ id: s.familyUpdates.id, title: s.familyUpdates.title })
      .from(s.familyUpdates)
      .where(
        and(
          eq(s.familyUpdates.tenantId, ctx.tenantId),
          eq(s.familyUpdates.householdId, scope.householdId),
          eq(s.familyUpdates.id, input.aboutUpdateId),
          updateVisibleTo(ctx.actorId),
        ),
      );
    if (!u) throw new AccessError("OUT_OF_SCOPE", "This update isn't available.");
    about = u;
  }
  const topic = about ? ABOUT_UPDATE_TOPIC : input.category.trim().slice(0, 80);
  // The same send arriving again is the first request, not a duplicate to ask about.
  const prior = sid ? await requestBySubmission(db, ctx, sid) : undefined;
  if (!prior && !input.sendAgain) {
    const [recent] = await db
      .select({ id: s.escalations.id })
      .from(s.escalations)
      .where(
        and(
          eq(s.escalations.tenantId, ctx.tenantId),
          eq(s.escalations.householdId, scope.householdId),
          eq(s.escalations.sourceType, "support_request"),
          eq(s.escalations.raisedByActorId, ctx.actorId),
          eq(s.escalations.topic, topic),
          about ? eq(s.escalations.sourceId, about.id) : undefined,
          gt(s.escalations.createdAt, new Date(now.getTime() - DUPLICATE_WINDOW_MS)),
        ),
      )
      .limit(1);
    if (recent) throw new AccessError("CONFLICT", DUPLICATE_MESSAGE);
  }
  const { row, replayed } = await createOnce(
    sid,
    () => requestBySubmission(db, ctx, sid!),
    (e) => e.topic === topic && e.sourceId === (about?.id ?? null) && e.householdId === scope.householdId,
    () =>
      raiseFamilyRequest(db, ctx, scope, {
        kind: "family_request",
        sourceType: "support_request",
        sourceId: about?.id ?? null,
        topic,
        submissionId: sid ?? null,
        summary: about
          ? `${firstName(ctx.displayName)} has a question about the update “${about.title}”.${body ? ` They wrote: “${body}”` : ""}${input.contactTime ? ` Best time: ${input.contactTime}.` : ""}`
          : `${firstName(ctx.displayName)} asked to talk with someone about: ${topic}.${body ? ` They wrote: “${body}”` : ""}${input.contactTime ? ` Best time: ${input.contactTime}.` : ""}`,
      }),
  );
  return { id: row.id, sentAt: row.createdAt, replayed };
}

/** The request this person already sent under this submission ID, if any. */
async function requestBySubmission(conn: Conn, ctx: ActorContext, submissionId: string) {
  const [e] = await conn
    .select()
    .from(s.escalations)
    .where(
      and(
        eq(s.escalations.tenantId, ctx.tenantId),
        eq(s.escalations.raisedByActorId, ctx.actorId),
        eq(s.escalations.submissionId, submissionId),
      ),
    );
  return e;
}

/* ------------------------------------------------------------------ bereavement */

export async function getBereavement(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "household.view");
  const [t] = await db
    .select()
    .from(s.bereavementTransitions)
    .where(
      and(
        eq(s.bereavementTransitions.tenantId, ctx.tenantId),
        eq(s.bereavementTransitions.householdId, scope.householdId),
        eq(s.bereavementTransitions.state, "confirmed"),
      ),
    );
  const names = await actorNames(db, ctx.tenantId, [t?.survivingContactActorId ?? null]);
  return {
    lifecycle: scope.lifecycle,
    patientName: scope.patientName,
    transition: t
      ? {
          confirmedAt: t.confirmedAt,
          survivingContact: t.survivingContactActorId ? (names.get(t.survivingContactActorId) ?? null) : null,
          isMe: t.survivingContactActorId === ctx.actorId,
          contactConfirmedAt: t.survivingContactConfirmedAt,
        }
      : null,
    canConfirm: can(scope.roles, "bereavement.confirm_contact", scope.lifecycle),
    plan: await familyPlan(db, ctx.tenantId, scope.householdId),
    contactPaused: !!(await contactPause(db, ctx.tenantId, scope.householdId)),
    canPauseContact: can(scope.roles, "bereavement.confirm_contact", scope.lifecycle),
  };
}

/**
 * "I'd rather not be contacted for now" (interaction review, item 13). Saved to the household's
 * support preferences and shown to the care team, who decide how to respect it; remaining
 * check-ins are flagged, not cancelled (founder decision 11). Can be turned back off.
 */
export async function setContactPause(db: DB, ctx: ActorContext, paused: boolean) {
  const scope = await familyScope(db, ctx, "bereavement.confirm_contact");
  const now = new Date();
  const values = {
    contactPaused: paused,
    contactPausedAt: paused ? now : null,
    contactPausedByActorId: paused ? ctx.actorId : null,
    updatedAt: now,
  };
  await db.transaction(async (tx) => {
    await tx
      .insert(s.supportPreferences)
      .values({ tenantId: ctx.tenantId, householdId: scope.householdId, ...values })
      .onConflictDoUpdate({ target: s.supportPreferences.householdId, set: values });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: paused ? "support_preferences.contact_paused" : "support_preferences.contact_resumed",
      subjectType: "support_preferences",
      subjectId: scope.householdId,
      summary: paused
        ? `${firstName(ctx.displayName)} asked not to be contacted for now.`
        : `${firstName(ctx.displayName)} said the care team can get in touch again.`,
      visibility: "family",
    });
    const guides = await careGuidesFor(tx, ctx.tenantId, scope.householdId);
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: guides.map((g) => g.actorId),
      kind: "bereavement",
      title: "A household changed its contact preference",
      link: `/staff/households/${scope.householdId}?tab=overview`,
    });
  });
}

export async function confirmSurvivingContact(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "bereavement.confirm_contact");
  await db.transaction(async (tx) => {
    const done = await tx
      .update(s.bereavementTransitions)
      .set({ survivingContactConfirmedAt: new Date() })
      .where(
        and(
          eq(s.bereavementTransitions.tenantId, ctx.tenantId),
          eq(s.bereavementTransitions.householdId, scope.householdId),
          eq(s.bereavementTransitions.state, "confirmed"),
          eq(s.bereavementTransitions.survivingContactActorId, ctx.actorId),
          isNull(s.bereavementTransitions.survivingContactConfirmedAt),
        ),
      )
      .returning();
    if (!done.length) throw new AccessError("INVALID", "There's nothing to confirm right now.");
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "bereavement.contact_confirmed",
      subjectType: "household",
      subjectId: scope.householdId,
      summary: `${firstName(ctx.displayName)} confirmed they're the main contact going forward.`,
      visibility: "family",
    });
    const guides = await careGuidesFor(tx, ctx.tenantId, scope.householdId);
    await notify(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      recipients: guides.map((g) => g.actorId),
      kind: "lifecycle",
      title: "A surviving contact was confirmed",
      link: `/staff/households/${scope.householdId}`,
    });
    await markLinkRead(tx, ctx.tenantId, ctx.actorId, "/family/bereavement");
  });
}
