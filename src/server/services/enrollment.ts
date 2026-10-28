/**
 * Enrollment and activation (founder decisions 66–70). Enrollment in Zeporah is separate from
 * hospice admission: declining Zeporah changes nothing about care.
 *
 * - **Enroll** (66): operations and administrators create a minimal case, the patient's name, and
 *   name the care guide who owns getting it started. The pilot cap is enforced here (70).
 * - **Invite the first member** (67, 68): operations or the household's care guide invite the
 *   patient or one coordinator with a one-time link, after confirming who the person is; how they
 *   confirmed it is recorded. The person sets their own password when they accept.
 * - **Setup** (69): the patient may complete household setup while there's no active coordinator.
 * - **Activation** is a tracked checklist for the care team, never a gate on anything.
 */
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { Conn, DB } from "../db/client";
import * as s from "../db/schema";
import { appendAudit } from "../audit";
import { AccessError, requireStaffPermission, staffScope, type ActorContext } from "../context";
import { addresses } from "../environment";
import { hashToken, looksLikeEmail, newToken, normalizeEmail } from "../auth/crypto";
import { INVITATION_DAYS } from "./auth";
import { eligibleGuide, insertAssignment, organizationCareGuides } from "./assignments";
import { orgSettings } from "./org-settings";
import { organizationHotline, onboardingState } from "./common";
import { publicUrl } from "@/domain/addresses";
import { STARTER_VAULT } from "@/domain/starter-vault";
import { ROLE_LABELS } from "@/domain/model";

/** Households that count toward the pilot cap: everything not closed or in bereavement (decision 70). */
const COUNTED = ["enrolled", "active_hospice"];

export const CAP_REACHED = (cap: number) =>
  `This hospice has ${cap} households in the pilot, its limit. An administrator can change the limit in Hospice settings.`;

async function householdsInPilot(conn: Conn, tenantId: string, organizationId: string) {
  const [r] = await conn
    .select({ n: count() })
    .from(s.households)
    .where(
      and(
        eq(s.households.tenantId, tenantId),
        eq(s.households.organizationId, organizationId),
        inArray(s.households.lifecycleState, COUNTED),
      ),
    );
  return r?.n ?? 0;
}

/** What the enrollment form needs: the count, the cap and the care guides to choose from. */
export async function enrollmentView(db: DB, ctx: ActorContext) {
  requireStaffPermission(ctx, "household.enroll");
  if (!ctx.organizationId) throw new AccessError("NOT_PERMITTED", "This needs a hospice.");
  const settings = await orgSettings(db, ctx.tenantId, ctx.organizationId);
  return {
    inPilot: await householdsInPilot(db, ctx.tenantId, ctx.organizationId),
    cap: settings.enrollment.cap,
    careGuides: await organizationCareGuides(db, ctx),
  };
}

/** "Rehanna Wells" → "The Wells household". */
export const householdNameFor = (patientName: string) => {
  const last = patientName.trim().split(/\s+/).at(-1) ?? patientName.trim();
  return `The ${last} household`;
};

export async function enrollHousehold(
  db: DB,
  ctx: ActorContext,
  input: { patientName: string; careGuideActorId: string },
) {
  requireStaffPermission(ctx, "household.enroll");
  const organizationId = ctx.organizationId;
  if (!organizationId) throw new AccessError("NOT_PERMITTED", "This needs a hospice.");
  const patientName = input.patientName.trim().replace(/\s+/g, " ");
  if (!patientName) throw new AccessError("INVALID", "Add the patient's name.");
  if (patientName.length > 120) throw new AccessError("INVALID", "Keep the name under 120 characters.");
  const guide = await eligibleGuide(db, ctx, input.careGuideActorId);
  const cap = (await orgSettings(db, ctx.tenantId, organizationId)).enrollment.cap;
  return db.transaction(async (tx) => {
    // One enrollment at a time per hospice, so two can't both take the last place under the cap.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`zeporah.enroll:${organizationId}`}, 0))`,
    );
    if ((await householdsInPilot(tx, ctx.tenantId, organizationId)) >= cap)
      throw new AccessError("CONFLICT", CAP_REACHED(cap));
    const [h] = await tx
      .insert(s.households)
      .values({
        tenantId: ctx.tenantId,
        organizationId,
        displayName: householdNameFor(patientName),
        patientName,
        lifecycleState: "enrolled",
        enrolledByActorId: ctx.actorId,
        activationOwnerActorId: guide.actorId,
      })
      .returning();
    const H = h!.id;
    await tx.insert(s.messageThreads).values({
      id: `th-${H}`,
      tenantId: ctx.tenantId,
      householdId: H,
      subject: "Messages with your care guide",
    });
    await tx.insert(s.careCoordinationRecords).values({
      tenantId: ctx.tenantId,
      householdId: H,
      careGuideActorId: guide.actorId,
      visitRhythm: "",
      // Decision 72: the line is read live from the hospice, never copied here.
      afterHoursRoute: "",
    });
    await tx.insert(s.vaultItems).values(
      STARTER_VAULT.map(([title, category, description, sensitivity]) => ({
        tenantId: ctx.tenantId,
        householdId: H,
        title,
        category,
        description,
        sensitivity,
        status: "needs_review",
        starter: true,
      })),
    );
    await insertAssignment(
      tx,
      ctx,
      { householdId: H, lifecycle: "enrolled", householdName: h!.displayName },
      guide,
    );
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: H,
      actorId: ctx.actorId,
      action: "household.enrolled",
      subjectType: "household",
      subjectId: H,
      summary: `The household was enrolled in Zeporah, with ${guide.name} owning activation.`,
      visibility: "staff",
      context: {
        activationOwner: guide.actorId,
        inPilotAfter: await householdsInPilot(tx, ctx.tenantId, organizationId),
      },
    });
    return { householdId: H, displayName: h!.displayName };
  });
}

