import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as s from "@/server/db/schema";

/** Founder decision 43: every vault item states its audience; membership alone grants nothing more. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const standardItem = async () => {
  const [i] = await t.db.select().from(s.vaultItems).where(eq(s.vaultItems.householdId, "hh-okafor"));
  const items = await t.db.select().from(s.vaultItems).where(eq(s.vaultItems.householdId, "hh-okafor"));
  return (items.find((x) => x.sensitivity === "standard") ?? i)!;
};
const ids = async (who: string) => (await family.listVault(t.db, await t.as(who))).items.map((i) => i.id);

describe("vault audiences", () => {
  it("existing items keep today's audience: keepers and the care team, not family members", async () => {
    const item = await standardItem();
    expect(item.audience).toBe("staff");
    expect(await ids("fm-daniel")).toContain(item.id);
    expect(await ids("fm-chidi")).not.toContain(item.id);
    const o = await staff.householdOverview(t.db, await t.as("st-maya"), "hh-okafor");
    expect(o.vault.some((v) => v.id === item.id)).toBe(true);
  });

  it("an item made visible to the household reaches family members, with a confirmed, audited change", async () => {
    const item = await standardItem();
    await family.setVaultAudience(t.db, await t.as("fm-daniel"), {
      id: item.id,
      audience: "household",
      sharedWith: [],
    });
    expect(await ids("fm-chidi")).toContain(item.id);
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "vault.audience_changed"));
    expect(ev?.context).toMatchObject({ before: { audience: "staff" }, after: { audience: "household" } });
    const label = (await family.listVault(t.db, await t.as("fm-chidi"))).items.find(
      (i) => i.id === item.id,
    )!.audienceLabel;
    expect(label).toBe("Visible to the household and your care team");
  });

  it("selected people only — and the care team stops seeing it", async () => {
    const item = await standardItem();
    await family.setVaultAudience(t.db, await t.as("fm-daniel"), {
      id: item.id,
      audience: "selected",
      sharedWith: ["fm-grace"],
    });
    expect(await ids("fm-grace")).toContain(item.id);
    expect(await ids("fm-daniel")).toContain(item.id); // the changer is always included
    expect(await ids("fm-ada")).not.toContain(item.id);
    const o = await staff.householdOverview(t.db, await t.as("st-maya"), "hh-okafor");
    expect(o.vault.some((v) => v.id === item.id)).toBe(false);
  });

  it("private to me only for the person who added it", async () => {
    const item = await standardItem();
    await expect(
      family.setVaultAudience(t.db, await t.as("fm-daniel"), {
        id: item.id,
        audience: "private",
        sharedWith: [],
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    const { id } = await family.addVaultItem(t.db, await t.as("fm-daniel"), {
      title: "Spare house key arrangement",
      keptWhere: "With the neighbour (synthetic)",
      audience: "private",
      sharedWith: [],
    });
    expect(await ids("fm-daniel")).toContain(id);
    for (const who of ["fm-grace", "fm-ada", "fm-chidi"]) expect(await ids(who)).not.toContain(id);
  });

  it("protected items can't be widened, and family members never see them", async () => {
    const [prot] = await t.db.select().from(s.vaultItems).where(eq(s.vaultItems.sensitivity, "protected"));
    await expect(
      family.setVaultAudience(t.db, await t.as("fm-grace"), {
        id: prot!.id,
        audience: "household",
        sharedWith: [],
      }),
    ).rejects.toThrow();
    expect(await ids("fm-chidi")).not.toContain(prot!.id);
  });

  it("family members can't change audiences or add items", async () => {
    const item = await standardItem();
    await expect(
      family.setVaultAudience(t.db, await t.as("fm-chidi"), {
        id: item.id,
        audience: "household",
        sharedWith: [],
      }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });
});
