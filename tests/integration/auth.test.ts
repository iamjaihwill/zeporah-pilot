import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as auth from "@/server/services/auth";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as s from "@/server/db/schema";
import { actorForToken, createSession } from "@/server/session";
import { hashToken } from "@/server/auth/crypto";
import { loadContext } from "@/server/context";
import { verifyAuditChain } from "@/server/audit";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => {
  vi.unstubAllEnvs();
  return t.close();
});

const PASSWORD = "synthetic-pass-phrase-1";
const tokenOf = (path: string) => path.replace("/invite/", "");

async function inviteStaff(
  email = "new.guide@example.invalid",
  role: "care_guide" | "hospice_ops" = "care_guide",
) {
  // Other roles than care guide need an administrator (decision 39).
  const r = await auth.createStaffInvitation(t.db, await t.as(role === "care_guide" ? "st-dana" : "st-lena"), {
    name: "Noor Haddad",
    email,
    role,
  });
  return tokenOf(r.acceptPath);
}
async function inviteFamily(
  email = "luis@example.invalid",
  role: "family_member" | "proxy" = "family_member",
) {
  const r = await family.inviteContact(t.db, await t.as("fm-marisol"), {
    name: "Luis Rivera",
    contact: email,
    role,
  });
  return tokenOf(r.acceptPath);
}
const accept = (token: string, password = PASSWORD, displayName = "Noor Haddad") =>
  auth.acceptInvitation(t.db, { token, displayName, password });

