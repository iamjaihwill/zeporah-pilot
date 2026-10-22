import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import { REPORT_EXPORT_NOTICE, reportExport } from "@/server/services/report-export";
import * as s from "@/server/db/schema";

/** Founder decision 57: operations export the report on screen as CSV; counts only; audit-logged. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  t = await freshDb();
});
afterEach(async () => {
  await t.close();
});

describe("report export", () => {
  it("operations export the overview: header lines, rows, no households or families, and an audit entry", async () => {
    const dana = await t.as("st-dana");
    const r = await reportExport(t.db, dana, { report: "overview", days: 30 });
    const lines = r.csv.split("\r\n");
    expect(lines[0]).toBe(`"${REPORT_EXPORT_NOTICE}"`);
    expect(lines[1]).toMatch(/^"Exported by Dana Brooks at /);
    expect(lines[2]).toMatch(/Report: Executive overview; last 30 days/);
    expect(lines[4]).toBe("section,label,value");
    expect(r.csv).toContain('"Open work","Escalations with no owner"');
    expect(r.csv).toMatch(/"Escalations raised, per week","[A-Z][a-z]{2} \d/);
    // Never household, patient or family names.
    expect(r.csv).not.toMatch(/Okafor|Hart household|Rivera|Bennett|Lindqvist|Nguyen|Patel/);
    expect(r.filename).toMatch(/^zeporah-report-overview-\d{4}-\d\d-\d\d-last-30-days\.csv$/);
    const [e] = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "report.exported"))
      .orderBy(desc(s.auditEvents.seq));
    expect(e).toMatchObject({ actorId: "st-dana", subjectId: "overview", householdId: null });
  });

  it("names staff only in the workforce report", async () => {
    const dana = await t.as("st-dana");
    expect((await reportExport(t.db, dana, { report: "workforce", days: 30 })).csv).toContain("Maya Chen");
    expect((await reportExport(t.db, dana, { report: "exceptions", days: 30 })).csv).not.toContain(
      "Maya Chen",
    );
  });

  it("is for operations only, and only for the offered periods", async () => {
    for (const who of ["st-maya", "st-priya", "st-lena"])
      await expect(
        reportExport(t.db, await t.as(who), { report: "overview", days: 30 }),
      ).rejects.toMatchObject({
        code: "NOT_PERMITTED",
      });
    await expect(
      reportExport(t.db, await t.as("st-dana"), { report: "overview", days: 365 }),
    ).rejects.toMatchObject({
      code: "INVALID",
    });
  });
});
