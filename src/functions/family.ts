/**
 * Typed contract for the household app. Every function resolves the session on the server,
 * rebuilds the actor's context, and returns a Result. See docs/api-contract.md.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CORRECTION_CATEGORIES } from "@/domain/consent";
import { submissionId } from "@/domain/submission";
import { CONTACT_RELATIONSHIPS } from "@/domain/contacts";

const server = () => import("@/server/api");
const id = z.object({ id: z.string().min(1) });

export const getFamilyHome = createServerFn({ method: "GET" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.familyHome(db, ctx));
});

export const getOnboarding = createServerFn({ method: "GET" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.getOnboarding(db, ctx));
});

export const savePreferences = createServerFn({ method: "POST" })
  .validator(
    z.object({
      language: z.string().min(2).max(10),
      textSize: z.enum(["standard", "larger", "largest"]),
      contactMethod: z.enum(["in_app", "phone", "email"]),
    }),
  )
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.savePreferences(db, ctx, data));
  });

export const inviteContact = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().max(120),
      contact: z.string().max(200),
      role: z.enum(["family_member", "proxy", "helper"]),
      relationship: z.string().max(80).optional(),
      accessModel: z.enum(["task", "collaboration"]).optional(),
      taskId: z.string().max(100).optional(),
      accessEndsAt: z.string().max(40).optional(),
      scopeNote: z.string().max(400).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.inviteContact(db, ctx, data));
  });

export const reissueInvitation = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.reissueInvitation(db, ctx, data.id));
  });

export const cancelInvitation = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.cancelInvitation(db, ctx, data.id));
  });

export const finishContactsStep = createServerFn({ method: "POST" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.finishContactsStep(db, ctx));
});

export const saveCommunication = createServerFn({ method: "POST" })
  .validator(
    z.object({
      notificationCadence: z.enum(["as_it_happens", "daily_summary", "essential_only"]),
      quietHoursStart: z.string(),
      quietHoursEnd: z.string(),
      emailNotices: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.saveCommunication(db, ctx, data));
  });

export const finishVaultStep = createServerFn({ method: "POST" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.finishVaultStep(db, ctx));
});

export const getVault = createServerFn({ method: "GET" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.listVault(db, ctx));
});

export const getVaultItem = createServerFn({ method: "GET" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.getVaultItem(db, ctx, data.id));
  });

export const reviewVaultItem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().min(1),
      status: z.enum(["needs_review", "reviewed", "not_available", "not_applicable"]),
      keptWhere: z.string().max(200).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.reviewVaultItem(db, ctx, data));
  });

export const markThreadSeen = createServerFn({ method: "POST" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.markThreadSeen(db, ctx));
});

export const getThread = createServerFn({ method: "GET" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.getThread(db, ctx));
});

export const sendFamilyMessage = createServerFn({ method: "POST" })
  .validator(z.object({ body: z.string().max(4000), submissionId }))
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.sendFamilyMessage(db, ctx, data.body, data.submissionId));
  });

export const acknowledgeUpdate = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.acknowledgeUpdate(db, ctx, data.id));
  });

export const getFamilyTasks = createServerFn({ method: "GET" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.listFamilyTasks(db, ctx));
});

export const completeFamilyTask = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.completeFamilyTask(db, ctx, data.id));
  });

/** Undo for "mark done", and "Reopen" in the Done list (interaction review, item 4). */
export const reopenFamilyTask = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.reopenFamilyTask(db, ctx, data.id));
  });

export const undoVaultReview = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.undoVaultReview(db, ctx, data.id));
  });

export const undoAcknowledgeUpdate = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.undoAcknowledgeUpdate(db, ctx, data.id));
  });

export const getPeople = createServerFn({ method: "GET" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.listPeople(db, ctx));
});

export const getHouseholdConsents = createServerFn({ method: "GET" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.listHouseholdConsents(db, ctx));
});

export const withdrawConsent = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.withdrawConsent(db, ctx, data.id));
  });

