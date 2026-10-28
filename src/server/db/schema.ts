/**
 * Who sees it (founder decision 43): `private` (its owner only), `selected` (the people in
 * `sharedWith`, or the vault keepers when that's null; not the care team), `household` (every
 * member and the care team) or `staff` (the vault keepers and the care team — what every item
 * had before this setting existed). Protected items always follow the protected-access rule.
 */
/**
 * Database schema. Every tenant-owned table carries `tenant_id`, and every reference between
 * tenant-owned rows is a composite foreign key that includes `tenant_id`, so the database itself
 * refuses a row that points into another tenant.
 *
 * Nothing here stores clinical charts, legal originals, or files — only coordination records,
 * metadata and workflow states. All data is synthetic.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()::text`);
const tenantId = () => text("tenant_id").notNull();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const nowCol = (name: string) => ts(name).notNull().defaultNow();
const createdAt = () => nowCol("created_at");

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    name: text("name").notNull(),
    stateCode: text("state_code").notNull(),
    /** The confirmed 24-hour line families see (decision 72). Changed only by a confirmed change. */
    afterHoursLine: text("after_hours_line").notNull(),
    /** An optional confirmed backup, "if you can't get through" (decision 72). */
    afterHoursBackupLine: text("after_hours_backup_line"),
    /** Shown as the sender of email notices (section 6). Empty: "Zeporah". */
    emailSenderName: text("email_sender_name").notNull().default(""),
    /** Workflow and organization settings (decision 39); see domain/org-settings.ts for defaults. */
    settings: jsonb("settings")
      .$type<Partial<import("@/domain/org-settings").OrgSettings>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
  },
  (t) => [unique("organizations_tenant_id").on(t.tenantId, t.id)],
);

export const actors = pgTable(
  "actors",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    /** `recipient`: a named outside recipient of a released packet (founder decision 45). */
    kind: text("kind").$type<"family" | "staff" | "recipient">().notNull(),
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    createdAt: createdAt(),
    /** Set when a staff member is deactivated: no sign-in, no session, no access. Never cleared here. */
    deactivatedAt: ts("deactivated_at"),
  },
  (t) => [unique("actors_tenant_id").on(t.tenantId, t.id)],
);

/** Reference table describing every role. Seeded; never edited by the app. */
export const roles = pgTable("roles", {
  code: text("code").primaryKey(),
  scope: text("scope").$type<"household" | "organization" | "external">().notNull(),
  label: text("label").notNull(),
  description: text("description").notNull(),
});

export const households = pgTable(
  "households",
  {
    id: id(),
    tenantId: tenantId(),
    organizationId: text("organization_id").notNull(),
    displayName: text("display_name").notNull(),
    patientName: text("patient_name").notNull(),
    lifecycleState: text("lifecycle_state").notNull().default("enrolled"),
    enrolledAt: nowCol("enrolled_at"),
    lifecycleChangedAt: ts("lifecycle_changed_at"),
    /** Who enrolled it in Zeporah (decision 66). Null for households from before enrollment existed. */
    enrolledByActorId: text("enrolled_by_actor_id"),
    /** The care guide who owns getting the household started (decision 66). */
    activationOwnerActorId: text("activation_owner_actor_id"),
  },
  (t) => [
    unique("households_tenant_id").on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.organizationId],
      foreignColumns: [organizations.tenantId, organizations.id],
    }),
  ],
);

