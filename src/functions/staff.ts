/** Typed contract for the hospice staff workspace. See docs/api-contract.md. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AUTHORITY_TYPES, SHARE_CATEGORIES } from "@/domain/model";
import { submissionId } from "@/domain/submission";
import { IDENTITY_LINK_BASES } from "@/domain/authority-identity";

const server = () => import("@/server/api");
const id = z.object({ id: z.string().min(1) });
const hid = z.object({ householdId: z.string().min(1) });

export const getStaffHome = createServerFn({ method: "GET" }).handler(async () => {
  const { run, staff } = await server();
  return run((db, ctx) => staff.staffHome(db, ctx));
});

export const getQueue = createServerFn({ method: "GET" }).handler(async () => {
  const { run, staff } = await server();
  return run((db, ctx) => staff.coordinationQueue(db, ctx));
});

export const searchHouseholds = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().max(100) }))
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.searchHouseholds(db, ctx, data.q));
  });

export const getHouseholdOverview = createServerFn({ method: "GET" })
  .validator(hid)
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.householdOverview(db, ctx, data.householdId));
  });

/** Enrollment (decisions 66 and 70): the count, the cap and the care guides to choose from. */
export const getEnrollment = createServerFn({ method: "GET" }).handler(async () => {
  const { run, enrollment } = await server();
  return run((db, ctx) => enrollment.enrollmentView(db, ctx));
});

export const enrollHousehold = createServerFn({ method: "POST" })
  .validator(z.object({ patientName: z.string().max(200), careGuideActorId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, enrollment } = await server();
    return run((db, ctx) => enrollment.enrollHousehold(db, ctx, data));
  });

/** Decisions 67 and 68: the patient or one coordinator, after confirming who they are. */
export const inviteFirstMember = createServerFn({ method: "POST" })
  .validator(
    hid.extend({
      role: z.enum(["patient", "coordinator"]),
      name: z.string().max(200),
      email: z.string().max(254),
      identityConfirmation: z.string().max(600),
    }),
  )
  .handler(async ({ data }) => {
    const { run, enrollment } = await server();
    return run((db, ctx) => enrollment.inviteFirstMember(db, ctx, data));
  });

/** "Who can see what" for one household (decision 58), computed from the access rules. */
export const getHouseholdAccessMap = createServerFn({ method: "GET" })
  .validator(hid)
  .handler(async ({ data }) => {
    const { run, accessMap } = await server();
    return run((db, ctx) => accessMap.householdAccessMap(db, ctx, data.householdId));
  });

/** Record what an outside organization said: staff-entered, labelled simulated (decision 60). */
export const logPartnerEvent = createServerFn({ method: "POST" })
  .validator(
    hid.extend({
      organization: z.string().max(120),
      kind: z.enum(["status", "request", "acknowledgement"]),
      said: z.string().max(280),
      occurredAt: z.string().datetime(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, record } = await server();
    return run((db, ctx) =>
      record.logPartnerEvent(db, ctx, { ...data, occurredAt: new Date(data.occurredAt) }),
    );
  });

export const composeUpdate = createServerFn({ method: "POST" })
  .validator(hid.extend({ title: z.string().max(140), body: z.string().max(4000), requiresAck: z.boolean() }))
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.composeUpdate(db, ctx, data));
  });

export const sendStaffMessage = createServerFn({ method: "POST" })
  .validator(hid.extend({ body: z.string().max(4000), prepared: z.boolean().optional(), submissionId }))
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.sendStaffMessage(db, ctx, data));
  });

export const addStaffNote = createServerFn({ method: "POST" })
  .validator(hid.extend({ body: z.string().max(4000) }))
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.addStaffNote(db, ctx, data));
  });

export const createTask = createServerFn({ method: "POST" })
  .validator(
    hid.extend({
      title: z.string().max(140),
      detail: z.string().max(1000),
      audience: z.enum(["family", "staff"]),
      assigneeActorId: z.string().nullable(),
      whenLabel: z.string().max(60),
      requiresAck: z.boolean(),
      dueAt: z.string().max(40).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.createTask(db, ctx, data));
  });

export const completeStaffTask = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.completeStaffTask(db, ctx, data.id));
  });

export const getEscalations = createServerFn({ method: "GET" }).handler(async () => {
  const { run, staff } = await server();
  return run((db, ctx) => staff.listEscalations(db, ctx));
});

