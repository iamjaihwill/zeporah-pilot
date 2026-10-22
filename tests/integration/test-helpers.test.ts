import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import * as s from "@/server/db/schema";

/**
 * Regression for an intermittent failure: the helper once guessed the tenant from an actor id's
 * first letter, so a generated id starting with "c" (1 in 16 UUIDs) was looked up in Cedar Valley.
 */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

describe("test helper: t.as", () => {
  it("finds an actor whose generated id starts with 'c' in its own tenant", async () => {
    await t.db.insert(s.actors).values({
      id: "c0ffee00-0000-4000-8000-000000000001",
      tenantId: "t-willow",
      kind: "family",
      displayName: "Synthetic Person",
      email: "c0ffee@example.invalid",
    });
    const ctx = await t.as("c0ffee00-0000-4000-8000-000000000001");
    expect(ctx.tenantId).toBe("t-willow");
  });

  it("still resolves seeded Cedar Valley actors, and still lets a test force a wrong tenant", async () => {
    expect((await t.as("cst-jordan")).tenantId).toBe("t-cedar");
    expect((await t.as("st-dana")).tenantId).toBe("t-willow");
    await expect(t.as("st-dana", "t-cedar")).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
  });
});
