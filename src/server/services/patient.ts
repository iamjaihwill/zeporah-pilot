/**
 * The patient's own view (founder decision 46): their wishes and preferences, the people involved,
 * their care team's contacts, what's coming up, the tasks shared with them, consent and sharing
 * status, packet status, their private notes, and a clear way to ask for help or flag a concern.
 *
 * Never staff-only notes, queue priorities, internal triage reasoning, who on staff owns what, or
 * detailed audit data. Packet holds show a plain status, never the policy reason code.
 *
 * Private notes are the patient's alone: no one else reads them — not the household, not the care
 * team — and their text never goes into an audit summary, a notification or a log.
 */
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, familyScope, type ActorContext } from "../context";
import { careGuidesFor, householdMembers, organizationHotline } from "./common";
import { familyMaySee } from "./tasks";
import { ROLE_LABELS, SUPPORT_CATEGORIES } from "@/domain/model";
import { LIFECYCLE_LABELS } from "@/domain/lifecycle";

export const NOTE_MAX = 2000;
const SOON_DAYS = 14;

async function patientScope(db: DB, ctx: ActorContext) {
  const scope = await familyScope(db, ctx, "household.view");
  if (!scope.roles.includes("patient") || scope.lifecycle === "bereavement")
    throw new AccessError("NOT_PERMITTED", "This page is the patient's own.");
  return scope;
}

export async function patientView(db: DB, ctx: ActorContext) {
  const scope = await patientScope(db, ctx);
  const T = ctx.tenantId;
  const H = scope.householdId;
  const [h] = await db
    .select()
    .from(s.households)
    .where(and(eq(s.households.tenantId, T), eq(s.households.id, H)));
  const [record] = await db
    .select()
    .from(s.careCoordinationRecords)
    .where(and(eq(s.careCoordinationRecords.tenantId, T), eq(s.careCoordinationRecords.householdId, H)));
  const [support] = await db
    .select()
    .from(s.supportPreferences)
    .where(and(eq(s.supportPreferences.tenantId, T), eq(s.supportPreferences.householdId, H)));
  const [prefs] = await db
    .select()
    .from(s.preferences)
    .where(and(eq(s.preferences.tenantId, T), eq(s.preferences.actorId, ctx.actorId)));
  const members = await householdMembers(db, T, H);
  const guides = await careGuidesFor(db, T, H);
  const tasks = (
    await db
      .select()
      .from(s.tasks)
      .where(
        and(
          eq(s.tasks.tenantId, T),
          eq(s.tasks.householdId, H),
          eq(s.tasks.audience, "family"),
          eq(s.tasks.status, "open"),
        ),
      )
      .orderBy(s.tasks.dueAt, s.tasks.createdAt)
  ).filter((t) => familyMaySee(t, ctx.actorId, scope.roles));
  const nameOf = (id: string | null) =>
    members.find((m) => m.actorId === id)?.name ?? guides.find((g) => g.actorId === id)?.name ?? null;
  const consents = await db
    .select()
    .from(s.consents)
    .where(and(eq(s.consents.tenantId, T), eq(s.consents.householdId, H)))
    .orderBy(desc(s.consents.createdAt));
  const packets = await db
    .select()
    .from(s.packets)
    .where(and(eq(s.packets.tenantId, T), eq(s.packets.householdId, H)))
    .orderBy(desc(s.packets.updatedAt));
  const now = Date.now();
  const soon = now + SOON_DAYS * 86_400_000;
  const supportLabels = new Map<string, string>(SUPPORT_CATEGORIES.map(([k, l]) => [k, l]));

  const milestones = [
    ...(record?.visitRhythm ? [{ what: `Visits: ${record.visitRhythm}`, when: null as Date | null }] : []),
    ...tasks
      .filter((t) => t.dueAt && t.dueAt.getTime() <= soon)
      .map((t) => ({ what: `Task due: ${t.title}`, when: t.dueAt })),
    ...consents
      .filter((c) => c.state === "active" && c.expiresAt && c.expiresAt.getTime() <= soon)
      .map((c) => ({ what: `Sharing with ${c.recipientName} ends`, when: c.expiresAt })),
    ...packets
      .filter((p) => p.state === "released" && p.expiresAt.getTime() > now && p.expiresAt.getTime() <= soon)
      .map((p) => ({ what: `Access for ${p.recipientName} ends`, when: p.expiresAt })),
  ].sort((a, b) => (a.when?.getTime() ?? 0) - (b.when?.getTime() ?? 0));

  const notes = await db
    .select()
    .from(s.privateNotes)
    .where(
      and(
        eq(s.privateNotes.tenantId, T),
        eq(s.privateNotes.householdId, H),
        eq(s.privateNotes.actorId, ctx.actorId),
      ),
    )
    .orderBy(desc(s.privateNotes.createdAt));

  return {
    stage: LIFECYCLE_LABELS[h!.lifecycleState as keyof typeof LIFECYCLE_LABELS] ?? h!.lifecycleState,
    wishes: {
      whatMatters: record?.familyPriorities || null,
      support: (support?.categories ?? []).map((c) => supportLabels.get(c) ?? c),
      spiritualCare: support?.spiritualCare ?? false,
      contactTime: support?.preferredContactTime ?? null,
      contactMethod: prefs?.contactMethod ?? "in_app",
    },
    people: members
      .filter((m) => m.actorId !== ctx.actorId)
      .map((m) => ({ name: m.name, roles: m.roles.map((r) => ROLE_LABELS[r]) })),
    careTeam: {
      guides: guides.map((g) => g.name),
      hotline: await organizationHotline(db, T, h!.organizationId),
    },
    milestones,
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt, with: nameOf(t.assigneeActorId) })),
    sharing: consents.map((c) => ({
      id: c.id,
      recipient: c.recipientName,
      purpose: c.purpose,
      status: CONSENT_PLAIN[c.state] ?? "Being set up",
      until: c.expiresAt,
    })),
    // A plain status only: never the release check's reason code or who on staff handled it.
    packets: packets.map((p) => ({
      id: p.id,
      recipient: p.recipientName,
      purpose: p.purpose,
      status:
        p.state === "released" && p.expiresAt.getTime() <= now
          ? "Expired"
          : (PACKET_PLAIN[p.state] ?? "Being prepared"),
      until: p.expiresAt,
    })),
    notes: notes.map((n) => ({ id: n.id, body: n.body, at: n.updatedAt ?? n.createdAt })),
  };
}