/** Ties a person to a household (household roles) or to an organization (staff roles). */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    tenantId: tenantId(),
    actorId: text("actor_id").notNull(),
    householdId: text("household_id"),
    organizationId: text("organization_id"),
    roleCode: text("role_code")
      .notNull()
      .references(() => roles.code),
    status: text("status").$type<"active" | "ended">().notNull().default("active"),
    createdAt: createdAt(),
    endedAt: ts("ended_at"),
    endReason: text("end_reason"),
    /** Task-only helpers (founder decision 42): the one task this membership covers. */
    taskId: text("task_id"),
    /** Helpers and household collaborators: when access ends by itself. */
    expiresAt: ts("expires_at"),
    /**
     * Temporary cover (decision 59): the care guide this membership covers for. Set only on
     * care-guide memberships granted by an accepted handoff; `expires_at` ends it at the exact time.
     */
    coverForActorId: text("cover_for_actor_id"),
    /** Temporary cover only: access starts at this exact time (decision 59), not when it's accepted. */
    startsAt: ts("starts_at"),
    /** Why the access was granted, in the words of the person who granted it. */
    grantReason: text("grant_reason"),
  },
  (t) => [
    // One active row per person, household and role: a care-guide assignment (or a household
    // role) can't be recorded twice, even by two simultaneous requests.
    uniqueIndex("memberships_one_active_household_role")
      .on(t.tenantId, t.actorId, t.householdId, t.roleCode)
      .where(sql`${t.status} = 'active' and ${t.householdId} is not null`),
    foreignKey({ columns: [t.tenantId, t.actorId], foreignColumns: [actors.tenantId, actors.id] }),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.organizationId],
      foreignColumns: [organizations.tenantId, organizations.id],
    }),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    invitedByActorId: text("invited_by_actor_id").notNull(),
    inviteeName: text("invitee_name").notNull(),
    inviteeContact: text("invitee_contact").notNull(),
    roleCode: text("role_code")
      .notNull()
      .references(() => roles.code),
    relationship: text("relationship"),
    /** Lower-cased email the account must use to accept. Null for older invitations, which can't be accepted. */
    inviteeEmail: text("invitee_email"),
    /** SHA-256 of the one-time acceptance token. Null for older invitations. */
    tokenHash: text("token_hash").unique(),
    acceptedByActorId: text("accepted_by_actor_id"),
    /** Helpers (founder decision 42): task-only access (the default) or household collaboration. */
    accessModel: text("access_model").$type<"task" | "collaboration">(),
    taskId: text("task_id"),
    /** When the access granted by accepting ends (not when the link expires). */
    accessExpiresAt: ts("access_expires_at"),
    /** Collaboration invitations: the stated scope, in the inviter's words. */
    scopeNote: text("scope_note"),
    status: text("status")
      .$type<"pending" | "accepted" | "declined" | "cancelled" | "expired">()
      .notNull()
      .default("pending"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    respondedAt: ts("responded_at"),
    /**
     * A staff invitation to the patient or coordinator (decision 67): how staff confirmed who the
     * person is and their role, in their words. Null for invitations from household members.
     */
    identityConfirmation: text("identity_confirmation"),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

/** One row per person. */
export const preferences = pgTable(
  "preferences",
  {
    actorId: text("actor_id").primaryKey(),
    tenantId: tenantId(),
    language: text("language").notNull().default("en"),
    textSize: text("text_size").$type<"standard" | "larger" | "largest">().notNull().default("standard"),
    simplerExplanations: boolean("simpler_explanations").notNull().default(false),
    contactMethod: text("contact_method").$type<"in_app" | "phone" | "email">().notNull().default("in_app"),
    notificationCadence: text("notification_cadence")
      .$type<"as_it_happens" | "daily_summary" | "essential_only">()
      .notNull()
      .default("as_it_happens"),
    quietHoursStart: text("quiet_hours_start").notNull().default("21:00"),
    quietHoursEnd: text("quiet_hours_end").notNull().default("08:00"),
    /** Opt-in email nudges (founder decision 23). Off by default; generic wording only. */
    emailNotices: boolean("email_notices").notNull().default(false),
    /** When the last email nudge went out, for the daily-summary cadence. */
    lastEmailNoticeAt: ts("last_email_notice_at"),
    /** Staff workspace density (staff rework, section 1): each person's own. */
    density: text("density").$type<"comfortable" | "compact">().notNull().default("comfortable"),
    /** Saved queue views (section 3): name plus the URL search it restores. Never patient data. */
    savedViews: jsonb("saved_views")
      .$type<{ name: string; search: Record<string, string> }[]>()
      .notNull()
      .default([]),
    /**
     * The care-team first-time guide (2026-10-21): when the person finished or skipped the tour, and
     * when they put the welcome card away, and when they hid the "Getting started" checklist. Checklist items themselves come from the audit
     * log, so nothing else is recorded about what they've done.
     */
    guide: jsonb("guide")
      .$type<{ tourDoneAt?: string; welcomeDismissedAt?: string; checklistHiddenAt?: string }>()
      .notNull()
      .default({}),
    updatedAt: nowCol("updated_at"),
  },
  (t) => [foreignKey({ columns: [t.tenantId, t.actorId], foreignColumns: [actors.tenantId, actors.id] })],
);

export const onboardingSteps = pgTable(
  "onboarding_steps",
  {
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    step: text("step").notNull(),
    completedAt: nowCol("completed_at"),
    completedByActorId: text("completed_by_actor_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.step] }),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

export const supportPreferences = pgTable(
  "support_preferences",
  {
    householdId: text("household_id").primaryKey(),
    tenantId: tenantId(),
    categories: jsonb("categories").$type<string[]>().notNull().default([]),
    spiritualCare: boolean("spiritual_care").notNull().default(false),
    preferredContactTime: text("preferred_contact_time"),
    recommendationsPaused: boolean("recommendations_paused").notNull().default(false),
    /**
     * "I'd rather not be contacted for now" (interaction review, item 13): bereavement check-ins are
     * flagged for the care team, not cancelled (founder decision 11). Visible to staff.
     */
    contactPaused: boolean("contact_paused").notNull().default(false),
    contactPausedAt: ts("contact_paused_at"),
    contactPausedByActorId: text("contact_paused_by_actor_id"),
    updatedAt: nowCol("updated_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

/** Non-clinical coordination record. Not the hospice plan of care. */
export const careCoordinationRecords = pgTable(
  "care_coordination_records",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull().unique(),
    careGuideActorId: text("care_guide_actor_id").notNull(),
    visitRhythm: text("visit_rhythm").notNull(),
    afterHoursRoute: text("after_hours_route").notNull(),
    familyPriorities: text("family_priorities").notNull().default(""),
    /** A pointer to the hospice's clinical record ("Record ref …"). Never clinical content. */
    ehrReference: text("ehr_reference").notNull().default(""),
    archivedAt: ts("archived_at"),
    updatedAt: nowCol("updated_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    audience: text("audience").$type<"family" | "staff">().notNull(),
    assigneeActorId: text("assignee_actor_id"),
    ownerActorId: text("owner_actor_id").notNull(),
    /** `closed`: no longer needed (founder decision 44), as distinct from done. */
    status: text("status").$type<"open" | "done" | "closed">().notNull().default("open"),
    whenLabel: text("when_label"),
    dueAt: ts("due_at"),
    /** `household`: everyone in the household. `limited`: the assignee, coordinators, the care team and `sharedWith`. */
    visibility: text("visibility").$type<"household" | "limited">().notNull().default("household"),
    sharedWith: jsonb("shared_with").$type<string[]>().notNull().default([]),
    createdByActorId: text("created_by_actor_id"),
    updatedAt: ts("updated_at"),
    closedReason: text("closed_reason"),
    requiresAck: boolean("requires_ack").notNull().default(false),
    source: text("source").$type<"onboarding" | "care_team" | "family" | "lifecycle">().notNull(),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
    completedByActorId: text("completed_by_actor_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

export const acknowledgements = pgTable(
  "acknowledgements",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    subjectType: text("subject_type").$type<"task" | "update">().notNull(),
    subjectId: text("subject_id").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("acknowledgements_once").on(t.subjectType, t.subjectId, t.actorId),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

/** Written by the care team for the household to read. Never contains internal notes. */
export const familyUpdates = pgTable(
  "family_updates",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    /** Null only for a system-posted update (decision 62): the family sees it from "your care team". */
    authorActorId: text("author_actor_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    requiresAck: boolean("requires_ack").notNull().default(false),
    /** Who may see it; null means everyone in the household who sees updates (decision 62). */
    audienceActorIds: jsonb("audience_actor_ids").$type<string[]>(),
    /** What posted it, for system updates (`cover_started`); null for updates the care team writes. */
    systemKind: text("system_kind"),
    /** The record a system update is about (the cover membership), so it's posted at most once. */
    sourceId: text("source_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
    uniqueIndex("family_updates_system_once")
      .on(t.tenantId, t.systemKind, t.sourceId)
      .where(sql`${t.systemKind} is not null`),
  ],
);

/** Internal care-team notes. No family-facing query ever reads this table. */
export const staffNotes = pgTable(
  "staff_notes",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    authorActorId: text("author_actor_id").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

export const messageThreads = pgTable(
  "message_threads",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    subject: text("subject").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("message_threads_tenant_id").on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    tenantId: tenantId(),
    threadId: text("thread_id").notNull(),
    householdId: text("household_id").notNull(),
    authorActorId: text("author_actor_id").notNull(),
    authorSide: text("author_side").$type<"family" | "staff">().notNull(),
    body: text("body").notNull(),
    /** The sender's own ID for this send, so a retry after a lost reply doesn't send it twice. */
    submissionId: text("submission_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_one_per_submission")
      .on(t.tenantId, t.authorActorId, t.submissionId)
      .where(sql`${t.submissionId} is not null`),
    foreignKey({
      columns: [t.tenantId, t.threadId],
      foreignColumns: [messageThreads.tenantId, messageThreads.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

/**
 * In-app notifications. Titles are generic: no sensitive detail in previews. A person who has
 * opted in also gets a generic email nudge about them (founder decision 23); `emailedAt` marks the
 * ones already covered by a nudge.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    tenantId: tenantId(),
    recipientActorId: text("recipient_actor_id").notNull(),
    householdId: text("household_id"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    link: text("link").notNull(),
    readAt: ts("read_at"),
    emailedAt: ts("emailed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.recipientActorId], foreignColumns: [actors.tenantId, actors.id] }),
  ],
);

/** Document and status vault: metadata and review state only — never the documents themselves. */
export const vaultItems = pgTable(
  "vault_items",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("needs_review"),
    sensitivity: text("sensitivity").$type<"standard" | "protected">().notNull().default("standard"),
    keptWhere: text("kept_where"),
    starter: boolean("starter").notNull().default(false),
    /**
     * Who in the household sees it (founder decision 43): `private` (its owner), `selected` (the
     * vault keepers, or `sharedWith` when set), `household` (every member) or `staff` (the vault
     * keepers and the care team). Protected items always follow the protected-access rule.
     */
    audience: text("audience")
      .$type<"private" | "selected" | "household" | "staff">()
      .notNull()
      .default("staff"),
    ownerActorId: text("owner_actor_id"),
    sharedWith: jsonb("shared_with").$type<string[] | null>(),
    reviewedByActorId: text("reviewed_by_actor_id"),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

export const authorityEvidence = pgTable(
  "authority_evidence",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    holderActorId: text("holder_actor_id"),
    holderName: text("holder_name").notNull(),
    authorityType: text("authority_type").notNull(),
    state: text("state").notNull().default("review_pending"),
    currentVersionId: text("current_version_id"),
    createdAt: createdAt(),
    updatedAt: nowCol("updated_at"),
  },
  (t) => [
    unique("authority_evidence_tenant_id").on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

/** Version lineage: each new submission points at the one it replaces. Metadata only. */
export const authorityEvidenceVersions = pgTable(
  "authority_evidence_versions",
  {
    id: id(),
    tenantId: tenantId(),
    evidenceId: text("evidence_id").notNull(),
    versionNo: integer("version_no").notNull(),
    previousVersionId: text("previous_version_id").references(
      (): AnyPgColumn => authorityEvidenceVersions.id,
    ),
    documentLabel: text("document_label").notNull(),
    effectiveDate: text("effective_date"),
    submittedByActorId: text("submitted_by_actor_id").notNull(),
    submittedAt: nowCol("submitted_at"),
    note: text("note").notNull().default(""),
  },
  (t) => [
    unique("authority_versions_seq").on(t.evidenceId, t.versionNo),
    foreignKey({
      columns: [t.tenantId, t.evidenceId],
      foreignColumns: [authorityEvidence.tenantId, authorityEvidence.id],
    }),
  ],
);

/**
 * Every link between an authority record and a verified household person, with its basis.
 * Earlier links are kept and marked superseded, never overwritten. A link is a workflow
 * association, not a legal determination.
 */
export const authorityIdentityLinks = pgTable(
  "authority_identity_links",
  {
    id: id(),
    tenantId: tenantId(),
    evidenceId: text("evidence_id").notNull(),
    actorId: text("actor_id").notNull(),
    basis: text("basis")
      .$type<"submitted_evidence" | "household_confirmation" | "reviewer_documented">()
      .notNull(),
    note: text("note").notNull().default(""),
    linkedByActorId: text("linked_by_actor_id").notNull(),
    linkedAt: nowCol("linked_at"),
    supersededAt: ts("superseded_at"),
    supersededByLinkId: text("superseded_by_link_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.evidenceId],
      foreignColumns: [authorityEvidence.tenantId, authorityEvidence.id],
    }),
    foreignKey({ columns: [t.tenantId, t.actorId], foreignColumns: [actors.tenantId, actors.id] }),
  ],
);

export const authorityReviews = pgTable(
  "authority_reviews",
  {
    id: id(),
    tenantId: tenantId(),
    evidenceId: text("evidence_id").notNull(),
    versionId: text("version_id").notNull(),
    reviewerActorId: text("reviewer_actor_id").notNull(),
    outcome: text("outcome")
      .$type<"workflow_active" | "conflict" | "needs_more_information" | "withdrawn">()
      .notNull(),
    rationale: text("rationale").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.evidenceId],
      foreignColumns: [authorityEvidence.tenantId, authorityEvidence.id],
    }),
  ],
);

export const consents = pgTable(
  "consents",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    grantedByName: text("granted_by_name").notNull(),
    grantedByActorId: text("granted_by_actor_id"),
    recordedByActorId: text("recorded_by_actor_id").notNull(),
    purpose: text("purpose").notNull(),
    recipientName: text("recipient_name").notNull(),
    scope: jsonb("scope").$type<string[]>().notNull(),
    startsAt: ts("starts_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    state: text("state").notNull().default("draft"),
    revocationPath: text("revocation_path").notNull(),
    activatedByActorId: text("activated_by_actor_id"),
    activatedAt: ts("activated_at"),
    revokedAt: ts("revoked_at"),
    revokedByActorId: text("revoked_by_actor_id"),
    revokeReason: text("revoke_reason"),
    /** Increases on every material change; a confirmation or activation applies to one version only. */
    version: integer("version").notNull().default(1),
    /** The version a reviewer activated. Active means state = active AND activated_version = version. */
    activatedVersion: integer("activated_version"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("consents_tenant_id").on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

/**
 * A household grantor's confirmation of one specific consent version. Kept forever (history);
 * a material change creates a new version that needs a new confirmation.
 */
export const consentConfirmations = pgTable(
  "consent_confirmations",
  {
    id: id(),
    tenantId: tenantId(),
    consentId: text("consent_id").notNull(),
    consentVersion: integer("consent_version").notNull(),
    actorId: text("actor_id").notNull(),
    method: text("method").notNull(),
    statement: text("statement").notNull(),
    confirmedAt: nowCol("confirmed_at"),
  },
  (t) => [
    unique("consent_confirmation_once").on(t.consentId, t.consentVersion),
    foreignKey({ columns: [t.tenantId, t.consentId], foreignColumns: [consents.tenantId, consents.id] }),
    foreignKey({ columns: [t.tenantId, t.actorId], foreignColumns: [actors.tenantId, actors.id] }),
  ],
);

export const packets = pgTable(
  "packets",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    purpose: text("purpose").notNull().default(""),
    recipientName: text("recipient_name").notNull().default(""),
    /** The named person at the recipient who signs in to read it (founder decision 45). */
    recipientContactName: text("recipient_contact_name"),
    recipientEmail: text("recipient_email"),
    consentId: text("consent_id"),
    authorityEvidenceId: text("authority_evidence_id"),
    expiresAt: ts("expires_at").notNull(),
    state: text("state").notNull().default("draft"),
    lastReasonCode: text("last_reason_code"),
    createdByActorId: text("created_by_actor_id").notNull(),
    createdAt: createdAt(),
    updatedAt: nowCol("updated_at"),
  },
  (t) => [
    unique("packets_tenant_id").on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
    foreignKey({ columns: [t.tenantId, t.consentId], foreignColumns: [consents.tenantId, consents.id] }),
    foreignKey({
      columns: [t.tenantId, t.authorityEvidenceId],
      foreignColumns: [authorityEvidence.tenantId, authorityEvidence.id],
    }),
  ],
);

/** The minimum-necessary manifest: one row per category of information in the packet. */
export const packetManifestItems = pgTable(
  "packet_manifest_items",
  {
    id: id(),
    tenantId: tenantId(),
    packetId: text("packet_id").notNull(),
    category: text("category").notNull(),
    justification: text("justification").notNull().default(""),
  },
  (t) => [
    unique("packet_manifest_once").on(t.packetId, t.category),
    foreignKey({ columns: [t.tenantId, t.packetId], foreignColumns: [packets.tenantId, packets.id] }),
  ],
);

export const packetReleaseReceipts = pgTable(
  "packet_release_receipts",
  {
    id: id(),
    tenantId: tenantId(),
    packetId: text("packet_id").notNull(),
    releasedByActorId: text("released_by_actor_id").notNull(),
    releasedAt: nowCol("released_at"),
    recipientName: text("recipient_name").notNull(),
    purpose: text("purpose").notNull(),
    manifest: jsonb("manifest").$type<string[]>().notNull(),
    expiresAt: ts("expires_at").notNull(),
    auditEventId: text("audit_event_id").notNull(),
  },
  (t) => [foreignKey({ columns: [t.tenantId, t.packetId], foreignColumns: [packets.tenantId, packets.id] })],
);

/**
 * Append-only. A database trigger (migration 0001) rejects UPDATE, DELETE and TRUNCATE.
 * Each event carries a hash of its content chained to the previous event in the same tenant,
 * so tampering is detectable. Summaries are written to be safe; contents are never copied in.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    tenantId: tenantId().references(() => tenants.id),
    householdId: text("household_id"),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    decision: text("decision"),
    reasonCode: text("reason_code"),
    summary: text("summary").notNull(),
    visibility: text("visibility").$type<"family" | "sharing" | "protected" | "staff">().notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
  },
  (t) => [
    // One chain per tenant, never a fork: no two events may follow the same event, and only one may
    // start the chain (src/server/audit.ts serializes appends; this is the database's backstop).
    uniqueIndex("audit_events_one_successor").on(t.tenantId, t.prevHash),
    uniqueIndex("audit_events_one_genesis")
      .on(t.tenantId)
      .where(sql`${t.prevHash} is null`),
  ],
);

export const bereavementTransitions = pgTable(
  "bereavement_transitions",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    state: text("state").$type<"proposed" | "confirmed" | "cancelled">().notNull().default("proposed"),
    proposedByActorId: text("proposed_by_actor_id").notNull(),
    proposedAt: nowCol("proposed_at"),
    confirmedByActorId: text("confirmed_by_actor_id"),
    confirmedAt: ts("confirmed_at"),
    survivingContactActorId: text("surviving_contact_actor_id"),
    survivingContactConfirmedAt: ts("surviving_contact_confirmed_at"),
    note: text("note").notNull().default(""),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

/** Human escalation and support routing: anything a person, not the system, must decide. */
/**
 * Planned bereavement check-ins (src/domain/bereavement.ts), created when a transition is
 * confirmed. The care team records each contact's outcome; the note is staff-only.
 */
export const bereavementContacts = pgTable(
  "bereavement_contacts",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    transitionId: text("transition_id").notNull(),
    step: text("step").notNull(),
    dueOn: ts("due_on").notNull(),
    status: text("status").$type<"planned" | "done">().notNull().default("planned"),
    outcome: text("outcome").$type<"reached" | "message_left" | "declined" | "not_needed">(),
    note: text("note").notNull().default(""),
    completedAt: ts("completed_at"),
    completedByActorId: text("completed_by_actor_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("bereavement_contacts_one_per_step").on(t.tenantId, t.transitionId, t.step),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

export const escalations = pgTable(
  "escalations",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    kind: text("kind").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    summary: text("summary").notNull(),
    status: text("status").$type<"open" | "acknowledged" | "resolved">().notNull().default("open"),
    ownerActorId: text("owner_actor_id"),
    /** Family requests: who asked, and the topic they chose (shown in "Your requests"). */
    raisedByActorId: text("raised_by_actor_id"),
    topic: text("topic"),
    createdAt: createdAt(),
    /** When its state last changed (raised, taken, resolved): what "Waiting" counts from. */
    stateChangedAt: ts("state_changed_at"),
    resolvedAt: ts("resolved_at"),
    resolvedByActorId: text("resolved_by_actor_id"),
    resolution: text("resolution"),
    /** A family request's own ID from the person's device (see messages.submissionId). */
    submissionId: text("submission_id"),
    /**
     * The request lifecycle (decisions 79–83), alongside status rather than replacing it. Waiting
     * names only the kind of party (decision 80); a withdrawn request is resolved with
     * closedReason "withdrawn"; a pending offer leaves the owner in place until it's accepted.
     */
    waitingOn: text("waiting_on").$type<"family" | "other">(),
    waitingOnLabel: text("waiting_on_label"),
    nextUpdateBy: ts("next_update_by"),
    closedReason: text("closed_reason").$type<"resolved" | "withdrawn">(),
    reopenedAt: ts("reopened_at"),
    reopenReason: text("reopen_reason"),
    offeredToActorId: text("offered_to_actor_id"),
    offeredByActorId: text("offered_by_actor_id"),
    offeredAt: ts("offered_at"),
  },
  (t) => [
    uniqueIndex("escalations_one_per_submission")
      .on(t.tenantId, t.raisedByActorId, t.submissionId)
      .where(sql`${t.submissionId} is not null`),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

/** Development sessions for synthetic personas only. Real identity is a production gate. */
export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token held in the browser cookie. The token itself is never stored. */
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    actorId: text("actor_id").notNull(),
    /** The signed-in account. Null only for development persona sessions (see method). */
    userId: text("user_id"),
    method: text("method")
      .$type<"password" | "development_persona">()
      .notNull()
      .default("development_persona"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [foreignKey({ columns: [t.tenantId, t.actorId], foreignColumns: [actors.tenantId, actors.id] })],
);

/**
 * A household request to correct a consent (wrong recipient, purpose, items, dates or person).
 * It is not a withdrawal. While one is open, the consent can't be activated or support a release.
 * `detail` is the person's own words and is shown only to the care team; audit events and
 * notifications carry the categories alone.
 */
export const consentCorrectionRequests = pgTable(
  "consent_correction_requests",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    consentId: text("consent_id").notNull(),
    consentVersion: integer("consent_version").notNull(),
    requestedByActorId: text("requested_by_actor_id").notNull(),
    categories: jsonb("categories").$type<string[]>().notNull().default([]),
    detail: text("detail").notNull().default(""),
    status: text("status").$type<"open" | "cancelled" | "resolved">().notNull().default("open"),
    outcome: text("outcome").$type<"amended" | "withdrawn" | "dismissed" | "closed">(),
    resolutionNote: text("resolution_note"),
    resolvedByActorId: text("resolved_by_actor_id"),
    escalationId: text("escalation_id"),
    createdAt: createdAt(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [
    // At most one open request per consent: repeats and double taps can't create a second.
    uniqueIndex("consent_correction_one_open")
      .on(t.consentId)
      .where(sql`${t.status} = 'open'`),
    foreignKey({ columns: [t.tenantId, t.consentId], foreignColumns: [consents.tenantId, consents.id] }),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
    foreignKey({ columns: [t.tenantId, t.requestedByActorId], foreignColumns: [actors.tenantId, actors.id] }),
  ],
);

/**
 * What a hospice tells families about routine messages, in its own words. Versioned: a change is
 * a new row, so earlier wording stays on record. No row (or a disabled latest row) means no
 * expectation is shown — the app never supplies a default response time.
 */
export const messageExpectations = pgTable(
  "message_expectations",
  {
    id: id(),
    tenantId: tenantId(),
    organizationId: text("organization_id").notNull(),
    version: integer("version").notNull(),
    enabled: boolean("enabled").notNull(),
    handlingHours: text("handling_hours").notNull().default(""),
    expectation: text("expectation").notNull().default(""),
    fallback: text("fallback").notNull().default(""),
    /** The hospice's expected reply time, in its words (e.g. "within 1 business day"). Decision 24. */
    replyTime: text("reply_time").notNull().default(""),
    effectiveFrom: ts("effective_from").notNull(),
    changedByActorId: text("changed_by_actor_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("message_expectation_version").on(t.organizationId, t.version),
    foreignKey({
      columns: [t.tenantId, t.organizationId],
      foreignColumns: [organizations.tenantId, organizations.id],
    }),
    foreignKey({ columns: [t.tenantId, t.changedByActorId], foreignColumns: [actors.tenantId, actors.id] }),
  ],
);

/**
 * A sign-in account for one person in one tenant (pilot: one account per person per hospice).
 * The password is stored only as an Argon2id hash. Failed attempts lock the account briefly.
 */
export const users = pgTable(
  "users",
  {
    id: id(),
    tenantId: tenantId(),
    actorId: text("actor_id").notNull(),
    /** Lower-cased. */
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastSignInAt: ts("last_sign_in_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("users_one_per_actor").on(t.tenantId, t.actorId),
    foreignKey({ columns: [t.tenantId, t.actorId], foreignColumns: [actors.tenantId, actors.id] }),
  ],
);

/**
 * An invitation for a care-team member to join a hospice organization in one staff role. The
 * organization and role come only from this record — never from the acceptance request.
 */
export const staffInvitations = pgTable(
  "staff_invitations",
  {
    id: id(),
    tenantId: tenantId(),
    organizationId: text("organization_id").notNull(),
    invitedByActorId: text("invited_by_actor_id").notNull(),
    inviteeName: text("invitee_name").notNull(),
    /** Lower-cased email the account must use to accept. */
    inviteeEmail: text("invitee_email").notNull(),
    roleCode: text("role_code")
      .notNull()
      .references(() => roles.code),
    /** SHA-256 of the one-time acceptance token. */
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status").$type<"pending" | "accepted" | "cancelled">().notNull().default("pending"),
    acceptedByActorId: text("accepted_by_actor_id"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    respondedAt: ts("responded_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.organizationId],
      foreignColumns: [organizations.tenantId, organizations.id],
    }),
    foreignKey({ columns: [t.tenantId, t.invitedByActorId], foreignColumns: [actors.tenantId, actors.id] }),
  ],
);

/**
 * Single-use password reset links for family accounts (founder decision 27). Only the token's
 * SHA-256 is stored. A link expires after 30 minutes and is used at most once.
 */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: id(),
    tenantId: tenantId(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
  },
  (t) => [foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] })],
);

/**
 * The development mail sink: every email Zeporah would send, kept here instead of being delivered
 * (founder decisions 18 and 23). There is no real email provider. Readable only on the
 * development-only mail page.
 */
export const devMailbox = pgTable(
  "dev_mailbox",
  {
    id: id(),
    tenantId: tenantId(),
    toEmail: text("to_email").notNull(),
    /** The sender name shown on the email: the hospice's setting, or "Zeporah". */
    fromName: text("from_name").notNull().default("Zeporah"),
    kind: text("kind")
      .$type<"notice" | "password_reset" | "password_changed" | "recipient_alert" | "invitation">()
      .notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    link: text("link").notNull(),
    createdAt: createdAt(),
  },
  (t) => [foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] })],
);

/**
 * When each person last opened their household's message thread: the "New since your last visit"
 * divider and the home page's "new reply" item come from this (interaction review, item 9).
 */
export const threadVisits = pgTable(
  "thread_visits",
  {
    tenantId: tenantId(),
    actorId: text("actor_id").notNull(),
    householdId: text("household_id").notNull(),
    seenAt: ts("seen_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorId, t.householdId] }),
    foreignKey({ columns: [t.tenantId, t.actorId], foreignColumns: [actors.tenantId, actors.id] }),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

/**
 * A released packet's named recipient and their read-only access (founder decision 45). Access is
 * bound to the packet, the recipient and the release's expiry; revoking the release ends it.
 */
export const packetRecipientAccess = pgTable(
  "packet_recipient_access",
  {
    id: id(),
    tenantId: tenantId(),
    packetId: text("packet_id").notNull(),
    receiptId: text("receipt_id").notNull(),
    recipientActorId: text("recipient_actor_id").notNull(),
    grantedAt: nowCol("granted_at"),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    acknowledgedAt: ts("acknowledged_at"),
    /** SHA-256 of a one-time link that lets a first-time recipient set a password. */
    setupTokenHash: text("setup_token_hash").unique(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.packetId], foreignColumns: [packets.tenantId, packets.id] }),
    foreignKey({ columns: [t.tenantId, t.recipientActorId], foreignColumns: [actors.tenantId, actors.id] }),
  ],
);

/** Every time a recipient opens, acknowledges or asks about a packet. Shown to them and to staff. */
export const packetAccessLog = pgTable(
  "packet_access_log",
  {
    id: id(),
    tenantId: tenantId(),
    packetId: text("packet_id").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").$type<"viewed" | "acknowledged" | "clarification_requested">().notNull(),
    at: nowCol("at"),
  },
  (t) => [foreignKey({ columns: [t.tenantId, t.packetId], foreignColumns: [packets.tenantId, packets.id] })],
);

/** The patient's own private notes (founder decision 46). Only their author ever reads them. */
export const privateNotes = pgTable(
  "private_notes",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    actorId: text("actor_id").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.actorId], foreignColumns: [actors.tenantId, actors.id] }),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

/**
 * People's part of a rule-derived exception (decision 58). The exception itself is computed from
 * its source records, so it can't say something that's no longer true; this row only holds who owns
 * it, what it's waiting on, and whether someone dismissed it (with a reason). `key` is
 * `category:subjectType:subjectId`.
 */
export const exceptionClaims = pgTable(
  "exception_claims",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    key: text("key").notNull(),
    ownerActorId: text("owner_actor_id"),
    state: text("state").$type<"owned" | "waiting">(),
    waitingOn: text("waiting_on").$type<"family" | "partner" | "staff">(),
    waitingNote: text("waiting_note"),
    dismissedReason: text("dismissed_reason"),
    dismissedByActorId: text("dismissed_by_actor_id"),
    dismissedAt: ts("dismissed_at"),
    updatedAt: nowCol("updated_at"),
  },
  (t) => [
    unique("exception_claims_key").on(t.tenantId, t.key),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
    foreignKey({ columns: [t.tenantId, t.ownerActorId], foreignColumns: [actors.tenantId, actors.id] }),
  ],
);

/** A care-team member's planned absence (workstream 3). Reasons never hold health details. */
export const staffAbsences = pgTable(
  "staff_absences",
  {
    id: id(),
    tenantId: tenantId(),
    actorId: text("actor_id").notNull(),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    reason: text("reason").notNull(),
    createdByActorId: text("created_by_actor_id").notNull(),
    createdAt: createdAt(),
    cancelledAt: ts("cancelled_at"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.actorId], foreignColumns: [actors.tenantId, actors.id] }),
    foreignKey({ columns: [t.tenantId, t.createdByActorId], foreignColumns: [actors.tenantId, actors.id] }),
  ],
);

/**
 * A household offered from one care guide to another: temporary `cover` during an absence, or a
 * permanent `transfer`. Nothing changes until the receiving guide accepts (decisions 59 and 61).
 */
export const handoffs = pgTable(
  "handoffs",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    fromActorId: text("from_actor_id").notNull(),
    toActorId: text("to_actor_id").notNull(),
    absenceId: text("absence_id"),
    kind: text("kind").$type<"cover" | "transfer">().notNull(),
    note: text("note").notNull().default(""),
    state: text("state")
      .$type<"offered" | "accepted" | "declined" | "withdrawn">()
      .notNull()
      .default("offered"),
    /** Cover only: when the access starts and ends. */
    startsAt: ts("starts_at"),
    endsAt: ts("ends_at"),
    acceptBy: ts("accept_by").notNull(),
    offeredByActorId: text("offered_by_actor_id").notNull(),
    offeredAt: createdAt(),
    respondedAt: ts("responded_at"),
    declineReason: text("decline_reason"),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
    foreignKey({ columns: [t.tenantId, t.fromActorId], foreignColumns: [actors.tenantId, actors.id] }),
    foreignKey({ columns: [t.tenantId, t.toActorId], foreignColumns: [actors.tenantId, actors.id] }),
  ],
);

/**
 * What an outside organization said, entered by staff (decisions 58 and 60). Always `simulated`
 * in the pilot: there are no live feeds and nothing is matched automatically.
 */
export const partnerEvents = pgTable(
  "partner_events",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    organizationLabel: text("organization_label").notNull(),
    kind: text("kind").$type<"status" | "request" | "acknowledgement">().notNull(),
    /** Short and non-clinical, in the staff member's words. */
    summary: text("summary").notNull(),
    occurredAt: ts("occurred_at").notNull(),
    enteredByActorId: text("entered_by_actor_id").notNull(),
    source: text("source").$type<"staff_entered" | "recipient_portal">().notNull().default("staff_entered"),
    packetId: text("packet_id"),
    simulated: boolean("simulated").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
    foreignKey({ columns: [t.tenantId, t.enteredByActorId], foreignColumns: [actors.tenantId, actors.id] }),
  ],
);

/**
 * Retention holds (brief reconciliation increment 5). A hold preserves records: while one is active,
 * nothing it covers may be removed (services/retention.ts). It grants no access and discloses
 * nothing. Holds are never deleted; releasing one only marks it released (migration 0026).
 */
export const retentionHolds = pgTable(
  "retention_holds",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    /** Null: every household in the tenant. */
    householdId: text("household_id"),
    /** Record classes covered (domain/record-classes.ts). Empty: every class. */
    recordClasses: jsonb("record_classes").$type<string[]>().notNull().default([]),
    /** Why, without names or health details (e.g. "Preservation request, matter ref on file"). */
    reason: text("reason").notNull(),
    /** The outside authorization this hold rests on, e.g. counsel's matter reference. */
    authorizationRef: text("authorization_ref").notNull(),
    placedByActorId: text("placed_by_actor_id").notNull(),
    placedAt: nowCol("placed_at"),
    status: text("status").$type<"active" | "released">().notNull().default("active"),
    releasedAt: ts("released_at"),
    releasedByActorId: text("released_by_actor_id"),
    releaseAuthorizationRef: text("release_authorization_ref"),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);

/**
 * Staff read-access log (founder decision 71). One entry when a staff member opens one household's
 * record or a part of it (coalesced per person, household and view), or a list view (household null,
 * with its row count). Append-only: the database refuses changes (migration 0028). Never content.
 */
export const staffAccessEvents = pgTable(
  "staff_access_events",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    actorId: text("actor_id").notNull(),
    /** The person's staff roles when they read. */
    roles: jsonb("roles").$type<string[]>().notNull(),
    /** Null for a list view. */
    householdId: text("household_id"),
    view: text("view").notNull(),
    kind: text("kind").$type<"record" | "list">().notNull(),
    /** List views: how many rows were shown. */
    rowCount: integer("row_count"),
    /** The household wasn't one the person is assigned to or covering (decision 71, for D-09). */
    outsideAssignment: boolean("outside_assignment").notNull().default(false),
    occurredAt: nowCol("occurred_at"),
  },
  (t) => [
    index("staff_access_household_idx").on(t.tenantId, t.householdId, t.occurredAt),
    index("staff_access_recent_idx").on(t.tenantId, t.actorId, t.view, t.occurredAt),
  ],
);

/**
 * Proposed changes to the 24-hour line, and every confirmation call (founder decision 72). A change
 * goes live only when someone other than its proposer confirms it; a re-confirmation records a call
 * to the unchanged line. One pending change per hospice (migration 0029).
 */
export const contactLineChanges = pgTable(
  "contact_line_changes",
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    organizationId: text("organization_id").notNull(),
    kind: text("kind").$type<"change" | "reconfirmation">().notNull(),
    line: text("line").notNull(),
    backupLine: text("backup_line"),
    status: text("status").$type<"pending" | "confirmed" | "withdrawn" | "superseded">().notNull(),
    proposedByActorId: text("proposed_by_actor_id").notNull(),
    proposedAt: nowCol("proposed_at"),
    confirmedByActorId: text("confirmed_by_actor_id"),
    confirmedAt: ts("confirmed_at"),
    /** What the person who called it heard, in their words (for example "nurse line answered"). */
    confirmationNote: text("confirmation_note"),
    closedAt: ts("closed_at"),
  },
  (t) => [
    uniqueIndex("contact_line_one_pending")
      .on(t.tenantId, t.organizationId)
      .where(sql`${t.status} = 'pending'`),
    index("contact_line_org_idx").on(t.tenantId, t.organizationId, t.confirmedAt),
    foreignKey({
      columns: [t.tenantId, t.organizationId],
      foreignColumns: [organizations.tenantId, organizations.id],
    }),
  ],
);

/**
 * Listed contacts (founder decisions 74–78): supporters around a household who aren't Zeporah
 * users. A row grants nothing. Removing one marks it removed; rows aren't deleted.
 */
export const householdContacts = pgTable(
  "household_contacts",
  {
    id: id(),
    tenantId: tenantId(),
    householdId: text("household_id").notNull(),
    name: text("name").notNull(),
    relationship: text("relationship").notNull(),
    organization: text("organization").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    /** How they help, in the household's words. No health details. */
    note: text("note").notNull().default(""),
    /** Decision 76: seen only by the patient and the care team; only the patient changes it. */
    patientPrivate: boolean("patient_private").notNull().default(false),
    addedByActorId: text("added_by_actor_id").notNull(),
    createdAt: createdAt(),
    updatedAt: ts("updated_at"),
    removedAt: ts("removed_at"),
    removedByActorId: text("removed_by_actor_id"),
  },
  (t) => [
    index("household_contacts_household_idx").on(t.tenantId, t.householdId),
    foreignKey({
      columns: [t.tenantId, t.householdId],
      foreignColumns: [households.tenantId, households.id],
    }),
  ],
);