/** Stage 2 of consent: the named grantor confirms the exact current version. */
export const confirmConsent = createServerFn({ method: "POST" })
  .validator(z.object({ consentId: z.string().min(1), version: z.number().int().min(1) }))
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.confirmConsent(db, ctx, data));
  });

export const askToWithdrawConsent = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.askToWithdrawConsent(db, ctx, data.id));
  });

export const getSupport = createServerFn({ method: "GET" })
  .validator(z.object({ aboutUpdateId: z.string().max(100).optional() }).optional())
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.getSupport(db, ctx, data ?? {}));
  });

export const saveSupportPreferences = createServerFn({ method: "POST" })
  .validator(
    z.object({
      categories: z.array(z.string().max(60)).max(12),
      spiritualCare: z.boolean(),
      preferredContactTime: z.string().max(100),
    }),
  )
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.saveSupportPreferences(db, ctx, data));
  });

export const requestHumanSupport = createServerFn({ method: "POST" })
  .validator(
    z.object({
      category: z.string().min(1).max(80),
      message: z.string().max(1000),
      contactTime: z.string().max(100),
      aboutUpdateId: z.string().max(100).optional(),
      sendAgain: z.boolean().optional(),
      submissionId,
    }),
  )
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.requestHumanSupport(db, ctx, data));
  });

export const getBereavement = createServerFn({ method: "GET" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.getBereavement(db, ctx));
});

export const setContactPause = createServerFn({ method: "POST" })
  .validator(z.object({ paused: z.boolean() }))
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.setContactPause(db, ctx, data.paused));
  });

export const confirmSurvivingContact = createServerFn({ method: "POST" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.confirmSurvivingContact(db, ctx));
});

/* ---------------- consents that name this person ---------------- */

export const getConsentsForMe = createServerFn({ method: "GET" }).handler(async () => {
  const { run, family } = await server();
  return run((db, ctx) => family.consentsForMe(db, ctx));
});

/** Authorized per consent: the signed-in person must be the one named in it. */
export const getConsentForMe = createServerFn({ method: "GET" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.getConsentForMe(db, ctx, data.id));
  });

/** "Request a correction" — not a withdrawal. Categories and words are both optional. */
export const requestConsentCorrection = createServerFn({ method: "POST" })
  .validator(
    z.object({
      consentId: z.string().min(1),
      version: z.number().int().min(1),
      categories: z.array(z.enum(CORRECTION_CATEGORIES)).max(CORRECTION_CATEGORIES.length),
      detail: z.string().max(1000),
    }),
  )
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.requestConsentCorrection(db, ctx, data));
  });

export const cancelConsentCorrection = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.cancelConsentCorrection(db, ctx, data.id));
  });

/** The household's own member administration (coordinator or patient; see services/household-admin.ts). */
export const changeMemberRole = createServerFn({ method: "POST" })
  .validator(z.object({ actorId: z.string().min(1).max(100), role: z.enum(["family_member", "proxy"]) }))
  .handler(async ({ data }) => {
    const { run, householdAdmin } = await server();
    return run((db, ctx) => householdAdmin.changeMemberRole(db, ctx, data));
  });

export const removeMember = createServerFn({ method: "POST" })
  .validator(z.object({ actorId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, householdAdmin } = await server();
    return run((db, ctx) => householdAdmin.removeMember(db, ctx, data));
  });

/* ------------------------------------------------------------------ household tasks (decision 44) */

const taskInput = z.object({
  title: z.string().max(200),
  detail: z.string().max(1000),
  assigneeActorId: z.string().max(100).nullable(),
  dueAt: z.string().max(40).nullable(),
  sensitive: z.boolean(),
  visibility: z.enum(["household", "limited"]),
  sharedWith: z.array(z.string().max(100)).max(20),
});

export const getTaskFormOptions = createServerFn({ method: "GET" }).handler(async () => {
  const { run, householdTasks } = await server();
  return run((db, ctx) => householdTasks.taskFormOptions(db, ctx));
});

export const createHouseholdTask = createServerFn({ method: "POST" })
  .validator(taskInput)
  .handler(async ({ data }) => {
    const { run, householdTasks } = await server();
    return run((db, ctx) => householdTasks.createHouseholdTask(db, ctx, data));
  });

