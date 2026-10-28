import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import { createOnce, SENT_DIFFERENTLY } from "@/server/services/send-once";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";
import { newSubmissionId, submissionId } from "@/domain/submission";

/**
 * Sending again after a lost reply (brief reconciliation increment 3): the same submission ID from
 * the same person stores one copy, writes one audit event and notifies once.
 */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const count = async (table: typeof s.messages | typeof s.escalations | typeof s.notifications) =>
  (await t.db.select().from(table)).length;
const sentEvents = async (action: string) =>
  (await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, action))).length;

describe("family messages", () => {
  it("stores one message, one audit event and one set of notifications for a resend", async () => {
    const daniel = await t.as("fm-daniel");
    const id = newSubmissionId();
    const [m0, a0, n0] = [
      await count(s.messages),
      await sentEvents("message.sent"),
      await count(s.notifications),
    ];
    const first = await family.sendFamilyMessage(t.db, daniel, "Can we move Thursday's visit?", id);
    const notifiedOnce = await count(s.notifications);
    expect(notifiedOnce).toBeGreaterThan(n0);
    const again = await family.sendFamilyMessage(t.db, daniel, "Can we move Thursday's visit?", id);
    expect(first.replayed).toBe(false);
    expect(again).toEqual({ id: first.id, sentAt: first.sentAt, replayed: true });
    expect(await count(s.messages)).toBe(m0 + 1);
    expect(await sentEvents("message.sent")).toBe(a0 + 1);
    expect(await count(s.notifications)).toBe(notifiedOnce);
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });

  it("refuses different words under an ID already used, and stores nothing more", async () => {
    const daniel = await t.as("fm-daniel");
    const id = newSubmissionId();
    await family.sendFamilyMessage(t.db, daniel, "First words", id);
    const before = await count(s.messages);
    await expect(family.sendFamilyMessage(t.db, daniel, "Other words", id)).rejects.toMatchObject({
      code: "CONFLICT",
      message: SENT_DIFFERENTLY,
    });
    expect(await count(s.messages)).toBe(before);
  });

  it("sends each new ID, and each send without an ID, as its own message", async () => {
    const daniel = await t.as("fm-daniel");
    const before = await count(s.messages);
    await family.sendFamilyMessage(t.db, daniel, "Same words", newSubmissionId());
    await family.sendFamilyMessage(t.db, daniel, "Same words", newSubmissionId());
    await family.sendFamilyMessage(t.db, daniel, "Same words");
    expect(await count(s.messages)).toBe(before + 3);
  });

  it("keeps one person's ID from matching another person's message", async () => {
    const id = newSubmissionId();
    await family.sendFamilyMessage(t.db, await t.as("fm-daniel"), "From Daniel", id);
    const before = await count(s.messages);
    const ada = await family.sendFamilyMessage(t.db, await t.as("fm-ada"), "From Ada", id);
    expect(ada.replayed).toBe(false);
    expect(await count(s.messages)).toBe(before + 1);
  });

  it("stores one copy when the same send arrives several times at once", async () => {
    const daniel = await t.as("fm-daniel");
    const id = newSubmissionId();
    const before = await count(s.messages);
    const all = await Promise.all(
      Array.from({ length: 5 }, () => family.sendFamilyMessage(t.db, daniel, "Racing", id)),
    );
    expect(new Set(all.map((r) => r.id)).size).toBe(1);
    expect(all.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await count(s.messages)).toBe(before + 1);
  });
});

describe("staff messages", () => {
  it("stores one reply for a resend", async () => {
    const maya = await t.as("st-maya");
    const id = newSubmissionId();
    const before = await count(s.messages);
    const first = await staff.sendStaffMessage(t.db, maya, {
      householdId: "hh-okafor",
      body: "On my way.",
      submissionId: id,
    });
    const again = await staff.sendStaffMessage(t.db, maya, {
      householdId: "hh-okafor",
      body: "On my way.",
      submissionId: id,
    });
    expect(again).toMatchObject({ id: first.id, replayed: true });
    expect(await count(s.messages)).toBe(before + 1);
  });

  it("doesn't let the same ID land in a different household", async () => {
    const maya = await t.as("st-maya");
    const id = newSubmissionId();
    await staff.sendStaffMessage(t.db, maya, { householdId: "hh-okafor", body: "Hello", submissionId: id });
    await expect(
      staff.sendStaffMessage(t.db, maya, { householdId: "hh-bennett", body: "Hello", submissionId: id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("family requests for a person to follow up", () => {
  const input = (submissionId?: string) => ({
    category: "Practical help at home",
    message: "Could someone call about equipment?",
    contactTime: "",
    ...(submissionId ? { submissionId } : {}),
  });

  it("treats a resend as the first request, not as a duplicate to ask about", async () => {
    const daniel = await t.as("fm-daniel");
    const id = newSubmissionId();
    const before = await count(s.escalations);
    const first = await family.requestHumanSupport(t.db, daniel, input(id));
    const again = await family.requestHumanSupport(t.db, daniel, input(id));
    expect(again).toMatchObject({ id: first.id, replayed: true });
    expect(await count(s.escalations)).toBe(before + 1);
  });

  it("still asks before a deliberate second request, and sends it on 'send again' with a new ID", async () => {
    const daniel = await t.as("fm-daniel");
    await family.requestHumanSupport(t.db, daniel, input(newSubmissionId()));
    await expect(family.requestHumanSupport(t.db, daniel, input(newSubmissionId()))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const before = await count(s.escalations);
    await family.requestHumanSupport(t.db, daniel, { ...input(newSubmissionId()), sendAgain: true });
    expect(await count(s.escalations)).toBe(before + 1);
  });
});

describe("the database's own guard", () => {
  it("refuses a second row with the same person and ID, written directly", async () => {
    const daniel = await t.as("fm-daniel");
    const id = newSubmissionId();
    await family.sendFamilyMessage(t.db, daniel, "Once", id);
    const [m] = await t.db
      .select()
      .from(s.messages)
      .where(and(eq(s.messages.authorActorId, "fm-daniel"), eq(s.messages.submissionId, id)));
    const { id: _id, createdAt: _at, ...copy } = m!;
    await expect(t.db.insert(s.messages).values(copy)).rejects.toThrow();
  });
});

describe("createOnce", () => {
  it("answers with the first copy when a racing copy wins between the check and the insert", async () => {
    let stored: { id: string; body: string } | undefined;
    const r = await createOnce(
      "a-race-between-two-sends",
      async () => stored,
      (p) => p.body === "hi",
      async () => {
        stored = { id: "first", body: "hi" }; // the other request got there first
        throw Object.assign(new Error("duplicate key"), { cause: { code: "23505" } });
      },
    );
    expect(r).toEqual({ row: { id: "first", body: "hi" }, replayed: true });
  });

  it("passes other failures through", async () => {
    await expect(
      createOnce(
        "another-submission-id",
        async () => undefined,
        () => true,
        async () => {
          throw new Error("disk full");
        },
      ),
    ).rejects.toThrow("disk full");
  });

  it("accepts only well-formed IDs", () => {
    expect(submissionId.safeParse(newSubmissionId()).success).toBe(true);
    for (const bad of ["", "short", "has spaces in it, too many", "x".repeat(65), "drop table;--abcdefgh"])
      expect(submissionId.safeParse(bad).success).toBe(false);
  });
});
