import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as admin from "@/server/services/household-admin";
import * as auth from "@/server/services/auth";
import * as family from "@/server/services/family";
import * as notifications from "@/server/services/notifications";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const PASSWORD = "synthetic-pass-phrase-1";
async function invite(role: "family_member" | "proxy" = "family_member") {
  const r = await family.inviteContact(t.db, await t.as("fm-marisol"), {
    name: "Luis Rivera",
    contact: "luis@example.invalid",
    role,
  });
  return r.acceptPath.replace("/invite/", "");
}
async function luis() {
  const r = await auth.acceptInvitation(t.db, {
    token: await invite(),
    displayName: "Luis Rivera",
    password: PASSWORD,
  });
  return r.actorId;
}
const events = (action: string) => t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, action));

describe("changing a member's role", () => {
  it("a coordinator moves someone between family member and proxy", async () => {
    const id = await luis();
    await admin.changeMemberRole(t.db, await t.as("fm-marisol"), { actorId: id, role: "proxy" });
    expect((await t.as(id)).householdRoles).toEqual([{ householdId: "hh-rivera", roles: ["proxy"] }]);
    expect(await events("household.member_role_changed")).toHaveLength(1);
    const notes = await notifications.listNotifications(t.db, await t.as(id));
    expect(notes.map((n) => n.title)).toContain("Your role in your household changed");
    await expect(
      admin.changeMemberRole(t.db, await t.as("fm-marisol"), { actorId: id, role: "proxy" }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("removing a member", () => {
  it("ends their access, unassigns their tasks, and tells them and the care guide", async () => {
    const id = await luis();
    const [task] = await t.db
      .insert(s.tasks)
      .values({
        tenantId: "t-willow",
        householdId: "hh-rivera",
        title: "Pick up the pharmacy order (synthetic)",
        audience: "family",
        assigneeActorId: id,
        ownerActorId: "fm-marisol",
        whenLabel: "This week",
        source: "family",
      })
      .returning();
    await admin.removeMember(t.db, await t.as("fm-marisol"), { actorId: id });
    const ctx = await t.as(id);
    expect(ctx.householdRoles).toEqual([]);
    await expect(family.familyHome(t.db, ctx)).rejects.toThrow();
    const [after] = await t.db.select().from(s.tasks).where(eq(s.tasks.id, task!.id));
    expect(after!.assigneeActorId).toBeNull();
    expect((await notifications.listNotifications(t.db, ctx)).map((n) => n.title)).toContain(
      "Your access to a household changed",
    );
    const maya = await notifications.listNotifications(t.db, await t.as("st-maya"));
    expect(maya.map((n) => n.title)).toContain("A household member's access changed");
    const removed = await events("household.member_removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.summary).not.toMatch(/reason/i);
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
    // The account remains: they can be invited back and link it with their password.
    const back = await auth.acceptInvitation(t.db, {
      token: await invite(),
      displayName: "",
      password: PASSWORD,
    });
    expect(back.actorId).toBe(id);
    expect((await t.as(id)).householdRoles).toEqual([{ householdId: "hh-rivera", roles: ["family_member"] }]);
  });
});

describe("guards", () => {
  it("only roles that can invite may manage, and only others' family-member or proxy roles", async () => {
    for (const who of ["fm-ada", "fm-chidi", "st-maya", "st-dana"])
      await expect(admin.removeMember(t.db, await t.as(who), { actorId: "fm-chidi" })).rejects.toMatchObject({
        code: "NOT_PERMITTED",
      });
    const daniel = await t.as("fm-daniel");
    await expect(admin.removeMember(t.db, daniel, { actorId: "fm-daniel" })).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(admin.removeMember(t.db, daniel, { actorId: "fm-grace" })).rejects.toMatchObject({
      code: "INVALID",
    });
    // Someone in another household looks the same as no one.
    await expect(admin.removeMember(t.db, daniel, { actorId: "fm-marisol" })).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });

  it("refuses while the person is named on a live consent or linked to an authority record", async () => {
    const daniel = await t.as("fm-daniel");
    await expect(admin.removeMember(t.db, daniel, { actorId: "fm-chidi" })).rejects.toThrow(
      /as the person giving consent/,
    );
    await expect(
      admin.changeMemberRole(t.db, daniel, { actorId: "fm-ada", role: "family_member" }),
    ).rejects.toThrow(/authority record|as the person giving consent/);
    const people = await family.listPeople(t.db, daniel);
    const byId = new Map(people.members.map((m) => [m.actorId, m.manage]));
    expect(byId.get("fm-chidi")?.blocker).toMatch(/as the person giving consent/);
    expect(byId.get("fm-ada")?.blocker).toBeTruthy();
    expect(byId.get("fm-grace")).toBeNull();
    expect(byId.get("fm-daniel")).toBeNull();
    // Nothing changed.
    const chidi = await t.db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.actorId, "fm-chidi"), eq(s.memberships.status, "active")));
    expect(chidi).toHaveLength(1);
  });
});