describe("staff invitations", () => {
  it("only hospice operations can invite, and only to their own organization", async () => {
    for (const who of ["st-maya", "st-priya", "fm-marisol"])
      await expect(
        auth.createStaffInvitation(t.db, await t.as(who), {
          name: "X",
          email: "x@example.invalid",
          role: "care_guide",
        }),
      ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await inviteStaff();
    const [row] = await t.db.select().from(s.staffInvitations);
    const dana = await t.as("st-dana");
    expect(row).toMatchObject({
      tenantId: "t-willow",
      organizationId: dana.organizationId,
      status: "pending",
    });
  });

  it("stores only a hash of the link token", async () => {
    const token = await inviteStaff();
    const [row] = await t.db.select().from(s.staffInvitations);
    expect(row!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("accepting creates an account and exactly the invited membership", async () => {
    const token = await inviteStaff();
    const preview = await auth.previewInvitation(t.db, token);
    expect(preview).toMatchObject({ kind: "staff", email: "new.guide@example.invalid", hasAccount: false });
    const r = await accept(token);
    expect(r).toMatchObject({ tenantId: "t-willow", kind: "staff" });
    const ctx = await loadContext(t.db, r.actorId, r.tenantId);
    expect(ctx.staffRoles).toEqual(["care_guide"]);
    expect(ctx.organizationId).toBe((await t.as("st-dana")).organizationId);
    const [u] = await t.db.select().from(s.users).where(eq(s.users.id, r.userId));
    expect(u!.passwordHash).toMatch(/^scrypt\$/);
    expect(u!.passwordHash).not.toContain(PASSWORD);
    const [inv] = await t.db.select().from(s.staffInvitations);
    expect(inv).toMatchObject({ status: "accepted", acceptedByActorId: r.actorId });
    const audit = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "invitation.accepted"));
    expect(audit).toHaveLength(1);
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });

  it("a link works once; reuse, expiry, cancellation and unknown tokens look the same", async () => {
    const used = await inviteStaff("a@example.invalid");
    await accept(used);
    const expired = await inviteStaff("b@example.invalid");
    await t.db
      .update(s.staffInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.staffInvitations.tokenHash, hashToken(expired)));
    const cancelled = await inviteStaff("c@example.invalid");
    const list = await auth.listStaffInvitations(t.db, await t.as("st-dana"));
    expect(list.find((x) => x.email === "b@example.invalid")?.status).toBe("expired");
    await auth.cancelStaffInvitation(
      t.db,
      await t.as("st-dana"),
      list.find((x) => x.email === "c@example.invalid")!.id,
    );
    for (const token of [used, expired, cancelled, "not-a-real-token", ""]) {
      await expect(auth.previewInvitation(t.db, token)).rejects.toThrow(auth.INVITATION_UNUSABLE);
      await expect(accept(token, PASSWORD, "Someone")).rejects.toThrow(auth.INVITATION_UNUSABLE);
    }
  });

  it("two simultaneous acceptances of one link produce one account", async () => {
    const token = await inviteStaff();
    const results = await Promise.allSettled([accept(token), accept(token)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await t.db.select().from(s.users)).toHaveLength(1);
  });

  it("extra request fields can't change the role, organization or tenant", async () => {
    const token = await inviteStaff();
    const r = await auth.acceptInvitation(t.db, {
      token,
      displayName: "Noor",
      password: PASSWORD,
      // Not part of the input type; a tampered request might still send them.
      ...({ role: "hospice_ops", organizationId: "org-cedar", tenantId: "t-cedar" } as object),
    });
    const ctx = await loadContext(t.db, r.actorId, "t-willow");
    expect(ctx.staffRoles).toEqual(["care_guide"]);
    expect(r.tenantId).toBe("t-willow");
  });

  it("the database refuses a family role on a staff invitation", async () => {
    await expect(
      auth.createStaffInvitation(t.db, await t.as("st-dana"), {
        name: "X",
        email: "x@example.invalid",
        role: "coordinator" as "care_guide",
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    const dana = await t.as("st-dana");
    await expect(
      t.db.insert(s.staffInvitations).values({
        tenantId: "t-willow",
        organizationId: dana.organizationId!,
        invitedByActorId: "st-dana",
        inviteeName: "X",
        inviteeEmail: "x@example.invalid",
        roleCode: "coordinator",
        tokenHash: "h1",
        expiresAt: new Date(Date.now() + 1000),
      }),
    ).rejects.toThrow();
  });

  it("a new care guide sees no households until assigned, and never another hospice's", async () => {
    const r = await accept(await inviteStaff());
    const ctx = await loadContext(t.db, r.actorId, r.tenantId);
    await expect(staff.householdOverview(t.db, ctx, "hh-okafor")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    await expect(staff.householdOverview(t.db, ctx, "chh-moss")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    // Unassigned and nonexistent look identical.
    const a = await staff.householdOverview(t.db, ctx, "hh-okafor").catch((e: Error) => e.message);
    const b = await staff.householdOverview(t.db, ctx, "hh-does-not-exist").catch((e: Error) => e.message);
    expect(a).toBe(b);
  });

  it("an invited hospice operations member sees their own hospice only", async () => {
    const r = await accept(await inviteStaff("ops@example.invalid", "hospice_ops"));
    const ctx = await loadContext(t.db, r.actorId, r.tenantId);
    await expect(staff.householdOverview(t.db, ctx, "hh-okafor")).resolves.toBeTruthy();
    await expect(staff.householdOverview(t.db, ctx, "chh-moss")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });
});

describe("family invitations", () => {
  it("need an email, and join the inviting household in the invited role", async () => {
    await expect(
      family.inviteContact(t.db, await t.as("fm-marisol"), {
        name: "Luis",
        contact: "555-0100",
        role: "family_member",
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    const token = await inviteFamily("luis@example.invalid", "proxy");
    const preview = await auth.previewInvitation(t.db, token);
    // The household's name isn't shown before joining.
    expect(JSON.stringify(preview)).not.toContain("Rivera household");
    const r = await accept(token, PASSWORD, "Luis Rivera");
    expect(r.kind).toBe("family");
    const ctx = await loadContext(t.db, r.actorId, r.tenantId);
    expect(ctx.householdRoles).toEqual([{ householdId: "hh-rivera", roles: ["proxy"] }]);
    // Family boundaries: their own household only, and no staff area.
    await expect(family.familyHome(t.db, ctx)).resolves.toBeTruthy();
    await expect(staff.householdOverview(t.db, ctx, "hh-rivera")).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
  });

  it("the database refuses staff roles and token-without-email on household invitations", async () => {
    await expect(
      t.db.insert(s.invitations).values({
        tenantId: "t-willow",
        householdId: "hh-rivera",
        invitedByActorId: "fm-marisol",
        inviteeName: "X",
        inviteeContact: "x@example.invalid",
        inviteeEmail: "x@example.invalid",
        roleCode: "hospice_ops",
        tokenHash: "h2",
        expiresAt: new Date(Date.now() + 1000),
      }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(s.invitations).values({
        tenantId: "t-willow",
        householdId: "hh-rivera",
        invitedByActorId: "fm-marisol",
        inviteeName: "X",
        inviteeContact: "x",
        roleCode: "family_member",
        tokenHash: "h3",
        expiresAt: new Date(Date.now() + 1000),
      }),
    ).rejects.toThrow();
  });

  it("an existing account links only with its own password, and only one household per account", async () => {
    const first = await accept(await inviteFamily("luis@example.invalid"), PASSWORD, "Luis Rivera");
    // A second invitation for the same email, to the same household: wrong password refused.
    const again = await inviteFamily("luis@example.invalid");
    expect((await auth.previewInvitation(t.db, again)).hasAccount).toBe(true);
    await expect(accept(again, "wrong-password-xyz")).rejects.toThrow(auth.SIGN_IN_FAILED);
    // Right password: links the same account; nothing duplicated.
    const linked = await accept(again);
    expect(linked.actorId).toBe(first.actorId);
    // An invitation to another household is refused for this pilot.
    const other = await family.inviteContact(t.db, await t.as("fm-daniel"), {
      name: "Luis",
      contact: "luis@example.invalid",
      role: "family_member",
    });
    await expect(accept(tokenOf(other.acceptPath))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a family account can't accept a staff invitation for the same email", async () => {
    await accept(await inviteFamily("shared@example.invalid"), PASSWORD, "Luis");
    await expect(accept(await inviteStaff("shared@example.invalid"))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("password sign-in", () => {
  it("signs in and gives the same message for unknown email and wrong password", async () => {
    await accept(await inviteStaff("noor@example.invalid"));
    await expect(
      auth.signInWithPassword(t.db, { email: " NOOR@example.invalid ", password: PASSWORD }),
    ).resolves.toMatchObject({
      kind: "staff",
    });
    const wrong = await auth
      .signInWithPassword(t.db, { email: "noor@example.invalid", password: "nope-nope-nope" })
      .catch((e: Error) => e.message);
    const unknown = await auth
      .signInWithPassword(t.db, { email: "nobody@example.invalid", password: PASSWORD })
      .catch((e: Error) => e.message);
    expect(wrong).toBe(auth.SIGN_IN_FAILED);
    expect(unknown).toBe(auth.SIGN_IN_FAILED);
  });

  it("locks after repeated failures, without saying so, then unlocks", async () => {
    await accept(await inviteStaff("noor@example.invalid"));
    for (let i = 0; i < auth.LOCK_AFTER_FAILURES; i++)
      await expect(
        auth.signInWithPassword(t.db, { email: "noor@example.invalid", password: "bad-password-123" }),
      ).rejects.toThrow(auth.SIGN_IN_FAILED);
    // Even the right password is refused, with the same message.
    await expect(
      auth.signInWithPassword(t.db, { email: "noor@example.invalid", password: PASSWORD }),
    ).rejects.toThrow(auth.SIGN_IN_FAILED);
    await t.db.update(s.users).set({ lockedUntil: new Date(Date.now() - 1000) });
    await expect(
      auth.signInWithPassword(t.db, { email: "noor@example.invalid", password: PASSWORD }),
    ).resolves.toBeTruthy();
    const locked = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "auth.locked"));
    expect(locked).toHaveLength(1);
  }, 60_000);

  it("rejects short passwords when creating an account", async () => {
    await expect(accept(await inviteStaff(), "short")).rejects.toMatchObject({ code: "INVALID" });
    expect(await t.db.select().from(s.users)).toHaveLength(0);
  });
});

describe("sessions", () => {
  it("store only a hash of the cookie token", async () => {
    const token = await createSession(t.db, {
      tenantId: "t-willow",
      actorId: "st-maya",
      userId: null,
      method: "development_persona",
    });
    const rows = await t.db.select().from(s.sessions);
    expect(rows.map((r) => r.id)).toEqual([hashToken(token)]);
  });

  it("development persona sessions work only behind the development gate", async () => {
    const token = await createSession(t.db, {
      tenantId: "t-willow",
      actorId: "st-maya",
      userId: null,
      method: "development_persona",
    });
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect((await actorForToken(t.db, token))?.actorId).toBe("st-maya");
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "");
    expect(await actorForToken(t.db, token)).toBeNull();
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(await actorForToken(t.db, token)).toBeNull();
  });

  it("password sessions work without the gate and must match their account", async () => {
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "");
    const r = await accept(await inviteStaff());
    const token = await createSession(t.db, { ...r, method: "password" });
    expect((await actorForToken(t.db, token))?.actorId).toBe(r.actorId);
    expect(await actorForToken(t.db, "not-a-token")).toBeNull();
    // A password session pointing at someone else's actor is refused (by the database or on read).
    await expect(
      createSession(t.db, { tenantId: "t-willow", actorId: "st-dana", userId: null, method: "password" }),
    ).rejects.toThrow();
    await t.db.execute(sql`update sessions set actor_id = 'st-dana' where id = ${hashToken(token)}`);
    expect(await actorForToken(t.db, token)).toBeNull();
  });

  it("an expired session is refused", async () => {
    const r = await accept(await inviteStaff());
    const token = await createSession(t.db, { ...r, method: "password" });
    await t.db
      .update(s.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(s.sessions.id, hashToken(token))));
    expect(await actorForToken(t.db, token)).toBeNull();
  });
});

describe("restricted named-grantor access is unchanged", () => {
  it("Chidi still reaches only consents naming him", async () => {
    const chidi = await t.as("fm-chidi");
    await expect(family.listHouseholdConsents(t.db, chidi)).rejects.toThrow();
    await expect(family.consentsForMe(t.db, chidi)).resolves.toBeDefined();
  });
});

describe("separate care-team and family sign-in pages", () => {
  it("each page takes only its own kind of account, after a correct password", async () => {
    await accept(await inviteStaff("guide@example.invalid"));
    await accept(await inviteFamily("luis@example.invalid"), PASSWORD, "Luis Rivera");
    await expect(
      auth.signInWithPassword(t.db, { email: "guide@example.invalid", password: PASSWORD, audience: "family" }),
    ).rejects.toThrow(auth.STAFF_ON_FAMILY_PAGE);
    await expect(
      auth.signInWithPassword(t.db, { email: "luis@example.invalid", password: PASSWORD, audience: "staff" }),
    ).rejects.toThrow(auth.FAMILY_ON_STAFF_PAGE);
    expect((await auth.signInWithPassword(t.db, { email: "guide@example.invalid", password: PASSWORD, audience: "staff" })).kind).toBe("staff");
    expect((await auth.signInWithPassword(t.db, { email: "luis@example.invalid", password: PASSWORD, audience: "family" })).kind).toBe("family");
    // A wrong password gets the usual message on either page: the page says nothing about the account.
    await expect(
      auth.signInWithPassword(t.db, { email: "guide@example.invalid", password: "wrong-password-123", audience: "family" }),
    ).rejects.toThrow(auth.SIGN_IN_FAILED);
  });
});
