import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as bereavement from "@/server/services/bereavement";
import * as auth from "@/server/services/auth";
import * as s from "@/server/db/schema";

/** Interaction review 2026-10-13: family-app behaviour (items 4–13). */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const auditOf = (action: string) => t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, action));

describe("item 4: undo and reopen", () => {
  it("a task marked done can be reopened by the same people, and it's recorded", async () => {
    const daniel = await t.as("fm-daniel");
    await family.completeFamilyTask(t.db, daniel, "tk-2"); // Chidi's, marked for him
    // Another family member can't reopen it.
    await expect(family.reopenFamilyTask(t.db, await t.as("fm-ada"), "tk-2")).rejects.toThrow();
    await family.reopenFamilyTask(t.db, daniel, "tk-2");
    const [row] = await t.db.select().from(s.tasks).where(eq(s.tasks.id, "tk-2"));
    expect(row).toMatchObject({ status: "open", completedAt: null, completedByActorId: null });
    expect(await auditOf("task.reopened")).toHaveLength(1);
    await expect(family.reopenFamilyTask(t.db, daniel, "tk-2")).rejects.toThrow(/already open/);
  });

  it("the Done list says who and when, not a repeat of the title", async () => {
    const list = await family.listFamilyTasks(t.db, await t.as("fm-daniel"));
    const done = list.find((x) => x.status === "done")!;
    expect(done.done).toMatchObject({ by: "Daniel Okafor", for: null });
    expect(done.done!.at).toBeInstanceOf(Date);
  });

  it("undoing a vault review restores exactly what was there, only for the reviewer, only briefly", async () => {
    const daniel = await t.as("fm-daniel");
    const item = (await family.listVault(t.db, daniel)).items.find((i) => i.sensitivity !== "protected")!;
    const before = { status: item.status, keptWhere: item.keptWhere, reviewedByActorId: item.reviewedByActorId };
    await family.reviewVaultItem(t.db, daniel, { id: item.id, status: "not_applicable", keptWhere: "Hall" });
    await expect(family.undoVaultReview(t.db, await t.as("fm-ada"), item.id)).rejects.toThrow(/can't be undone/);
    await expect(
      family.undoVaultReview(t.db, daniel, item.id, new Date(Date.now() + family.UNDO_WINDOW_MS + 1000)),
    ).rejects.toThrow(/can't be undone/);
    await family.undoVaultReview(t.db, daniel, item.id);
    const [after] = await t.db.select().from(s.vaultItems).where(eq(s.vaultItems.id, item.id));
    expect({ status: after!.status, keptWhere: after!.keptWhere, reviewedByActorId: after!.reviewedByActorId }).toEqual(
      before,
    );
    expect(await auditOf("vault.review_undone")).toHaveLength(1);
  });

  it("an acknowledgement can be undone only within the window", async () => {
    const ada = await t.as("fm-ada");
    const update = (await family.getThread(t.db, ada)).entries.find(
      (e) => e.type === "update" && e.requiresAck && !e.ackedByMe,
    )!;
    await family.acknowledgeUpdate(t.db, ada, update.id);
    await expect(
      family.undoAcknowledgeUpdate(t.db, ada, update.id, new Date(Date.now() + family.UNDO_WINDOW_MS + 1000)),
    ).rejects.toThrow();
    await family.undoAcknowledgeUpdate(t.db, ada, update.id);
    const again = (await family.getThread(t.db, ada)).entries.find((e) => e.id === update.id);
    expect(again && "ackedByMe" in again && again.ackedByMe).toBe(false);
  });
});

describe("item 6: support requests", () => {
  it("records the topic and who asked, and checks before a quick duplicate", async () => {
    const daniel = await t.as("fm-daniel");
    const input = { category: "A break for the main caregiver", message: "", contactTime: "" };
    await family.requestHumanSupport(t.db, daniel, input);
    await expect(family.requestHumanSupport(t.db, daniel, input)).rejects.toThrow(family.DUPLICATE_MESSAGE);
    await family.requestHumanSupport(t.db, daniel, { ...input, sendAgain: true });
    const mine = (await family.getSupport(t.db, daniel)).requests.filter((r) => r.topic === input.category);
    expect(mine).toHaveLength(2);
    // Someone else's request isn't in Daniel's "Your requests".
    await family.requestHumanSupport(t.db, await t.as("fm-ada"), { ...input, category: "Talking with a social worker" });
    expect((await family.getSupport(t.db, daniel)).requests.some((r) => r.topic === "Talking with a social worker")).toBe(
      false,
    );
  });

  it("'Ask about this' names the update and goes to the care team; another household's update is refused", async () => {
    const chidi = await t.as("fm-chidi");
    const update = (await family.getThread(t.db, chidi)).entries.find((e) => e.type === "update")!;
    await family.requestHumanSupport(t.db, chidi, {
      category: "",
      message: "What does this mean for Thursday?",
      contactTime: "",
      aboutUpdateId: update.id,
    });
    const [e] = await t.db
      .select()
      .from(s.escalations)
      .where(and(eq(s.escalations.raisedByActorId, "fm-chidi"), eq(s.escalations.sourceId, update.id)));
    expect(e).toMatchObject({ topic: family.ABOUT_UPDATE_TOPIC, kind: "family_request", householdId: "hh-okafor" });
    await expect(
      family.requestHumanSupport(t.db, await t.as("fm-marisol"), {
        category: "",
        message: "",
        contactTime: "",
        aboutUpdateId: update.id,
      }),
    ).rejects.toThrow(/isn't available/);
  });

  it("'one smaller step' uses the viewer's own open tasks", async () => {
    expect((await family.getSupport(t.db, await t.as("fm-chidi"))).smallestTask?.id).toBe("tk-2");
    expect((await family.getSupport(t.db, await t.as("fm-ada"))).smallestTask).toBeNull();
  });
});

describe("item 7: invitation links", () => {
  it("a new link replaces the old one at once, and it's recorded", async () => {
    const daniel = await t.as("fm-daniel");
    const first = await family.inviteContact(t.db, daniel, {
      name: "Test Cousin",
      contact: "test.cousin@example.invalid",
      role: "family_member",
    });
    const [inv] = await t.db.select().from(s.invitations).where(eq(s.invitations.inviteeEmail, "test.cousin@example.invalid"));
    const second = await family.reissueInvitation(t.db, daniel, inv!.id);
    await expect(auth.previewInvitation(t.db, first.acceptPath.replace("/invite/", ""))).rejects.toThrow();
    await expect(auth.previewInvitation(t.db, second.acceptPath.replace("/invite/", ""))).resolves.toBeTruthy();
    expect(await auditOf("invitation.reissued")).toHaveLength(1);
    // Someone who can't invite can't replace or revoke links.
    await expect(family.reissueInvitation(t.db, await t.as("fm-chidi"), inv!.id)).rejects.toThrow();
    await expect(family.cancelInvitation(t.db, await t.as("fm-chidi"), inv!.id)).rejects.toThrow();
    await family.cancelInvitation(t.db, daniel, inv!.id);
    await expect(auth.previewInvitation(t.db, second.acceptPath.replace("/invite/", ""))).rejects.toThrow();
    await expect(family.reissueInvitation(t.db, daniel, inv!.id)).rejects.toThrow(/already been used or revoked/);
  });
});

describe("item 8: what the home page offers matches what the person can do", () => {
  it("Chidi can request a correction on the consents that name him, but not confirm or withdraw", async () => {
    const h = await family.familyHome(t.db, await t.as("fm-chidi"));
    expect(h.namedConsents.can).toEqual({ confirm: false, correct: true, withdraw: false, askToWithdraw: false });
  });
});

describe("item 9: new replies", () => {
  it("a care-team reply shows on the family home until the thread is opened", async () => {
    const daniel = await t.as("fm-daniel");
    await family.markThreadSeen(t.db, daniel);
    expect((await family.familyHome(t.db, daniel)).newReply).toBeNull();
    await staff.sendStaffMessage(t.db, await t.as("st-maya"), { householdId: "hh-okafor", body: "See you Friday." });
    const h = await family.familyHome(t.db, daniel);
    expect(h.newReply?.author).toBe("Maya Chen");
    const [n] = await t.db
      .select()
      .from(s.notifications)
      .where(and(eq(s.notifications.recipientActorId, "fm-daniel"), eq(s.notifications.kind, "message")))
      .orderBy(s.notifications.createdAt);
    expect(n).toBeTruthy();
    await family.markThreadSeen(t.db, daniel);
    expect((await family.familyHome(t.db, daniel)).newReply).toBeNull();
  });

  it("notification links open the exact message", async () => {
    await staff.sendStaffMessage(t.db, await t.as("st-maya"), { householdId: "hh-okafor", body: "Hello." });
    const [m] = await t.db
      .select()
      .from(s.messages)
      .where(eq(s.messages.body, "Hello."));
    const notes = await t.db.select().from(s.notifications).where(eq(s.notifications.recipientActorId, "fm-daniel"));
    expect(notes.some((x) => x.link === `/family/messages#entry-${m!.id}`)).toBe(true);
  });
});

describe("item 13: bereavement contact pause", () => {
  it("is saved for the household, visible to staff, and limited to coordinators and proxies", async () => {
    const ingrid = await t.as("fm-ingrid");
    await family.setContactPause(t.db, ingrid, true);
    expect((await family.getBereavement(t.db, ingrid)).contactPaused).toBe(true);
    const plan = await bereavement.staffPlan(t.db, await t.as("st-dana"), "hh-lindqvist");
    expect(plan?.contactPause?.by).toBe("Ingrid Lindqvist");
    await family.setContactPause(t.db, ingrid, false);
    expect((await bereavement.staffPlan(t.db, await t.as("st-dana"), "hh-lindqvist"))?.contactPause).toBeNull();
    expect(await auditOf("support_preferences.contact_paused")).toHaveLength(1);
    // A family member (no bereavement.confirm_contact) can't set it.
    await expect(family.setContactPause(t.db, await t.as("fm-chidi"), true)).rejects.toThrow();
  });

  it("planned check-ins carry an approximate date", async () => {
    const plan = (await family.getBereavement(t.db, await t.as("fm-ingrid"))).plan!;
    for (const st of plan.steps) expect(st.when).toMatch(/^(early|mid|late) [A-Z][a-z]{2}$/);
  });
});