/* ------------------------------------------------------------------ first members */

const FIRST_ROLES = ["patient", "coordinator"] as const;
export type FirstRole = (typeof FIRST_ROLES)[number];

/** Whether the household already has, or has invited, someone in this role. */
async function roleTaken(conn: Conn, tenantId: string, householdId: string, role: FirstRole) {
  const [member] = await conn
    .select({ id: s.memberships.id })
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.tenantId, tenantId),
        eq(s.memberships.householdId, householdId),
        eq(s.memberships.roleCode, role),
        eq(s.memberships.status, "active"),
      ),
    );
  if (member) return "member" as const;
  const [pending] = await conn
    .select({ id: s.invitations.id })
    .from(s.invitations)
    .where(
      and(
        eq(s.invitations.tenantId, tenantId),
        eq(s.invitations.householdId, householdId),
        eq(s.invitations.roleCode, role),
        eq(s.invitations.status, "pending"),
        sql`${s.invitations.expiresAt} > now()`,
      ),
    );
  return pending ? ("invited" as const) : null;
}

export async function inviteFirstMember(
  db: DB,
  ctx: ActorContext,
  input: { householdId: string; role: FirstRole; name: string; email: string; identityConfirmation: string },
) {
  const scope = await staffScope(db, ctx, input.householdId, "household.invite_first");
  if (!(FIRST_ROLES as readonly string[]).includes(input.role))
    throw new AccessError("INVALID", "Staff can invite the patient or a household coordinator.");
  if (scope.lifecycle !== "enrolled" && scope.lifecycle !== "active_hospice")
    throw new AccessError("INVALID", "This household isn't taking new members.");
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const confirmed = input.identityConfirmation.trim();
  if (!name) throw new AccessError("INVALID", "Add their name.");
  if (!looksLikeEmail(email))
    throw new AccessError("INVALID", "Enter their email address. They'll use it to create their account.");
  if (!confirmed) throw new AccessError("INVALID", "Say how you confirmed who they are and their role.");
  if (confirmed.length > 300) throw new AccessError("INVALID", "Keep that under 300 characters.");
  const taken = await roleTaken(db, ctx.tenantId, scope.householdId, input.role);
  if (taken)
    throw new AccessError(
      "CONFLICT",
      taken === "member"
        ? `This household already has a ${ROLE_LABELS[input.role].toLowerCase()}.`
        : `A ${ROLE_LABELS[input.role].toLowerCase()} invitation is already waiting. Cancel it before sending another.`,
    );
  const token = newToken();
  await db.transaction(async (tx) => {
    const [inv] = await tx
      .insert(s.invitations)
      .values({
        tenantId: ctx.tenantId,
        householdId: scope.householdId,
        invitedByActorId: ctx.actorId,
        inviteeName: name,
        inviteeContact: email,
        inviteeEmail: email,
        tokenHash: hashToken(token),
        roleCode: input.role,
        identityConfirmation: confirmed,
        expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
      })
      .returning();
    await appendAudit(tx, {
      tenantId: ctx.tenantId,
      householdId: scope.householdId,
      actorId: ctx.actorId,
      action: "invitation.created",
      subjectType: "invitation",
      subjectId: inv!.id,
      summary: `The care team invited the household's ${ROLE_LABELS[input.role].toLowerCase()}.`,
      visibility: "staff",
      // How identity was confirmed stays on the invitation, not in the audit summary.
      context: { role: input.role, byStaff: true },
    });
  });
  // Shown once, to the person who invited; only its hash is stored. Families sign in on the app address.
  return { acceptPath: `/invite/${token}`, acceptUrl: publicUrl(addresses(), `/invite/${token}`, "app") };
}