export const updateEscalation = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().min(1),
      action: z.enum(["take", "resolve"]),
      resolution: z.string().max(1000).optional(),
      takeOver: z.boolean().optional(),
      familyMessage: z.string().max(600).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.updateEscalation(db, ctx, data));
  });

export const proposeBereavement = createServerFn({ method: "POST" })
  .validator(hid.extend({ survivingContactActorId: z.string().min(1), note: z.string().max(1000) }))
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.proposeBereavement(db, ctx, data));
  });

export const confirmBereavement = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.confirmBereavement(db, ctx, data.id));
  });

export const cancelBereavement = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.cancelBereavement(db, ctx, data.id));
  });

/* ---------------- controlled sharing ---------------- */

export const getPackets = createServerFn({ method: "GET" }).handler(async () => {
  const { run, sharing } = await server();
  return run((db, ctx) => sharing.listPackets(db, ctx));
});

export const getPacketDraftHouseholds = createServerFn({ method: "GET" }).handler(async () => {
  const { run, staff } = await server();
  return run((db, ctx) => staff.packetDraftHouseholds(db, ctx));
});

export const getPacket = createServerFn({ method: "GET" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.getPacket(db, ctx, data.id));
  });

export const requestRelease = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.requestRelease(db, ctx, data.id));
  });

export const setManifest = createServerFn({ method: "POST" })
  .validator(
    z.object({
      packetId: z.string().min(1),
      categories: z.array(z.enum(SHARE_CATEGORIES)).max(SHARE_CATEGORIES.length),
    }),
  )
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.setManifest(db, ctx, data));
  });

export const createPacket = createServerFn({ method: "POST" })
  .validator(
    hid.extend({
      purpose: z.string().max(200),
      recipientName: z.string().max(200),
      consentId: z.string().nullable(),
      authorityEvidenceId: z.string().nullable(),
      expiresAt: z.coerce.date(),
      categories: z.array(z.enum(SHARE_CATEGORIES)).max(SHARE_CATEGORIES.length),
      prepared: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run(async (db, ctx) => (await sharing.createPacket(db, ctx, data)).id);
  });

export const revokePacket = createServerFn({ method: "POST" })
  .validator(z.object({ packetId: z.string().min(1), reason: z.string().max(500) }))
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.revokePacket(db, ctx, data));
  });

export const getPolicyScenarios = createServerFn({ method: "GET" }).handler(async () => {
  const { run, sharing } = await server();
  return run((db, ctx) => sharing.policyScenarios(db, ctx));
});

export const getAuthority = createServerFn({ method: "GET" })
  .validator(hid)
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.listAuthority(db, ctx, data.householdId));
  });

export const getReviewQueue = createServerFn({ method: "GET" }).handler(async () => {
  const { run, sharing } = await server();
  return run((db, ctx) => sharing.reviewQueue(db, ctx));
});

export const submitEvidence = createServerFn({ method: "POST" })
  .validator(
    hid.extend({
      evidenceId: z.string().optional(),
      holderName: z.string().min(1).max(120),
      holderActorId: z.string().nullable().optional(),
      authorityType: z.enum(AUTHORITY_TYPES),
      documentLabel: z.string().min(1).max(200),
      effectiveDate: z.string().max(20).optional(),
      note: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.submitEvidence(db, ctx, data));
  });

export const reviewEvidence = createServerFn({ method: "POST" })
  .validator(
    z.object({
      evidenceId: z.string().min(1),
      outcome: z.enum(["workflow_active", "conflict", "needs_more_information", "withdrawn"]),
      rationale: z.string().max(1000),
    }),
  )
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.reviewEvidence(db, ctx, data));
  });

export const getConsents = createServerFn({ method: "GET" })
  .validator(hid)
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.listConsents(db, ctx, data.householdId));
  });

export const recordConsent = createServerFn({ method: "POST" })
  .validator(
    hid.extend({
      grantedByActorId: z.string().min(1),
      purpose: z.string().max(200),
      recipientName: z.string().max(200),
      scope: z.array(z.enum(SHARE_CATEGORIES)).max(SHARE_CATEGORIES.length),
      startsAt: z.coerce.date(),
      expiresAt: z.coerce.date(),
      revocationPath: z.string().max(300),
    }),
  )
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run(async (db, ctx) => (await sharing.recordConsent(db, ctx, data)).id);
  });

