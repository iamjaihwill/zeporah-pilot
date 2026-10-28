/**
 * TESTS ONLY: builds a synthetic database as it was at the previous schema version (0013), so the
 * upgrade test can check that the app migrates it in place and every page still loads.
 *
 * It seeds at the latest version, then undoes the newest migrations (tests/fixtures/downgrade-*.sql)
 * and removes its entry from drizzle's migration table. Data written by the old code (rows without
 * the new columns) is exactly what's left.
 */
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { DATA_DIR, openDb } from "../src/server/db/client";
import { seed } from "../src/server/db/seed";

/**
 * Undo the newest `steps` migrations (each has tests/fixtures/downgrade-NNNN.sql) and remove their
 * entries from drizzle's migration table.
 */
export async function downgradeToPrevious(db: Awaited<ReturnType<typeof openDb>>["db"], steps = 1) {
  const journal = JSON.parse(readFileSync("src/server/db/migrations/meta/_journal.json", "utf8")) as {
    entries: { tag: string }[];
  };
  for (const { tag } of journal.entries.slice(-steps).reverse()) {
    const down = readFileSync(`tests/fixtures/downgrade-${tag.slice(0, 4)}.sql`, "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("--"))
      .join("\n");
    for (const stmt of down
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean))
      await db.execute(sql.raw(stmt));
    await db.execute(
      sql.raw(
        `DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)`,
      ),
    );
  }
}

if (import.meta.main) {
  if (!process.env["ZEPORAH_DATA_DIR"]) throw new Error("Refusing to touch the development database.");
  await rm(DATA_DIR, { recursive: true, force: true });
  const { db, close } = await openDb(DATA_DIR);
  await seed(db);
  // The reviewers database was at 0013: upgrade across everything since.
  await downgradeToPrevious(db, Number(process.env["ZEPORAH_DOWNGRADE_STEPS"] ?? 13));
  await close();
  console.log(`Synthetic data at the previous schema version in ${DATA_DIR}`);
}
