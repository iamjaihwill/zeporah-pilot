import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as sharing from "@/server/services/sharing";
import * as recipient from "@/server/services/recipient";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import { loadContext } from "@/server/context";
import * as s from "@/server/db/schema";
import { RELEASE_NOTE, RELEASE_NOTE_RECIPIENT } from "@/domain/claims";

/** Founder decision 45: a released packet's named recipient reads it in Zeporah, read-only. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  // The development mail sink (decision 18: the only email channel) is on only with the dev gate.
  vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "1");
  vi.stubEnv("NODE_ENV", "development");
  t = await freshDb();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

const rosa = () => t.as("rc-rosa");
const release = async () => sharing.requestRelease(t.db, await t.as("st-dana"), "pk-okafor-respite");

describe("before release", () => {
  it("the recipient sees nothing of an unreleased packet", async () => {
    // The seed releases a separate intake packet to Rosa; the respite packet is still a draft.
    const ids = (await recipient.recipientPackets(t.db, await rosa())).packets.map((p) => p.id);
    expect(ids).toEqual(["pk-okafor-intake"]);
    await expect(recipient.recipientPacket(t.db, await rosa(), "pk-okafor-respite")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });
});

describe("after release", () => {
  it("shows sender, recipient, purpose, materials, access period, status and history", async () => {
    const r = await release();
    expect(r.decision).toBe("allow");
    const v = await recipient.recipientPacket(t.db, await rosa(), "pk-okafor-respite");
    expect(v.sender.organization).toBe("Willow Creek Hospice (synthetic)");
    expect(v.recipient).toMatchObject({
      name: "Rosa Lin",
      organization: "Brightwater Respite House (synthetic)",
    });
    expect(v.purpose).toBe("Coordinate a short respite stay");
    expect(v.status).toBe("active");
    expect(v.materials!.length).toBeGreaterThan(0);
    // Only what the manifest lists.
    expect(v.materials!.map((m) => m.label)).toEqual(v.manifest);
    expect(v.history.map((h) => h.action)).toEqual(["viewed"]);
    // A second look within ten minutes isn't logged twice.
    await recipient.recipientPacket(t.db, await rosa(), "pk-okafor-respite");
    expect((await t.db.select().from(s.packetAccessLog)).length).toBe(1);
    // Decision 48c: the recipient was alerted, so the release says so; without an alert it doesn't.
    const p = await sharing.getPacket(t.db, await t.as("st-dana"), "pk-okafor-respite");
    expect(p.releaseNote).toBe(RELEASE_NOTE_RECIPIENT);
    expect(p.releaseNote).not.toBe(RELEASE_NOTE);
  });

  it("the alert email carries a link and fixed wording only", async () => {
    await release();
    const mail = await t.db.select().from(s.devMailbox).where(eq(s.devMailbox.kind, "recipient_alert"));
    expect(mail).toHaveLength(1);
    expect(mail[0]!.toEmail).toBe("rosa.lin@brightwater.example.invalid");
    expect(`${mail[0]!.subject} ${mail[0]!.body}`).not.toMatch(/Okafor|Grace|respite|Brightwater|Ada/i);
    expect(mail[0]!.link).toMatch(/^\/recipient(\/setup\/[\w-]+)?$/);
  });

  it("acknowledge and ask a question; both reach the care team and the record", async () => {
    await release();
    await recipient.acknowledgePacket(t.db, await rosa(), "pk-okafor-respite");
    await recipient.requestClarification(t.db, await rosa(), {
      packetId: "pk-okafor-respite",
      question: "Which entrance should the family use on arrival? (synthetic)",
    });
    const [e] = await t.db.select().from(s.escalations).where(eq(s.escalations.kind, "packet_clarification"));
    expect(e).toMatchObject({ householdId: "hh-okafor", status: "open" });
    const p = await sharing.getPacket(t.db, await t.as("st-dana"), "pk-okafor-respite");
    expect(p.recipientAccess[0]!.history.map((h) => h.action).sort()).toEqual([
      "acknowledged",
      "clarification_requested",
    ]);
  });

  it("ends at once when the release is revoked, and materials are no longer shown", async () => {
    await release();
    await sharing.revokePacket(t.db, await t.as("st-dana"), {
      packetId: "pk-okafor-respite",
      reason: "Plans changed (synthetic).",
    });
    const v = await recipient.recipientPacket(t.db, await rosa(), "pk-okafor-respite");
    expect(v.status).toBe("revoked");
    expect(v.materials).toBeNull();
    await expect(recipient.acknowledgePacket(t.db, await rosa(), "pk-okafor-respite")).rejects.toMatchObject({
      code: "INVALID",
    });
  });

  it("ends at the expiry", async () => {
    await release();
    await t.db.update(s.packetRecipientAccess).set({ expiresAt: new Date(Date.now() - 1000) });
    const v = await recipient.recipientPacket(t.db, await rosa(), "pk-okafor-respite");
    expect(v.status).toBe("expired");
    expect(v.materials).toBeNull();
  });
});

describe("recipients are bound to their own packets", () => {
  it("can't use family, staff or other packets", async () => {
    await release();
    const ctx = await rosa();
    await expect(family.familyHome(t.db, ctx)).rejects.toThrow();
    await expect(staff.coordinationQueue(t.db, ctx)).rejects.toThrow();
    await expect(recipient.recipientPacket(t.db, ctx, "pk-bennett-equipment")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    // And nobody else can use the recipient view.
    await expect(recipient.recipientPackets(t.db, await t.as("fm-daniel"))).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
  });

  it("a first-time recipient sets a password from a one-time link", async () => {
    await t.db
      .update(s.packets)
      .set({ recipientContactName: "Noor Intake", recipientEmail: "noor@brightwater.example.invalid" })
      .where(eq(s.packets.id, "pk-okafor-respite"));
    await release();
    const [mail] = await t.db
      .select()
      .from(s.devMailbox)
      .where(eq(s.devMailbox.toEmail, "noor@brightwater.example.invalid"));
    const token = mail!.link.replace("/recipient/setup/", "");
    expect((await recipient.previewRecipientSetup(t.db, token)).name).toBe("Noor Intake");
    const r = await recipient.completeRecipientSetup(t.db, { token, password: "synthetic-pass-phrase-1" });
    const ctx = await loadContext(t.db, r.actorId, r.tenantId);
    expect((await recipient.recipientPackets(t.db, ctx)).packets).toHaveLength(1);
    await expect(
      recipient.completeRecipientSetup(t.db, { token, password: "synthetic-pass-phrase-1" }),
    ).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });

  it("only draft-capable staff set the contact, before release", async () => {
    await expect(
      sharing.setPacketRecipientContact(t.db, await t.as("st-priya"), {
        packetId: "pk-okafor-respite",
        name: "X",
        email: "x@example.invalid",
      }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await release();
    await expect(
      sharing.setPacketRecipientContact(t.db, await t.as("st-dana"), {
        packetId: "pk-okafor-respite",
        name: "X",
        email: "x@example.invalid",
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});
