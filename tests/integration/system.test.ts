import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { systemStatus } from "@/server/services/system";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

describe("system status", () => {
  it("is for hospice operations only", async () => {
    for (const who of ["st-maya", "st-priya", "fm-daniel"])
      await expect(systemStatus(t.db, await t.as(who))).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });

  it("reports schema and audit integrity without paths or secrets", async () => {
    const r = await systemStatus(t.db, await t.as("st-dana"));
    expect(r.database.migrationsApplied).toBe(r.database.migrationsAvailable);
    expect(r.audit.ok).toBe(true);
    expect(r.environment.mode).toBe("test");
    expect(JSON.stringify(r)).not.toMatch(/\.data|pglite\/|password|token|\/Users\//i);
  });
});