/** Any material change creates a new version that needs new household confirmation and activation. */
export const amendConsent = createServerFn({ method: "POST" })
  .validator(
    z.object({
      consentId: z.string().min(1),
      purpose: z.string().max(200),
      recipientName: z.string().max(200),
      scope: z.array(z.enum(SHARE_CATEGORIES)).max(SHARE_CATEGORIES.length),
      startsAt: z.coerce.date(),
      expiresAt: z.coerce.date(),
      revocationPath: z.string().max(300),
    }),
  )
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.amendConsent(db, ctx, data));
  });

/** Link an authority record to a verified household person, with a stated basis (workflow association only). */
export const linkEvidenceHolder = createServerFn({ method: "POST" })
  .validator(
    z.object({
      evidenceId: z.string().min(1),
      actorId: z.string().min(1),
      basis: z.enum(IDENTITY_LINK_BASES),
      note: z.string().max(1000),
    }),
  )
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.linkEvidenceHolder(db, ctx, data));
  });

export const activateConsent = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.activateConsent(db, ctx, data.id));
  });

export const revokeConsentOnRequest = createServerFn({ method: "POST" })
  .validator(z.object({ consentId: z.string().min(1), reason: z.string().max(500) }))
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.revokeConsentOnRequest(db, ctx, data));
  });

/** A person reviewed a correction request and made no change; the explanation is shown to the person who asked. */
export const dismissConsentCorrection = createServerFn({ method: "POST" })
  .validator(z.object({ requestId: z.string().min(1), explanation: z.string().min(1).max(1000) }))
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.dismissConsentCorrection(db, ctx, data));
  });

/* ---------------- hospice settings ---------------- */

export const getMessageSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { run, settings } = await server();
  return run((db, ctx) => settings.getMessageSettings(db, ctx));
});

export const setMessageExpectation = createServerFn({ method: "POST" })
  .validator(
    z.object({
      enabled: z.boolean(),
      handlingHours: z.string().max(200),
      expectation: z.string().max(400),
      fallback: z.string().max(300),
      replyTime: z.string().max(80).default(""),
    }),
  )
  .handler(async ({ data }) => {
    const { run, settings } = await server();
    return run((db, ctx) => settings.setMessageExpectation(db, ctx, data));
  });

/* ---------------- care-team invitations (hospice operations) ---------------- */

export const getHospiceDetails = createServerFn({ method: "GET" }).handler(async () => {
  const { run, settings } = await server();
  return run((db, ctx) => settings.getHospiceDetailsWithDefaults(db, ctx));
});

export const setHospiceDetails = createServerFn({ method: "POST" })
  .validator(z.object({ afterHoursLine: z.string().max(80), emailSenderName: z.string().max(60) }))
  .handler(async ({ data }) => {
    const { run, settings } = await server();
    return run((db, ctx) => settings.setHospiceDetails(db, ctx, data));
  });

export const getStaffInvitations = createServerFn({ method: "GET" }).handler(async () => {
  const { run, auth } = await server();
  return run((db, ctx) => auth.listStaffInvitations(db, ctx));
});

/** The organization comes from the signed-in person's membership, never from the request. */
export const createStaffInvitation = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().max(120),
      email: z.string().max(254),
      role: z.enum(["care_guide", "hospice_ops", "privileged_reviewer", "hospice_admin"]),
    }),
  )
  .handler(async ({ data }) => {
    const { run, auth } = await server();
    return run((db, ctx) => auth.createStaffInvitation(db, ctx, data));
  });

export const cancelStaffInvitation = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, auth } = await server();
    return run((db, ctx) => auth.cancelStaffInvitation(db, ctx, data.id));
  });

/* ------------------------------------------------------------------ care-guide assignment */

export const assignCareGuide = createServerFn({ method: "POST" })
  .validator(hid.extend({ actorId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, assignments } = await server();
    return run((db, ctx) => assignments.assignCareGuide(db, ctx, data));
  });

export const endAssignment = createServerFn({ method: "POST" })
  .validator(z.object({ membershipId: z.string().min(1).max(100), reason: z.string().max(500) }))
  .handler(async ({ data }) => {
    const { run, assignments } = await server();
    return run((db, ctx) => assignments.endAssignment(db, ctx, data));
  });

