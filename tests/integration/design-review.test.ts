import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as sharing from "@/server/services/sharing";
import * as reports from "@/server/services/reports";
import * as s from "@/server/db/schema";

/** Behaviour added for the full-product design review (2026-10-13). */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => {
  vi.unstubAllEnvs();
  return t.close();
});

describe("one escalation count everywhere", () => {
  it("the operations dashboard and Reports count open escalations the same way", async () => {
    const dana = await t.as("st-dana");
    const home = await staff.staffHome(t.db, dana);
    const report = await reports.operationsReport(t.db, dana);
    expect(home.counts.escalations).toBe(report.escalations.open);
    // Consent-correction escalations are counted as corrections, not twice.
    expect(report.corrections).toBeGreaterThan(0);
  });

  it("the dashboard shows the top five and the total", async () => {
    const home = await staff.staffHome(t.db, await t.as("st-dana"));
    expect(home.queue.length).toBeLessThanOrEqual(5);
    expect(home.queueTotal).toBeGreaterThanOrEqual(home.queue.length);
  });
});

describe("queue rows", () => {
  it("know whose they are, and offer taking ownership only where it's the next step", async () => {
    const maya = await staff.coordinationQueue(t.db, await t.as("st-maya"));
    expect(maya.some((r) => r.mine)).toBe(true);
    const open = maya.filter((r) => r.kind === "escalation" && r.ownerIds.length === 0);
    for (const r of open) expect(r.takeEscalationId).toBeTruthy();
    const taken = maya.filter((r) => r.kind === "escalation" && r.ownerIds.length > 0);
    for (const r of taken) expect(r.takeEscalationId).toBeNull();
    // Priority reasons no longer repeat the State column.
    for (const r of maya.filter((x) => x.kind === "escalation"))
      expect(r.state.toLowerCase()).not.toContain(r.priorityReason.toLowerCase());
  });
});

describe("policy scenarios is a testing tool", () => {
  it("is refused to care guides and reviewers outside development, and allowed for operations", async () => {
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "");
    for (const who of ["st-maya", "st-priya"])
      await expect(sharing.policyScenarios(t.db, await t.as(who))).rejects.toMatchObject({
        code: "NOT_PERMITTED",
      });
    await expect(sharing.policyScenarios(t.db, await t.as("st-dana"))).resolves.toBeTruthy();
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "1");
    vi.stubEnv("NODE_ENV", "development");
    await expect(sharing.policyScenarios(t.db, await t.as("st-maya"))).resolves.toBeTruthy();
  });
});

describe("family sharing", () => {
  it("puts what needs you first and shows old → new for a change", async () => {
    const list = await family.listHouseholdConsents(t.db, await t.as("fm-ada"));
    expect(list[0]!.id).toBe("cs-okafor-equipment");
    expect(list[0]!.canConfirm).toBe(true);
    const change = list[0]!.changes.find((c) => c.field === "expiry")!;
    expect(change.kind).toBe("date");
    expect(change.from).toBeTruthy();
    expect(new Date(change.to!).getTime()).toBeGreaterThan(new Date(change.from!).getTime());
  });

  it("explains withdrawal by what each person can actually do", async () => {
    const guidance = async (who: string) =>
      (await family.listHouseholdConsents(t.db, await t.as(who))).find((c) => c.id === "cs-okafor-respite")
        ?.withdrawGuidance;
    expect(await guidance("fm-grace")).toMatch(/You can withdraw this at any time/);
    expect(await guidance("fm-daniel")).toMatch(/Ask the care team to withdraw this/);
    const chidi = await family.consentsForMe(t.db, await t.as("fm-chidi"));
    expect(chidi.find((c) => c.id === "cs-okafor-library")?.withdrawGuidance).toMatch(/ask your care guide/);
    // The free text staff typed is never shown as instructions any more.
    expect(JSON.stringify(chidi)).not.toMatch(
      /withdrawGuidance":"Withdraw any time in Zeporah under Sharing/,
    );
  });

  it("records the previous value whenever staff change a consent", async () => {
    const maya = await t.as("st-maya");
    const [c] = await t.db.select().from(s.consents).where(eq(s.consents.id, "cs-okafor-respite"));
    await sharing.amendConsent(t.db, maya, {
      consentId: c!.id,
      purpose: "Arrange a short respite stay (synthetic)",
      recipientName: c!.recipientName,
      scope: c!.scope as never,
      startsAt: c!.startsAt,
      expiresAt: c!.expiresAt,
      revocationPath: c!.revocationPath,
    });
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "consent.amended"))
      .then((r) => r.filter((e) => e.subjectId === c!.id));
    expect((ev!.context as { previous: Record<string, string> }).previous.purpose).toBe(c!.purpose);
    expect(ev!.summary).toMatch(/changed: why it's shared/);
    expect(ev!.summary).not.toMatch(/version|\(purpose\)/i);
  });
});

describe("staff see how a family member asked to be reached", () => {
  it("only on that household's overview, for people who can see it", async () => {
    await t.db
      .update(s.preferences)
      .set({ contactMethod: "phone" })
      .where(eq(s.preferences.actorId, "fm-daniel"));
    const o = await staff.householdOverview(t.db, await t.as("st-maya"), "hh-okafor");
    expect(o.members.find((m) => m.actorId === "fm-daniel")?.contactPreference).toBe("Phone call");
    await expect(staff.householdOverview(t.db, await t.as("st-tom"), "hh-okafor")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });
});

describe("packets list", () => {
  it("marks expired packets and lists them last; released ones carry their release date", async () => {
    const list = await sharing.listPackets(t.db, await t.as("st-dana"));
    const firstExpired = list.findIndex((p) => p.expired);
    expect(firstExpired).toBeGreaterThan(-1);
    expect(list.slice(firstExpired).every((p) => p.expired)).toBe(true);
    const released = list.filter((p) => p.state === "released");
    expect(released.length).toBeGreaterThan(0);
    for (const p of released) expect(p.releasedAt).toBeInstanceOf(Date);
  });
});
