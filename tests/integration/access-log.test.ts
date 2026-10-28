import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as s from "@/server/db/schema";
import * as staff from "@/server/services/staff";
import {
  accessLogReview,
  loggedList,
  loggedRead,
  NOT_RECORDED,
  recordListView,
  recordRead,
} from "@/server/services/access-log";

/** Staff read-access logging (founder decision 71), with synthetic people only. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const entries = () => t.db.select().from(s.staffAccessEvents);

describe("record reads", () => {
  it("records who opened which household, with their roles and whether they were assigned", async () => {
    await recordRead(t.db, await t.as("st-maya"), "household_overview", "hh-okafor");
    await recordRead(t.db, await t.as("st-dana"), "household_overview", "hh-okafor");
    const rows = await entries();
    expect(rows.map((r) => [r.actorId, r.householdId, r.view, r.kind, r.outsideAssignment, r.roles])).toEqual(
      [
        ["st-maya", "hh-okafor", "household_overview", "record", false, ["care_guide"]],
        ["st-dana", "hh-okafor", "household_overview", "record", true, ["hospice_ops"]],
      ],
    );
  });

  it("records one entry per person, household and view within the window", async () => {
    const maya = await t.as("st-maya");
    await recordRead(t.db, maya, "household_overview", "hh-okafor");
    await recordRead(t.db, maya, "household_overview", "hh-okafor");
    await recordRead(t.db, maya, "consents", "hh-okafor");
    await recordRead(t.db, maya, "household_overview", "hh-bennett");
    expect(await entries()).toHaveLength(3);
  });

  it("records nothing for family members or outside recipients", async () => {
    await recordRead(t.db, await t.as("fm-daniel"), "household_overview", "hh-okafor");
    await recordRead(t.db, await t.as("rc-rosa"), "packet", "hh-okafor");
    expect(await entries()).toEqual([]);
  });

  it("records a read only when it succeeded, and returns the read unchanged", async () => {
    const maya = await t.as("st-maya");
    const o = await loggedRead(
      t.db,
      maya,
      "household_overview",
      () => staff.householdOverview(t.db, maya, "hh-okafor"),
      (r) => r.household.id,
    );
    expect(o.household.id).toBe("hh-okafor");
    // Maya isn't assigned to Nguyen: the read is refused, and nothing is recorded as opened.
    await expect(
      loggedRead(
        t.db,
        maya,
        "household_overview",
        () => staff.householdOverview(t.db, maya, "hh-nguyen"),
        (r) => r.household.id,
      ),
    ).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    expect((await entries()).map((r) => r.householdId)).toEqual(["hh-okafor"]);
  });

  it("refuses the read when the entry can't be written", async () => {
    await t.db.execute(sql`alter table staff_access_events rename to staff_access_events_away`);
    try {
      await expect(
        recordRead(t.db, await t.as("st-maya"), "household_overview", "hh-okafor"),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: NOT_RECORDED,
      });
    } finally {
      await t.db.execute(sql`alter table staff_access_events_away rename to staff_access_events`);
    }
  });
});

describe("list views", () => {
  it("record the view and its row count, never the households", async () => {
    const dana = await t.as("st-dana");
    const rows = await loggedList(t.db, dana, "household_search", () =>
      staff.searchHouseholds(t.db, dana, ""),
    );
    await recordListView(t.db, dana, "household_search", 3);
    const [e, ...more] = await entries();
    expect(more).toEqual([]);
    expect(e).toMatchObject({
      kind: "list",
      householdId: null,
      view: "household_search",
      rowCount: rows.length,
    });
  });
});

describe("the log itself", () => {
  it("can't be changed or removed", async () => {
    await recordRead(t.db, await t.as("st-maya"), "household_overview", "hh-okafor");
    await expect(t.db.update(s.staffAccessEvents).set({ view: "other" })).rejects.toThrow();
    await expect(t.db.delete(s.staffAccessEvents)).rejects.toThrow();
    await expect(t.db.execute(sql`truncate staff_access_events`)).rejects.toThrow();
  });

  it("refuses a record entry without a household, or a list entry with one", async () => {
    const base = { tenantId: "t-willow", actorId: "st-maya", roles: ["care_guide"], view: "x" };
    await expect(t.db.insert(s.staffAccessEvents).values({ ...base, kind: "record" })).rejects.toThrow();
    await expect(
      t.db.insert(s.staffAccessEvents).values({ ...base, kind: "list", householdId: "hh-okafor" }),
    ).rejects.toThrow();
  });

  it("is for privileged reviewers and administrators only, and holds no content", async () => {
    await recordRead(t.db, await t.as("st-dana"), "packet", "hh-okafor");
    for (const who of ["st-maya", "st-dana", "fm-daniel"])
      await expect(accessLogReview(t.db, await t.as(who), {})).rejects.toMatchObject({
        code: "NOT_PERMITTED",
      });
    for (const who of ["st-priya", "st-lena"]) {
      const [row] = await accessLogReview(t.db, await t.as(who), { householdId: "hh-okafor" });
      expect(Object.keys(row!).sort()).toEqual(
        [
          "actorId",
          "at",
          "household",
          "householdId",
          "id",
          "kind",
          "outsideAssignment",
          "roles",
          "rowCount",
          "view",
          "who",
        ].sort(),
      );
      expect(row).toMatchObject({ who: "Dana Brooks", view: "Packet", household: "The Okafor household" });
    }
    // Each tenant sees only its own log.
    expect(await accessLogReview(t.db, await t.as("cst-jordan"), {}).catch((e) => e.code)).toBe(
      "NOT_PERMITTED",
    );
    expect(
      await t.db.select().from(s.staffAccessEvents).where(eq(s.staffAccessEvents.tenantId, "t-cedar")),
    ).toEqual([]);
  });
});

describe("every staff read", () => {
  it("is logged, or is a listed exemption (settings, counts, the shell, staff names)", () => {
    const exempt = new Set([
      "getEnrollment",
      "getPolicyScenarios",
      "getMessageSettings",
      "getHospiceDetails",
      "getStaffInvitations",
      "getOperationsReport",
      "getTrendsReport",
      "getSystemStatus",
      "getReportSet",
      "getOrgSettings",
      "getRetentionReview",
      "getAdminOverview",
      "getStaffShell",
      "getAssignableOwners",
      "getGuide",
    ]);
    const unlogged: string[] = [];
    const seen = new Set<string>();
    for (const file of ["src/functions/staff.ts", "src/functions/staff-shell.ts"]) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/export const (\w+) = createServerFn\(\{ method: "GET" \}\)/g)) {
        seen.add(m[1]!);
        const next = src.indexOf("export const ", m.index! + 1);
        const body = src.slice(m.index!, next < 0 ? undefined : next);
        if (!body.includes("accessLog.logged") && !exempt.has(m[1]!)) unlogged.push(m[1]!);
      }
    }
    expect(unlogged).toEqual([]);
    expect([...exempt].filter((e) => !seen.has(e))).toEqual([]);
  });
});
