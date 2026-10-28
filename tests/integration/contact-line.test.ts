import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as line from "@/server/services/contact-line";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import { systemStatus } from "@/server/services/system";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";
import { isWellFormedLine } from "@/domain/contact-line";

/** A verified 24-hour line (founder decision 72), with synthetic numbers only. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const NEW = "(555) 555-0142, press 1 for the nurse line";
const called = { reached: true, note: "Nurse line answered (synthetic)." };
const familySees = async () => (await family.familyHome(t.db, await t.as("fm-daniel"))).hotline;
const propose = async (who = "st-lena", input: { line: string; backupLine?: string } = { line: NEW }) =>
  line.proposeLine(t.db, await t.as(who), input);

describe("the format check", () => {
  it("accepts US numbers with an optional extension or note, and refuses anything else", () => {
    for (const ok of ["(555) 555-0142", "555-555-0142", "1-555-555-0142 ext. 12", "+1 555.555.0142", NEW])
      expect(isWellFormedLine(ok), ok).toBe(true);
    for (const bad of ["", "555-0142", "call the office", "555-555-01422", "x".repeat(81)])
      expect(isWellFormedLine(bad), bad).toBe(false);
  });
});

describe("changing the line (two people)", () => {
  it("keeps families on the confirmed line until someone else calls and confirms the new one", async () => {
    const before = await familySees();
    await propose();
    expect(await familySees()).toBe(before);
    // The proposer can't confirm their own change.
    const mine = await line.myLineStatus(t.db, await t.as("st-lena"));
    expect(mine.canConfirmPending).toBe(false);
    await expect(
      line.confirmLine(t.db, await t.as("st-lena"), { changeId: mine.pending!.id, ...called }),
    ).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
    await line.confirmLine(t.db, await t.as("st-dana"), { changeId: mine.pending!.id, ...called });
    expect(await familySees()).toBe(NEW);
    expect((await staff.householdOverview(t.db, await t.as("st-maya"), "hh-okafor")).hotline).toBe(NEW);
    const after = await line.myLineStatus(t.db, await t.as("st-dana"));
    expect(after).toMatchObject({
      line: NEW,
      pending: null,
      due: false,
      lastConfirmed: { by: "Dana Brooks" },
    });
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });

  it("refuses a change confirmed by its own proposer even when written directly", async () => {
    const { id } = await propose();
    await expect(
      t.db
        .update(s.contactLineChanges)
        .set({
          status: "confirmed",
          confirmedByActorId: "st-lena",
          confirmedAt: new Date(),
          confirmationNote: "x",
        })
        .where(eq(s.contactLineChanges.id, id)),
    ).rejects.toThrow();
  });

  it("lets only administrators propose, and only operations or administrators confirm", async () => {
    await expect(propose("st-dana")).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    const { id } = await propose();
    for (const who of ["st-maya", "st-priya"])
      await expect(
        line.confirmLine(t.db, await t.as(who), { changeId: id, ...called }),
      ).rejects.toMatchObject({
        code: "NOT_PERMITTED",
      });
  });

  it("needs the call to have reached the service, a note, a well-formed number and an actual change", async () => {
    const { id } = await propose();
    const dana = await t.as("st-dana");
    await expect(
      line.confirmLine(t.db, dana, { changeId: id, reached: false, note: "x" }),
    ).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(
      line.confirmLine(t.db, dana, { changeId: id, reached: true, note: " " }),
    ).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(propose("st-lena", { line: "call reception" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(propose("st-lena", { line: "555-0100 (synthetic 24-hour line)" })).rejects.toMatchObject({
      code: "INVALID",
    });
  });

  it("shows a confirmed backup line as 'if you can't get through'", async () => {
    const { id } = await propose("st-lena", { line: NEW, backupLine: "555-555-0177" });
    await line.confirmLine(t.db, await t.as("st-dana"), { changeId: id, ...called });
    expect(await familySees()).toBe(`${NEW} (if you can't get through: 555-555-0177)`);
  });

  it("withdraws, or replaces a waiting change with a newer one, without touching what families see", async () => {
    const before = await familySees();
    const first = await propose();
    const second = await propose("st-lena", { line: "555-555-0188" });
    const rows = await t.db
      .select()
      .from(s.contactLineChanges)
      .where(eq(s.contactLineChanges.kind, "change"));
    expect(rows.find((r) => r.id === first.id)?.status).toBe("superseded");
    await line.withdrawLine(t.db, await t.as("st-dana"), { changeId: second.id });
    expect((await line.myLineStatus(t.db, await t.as("st-dana"))).pending).toBeNull();
    expect(await familySees()).toBe(before);
  });
});

describe("re-confirming (every 90 days)", () => {
  it("is current after the seeded call, due after 90 days, and current again once called", async () => {
    expect((await line.lineStatus(t.db, "t-willow", "org-willow")).due).toBe(false);
    const later = new Date(Date.now() + 100 * 86_400_000);
    expect((await line.lineStatus(t.db, "t-willow", "org-willow", later)).due).toBe(true);
    const status = await systemStatus(t.db, await t.as("st-dana"), later);
    expect(status.contactLine).toMatchObject({ due: true });
    await line.reconfirmLine(t.db, await t.as("st-dana"), called);
    expect((await line.lineStatus(t.db, "t-willow", "org-willow")).lastConfirmed?.note).toBe(called.note);
    await expect(line.reconfirmLine(t.db, await t.as("st-maya"), called)).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
  });
});

describe("the record itself", () => {
  it("can't be deleted, and holds one waiting change per hospice", async () => {
    await propose();
    await expect(t.db.delete(s.contactLineChanges)).rejects.toThrow();
    await expect(
      t.db.insert(s.contactLineChanges).values({
        tenantId: "t-willow",
        organizationId: "org-willow",
        kind: "change",
        line: "555-555-0199",
        status: "pending",
        proposedByActorId: "st-lena",
      }),
    ).rejects.toThrow();
  });

  it("is the only source: nothing in the app reads a stored copy of the line", () => {
    const dir = path.resolve("src");
    const readers = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter(
        (f) => /\.(ts|tsx)$/.test(f) && !f.startsWith(path.join("server", "db")) && !f.includes("fixtures"),
      )
      .filter(
        (f) =>
          readFileSync(path.join(dir, f), "utf8").includes("afterHoursRoute") && !f.endsWith("enrollment.ts"),
      );
    expect(readers).toEqual([]);
  });
});