/* ------------------------------------------------------------------ setup (decision 69) */

/** Whether the household has an active coordinator. */
export async function hasCoordinator(conn: Conn, tenantId: string, householdId: string) {
  const [c] = await conn
    .select({ id: s.memberships.id })
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.tenantId, tenantId),
        eq(s.memberships.householdId, householdId),
        eq(s.memberships.roleCode, "coordinator"),
        eq(s.memberships.status, "active"),
      ),
    );
  return !!c;
}

/* ------------------------------------------------------------------ activation */

export type ActivationItem = { key: string; label: string; done: boolean };

/**
 * Where a household is in getting started, for its care team. Tracked, not enforced: nothing in
 * the app waits on it. Computed from the records each step leaves behind.
 */
export async function activationStatus(
  conn: Conn,
  tenantId: string,
  householdId: string,
  organizationId: string,
) {
  const T = tenantId;
  const H = householdId;
  const [h] = await conn
    .select({ owner: s.households.activationOwnerActorId })
    .from(s.households)
    .where(and(eq(s.households.tenantId, T), eq(s.households.id, H)));
  const [account] = await conn
    .select({ id: s.memberships.id })
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.tenantId, T),
        eq(s.memberships.householdId, H),
        inArray(s.memberships.roleCode, [...FIRST_ROLES]),
        eq(s.memberships.status, "active"),
      ),
    );
  const [guide] = await conn
    .select({ id: s.memberships.id })
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.tenantId, T),
        eq(s.memberships.householdId, H),
        eq(s.memberships.roleCode, "care_guide"),
        eq(s.memberships.status, "active"),
      ),
    );
  const hotline = await organizationHotline(conn, T, organizationId);
  const setup = await onboardingState(conn, T, H);
  const [firstFamily] = await conn
    .select({ at: s.messages.createdAt })
    .from(s.messages)
    .where(
      and(eq(s.messages.tenantId, T), eq(s.messages.householdId, H), eq(s.messages.authorSide, "family")),
    )
    .orderBy(s.messages.createdAt)
    .limit(1);
  const [request] = await conn
    .select({ at: s.escalations.createdAt, owner: s.escalations.ownerActorId, status: s.escalations.status })
    .from(s.escalations)
    .where(
      and(
        eq(s.escalations.tenantId, T),
        eq(s.escalations.householdId, H),
        eq(s.escalations.sourceType, "support_request"),
      ),
    )
    .orderBy(s.escalations.createdAt)
    .limit(1);
  const firstAction = [firstFamily?.at, request?.at].filter((x): x is Date => !!x).sort((a, b) => +a - +b)[0];
  const [reply] = firstAction
    ? await conn
        .select({ id: s.messages.id })
        .from(s.messages)
        .where(
          and(
            eq(s.messages.tenantId, T),
            eq(s.messages.householdId, H),
            eq(s.messages.authorSide, "staff"),
            sql`${s.messages.createdAt} >= ${firstAction}`,
          ),
        )
        .limit(1)
    : [];
  const followedUp = !!reply || !!(request && (request.owner || request.status !== "open"));
  const owner = h?.owner
    ? ((
        await conn
          .select({ name: s.actors.displayName })
          .from(s.actors)
          .where(and(eq(s.actors.tenantId, T), eq(s.actors.id, h.owner)))
      )[0]?.name ?? null)
    : null;
  const pending = await conn
    .select({
      name: s.invitations.inviteeName,
      role: s.invitations.roleCode,
      expiresAt: s.invitations.expiresAt,
    })
    .from(s.invitations)
    .where(
      and(
        eq(s.invitations.tenantId, T),
        eq(s.invitations.householdId, H),
        inArray(s.invitations.roleCode, [...FIRST_ROLES]),
        eq(s.invitations.status, "pending"),
        sql`${s.invitations.expiresAt} > now()`,
      ),
    );
  const items: ActivationItem[] = [
    { key: "account", label: "The patient or a coordinator has an account", done: !!account },
    {
      key: "contact",
      label: "A care guide is assigned and the 24-hour line is set",
      done: !!guide && !!hotline,
    },
    { key: "setup", label: "Communication settings are chosen in setup", done: setup.has("communication") },
    { key: "first_action", label: "The household sent a message or asked for help", done: !!firstAction },
    { key: "followed_up", label: "The care team replied or took the request", done: followedUp },
  ];
  return {
    owner,
    items,
    activated: items.every((i) => i.done),
    pendingInvitations: pending.map((p) => ({
      name: p.name,
      role: ROLE_LABELS[p.role as FirstRole],
      expiresAt: p.expiresAt,
    })),
  };
}
