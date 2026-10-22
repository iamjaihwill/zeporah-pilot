import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb } from "./helpers";
import * as sharing from "@/server/services/sharing";
import * as recipient from "@/server/services/recipient";
import * as staff from "@/server/services/staff";

/** The Packets review (2026-10-21): what the list tells staff, and who may start a draft. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "1");
  vi.stubEnv("NODE_ENV", "development");
  t = await freshDb();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

const row = async (id: string) =>
  (await sharing.listPackets(t.db, await t.as("st-dana"))).find((p) => p.id === id)!;

describe("packet list", () => {
  it("lists what each packet carries, and flags drafts ending within a week", async () => {
    const p = await row("pk-okafor-respite");
    expect(p.manifest).toEqual(expect.arrayContaining(["Household contact details", "Visit schedule"]));
    const list = await sharing.listPackets(t.db, await t.as("st-dana"));
    for (const x of list) {
      const days = (new Date(x.expiresAt).getTime() - Date.now()) / 86_400_000;
      if (x.endsSoon) expect(days).toBeLessThanOrEqual(7);
      if (x.state === "released" || x.expired) expect(x.endsSoon).toBe(false);
    }
  });

  it("shows staff what the named recipient has done, step by step", async () => {
    expect((await row("pk-okafor-respite")).recipient).toBeNull();
    await sharing.requestRelease(t.db, await t.as("st-dana"), "pk-okafor-respite");
    expect((await row("pk-okafor-respite")).recipient).toBe("Not opened yet");
    const rosa = await t.as("rc-rosa");
    await recipient.recipientPacket(t.db, rosa, "pk-okafor-respite");
    expect((await row("pk-okafor-respite")).recipient).toBe("Opened");
    await recipient.acknowledgePacket(t.db, rosa, "pk-okafor-respite");
    expect((await row("pk-okafor-respite")).recipient).toBe("Acknowledged");
    await recipient.requestClarification(t.db, rosa, {
      packetId: "pk-okafor-respite",
      question: "Which entrance should the family use? (synthetic)",
    });
    expect((await row("pk-okafor-respite")).recipient).toBe("Asked a question");
  });

  it("offers the draft picker only for households the person may draft for", async () => {
    expect((await staff.packetDraftHouseholds(t.db, await t.as("st-maya"))).length).toBeGreaterThan(0);
    expect(await staff.packetDraftHouseholds(t.db, await t.as("st-priya"))).toEqual([]);
  });
});
