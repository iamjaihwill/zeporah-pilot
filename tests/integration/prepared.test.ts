import { afterEach, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import { catchMeUp, preparedDrafts } from "@/server/services/prepared";
import { sendStaffMessage } from "@/server/services/staff";
import { offerCover, recordAbsence } from "@/server/services/coverage";
import { createPacket } from "@/server/services/sharing";
import * as s from "@/server/db/schema";

/** The demo-safe Copilot foundation (decision 58, workstream 5; plan stories P-1 to P-3). */
let t: Awaited<ReturnType<typeof freshDb>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const lastEvent = async (action: string) =>
  (
    await t!.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, action))
      .orderBy(desc(s.auditEvents.seq))
      .limit(1)
  )[0]!;

describe("prepared drafts", () => {
  it("exist only while a demo snapshot is loaded, only for their household, always labelled", async () => {
    t = await freshDb();
    expect(await preparedDrafts(t.db, await t.as("st-maya"), "hh-okafor")).toBeNull();
    // Claiming a draft that wasn't on offer isn't recorded as prepared.
    await sendStaffMessage(t.db, await t.as("st-maya"), {
      householdId: "hh-okafor",
      body: "Hello (synthetic).",
      prepared: true,
    });
    expect((await lastEvent("message.sent")).context).not.toHaveProperty("prepared");
    await t.close();

    t = await freshDb(new Date(), "demo_midweek");
    const maya = await t.as("st-maya");
    const d = await preparedDrafts(t.db, maya, "hh-okafor");
    expect(d).toMatchObject({ label: "Prepared with Copilot · synthetic example" });
    expect(await preparedDrafts(t.db, maya, "hh-hart")).toBeNull();
    // Someone who can't open the household gets nothing.
    await expect(preparedDrafts(t.db, await t.as("st-tom"), "hh-okafor")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });

  it("records that a draft was used, with the person as the actor", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const maya = await t.as("st-maya");
    const d = (await preparedDrafts(t.db, maya, "hh-okafor"))!;
    await sendStaffMessage(t.db, maya, { householdId: "hh-okafor", body: d.message, prepared: true });
    const ev = await lastEvent("message.sent");
    expect(ev).toMatchObject({ actorId: "st-maya" });
    expect(ev.context).toMatchObject({ prepared: true, source: "staff" });

    const dana = await t.as("st-dana");
    const { id: absenceId } = await recordAbsence(t.db, dana, {
      actorId: "st-maya",
      startsAt: new Date(Date.now() + 3_600_000),
      endsAt: new Date(Date.now() + 7_200_000),
      reason: "Leave (synthetic)",
    });
    await offerCover(t.db, dana, {
      absenceId,
      householdId: "hh-okafor",
      toActorId: "st-sofia",
      note: d.handoffNote,
      prepared: true,
    });
    expect((await lastEvent("handoff.offered")).context).toMatchObject({
      prepared: true,
      actorRoles: ["hospice_ops"],
    });
  });
});

describe("prepared manifest suggestion", () => {
  it("records a packet drafted from the suggestion as prepared", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const maya = await t.as("st-maya");
    const d = (await preparedDrafts(t.db, maya, "hh-okafor"))!;
    await createPacket(t.db, maya, {
      householdId: "hh-okafor",
      purpose: "Coordinate a short respite stay",
      recipientName: "Brightwater Respite House (synthetic)",
      consentId: "cs-okafor-respite",
      authorityEvidenceId: null,
      expiresAt: new Date(Date.now() + 5 * 86_400_000),
      categories: d.manifest as never,
      prepared: true,
    });
    expect((await lastEvent("packet.drafted")).context).toMatchObject({
      prepared: true,
      categories: ["contact_details", "visit_schedule"],
    });
  });
});

describe("catch me up", () => {
  it("cites the household's own events on every line, and is recorded with its sources", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const b = await catchMeUp(t.db, await t.as("st-maya"), "hh-okafor");
    expect(b.lines.length).toBeGreaterThanOrEqual(4);
    const ids = (
      await t.db
        .select({ id: s.auditEvents.id })
        .from(s.auditEvents)
        .where(eq(s.auditEvents.householdId, "hh-okafor"))
    ).map((r) => r.id);
    for (const l of b.lines) {
      expect(l.sources.length, l.text).toBeGreaterThan(0);
      for (const x of l.sources) expect(ids, l.text).toContain(x.id);
    }
    // Never message, note or private-note text.
    const text = b.lines.map((l) => l.text).join(" ");
    expect(text).not.toMatch(/Thursday at 10 is confirmed|Mum slept better|what the respite house will need/);
    const ev = await lastEvent("summary.prepared");
    expect(ev).toMatchObject({ actorId: "st-maya", householdId: "hh-okafor" });
    expect((ev.context as { sources: string[] }).sources).toEqual(
      b.lines.flatMap((l) => l.sources.map((x) => x.id)),
    );
  });

  it("isn't available to administrators or to staff who can't open the household", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    await expect(catchMeUp(t.db, await t.as("st-lena"), "hh-okafor")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    await expect(catchMeUp(t.db, await t.as("st-tom"), "hh-okafor")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    const n = await t.db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.action, "summary.prepared")));
    expect(n).toHaveLength(0);
  });
});
