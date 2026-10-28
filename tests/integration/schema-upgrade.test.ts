import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { getDb, latestMigration, openDb, type DB } from "@/server/db/client";
import { seed } from "@/server/db/seed";
import { loadContext } from "@/server/context";
import { downgradeToPrevious } from "../../scripts/db-seed-previous";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as settings from "@/server/services/settings";
import * as notifications from "@/server/services/notifications";
import * as auditReview from "@/server/services/audit-review";
import * as reports from "@/server/services/reports";

/**
 * A database written by the previous version must upgrade in place, with safe defaults, and every
 * page's data must load afterwards (interaction review 2026-10-13, item 2).
 */
let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function previousThenMigrated() {
  const h = await openDb();
  close = h.close;
  await seed(h.db);
  // Three versions back: the database the reviewers had (before 0014), across 0016 too.
  await downgradeToPrevious(h.db, 15);
  const cols = await h.db.execute(
    sql.raw(`SELECT column_name FROM information_schema.columns WHERE table_name = 'preferences'`),
  );
  expect(cols.rows.map((r) => (r as { column_name: string }).column_name)).not.toContain("email_notices");
  await migrate(h.db, { migrationsFolder: path.resolve("src/server/db/migrations") });
  return h.db as DB;
}

describe("upgrading a database from the previous schema version", () => {
  it("adds the new settings with safe defaults", async () => {
    const db = await previousThenMigrated();
    const willow = await settings.currentMessageExpectation(db, "t-willow", "org-willow");
    expect(willow?.replyTime).toBe(""); // not set yet: families see the fixed sentence
    const prefs = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM preferences WHERE email_notices`));
    expect((prefs.rows[0] as { n: number }).n).toBe(0); // nobody is opted in to email
  });

  it("loads every family and staff page's data afterwards", async () => {
    const db = await previousThenMigrated();
    const ctx = (actorId: string, tenantId = "t-willow") => loadContext(db, actorId, tenantId);
    for (const id of ["fm-daniel", "fm-ada", "fm-chidi", "fm-grace", "fm-marisol", "fm-ingrid"]) {
      const c = await ctx(id);
      await family.familyHome(db, c);
      await family.getOnboarding(db, c);
      await family.listFamilyTasks(db, c);
      await family.getThread(db, c);
      await family.getSupport(db, c);
      await family.listPeople(db, c);
      await notifications.listNotifications(db, c);
      await notifications.emailNoticeState(db, c);
      await family.listVault(db, c).catch((e) => expect(e.name).toBe("AccessError"));
    }
    for (const [id, tenant] of [
      ["st-maya", "t-willow"],
      ["st-dana", "t-willow"],
      ["st-priya", "t-willow"],
      ["cst-jordan", "t-cedar"],
    ] as const) {
      const c = await ctx(id, tenant);
      await staff.staffHome(db, c);
      await staff.coordinationQueue(db, c);
      await staff.listEscalations(db, c);
      await notifications.listNotifications(db, c);
      if (id !== "st-maya") await auditReview.auditReview(db, c, {});
      if (id === "st-dana") {
        await reports.operationsReport(db, c);
        await settings.getMessageSettings(db, c);
        await staff.householdOverview(db, c, "hh-okafor");
      }
    }
    // A family task can be completed on the upgraded data (it failed before the fix).
    await family.completeFamilyTask(db, await ctx("fm-daniel"), "tk-1");
  });
});

describe("a dev server that stays running while code changes", () => {
  it("applies a new migration to its already-open database before the next query", async () => {
    await import("@/server/db/client"); // creates the shared holder
    const h = await openDb();
    close = h.close;
    await seed(h.db);
    await downgradeToPrevious(h.db, 15);
    // As a server opened before the migration existed would hold it.
    const holder = (globalThis as { __zeporahDb?: { promise: unknown; migrated?: string } }).__zeporahDb!;
    const saved = { ...holder };
    Object.assign(holder, { promise: Promise.resolve(h), migrated: "0013_previous" });
    try {
      const db = await getDb();
      expect(holder.migrated).toBe(latestMigration());
      await family.getOnboarding(db, await loadContext(db, "fm-marisol", "t-willow"));
    } finally {
      Object.assign(holder, saved);
    }
  });
});