export const editHouseholdTask = createServerFn({ method: "POST" })
  .validator(taskInput.extend({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, householdTasks } = await server();
    return run((db, ctx) => householdTasks.editHouseholdTask(db, ctx, data));
  });

export const closeHouseholdTask = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100), reason: z.string().max(500) }))
  .handler(async ({ data }) => {
    const { run, householdTasks } = await server();
    return run((db, ctx) => householdTasks.closeHouseholdTask(db, ctx, data));
  });

/* ------------------------------------------------------------------ vault audience (decision 43) */

const audience = z.enum(["private", "selected", "household", "staff"]);

export const setVaultAudience = createServerFn({ method: "POST" })
  .validator(
    z.object({ id: z.string().min(1).max(100), audience, sharedWith: z.array(z.string().max(100)).max(20) }),
  )
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.setVaultAudience(db, ctx, data));
  });

export const addVaultItem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      title: z.string().max(200),
      keptWhere: z.string().max(400),
      audience,
      sharedWith: z.array(z.string().max(100)).max(20),
    }),
  )
  .handler(async ({ data }) => {
    const { run, family } = await server();
    return run((db, ctx) => family.addVaultItem(db, ctx, data));
  });

/* ------------------------------------------------------------------ helpers (decision 42) */

export const getHelperView = createServerFn({ method: "GET" }).handler(async () => {
  const { run, helpers } = await server();
  return run((db, ctx) => helpers.helperView(db, ctx));
});

export const completeHelperTask = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, helpers } = await server();
    return run((db, ctx) => helpers.completeHelperTask(db, ctx, data.id));
  });

/* ------------------------------------------------------------------ the patient's own view (decision 46) */

export const getPatientView = createServerFn({ method: "GET" }).handler(async () => {
  const { run, patient } = await server();
  return run((db, ctx) => patient.patientView(db, ctx));
});

export const addPrivateNote = createServerFn({ method: "POST" })
  .validator(z.object({ body: z.string().max(4000) }))
  .handler(async ({ data }) => {
    const { run, patient } = await server();
    return run((db, ctx) => patient.addPrivateNote(db, ctx, data));
  });

export const editPrivateNote = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1).max(100), body: z.string().max(4000) }))
  .handler(async ({ data }) => {
    const { run, patient } = await server();
    return run((db, ctx) => patient.editPrivateNote(db, ctx, data));
  });

/* ------------------------------------------------------------------ listed contacts (decisions 74–78) */

const contactFields = z.object({
  name: z.string().max(200),
  relationship: z.enum(CONTACT_RELATIONSHIPS),
  organization: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(254).optional(),
  note: z.string().max(400).optional(),
  patientPrivate: z.boolean().optional(),
});

export const getContacts = createServerFn({ method: "GET" }).handler(async () => {
  const { run, contacts } = await server();
  return run((db, ctx) => contacts.listContacts(db, ctx));
});

export const addContact = createServerFn({ method: "POST" })
  .validator(contactFields)
  .handler(async ({ data }) => {
    const { run, contacts } = await server();
    return run((db, ctx) => contacts.addContact(db, ctx, data));
  });

export const updateContact = createServerFn({ method: "POST" })
  .validator(contactFields.extend({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const { run, contacts } = await server();
    return run((db, ctx) => contacts.updateContact(db, ctx, data));
  });

export const removeContact = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, contacts } = await server();
    return run((db, ctx) => contacts.removeContact(db, ctx, data));
  });

/* ------------------------------------------------------------------ request lifecycle (decisions 79–83) */

export const withdrawRequest = createServerFn({ method: "POST" })
  .validator(id)
  .handler(async ({ data }) => {
    const { run, requests } = await server();
    return run((db, ctx) => requests.withdrawRequest(db, ctx, data));
  });

export const reopenRequest = createServerFn({ method: "POST" })
  .validator(id.extend({ reason: z.string().max(300) }))
  .handler(async ({ data }) => {
    const { run, requests } = await server();
    return run((db, ctx) => requests.reopenRequest(db, ctx, data));
  });
