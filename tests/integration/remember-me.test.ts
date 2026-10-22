import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { desc } from "drizzle-orm";
import { freshDb } from "./helpers";
import { REMEMBER_DAYS, createSession } from "@/server/session";
import * as s from "@/server/db/schema";

/** Founder decision 53: "Remember me" keeps a session for 30 days; otherwise the usual length. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const latest = async () => (await t.db.select().from(s.sessions).orderBy(desc(s.sessions.createdAt)).limit(1))[0]!;

describe("session length", () => {
  it("is 12 hours normally and 30 days when remembered", async () => {
    await createSession(t.db, { tenantId: "t-willow", actorId: "fm-daniel", userId: null, method: "development_persona" });
    const plain = await latest();
    expect(plain.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(12 * 3_600_000 + 1000);
    await createSession(t.db, {
      tenantId: "t-willow",
      actorId: "fm-daniel",
      userId: null,
      method: "development_persona",
      remember: true,
    });
    const kept = await latest();
    expect(kept.expiresAt.getTime() - Date.now()).toBeGreaterThan((REMEMBER_DAYS - 1) * 86_400_000);
  });
});
