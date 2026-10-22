import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import { familyCan, familyScope, protectedAccess, staffScope } from "@/server/context";
import { householdOverview } from "@/server/services/staff";
import { householdAccessMap } from "@/server/services/access-map";
import { logPartnerEvent } from "@/server/services/record";
import * as s from "@/server/db/schema";

/** Coordination Record v2 (decision 58; plan stories R-1 to R-5). */
let t: Awaited<ReturnType<typeof freshDb>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe("timeline and context column", () => {
  it("shows each event's role at the time and source, and what a partner said", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const o = await householdOverview(t.db, await t.as("st-maya"), "hh-okafor");
    const bed = o.audit.find((e) => e.action === "partner_event.logged" && e.partner?.said.includes("bed"));
    expect(bed).toMatchObject({ source: "partner_simulated", role: "Care guide", roleRecorded: true });
    expect(bed!.summary).not.toContain("bed");
    expect(o.audit.find((e) => e.prepared)).toBeTruthy();
    // Context: who's involved and how, outside access, the EHR pointer, open items.
    const ada = o.context.participants.find((p) => p.name === "Ada Okafor");
    expect(ada?.authority.length).toBeGreaterThan(0);
    const brightwater = o.context.organizations.find((x) => x.name.startsWith("Brightwater"));
    expect(brightwater?.access.map((a) => a.purpose)).toContain("Coordinate a short respite stay");
    expect(o.record?.ehrReference).toBe("000-SYN-4411");
    expect(o.context.openItems.every((r) => r.link)).toBe(true);
    expect(o.context.canLogPartnerEvent).toBe(true);
  });
});

describe("who can see what", () => {
  it("matches what the app actually allows each household member", async () => {
    t = await freshDb();
    const map = await householdAccessMap(t.db, await t.as("st-maya"), "hh-okafor");
    const members = map.rows.filter((r) => r.group === "household");
    expect(members.length).toBeGreaterThanOrEqual(4);
    for (const r of members) {
      const ctx = await t.as(r.key);
      expect(r.cells.updates.level === "yes", `${r.who}: updates`).toBe(
        await familyCan(t.db, ctx, "updates.view"),
      );
      expect(r.cells.messages.level === "yes", `${r.who}: messages`).toBe(
        await familyCan(t.db, ctx, "thread.view"),
      );
      expect(r.cells.sharing.level === "yes", `${r.who}: sharing`).toBe(
        await familyCan(t.db, ctx, "consent.view"),
      );
      const scope = await familyScope(t.db, ctx, "household.view");
      expect(r.cells.protected.level !== "no", `${r.who}: protected`).toBe(
        await protectedAccess(t.db, ctx, scope),
      );
      expect(r.cells.notes.level).toBe("no");
    }
    const grace = members.find((r) => r.who === "Grace Okafor")!;
    expect(grace.cells.private.text).toBe("Their own");
    expect(members.filter((r) => r.who !== "Grace Okafor").every((r) => r.cells.private.level === "no")).toBe(
      true,
    );
  });

  it("administrators get No everywhere, and can't open the map or the household", async () => {
    t = await freshDb();
    const map = await householdAccessMap(t.db, await t.as("st-dana"), "hh-okafor");
    const admin = map.rows.find((r) => r.key === "role:hospice_admin")!;
    expect(Object.values(admin.cells).every((c) => c.level === "no")).toBe(true);
    await expect(householdAccessMap(t.db, await t.as("st-lena"), "hh-okafor")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    await expect(
      staffScope(t.db, await t.as("st-lena"), "hh-okafor", "staff.household.view"),
    ).rejects.toBeTruthy();
  });

  it("shows cover as Temporary until its exact end, and drops it once it ends (decision 59)", async () => {
    t = await freshDb();
    const until = new Date(Date.now() + 2 * 3_600_000);
    await t.db.insert(s.memberships).values({
      id: "mb-test-cover",
      tenantId: "t-willow",
      actorId: "st-sofia",
      householdId: "hh-okafor",
      roleCode: "care_guide",
      expiresAt: until,
      coverForActorId: "st-maya",
      grantReason: "Synthetic cover.",
    });
    const map = await householdAccessMap(t.db, await t.as("st-dana"), "hh-okafor");
    const sofia = map.rows.find((r) => r.key === "mb-test-cover")!;
    expect(sofia).toMatchObject({ temporary: true, basis: "Care guide, covering for Maya Chen" });
    expect(sofia.until!.getTime()).toBe(until.getTime());
    await staffScope(t.db, await t.as("st-sofia"), "hh-okafor", "staff.household.view");
    // The end time passes: no row, and no access.
    await t.db
      .update(s.memberships)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.memberships.id, "mb-test-cover"));
    const after = await householdAccessMap(t.db, await t.as("st-dana"), "hh-okafor");
    expect(after.rows.find((r) => r.key === "mb-test-cover")).toBeUndefined();
    await expect(
      staffScope(t.db, await t.as("st-sofia"), "hh-okafor", "staff.household.view"),
    ).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });

  it("lists outside recipients with what they can read and until when", async () => {
    t = await freshDb();
    const map = await householdAccessMap(t.db, await t.as("st-maya"), "hh-okafor");
    expect(map.outside).toEqual([
      expect.objectContaining({
        who: "Rosa Lin",
        purpose: "Share contact details for respite intake",
        includes: ["Household contact details"],
      }),
    ]);
  });
});

describe("logging a partner event (decision 60)", () => {
  const input = (householdId: string, extra: Partial<Parameters<typeof logPartnerEvent>[2]> = {}) => ({
    householdId,
    organization: "Brightwater Respite House (synthetic)",
    kind: "status" as const,
    said: "A bed is available on Tuesday (synthetic).",
    occurredAt: new Date(Date.now() - 60_000),
    ...extra,
  });

  it("assigned care guides and operations can; others can't", async () => {
    t = await freshDb();
    const { id } = await logPartnerEvent(t.db, await t.as("st-maya"), input("hh-okafor"));
    const [row] = await t.db.select().from(s.partnerEvents).where(eq(s.partnerEvents.id, id));
    expect(row).toMatchObject({ simulated: true, source: "staff_entered", enteredByActorId: "st-maya" });
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.action, "partner_event.logged"), eq(s.auditEvents.subjectId, id)));
    expect(ev?.context).toMatchObject({
      source: "partner_simulated",
      simulated: true,
      actorRoles: ["care_guide"],
    });
    expect(ev?.summary).not.toContain("bed");
    await logPartnerEvent(t.db, await t.as("st-dana"), input("hh-nguyen"));
    await expect(logPartnerEvent(t.db, await t.as("st-maya"), input("hh-nguyen"))).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    await expect(logPartnerEvent(t.db, await t.as("st-priya"), input("hh-okafor"))).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
    await expect(logPartnerEvent(t.db, await t.as("st-lena"), input("hh-okafor"))).rejects.toBeTruthy();
  });

  it("refuses empty or overlong text, the future, and anything older than 30 days", async () => {
    t = await freshDb();
    const maya = await t.as("st-maya");
    for (const bad of [
      { said: "  " },
      { said: "x".repeat(281) },
      { organization: "" },
      { occurredAt: new Date(Date.now() + 3_600_000) },
      { occurredAt: new Date(Date.now() - 31 * 86_400_000) },
    ])
      await expect(logPartnerEvent(t.db, maya, input("hh-okafor", bad))).rejects.toMatchObject({
        code: "INVALID",
      });
  });
});
