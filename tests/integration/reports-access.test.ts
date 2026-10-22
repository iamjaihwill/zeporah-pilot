import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { operationsReport, reportSet, trendsReport } from "@/server/services/reports";

/** Founder decision 39: administrators do no household work, so Reports is for operations only. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  t = await freshDb();
});
afterEach(async () => {
  await t.close();
});

describe("reports access", () => {
  it("administrators don't get Reports", async () => {
    const lena = await t.as("st-lena");
    for (const run of [
      () => operationsReport(t.db, lena),
      () => trendsReport(t.db, lena, { days: 30 }),
      () => reportSet(t.db, lena),
    ])
      await expect(run()).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });

  it("operations still do", async () => {
    const dana = await t.as("st-dana");
    await expect(operationsReport(t.db, dana)).resolves.toBeTruthy();
    await expect(trendsReport(t.db, dana, { days: 30 })).resolves.toBeTruthy();
    await expect(reportSet(t.db, dana)).resolves.toBeTruthy();
  });
});
