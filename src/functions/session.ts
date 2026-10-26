/**
 * Sign-in, sign-out and invitations. Password sign-in and invitations always work; the persona
 * picker and the synthetic-data reset are development-only and need ZEPORAH_DEV_SIGN_IN=1
 * (see src/server/auth/dev-gate.ts). See docs/authentication-and-access.md.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";

/** Whether this server offers the development-only shortcuts. */
export const getAuthOptions = createServerFn({ method: "GET" }).handler(async () => {
  const { devSignInEnabled } = await import("@/server/auth/dev-gate");
  const { emailAvailable } = await import("@/server/mail");
  // Password reset by email (decision 27) needs a mail channel.
  return { devSignIn: devSignInEnabled(), passwordReset: emailAvailable() };
});

/** DEVELOPMENT ONLY: synthetic personas for the sign-in screen. Empty unless the gate is on. */
export const listPersonas = createServerFn({ method: "GET" }).handler(async () => {
  const { devSignInEnabled } = await import("@/server/auth/dev-gate");
  if (!devSignInEnabled()) return [];
  const { getDb } = await import("@/server/db/client");
  const { actors, memberships, tenants } = await import("@/server/db/schema");
  const { PERSONAS } = await import("@/fixtures/synthetic");
  const { ROLE_LABELS } = await import("@/domain/model");
  const db = await getDb();
  const rows = await db
    .select()
    .from(actors)
    .where(
      inArray(
        actors.id,
        PERSONAS.map((p) => p.actorId),
      ),
    );
  const tn = await db.select().from(tenants);
  // Each persona's current role, shown as a tag (household role for family, staff role for staff).
  const roleRows = await db
    .select({ actorId: memberships.actorId, role: memberships.roleCode, household: memberships.householdId })
    .from(memberships)
    .where(
      and(
        inArray(
          memberships.actorId,
          PERSONAS.map((p) => p.actorId),
        ),
        eq(memberships.status, "active"),
      ),
    );
  const roleOf = (actorId: string, kind: string) => {
    const mine = roleRows.filter(
      (r) => r.actorId === actorId && (kind === "family" ? r.household : !r.household),
    );
    return [...new Set(mine.map((r) => ROLE_LABELS[r.role as keyof typeof ROLE_LABELS] ?? r.role))];
  };
  return PERSONAS.flatMap((p) => {
    const a = rows.find((r) => r.id === p.actorId && r.tenantId === p.tenantId);
    return a
      ? [
          {
            actorId: a.id,
            tenantId: a.tenantId,
            name: a.displayName,
            kind: a.kind,
            tenant: tn.find((t) => t.id === a.tenantId)?.name ?? "",
            roles: roleOf(a.id, a.kind),
            blurb: p.blurb,
          },
        ]
      : [];
  });
});

export const whoAmI = createServerFn({ method: "GET" }).handler(async () => {
  const { currentActor } = await import("@/server/session");
  const { ROLE_LABELS } = await import("@/domain/model");
  const { tenants } = await import("@/server/db/schema");
  const a = await currentActor();
  if (!a) return null;
  const [t] = await a.db.select().from(tenants).where(eq(tenants.id, a.ctx.tenantId));
  const roles = a.ctx.kind === "staff" ? a.ctx.staffRoles : (a.ctx.householdRoles[0]?.roles ?? []);
  return {
    actorId: a.ctx.actorId,
    name: a.ctx.displayName,
    kind: a.ctx.kind,
    tenantName: t?.name ?? "",
    roles: roles.map((r) => ROLE_LABELS[r]),
    roleCodes: [...roles] as string[],
  };
});

/** DEVELOPMENT ONLY: sign in as a synthetic persona. Refused unless the gate is on. */
export const signIn = createServerFn({ method: "POST" })
  .validator(z.object({ actorId: z.string().min(1), tenantId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { startDevPersonaSession } = await import("@/server/session");
    const actor = await startDevPersonaSession(data.actorId, data.tenantId);
    return { kind: actor.kind };
  });

type AuthResult =
  | { ok: true; kind: "family" | "staff" | "recipient" }
  /** `goTo`: the right sign-in page, when the account belongs on the other one. */
  | { ok: false; message: string; goTo?: "/" | "/staff-sign-in" };

export const signInWithPassword = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email: z.string().max(254),
      password: z.string().max(200),
      audience: z.enum(["family", "staff"]).optional(),
      remember: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<AuthResult> => {
    const { getDb } = await import("@/server/db/client");
    const { startSession } = await import("@/server/session");
    const auth = await import("@/server/services/auth");
    const { AccessError } = await import("@/server/context");
    try {
      const r = await auth.signInWithPassword(await getDb(), data);
      // Decision 53: "Remember me" is for the family sign-in only, never for care-team accounts.
      const remember = !!data.remember && data.audience === "family" && r.kind !== "staff";
      await startSession({
        tenantId: r.tenantId,
        actorId: r.actorId,
        userId: r.userId,
        method: "password",
        remember,
      });
      return { ok: true, kind: r.kind };
    } catch (e) {
      if (e instanceof AccessError) {
        const goTo =
          e.message === auth.STAFF_ON_FAMILY_PAGE
            ? ("/staff-sign-in" as const)
            : e.message === auth.FAMILY_ON_STAFF_PAGE
              ? ("/" as const)
              : undefined;
        return { ok: false, message: e.message, ...(goTo ? { goTo } : {}) };
      }
      return { ok: false, message: auth.SIGN_IN_FAILED };
    }
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { endSession } = await import("@/server/session");
  await endSession();
  return true;
});

