import { eq } from "drizzle-orm";
import { openDb, type DB } from "@/server/db/client";
import { seed } from "@/server/db/seed";
import { loadContext } from "@/server/context";
import { actors } from "@/server/db/schema";
import type { SeedSnapshot } from "@/fixtures/demo-week";

/** A fresh in-memory database with the synthetic dataset, per test file or test. */
export async function freshDb(now = new Date(), snapshot: SeedSnapshot = "standard") {
  const { db, close } = await openDb();
  await seed(db, now, snapshot);
  /**
   * The context for an actor. The tenant is the actor's own (looked up by id, which is unique),
   * unless a test passes one to check a cross-tenant refusal. It used to be guessed from the id's
   * first letter ("c" → Cedar Valley), which mis-routed generated UUIDs starting with "c" —
   * 1 in 16 — and made tests with invited accounts fail intermittently.
   */
  const as = async (actorId: string, tenantId?: string) => {
    if (tenantId) return loadContext(db, actorId, tenantId);
    const [a] = await db.select({ tenantId: actors.tenantId }).from(actors).where(eq(actors.id, actorId));
    if (!a) throw new Error(`Test helper: no actor "${actorId}" in the seed or created by this test.`);
    return loadContext(db, actorId, a.tenantId);
  };
  return { db: db as DB, close, as };
}
