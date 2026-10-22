import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { auditExport, auditReview } from "@/server/services/audit-review";
import * as staff from "@/server/services/staff";
import * as auth from "@/server/services/auth";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

describe("audit review", () => {
  it("is for operations and reviewers, not care guides or families", async () => {
    for (const who of ["st-maya", "st-tom", "fm-daniel"])
      await expect(auditReview(t.db, await t.as(who), {})).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });

  it("shows operations both household and organization-level events, within its own hospice", async () => {
    // A refused request (organization-level: not tied to a household).
    await staff.householdOverview(t.db, await t.as("st-maya"), "hh-nguyen").catch(() => null);
    // An organization-level change (not tied to a household).
    await auth.createStaffInvitation(t.db, await t.as("st-dana"), {
      name: "Noor",
      email: "noor@example.invalid",
      role: "care_guide",
    });
    const r = await auditReview(t.db, await t.as("st-dana"), { days: 90 });
    expect(r.integrity.ok).toBe(true);
    expect(r.events.some((e) => e.action === "access.denied")).toBe(true);
    expect(r.events.some((e) => e.action === "invitation.created")).toBe(true);
    expect(r.events.some((e) => e.household === "The Okafor household")).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/Moss|Cedar Valley/);
  });

  it("shows reviewers household events only", async () => {
    await staff.householdOverview(t.db, await t.as("st-maya"), "hh-nguyen").catch(() => null);
    const r = await auditReview(t.db, await t.as("st-priya"), { days: 90 });
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events.every((e) => e.household !== null)).toBe(true);
    expect(r.events.some((e) => e.action === "access.denied")).toBe(false);
  });

  it("filters by kind, household and period", async () => {
    const dana = await t.as("st-dana");
    const people = await auditReview(t.db, dana, { category: "people", days: 90 });
    expect(people.events.length).toBeGreaterThan(0);
    expect(people.events.every((e) => e.category === "people")).toBe(true);
    expect(people.events.some((e) => e.action === "assignment.created")).toBe(true);
    const okafor = await auditReview(t.db, dana, { householdId: "hh-okafor", days: 90 });
    expect(okafor.events.every((e) => e.household === "The Okafor household")).toBe(true);
    // The seed event is 90 days old: outside a 30-day period.
    expect(
      (await auditReview(t.db, dana, { days: 30 })).events.some((e) => e.action === "system.seeded"),
    ).toBe(false);
    // A household outside the person's scope is refused, not silently empty.
    await expect(auditReview(t.db, dana, { householdId: "chh-moss" })).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });
});

describe("periods and date ranges (Audit review, 2026-10-21)", () => {
  it("covers a calendar range, tells events their subject, and keeps exports to 90 days", async () => {
    const dana = await t.as("st-dana");
    const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const today = new Date();
    const r = await auditReview(t.db, dana, {
      from: day(new Date(today.getTime() - 3 * 86_400_000)),
      to: day(today),
    });
    expect(r.range).not.toBeNull();
    expect(r.events.length).toBeGreaterThan(0);
    for (const e of r.events) expect(e.at.getTime()).toBeGreaterThan(today.getTime() - 5 * 86_400_000);
    expect(r.events.some((e) => e.subjectType && e.householdId)).toBe(true);
    // A year shows on screen, but exports stay within 90 days (decision 28).
    expect((await auditReview(t.db, dana, { days: 365 })).days).toBe(365);
    await expect(auditExport(t.db, dana, { days: 365 })).rejects.toMatchObject({ code: "INVALID" });
    await expect(
      auditExport(t.db, dana, { from: day(new Date(today.getTime() - 200 * 86_400_000)), to: day(today) }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await expect(auditReview(t.db, dana, { from: "2026-10-10", to: "2026-10-01" })).rejects.toMatchObject({
      code: "INVALID",
    });
  });
});
