import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as sharing from "@/server/services/sharing";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";

/**
 * Repeated and simultaneous requests (double taps, retries, two people at once) must never apply
 * an action twice. Each consequential write only happens if the record is still in the state that
 * was checked; the others get a plain "already done" refusal and write nothing.
 */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const day = (n: number) => new Date(Date.now() + n * 86_400_000);
const at10 = <T>(f: () => Promise<T>) => Promise.allSettled(Array.from({ length: 10 }, f));
const ok = (r: PromiseSettledResult<unknown>[]) => r.filter((x) => x.status === "fulfilled").length;
const events = async (subjectId: string, action: string) =>
  (
    await t.db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.subjectId, subjectId), eq(s.auditEvents.action, action)))
  ).length;
const chainOk = async () => expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);

async function confirmedConsent() {
  const { id } = await sharing.recordConsent(t.db, await t.as("st-maya"), {
    householdId: "hh-okafor",
    grantedByActorId: "fm-grace",
    purpose: "Arrange companion visits",
    recipientName: "Lakeside Companion Care (synthetic)",
    scope: ["contact_details"],
    startsAt: day(-1),
    expiresAt: day(20),
    revocationPath: "Withdraw any time in Zeporah under Sharing.",
  });
  return id;
}

describe("a released packet is never released twice", () => {
  it("stays released through repeated requests, one after another", async () => {
    const dana = await t.as("st-dana");
    const codes = [];
    for (let i = 0; i < 3; i++)
      codes.push((await sharing.requestRelease(t.db, dana, "pk-okafor-respite")).reasonCode);
    expect(codes).toEqual(["RELEASE_ALLOWED", "PACKET_NOT_RELEASABLE", "PACKET_NOT_RELEASABLE"]);
    const [p] = await t.db.select().from(s.packets).where(eq(s.packets.id, "pk-okafor-respite"));
    expect(p!.state).toBe("released");
    expect(
      await t.db
        .select()
        .from(s.packetReleaseReceipts)
        .where(eq(s.packetReleaseReceipts.packetId, "pk-okafor-respite")),
    ).toHaveLength(1);
  });

  it("releases once when 25 requests arrive together", async () => {
    const dana = await t.as("st-dana");
    await Promise.allSettled(
      Array.from({ length: 25 }, () => sharing.requestRelease(t.db, dana, "pk-okafor-respite")),
    );
    expect(
      await t.db
        .select()
        .from(s.packetReleaseReceipts)
        .where(eq(s.packetReleaseReceipts.packetId, "pk-okafor-respite")),
    ).toHaveLength(1);
    expect(await events("pk-okafor-respite", "packet.released")).toBe(1);
    await chainOk();
  });
});

describe("simultaneous consent actions apply once", () => {
  it("confirmation: one stored, the rest told it's already done", async () => {
    const id = await confirmedConsent();
    const grace = await t.as("fm-grace");
    const r = await at10(() => family.confirmConsent(t.db, grace, { consentId: id, version: 1 }));
    expect(ok(r)).toBe(1);
    expect(
      r
        .filter((x) => x.status === "rejected")
        .every((x) => /already confirmed/.test(String((x as PromiseRejectedResult).reason))),
    ).toBe(true);
    expect(await events(id, "consent.confirmed")).toBe(1);
  });

  it("activation", async () => {
    const id = await confirmedConsent();
    await family.confirmConsent(t.db, await t.as("fm-grace"), { consentId: id, version: 1 });
    const priya = await t.as("st-priya");
    expect(ok(await at10(() => sharing.activateConsent(t.db, priya, id)))).toBe(1);
    expect(await events(id, "consent.activated")).toBe(1);
    await chainOk();
  });

  it("household withdrawal and staff withdrawal", async () => {
    const grace = await t.as("fm-grace");
    const priya = await t.as("st-priya");
    const r = await Promise.allSettled([
      ...Array.from({ length: 5 }, () => family.withdrawConsent(t.db, grace, "cs-okafor-respite")),
      ...Array.from({ length: 5 }, () =>
        sharing.revokeConsentOnRequest(t.db, priya, {
          consentId: "cs-okafor-respite",
          reason: "Asked by phone (synthetic).",
        }),
      ),
    ]);
    expect(ok(r)).toBe(1);
    expect(await events("cs-okafor-respite", "consent.revoked")).toBe(1);
    await chainOk();
  });
});

describe("other consequential actions apply once", () => {
  it("packet revocation", async () => {
    const dana = await t.as("st-dana");
    expect(
      ok(
        await at10(() =>
          sharing.revokePacket(t.db, dana, { packetId: "pk-lindqvist-circle", reason: "Asked (synthetic)." }),
        ),
      ),
    ).toBe(1);
    expect(await events("pk-lindqvist-circle", "packet.revoked")).toBe(1);
  });

  it("taking and resolving an escalation", async () => {
    // An open escalation nobody has taken yet (Bennett is already owned by Priya in the seed).
    const priya = await t.as("st-priya");
    const dana = await t.as("st-dana");
    const take = await Promise.allSettled([
      staff.updateEscalation(t.db, priya, { id: "es-rivera-identity", action: "take" }),
      staff.updateEscalation(t.db, dana, { id: "es-rivera-identity", action: "take" }),
    ]);
    expect(ok(take)).toBe(1);
    expect(
      ok(
        await at10(() =>
          staff.updateEscalation(t.db, priya, {
            id: "es-rivera-identity",
            action: "resolve",
            resolution: "Reviewed (synthetic).",
          }),
        ),
      ),
    ).toBe(1);
    expect(await events("es-rivera-identity", "escalation.resolved")).toBe(1);
  });

  it("bereavement confirmation", async () => {
    await staff.proposeBereavement(t.db, await t.as("st-maya"), {
      householdId: "hh-okafor",
      survivingContactActorId: "fm-daniel",
      note: "",
    });
    const [tr] = await t.db
      .select()
      .from(s.bereavementTransitions)
      .where(
        and(
          eq(s.bereavementTransitions.householdId, "hh-okafor"),
          eq(s.bereavementTransitions.state, "proposed"),
        ),
      );
    const dana = await t.as("st-dana");
    expect(ok(await at10(() => staff.confirmBereavement(t.db, dana, tr!.id)))).toBe(1);
    const confirmed = (
      await t.db
        .select()
        .from(s.auditEvents)
        .where(eq(s.auditEvents.action, "lifecycle.bereavement_confirmed"))
    ).filter((e) => e.householdId === "hh-okafor");
    expect(confirmed).toHaveLength(1);
    await chainOk();
  });
});