/** What an invitation page may show before acceptance, or a single generic refusal. */
export const getInvitation = createServerFn({ method: "GET" })
  .validator(z.object({ token: z.string().max(200) }))
  .handler(async ({ data }) => {
    const { getDb } = await import("@/server/db/client");
    const auth = await import("@/server/services/auth");
    try {
      return { ok: true as const, invitation: await auth.previewInvitation(await getDb(), data.token) };
    } catch {
      return { ok: false as const, message: auth.INVITATION_UNUSABLE };
    }
  });

/** Only the token, a display name and a password are accepted; everything else comes from the invitation. */
export const acceptInvitation = createServerFn({ method: "POST" })
  .validator(
    z.object({ token: z.string().max(200), displayName: z.string().max(120), password: z.string().max(200) }),
  )
  .handler(async ({ data }): Promise<AuthResult> => {
    const { getDb } = await import("@/server/db/client");
    const { startSession } = await import("@/server/session");
    const auth = await import("@/server/services/auth");
    const { AccessError } = await import("@/server/context");
    try {
      const r = await auth.acceptInvitation(await getDb(), data);
      await startSession({ tenantId: r.tenantId, actorId: r.actorId, userId: r.userId, method: "password" });
      return { ok: true, kind: r.kind };
    } catch (e) {
      if (e instanceof AccessError) return { ok: false, message: e.message };
      return { ok: false, message: "That didn't go through. Please try again — nothing was changed." };
    }
  });

/** DEVELOPMENT ONLY: wipe and reseed the local synthetic database. Refused unless the gate is on. */
export const resetSyntheticData = createServerFn({ method: "POST" })
  .validator(
    z
      .object({ snapshot: z.enum(["standard", "demo_midweek", "demo_endweek"]).default("standard") })
      .default({ snapshot: "standard" }),
  )
  .handler(async ({ data }) => {
    const { devSignInEnabled } = await import("@/server/auth/dev-gate");
    if (!devSignInEnabled()) throw new Error("Not available.");
    const { rm } = await import("node:fs/promises");
    const { closeSharedDb, DATA_DIR, getDb } = await import("@/server/db/client");
    const { seed } = await import("@/server/db/seed");
    const { endSession } = await import("@/server/session");
    await closeSharedDb();
    await rm(DATA_DIR, { recursive: true, force: true });
    // The Okafor demo week (decision 58) only when asked for; otherwise the standard seed.
    await seed(await getDb(), new Date(), data.snapshot);
    await endSession();
    return true;
  });

/** What everyone should know about this server right now (no sign-in needed; nothing sensitive). */
export const getSystemNotice = createServerFn({ method: "GET" }).handler(async () => {
  const { environment } = await import("@/server/environment");
  return { readOnly: environment().readOnly };
});

/** The app and care addresses (domain/addresses.ts), or null. Public: they're the site's own addresses. */
export const getAddresses = createServerFn({ method: "GET" }).handler(async () => {
  const { addresses } = await import("@/server/environment");
  const a = addresses();
  return a ? { app: a.app.origin, care: a.care.origin } : null;
});

/* ------------------------------------------------------------------ password reset (decision 27) */

type ResetResult = { ok: true; message?: string } | { ok: false; message: string };

async function resetGuard() {
  const { environment, READ_ONLY_MESSAGE } = await import("@/server/environment");
  return environment().readOnly ? READ_ONLY_MESSAGE : null;
}

/** Always the same answer, whether or not an email went out. */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().max(254) }))
  .handler(async ({ data }): Promise<ResetResult> => {
    const blocked = await resetGuard();
    if (blocked) return { ok: false, message: blocked };
    const { getDb } = await import("@/server/db/client");
    const reset = await import("@/server/services/password-reset");
    const { AccessError } = await import("@/server/context");
    try {
      return { ok: true, message: (await reset.requestPasswordReset(await getDb(), data)).message };
    } catch (e) {
      if (e instanceof AccessError) return { ok: false, message: e.message };
      return { ok: true, message: reset.RESET_REQUESTED };
    }
  });

export const checkResetLink = createServerFn({ method: "GET" })
  .validator(z.object({ token: z.string().max(200) }))
  .handler(async ({ data }): Promise<ResetResult> => {
    const { getDb } = await import("@/server/db/client");
    const reset = await import("@/server/services/password-reset");
    try {
      return await reset.checkResetLink(await getDb(), data.token);
    } catch {
      return { ok: false, message: reset.RESET_UNUSABLE };
    }
  });

export const completePasswordReset = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().max(200), password: z.string().max(200) }))
  .handler(async ({ data }): Promise<ResetResult> => {
    const blocked = await resetGuard();
    if (blocked) return { ok: false, message: blocked };
    const { getDb } = await import("@/server/db/client");
    const reset = await import("@/server/services/password-reset");
    const { AccessError } = await import("@/server/context");
    try {
      return await reset.completePasswordReset(await getDb(), data);
    } catch (e) {
      if (e instanceof AccessError) return { ok: false, message: e.message };
      return { ok: false, message: "That didn't go through. Please try again — nothing was changed." };
    }
  });