const CONSENT_PLAIN: Record<string, string> = {
  draft: "Not in effect yet",
  active: "In effect",
  revoked: "Withdrawn",
  expired: "Ended",
};

const PACKET_PLAIN: Record<string, string> = {
  draft: "Being prepared",
  held: "Waiting on a check before it can be shared",
  released: "Shared",
  denied: "Not shared",
  revoked: "Sharing stopped",
};

function checkNote(raw: string) {
  const body = raw.trim();
  if (!body) throw new AccessError("INVALID", "Write something first.");
  if (body.length > NOTE_MAX) throw new AccessError("INVALID", `Keep it under ${NOTE_MAX} characters.`);
  return body;
}

/** A private note. Audit-logged as a fact only — never its text. */
export async function addPrivateNote(db: DB, ctx: ActorContext, input: { body: string }) {
  const scope = await patientScope(db, ctx);
  const body = checkNote(input.body);
  await db.transaction(async (tx) => {
    const [n] = await tx
      .insert(s.privateNotes)
      .values({ tenantId: ctx.tenantId, householdId: scope.householdId, actorId: ctx.actorId, body })
      .returning({ id: s.privateNotes.id });
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "private_note.saved",
      subjectType: "private_note",
      subjectId: n!.id,
      summary: "The patient saved a private note.",
      visibility: "staff",
    });
  });
}

export async function editPrivateNote(db: DB, ctx: ActorContext, input: { id: string; body: string }) {
  const scope = await patientScope(db, ctx);
  const body = checkNote(input.body);
  const done = await db
    .update(s.privateNotes)
    .set({ body, updatedAt: new Date() })
    .where(
      and(
        eq(s.privateNotes.tenantId, ctx.tenantId),
        eq(s.privateNotes.householdId, scope.householdId),
        eq(s.privateNotes.actorId, ctx.actorId),
        eq(s.privateNotes.id, input.id),
      ),
    )
    .returning({ id: s.privateNotes.id });
  if (!done.length) throw new AccessError("OUT_OF_SCOPE", "That note isn't available.");
}
