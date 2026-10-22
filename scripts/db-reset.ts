/**
 * Deletes the local development database and reloads the synthetic dataset.
 * Stop the dev server first (or use the in-app "Reset synthetic data" control, which does this safely).
 */
import { rm } from "node:fs/promises";
import { DATA_DIR, openDb } from "../src/server/db/client";
import { seed } from "../src/server/db/seed";
import { SEED_SNAPSHOTS, type SeedSnapshot } from "../src/fixtures/demo-week";

// ZEPORAH_SEED_SNAPSHOT=demo_midweek or demo_endweek loads the enterprise demo week (decision 58).
const snapshot = (process.env["ZEPORAH_SEED_SNAPSHOT"] ?? "standard") as SeedSnapshot;
if (!SEED_SNAPSHOTS.includes(snapshot)) throw new Error(`Unknown snapshot "${snapshot}".`);

await rm(DATA_DIR, { recursive: true, force: true });
const { db, close } = await openDb(DATA_DIR);
await seed(db, new Date(), snapshot);
await close();
console.log(`Synthetic data (${snapshot}) reset at ${DATA_DIR}`);
