import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import { assertEnvironment } from "../environment";

export type DB = ReturnType<typeof drizzle<typeof schema>>;
/** A database handle or an open transaction — services accept either. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Conn = DB | Tx;

const MIGRATIONS = path.resolve(process.cwd(), "src/server/db/migrations");

/**
 * The local database lives here. Synthetic data only; delete freely.
 * End-to-end tests set ZEPORAH_DATA_DIR to an isolated folder so they never touch this one.
 */
export const DATA_DIR = path.resolve(process.cwd(), process.env["ZEPORAH_DATA_DIR"] ?? ".data/pglite");

/** Open a database and bring it to the latest schema. No `dataDir` = in memory (tests). */
export async function openDb(dataDir?: string): Promise<{ db: DB; close: () => Promise<void> }> {
  if (dataDir) mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}

/** The newest migration the code ships with (from drizzle's journal), e.g. "0014_email_reply_reset". */
export function latestMigration(): string {
  try {
    const j = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    return j.entries.at(-1)?.tag ?? "";
  } catch {
    return "";
  }
}

type Holder = {
  promise: Promise<{ db: DB; close: () => Promise<void> }> | null;
  /** The newest migration applied to the open database. */
  migrated?: string;
  upgrading?: Promise<void> | null;
};
const holder: Holder = ((globalThis as { __zeporahDb?: Holder }).__zeporahDb ??= { promise: null });

/**
 * The dev server's single shared database (kept across hot reloads).
 *
 * A long-running dev server keeps its database open while code changes under it. If new code ships
 * a migration, it's applied here, in place, before the next query — instead of only when the
 * database is first opened. Without this, hot-reloaded code queried columns that didn't exist yet
 * (the 2026-10-13 interaction review, items 1 and 2).
 */
export async function getDb(): Promise<DB> {
  assertEnvironment();
  const latest = latestMigration();
  if (holder.promise && holder.migrated !== latest) {
    holder.upgrading ??= holder.promise
      .then(({ db }) => migrate(db, { migrationsFolder: MIGRATIONS }))
      .then(() => {
        holder.migrated = latest;
        console.info(JSON.stringify({ level: "info", event: "database.migrated", to: latest }));
      })
      .finally(() => {
        holder.upgrading = null;
      });
    await holder.upgrading;
  }
  if (!holder.promise) {
    holder.promise = openDb(DATA_DIR);
    holder.migrated = latest;
  }
  // Development only: email nudges (decision 23) go to the mail sink once a minute (started once).
  void import("../services/email-notices").then((m) => m.startEmailNoticeTimer(getDb));
  return holder.promise.then((h) => h.db);
}

/** Close the shared database (used by the dev-only reset endpoint before reseeding). */
export async function closeSharedDb() {
  const p = holder.promise;
  holder.promise = null;
  holder.migrated = "";
  if (p) await (await p).close();
}
