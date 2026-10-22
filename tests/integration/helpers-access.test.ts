import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as helpers from "@/server/services/helpers";
import * as auth from "@/server/services/auth";
import { loadContext } from "@/server/context";
import * as s from "@/server/db/schema";

/** Founder decision 42: task-only helpers by default; collaboration only by explicit, dated invitation. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const PASSWORD = "synthetic-pass-phrase-1";
const token = (p: string) => p.replace("/invite/", "");

async function inviteHelper(taskId = "tk-2", endsAt?: string) {
  const r = await family.inviteContact(t.db, await t.as("fm-daniel"), {
    name: "Sam Neighbour",
    contact: "sam.helper@example.invalid",
    role: "helper",
    accessModel: "task",
    taskId,
    accessEndsAt: endsAt,
  });
  const a = await auth.acceptInvitation(t.db, {
    token: token(r.acceptPath),
    displayName: "Sam Neighbour",
    password: PASSWORD,
  });
  return loadContext(t.db, a.actorId, a.tenantId);
}

describe("task-only helpers", () => {
  it("see their one task and nothing else in the household", async () => {
    const sam = await inviteHelper();
    const v = await helpers.helperView(t.db, sam);
    expect(v.tasks.map((x) => x.id)).toEqual(["tk-2"]);
    expect(JSON.stringify(v)).not.toMatch(/Grace|Okafor household|vault/i);
    for (const call of [
      () => family.familyHome(t.db, sam),
      () => family.listVault(t.db, sam),
      () => family.listFamilyTasks(t.db, sam),
      () => family.listPeople(t.db, sam),
    ])
      await expect(call()).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    // The task is theirs now.
    const [task] = await t.db.select().from(s.tasks).where(eq(s.tasks.id, "tk-2"));
    expect(task!.assigneeActorId).toBe(sam.actorId);
  });

  it("lose access when the task is done", async () => {
    const sam = await inviteHelper();
    await helpers.completeHelperTask(t.db, sam, "tk-2");
    const [m] = await t.db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.actorId, sam.actorId), eq(s.memberships.roleCode, "helper")));
    expect(m).toMatchObject({ status: "ended", endReason: "task_done" });
    expect((await helpers.helperView(t.db, sam)).tasks).toEqual([]);
    await expect(helpers.completeHelperTask(t.db, sam, "tk-2")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });

  it("lose access on the stated date", async () => {
    const sam = await inviteHelper("tk-2", new Date(Date.now() + 3_600_000).toISOString());
    await t.db
      .update(s.memberships)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.memberships.actorId, sam.actorId));
    expect(
      (await helpers.helperView(t.db, await loadContext(t.db, sam.actorId, sam.tenantId))).tasks,
    ).toEqual([]);
  });

  it("need an open task the inviter can see", async () => {
    await expect(
      family.inviteContact(t.db, await t.as("fm-daniel"), {
        name: "X",
        contact: "x@example.invalid",
        role: "helper",
        accessModel: "task",
        taskId: "tk-3", // done
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await expect(
      family.inviteContact(t.db, await t.as("fm-daniel"), {
        name: "X",
        contact: "x@example.invalid",
        role: "helper",
        accessModel: "collaboration",
        taskId: "tk-2",
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("household collaboration", () => {
  it("needs a stated scope and an end date, then works like a family member until then", async () => {
    const daniel = await t.as("fm-daniel");
    const base = {
      name: "Pat Friend",
      contact: "pat@example.invalid",
      role: "family_member" as const,
      accessModel: "collaboration" as const,
    };
    await expect(
      family.inviteContact(t.db, daniel, {
        ...base,
        accessEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await expect(
      family.inviteContact(t.db, daniel, { ...base, scopeNote: "Meals rota" }),
    ).rejects.toMatchObject({ code: "INVALID" });
    const r = await family.inviteContact(t.db, daniel, {
      ...base,
      scopeNote: "Meals rota for the next month",
      accessEndsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    const a = await auth.acceptInvitation(t.db, {
      token: token(r.acceptPath),
      displayName: "Pat Friend",
      password: PASSWORD,
    });
    const pat = await loadContext(t.db, a.actorId, a.tenantId);
    await expect(family.familyHome(t.db, pat)).resolves.toBeTruthy();
    await t.db
      .update(s.memberships)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.memberships.actorId, a.actorId));
    await expect(family.familyHome(t.db, await loadContext(t.db, a.actorId, a.tenantId))).rejects.toThrow();
  });
});
