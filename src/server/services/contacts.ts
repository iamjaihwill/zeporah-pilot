/**
 * Listed contacts (founder decisions 74–78): a household's other supporters, who aren't Zeporah
 * users. A listing is information only. It grants no account, sends nothing, and shows the person
 * nothing; access comes only through an invitation (decision 42) or a packet (decision 45).
 *
 * - **Who manages:** the patient and the coordinator (`contacts.manage`), and the care team
 *   (`staff.contacts.manage`: care guides and operations).
 * - **Who sees:** household members with `people.view`, and the care team.
 * - **Patient-private** (decision 76): seen only by the patient and the care team; only the patient
 *   adds, changes or removes one. Its audit entries are staff-only, so it doesn't appear in the
 *   household's activity.
 * - Removing a contact marks it removed; rows aren't deleted.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, familyScope, staffScope, type ActorContext } from "../context";
import { looksLikeEmail, normalizeEmail } from "../auth/crypto";
import { can } from "@/domain/permissions";
import {
  CONTACT_RELATIONSHIP_LABELS,
  CONTACT_RELATIONSHIPS,
  looksLikePhone,
  NAME_MAX,
  NOTE_MAX,
  type ContactRelationship,
} from "@/domain/contacts";

export type ContactInput = {
  name: string;
  relationship: ContactRelationship;
  organization?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  note?: string | undefined;
  patientPrivate?: boolean | undefined;
};

type Who = { tenantId: string; householdId: string; isPatient: boolean; canManage: boolean };

/** Where the person stands: their household and whether they may manage contacts. */
async function who(db: DB, ctx: ActorContext, householdId?: string): Promise<Who> {
  if (ctx.kind === "staff") {
    if (!householdId) throw new AccessError("INVALID", "Choose a household.");
    const scope = await staffScope(db, ctx, householdId, "staff.household.view");
    return {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      isPatient: false,
      canManage: can(ctx.staffRoles, "staff.contacts.manage", scope.lifecycle),
    };
  }
  const scope = await familyScope(db, ctx, "people.view");
  return {
    tenantId: ctx.tenantId,
    householdId: scope.householdId,
    isPatient: scope.roles.includes("patient"),
    canManage: can(scope.roles, "contacts.manage", scope.lifecycle),
  };
}

function clean(input: ContactInput) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new AccessError("INVALID", "Add their name.");
  if (name.length > NAME_MAX) throw new AccessError("INVALID", `Keep the name under ${NAME_MAX} characters.`);
  if (!(CONTACT_RELATIONSHIPS as readonly string[]).includes(input.relationship))
    throw new AccessError("INVALID", "Choose how they're involved.");
  const phone = (input.phone ?? "").trim();
  const email = input.email?.trim() ? normalizeEmail(input.email) : "";
  if (phone && !looksLikePhone(phone))
    throw new AccessError("INVALID", "That phone number doesn't look right.");
  if (email && !looksLikeEmail(email))
    throw new AccessError("INVALID", "That email address doesn't look right.");
  const note = (input.note ?? "").trim();
  if (note.length > NOTE_MAX) throw new AccessError("INVALID", `Keep the note under ${NOTE_MAX} characters.`);
  return {
    name,
    relationship: input.relationship,
    organization: (input.organization ?? "").trim().slice(0, 120),
    phone,
    email,
    note,
  };
}

const visible = (w: Who, ctx: ActorContext) => (r: typeof s.householdContacts.$inferSelect) =>
  !r.patientPrivate || ctx.kind === "staff" || w.isPatient;

const editable = (w: Who) => (r: { patientPrivate: boolean }) =>
  w.canManage && (r.patientPrivate ? w.isPatient : true);

export async function listContacts(db: DB, ctx: ActorContext, householdId?: string) {
  const w = await who(db, ctx, householdId);
  const rows = await db
    .select()
    .from(s.householdContacts)
    .where(
      and(
        eq(s.householdContacts.tenantId, w.tenantId),
        eq(s.householdContacts.householdId, w.householdId),
        isNull(s.householdContacts.removedAt),
      ),
    )
    .orderBy(asc(s.householdContacts.name));
  return {
    canAdd: w.canManage,
    /** Only the patient can make a contact private (decision 76). */
    canAddPrivate: w.canManage && w.isPatient,
    contacts: rows.filter(visible(w, ctx)).map((r) => ({
      id: r.id,
      name: r.name,
      relationship: r.relationship as ContactRelationship,
      relationshipLabel: CONTACT_RELATIONSHIP_LABELS[r.relationship as ContactRelationship] ?? "Other",
      organization: r.organization,
      phone: r.phone,
      email: r.email,
      note: r.note,
      patientPrivate: r.patientPrivate,
      canEdit: editable(w)(r),
    })),
  };
}