export const reassignCareGuide = createServerFn({ method: "POST" })
  .validator(
    z.object({
      membershipId: z.string().min(1).max(100),
      toActorId: z.string().min(1).max(100),
      reason: z.string().max(500),
      handOver: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, assignments } = await server();
    return run((db, ctx) => assignments.reassignCareGuide(db, ctx, data));
  });

export const getRoster = createServerFn({ method: "GET" }).handler(async () => {
  const { run, assignments } = await server();
  return run((db, ctx) => assignments.roster(db, ctx));
});

/* ------------------------------------------------------------------ staff lifecycle */

const staffRole = z.enum(["care_guide", "hospice_ops", "privileged_reviewer", "hospice_admin"]);

export const getStaffMember = createServerFn({ method: "GET" })
  .validator(z.object({ actorId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, team } = await server();
    return run((db, ctx) => team.staffMember(db, ctx, data.actorId));
  });

export const changeStaffRole = createServerFn({ method: "POST" })
  .validator(z.object({ actorId: z.string().min(1).max(100), role: staffRole, reason: z.string().max(500) }))
  .handler(async ({ data }) => {
    const { run, team } = await server();
    return run((db, ctx) => team.changeStaffRole(db, ctx, data));
  });

export const deactivateStaff = createServerFn({ method: "POST" })
  .validator(z.object({ actorId: z.string().min(1).max(100), reason: z.string().max(500) }))
  .handler(async ({ data }) => {
    const { run, team } = await server();
    return run((db, ctx) => team.deactivateStaff(db, ctx, data));
  });

/** Administrators only (founder decision 38); the server checks. */
export const reactivateStaff = createServerFn({ method: "POST" })
  .validator(z.object({ actorId: z.string().min(1).max(100), role: staffRole, reason: z.string().max(500) }))
  .handler(async ({ data }) => {
    const { run, team } = await server();
    return run((db, ctx) => team.reactivateStaff(db, ctx, data));
  });

export const giveEscalation = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100), actorId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, staff } = await server();
    return run((db, ctx) => staff.giveEscalation(db, ctx, data));
  });

/* ------------------------------------------------------------------ sharing register */

export const getSharingRegister = createServerFn({ method: "GET" }).handler(async () => {
  const { run, register } = await server();
  return run((db, ctx) => register.sharingRegister(db, ctx));
});

export const getConsentHistory = createServerFn({ method: "GET" })
  .validator(z.object({ consentId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, register } = await server();
    return run((db, ctx) => register.consentHistory(db, ctx, data.consentId));
  });

/* ------------------------------------------------------------------ bereavement follow-up */

export const getBereavementWorkload = createServerFn({ method: "GET" }).handler(async () => {
  const { run, bereavement } = await server();
  return run((db, ctx) => bereavement.bereavementWorkload(db, ctx));
});

export const recordCheckIn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      contactId: z.string().min(1).max(100),
      outcome: z.enum(["reached", "message_left", "declined", "not_needed"]),
      note: z.string().max(1000),
    }),
  )
  .handler(async ({ data }) => {
    const { run, bereavement } = await server();
    return run((db, ctx) => bereavement.recordCheckIn(db, ctx, data));
  });

/* ------------------------------------------------------------------ audit review */

export const getAuditReview = createServerFn({ method: "GET" })
  .validator(
    z.object({
      category: z.enum(["access", "people", "sharing", "care"]).optional(),
      householdId: z.string().max(100).optional(),
      days: z.number().int().optional(),
      actorId: z.string().max(100).optional(),
      source: z
        .enum(["staff", "family", "recipient", "partner_simulated", "system", "rule", "prepared", "approval"])
        .optional(),
      q: z.string().max(80).optional(),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, auditReview } = await server();
    return run((db, ctx) => auditReview.auditReview(db, ctx, data));
  });

/** CSV of audit review under the same filters (decision 28). The server audit-logs every export. */
export const exportAuditCsv = createServerFn({ method: "POST" })
  .validator(
    z.object({
      category: z.enum(["access", "people", "sharing", "care"]).optional(),
      householdId: z.string().max(100).optional(),
      days: z.number().int().optional(),
      actorId: z.string().max(100).optional(),
      source: z
        .enum(["staff", "family", "recipient", "partner_simulated", "system", "rule", "prepared", "approval"])
        .optional(),
      q: z.string().max(80).optional(),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, auditReview } = await server();
    return run((db, ctx) => auditReview.auditExport(db, ctx, data));
  });

