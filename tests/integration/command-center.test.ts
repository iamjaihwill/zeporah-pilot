import { afterEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { coordinationQueue, staffHome } from "@/server/services/staff";
import { adminOverview } from "@/server/services/team";

/** Role homes (decision 58, workstream 4; plan stories H-1 to H-4). */
let t: Awaited<ReturnType<typeof freshDb>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** What each widget's link opens, as the Exceptions page filters it. */
const VIEW: Record<string, (r: Awaited<ReturnType<typeof coordinationQueue>>[number]) => boolean> = {
  mine: (r) => r.mine,
  unowned: (r) => r.ownerIds.length === 0,
  due: (r) => r.due !== null,
  family: (r) => r.waitingOn === "family" || ["family_contact", "unread_update"].includes(r.category),
  partner: (r) => r.waitingOn === "partner" || r.category === "partner_waiting",
  releases: (r) => r.category === "release_incomplete",
};

describe("role homes", () => {
  for (const [who, role, first] of [
    ["st-maya", "care_guide", "mine"],
    ["st-dana", "hospice_ops", "unowned"],
    ["st-priya", "privileged_reviewer", "reviews"],
  ] as const)
    it(`${who}: the ${role} home, each number equal to the list it opens, three oldest at most`, async () => {
      t = await freshDb(new Date(), "demo_midweek");
      const ctx = await t.as(who);
      const home = await staffHome(t.db, ctx);
      const rows = await coordinationQueue(t.db, ctx);
      expect(home.center.role).toBe(role);
      expect(home.center.widgets[0]!.key).toBe(first);
      for (const w of home.center.widgets) {
        expect(w.items.length, w.key).toBeLessThanOrEqual(3);
        if (VIEW[w.key]) expect(w.count, w.key).toBe(rows.filter(VIEW[w.key]!).length);
        // The oldest first.
        const times = w.items.map((i) => new Date(i.since).getTime());
        if (w.key !== "changed") expect(times).toEqual([...times].sort((a, b) => a - b));
      }
    });

  it("operations' coverage widget counts gaps and stalled handoffs, and says who's away", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const home = await staffHome(t.db, await t.as("st-dana"));
    const coverage = home.center.widgets.find((w) => w.key === "coverage")!;
    expect(coverage.count).toBeGreaterThanOrEqual(4);
    expect(coverage.note).toBe("1 care guide away now or soon");
  });

  it("the administrator's overview counts coverage and checks the audit chain, naming no household", async () => {
    t = await freshDb(new Date(), "demo_midweek");
    const o = await adminOverview(t.db, await t.as("st-lena"));
    expect(o.integrity.ok).toBe(true);
    expect(o.coverage).toMatchObject({ withoutGuide: 1, away: 1 });
    expect(JSON.stringify({ coverage: o.coverage, integrity: o.integrity })).not.toMatch(
      /Okafor|Nguyen|Bennett|Rivera|Hart|Patel|Lindqvist/,
    );
  });
});