async function audit(
  db: DB,
  ctx: ActorContext,
  w: Who,
  action: "contact.added" | "contact.updated" | "contact.removed",
  row: { id: string; relationship: string; patientPrivate: boolean },
) {
  const label = (
    CONTACT_RELATIONSHIP_LABELS[row.relationship as ContactRelationship] ?? "contact"
  ).toLowerCase();
  await appendAudit(db, {
    tenantId: w.tenantId,
    householdId: w.householdId,
    actorId: ctx.actorId,
    action,
    subjectType: "household_contact",
    subjectId: row.id,
    summary:
      action === "contact.added"
        ? `A ${label} was added to the household's contacts.`
        : action === "contact.updated"
          ? `A ${label} in the household's contacts was updated.`
          : `A ${label} was removed from the household's contacts.`,
    // A private contact stays out of the household's activity (decision 76).
    visibility: row.patientPrivate ? "staff" : "family",
  });
}

export async function addContact(
  db: DB,
  ctx: ActorContext,
  input: ContactInput & { householdId?: string | undefined },
) {
  const w = await who(db, ctx, input.householdId);
  if (!w.canManage)
    throw new AccessError("NOT_PERMITTED", "The patient, the coordinator or the care team can add contacts.");
  if (input.patientPrivate && !w.isPatient)
    throw new AccessError("NOT_PERMITTED", "Only the patient can keep a contact private.");
  const v = clean(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.householdContacts)
      .values({
        tenantId: w.tenantId,
        householdId: w.householdId,
        ...v,
        patientPrivate: !!input.patientPrivate,
        addedByActorId: ctx.actorId,
      })
      .returning();
    await audit(tx as unknown as DB, ctx, w, "contact.added", row!);
    return { id: row!.id };
  });
}

async function editableRow(db: DB, ctx: ActorContext, w: Who, id: string) {
  const [row] = await db
    .select()
    .from(s.householdContacts)
    .where(
      and(
        eq(s.householdContacts.tenantId, w.tenantId),
        eq(s.householdContacts.householdId, w.householdId),
        eq(s.householdContacts.id, id),
        isNull(s.householdContacts.removedAt),
      ),
    );
  // A private contact someone can't see looks the same as one that doesn't exist.
  if (!row || !visible(w, ctx)(row)) throw new AccessError("OUT_OF_SCOPE", "This contact isn't available.");
  if (!editable(w)(row))
    throw new AccessError(
      "NOT_PERMITTED",
      row.patientPrivate
        ? "Only the patient can change a private contact."
        : "You can't change this contact.",
    );
  return row;
}

export async function updateContact(
  db: DB,
  ctx: ActorContext,
  input: ContactInput & { id: string; householdId?: string | undefined },
) {
  const w = await who(db, ctx, input.householdId);
  const row = await editableRow(db, ctx, w, input.id);
  if (input.patientPrivate !== undefined && input.patientPrivate !== row.patientPrivate && !w.isPatient)
    throw new AccessError("NOT_PERMITTED", "Only the patient can keep a contact private.");
  const v = clean(input);
  const patientPrivate = input.patientPrivate ?? row.patientPrivate;
  await db.transaction(async (tx) => {
    await tx
      .update(s.householdContacts)
      .set({ ...v, patientPrivate, updatedAt: new Date() })
      .where(eq(s.householdContacts.id, row.id));
    // Staff-only if it is, or was, private: nothing about a private contact reaches the household.
    await audit(tx as unknown as DB, ctx, w, "contact.updated", {
      id: row.id,
      relationship: v.relationship,
      patientPrivate: patientPrivate || row.patientPrivate,
    });
  });
}

export async function removeContact(
  db: DB,
  ctx: ActorContext,
  input: { id: string; householdId?: string | undefined },
) {
  const w = await who(db, ctx, input.householdId);
  const row = await editableRow(db, ctx, w, input.id);
  await db.transaction(async (tx) => {
    await tx
      .update(s.householdContacts)
      .set({ removedAt: new Date(), removedByActorId: ctx.actorId })
      .where(eq(s.householdContacts.id, row.id));
    await audit(tx as unknown as DB, ctx, w, "contact.removed", row);
  });
}