/* ------------------------------------------------------------------ reports and household closure */

/** CSV of the report on screen (founder decision 57). The server audit-logs every export. */
export const exportReportCsv = createServerFn({ method: "POST" })
  .validator(
    z.object({
      report: z.enum(["overview", "households", "work", "exceptions", "bereavement", "workforce"]),
      days: z.number().int(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, reportExport } = await server();
    return run((db, ctx) => reportExport.reportExport(db, ctx, data));
  });

export const getOperationsReport = createServerFn({ method: "GET" }).handler(async () => {
  const { run, reports } = await server();
  return run((db, ctx) => reports.operationsReport(db, ctx));
});

export const getTrendsReport = createServerFn({ method: "GET" })
  .validator(z.object({ days: z.number().int() }))
  .handler(async ({ data }) => {
    const { run, reports } = await server();
    return run((db, ctx) => reports.trendsReport(db, ctx, data));
  });

export const closeHousehold = createServerFn({ method: "POST" })
  .validator(hid.extend({ reason: z.string().max(500) }))
  .handler(async ({ data }) => {
    const { run, reports } = await server();
    return run((db, ctx) => reports.closeHousehold(db, ctx, data));
  });

export const getSystemStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { run, system } = await server();
  return run((db, ctx) => system.systemStatus(db, ctx));
});

/* ------------------------------------------------------------------ care-team tasks (decision 40) */

const bulkTasks = z.object({
  taskIds: z.array(z.string().min(1).max(100)).min(1).max(50),
  toActorId: z.string().min(1).max(100),
});

export const getCoverageTasks = createServerFn({ method: "GET" }).handler(async () => {
  const { run, staffTasks } = await server();
  return run((db, ctx) => staffTasks.myCoverageTasks(db, ctx));
});

/** Changes nothing: what bulk assigning would do. */
export const previewBulkTaskAssign = createServerFn({ method: "POST" })
  .validator(bulkTasks)
  .handler(async ({ data }) => {
    const { run, staffTasks } = await server();
    return run((db, ctx) => staffTasks.previewBulkTaskAssign(db, ctx, data));
  });

export const bulkAssignTasks = createServerFn({ method: "POST" })
  .validator(bulkTasks.extend({ reason: z.string().max(500), confirmed: z.boolean() }))
  .handler(async ({ data }) => {
    const { run, staffTasks } = await server();
    return run((db, ctx) => staffTasks.bulkAssignTasks(db, ctx, data));
  });

/** Decision 45: the person at the recipient who'll read the packet once released. */
export const setPacketRecipientContact = createServerFn({ method: "POST" })
  .validator(
    z.object({ packetId: z.string().min(1).max(100), name: z.string().max(200), email: z.string().max(254) }),
  )
  .handler(async ({ data }) => {
    const { run, sharing } = await server();
    return run((db, ctx) => sharing.setPacketRecipientContact(db, ctx, data));
  });

/** Founder decision 41: the figures behind the six reports. Counts only. */
export const getReportSet = createServerFn({ method: "GET" }).handler(async () => {
  const { run, reports } = await server();
  return run((db, ctx) => reports.reportSet(db, ctx));
});

/* ------------------------------------------------------------------ hospice settings (decision 39) */

export const getOrgSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { run, orgSettings } = await server();
  return run((db, ctx) => orgSettings.settingsView(db, ctx));
});

/** One group at a time; the server checks who may change it and validates the values. */
export const updateSettingsGroup = createServerFn({ method: "POST" })
  .validator(
    z.object({
      group: z.enum([
        "queue",
        "exceptions",
        "assignment",
        "taskCatalog",
        "notifications",
        "reports",
        "statusLabels",
        "enrollment",
        "access",
        "retention",
      ]),
      value: z.unknown(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, orgSettings } = await server();
    return run((db, ctx) =>
      orgSettings.updateSettingsGroup(db, ctx, { group: data.group, value: data.value }),
    );
  });

export const getRetentionReview = createServerFn({ method: "GET" }).handler(async () => {
  const { run, orgSettings } = await server();
  return run((db, ctx) => orgSettings.retentionReview(db, ctx));
});

/** Founder decision 39: the administrator's overview. */
export const getAdminOverview = createServerFn({ method: "GET" }).handler(async () => {
  const { run, team } = await server();
  return run((db, ctx) => team.adminOverview(db, ctx));
});
