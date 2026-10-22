import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as staff from "@/server/services/staff";
import * as shell from "@/server/services/staff-shell";
import * as detail from "@/server/services/queue-detail";
import * as s from "@/server/db/schema";

/** Staff workspace rework (2026-10): search, bulk actions, density, resolve rules, queue rows. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const jordan = () => t.as("cst-jordan", "t-cedar");

describe("global search is scoped like every staff list", () => {
  it("finds Willow Creek records for Willow Creek staff", async () => {
    const hits = await shell.staffSearch(t.db, await t.as("st-dana"), "Okafor");
    expect(hits.some((h) => h.type === "household" && h.title === "The Okafor household")).toBe(true);
    expect(hits.some((h) => h.type === "person" && h.title === "Daniel Okafor")).toBe(true);
    const consents = await shell.staffSearch(t.db, await t.as("st-dana"), "Brightwater");
    expect(consents.some((h) => h.type === "consent")).toBe(true);
    expect(consents.some((h) => h.type === "packet")).toBe(true);
  });

  it("returns nothing from Willow Creek to Jordan (Cedar Valley), whatever the query", async () => {
    for (const q of ["Okafor", "Rivera", "Brightwater", "Willow", "Authority conflict", "Maya", "pk-", "hh-"]) {
      const hits = await shell.staffSearch(t.db, await jordan(), q);
      for (const h of hits) {
        expect(h.link).not.toMatch(/hh-|pk-okafor|pk-bennett|pk-patel|pk-nguyen|pk-hart|pk-lindqvist/);
        expect(`${h.title} ${h.detail}`).not.toMatch(/Okafor|Rivera|Bennett|Patel|Nguyen|Hart|Lindqvist|Willow/);
      }
    }
    // Jordan still finds Cedar Valley's own household.
    expect((await shell.staffSearch(t.db, await jordan(), "Moss")).some((h) => h.title === "The Moss household")).toBe(
      true,
    );
  });

  it("limits a care guide to assigned households", async () => {
    const maya = await t.as("st-maya");
    const visible = new Set(maya.assignedHouseholdIds);
    for (const h of await shell.staffSearch(t.db, maya, "household"))
      if (h.type === "household") expect(visible.has(h.id)).toBe(true);
  });

  it("never matches what a family wrote in an escalation", async () => {
    const [e] = await t.db.select().from(s.escalations).where(eq(s.escalations.sourceType, "support_request"));
    if (!e) return;
    const word = e.summary.split(/\s+/).find((w) => w.length > 6 && /^[a-z]+$/i.test(w));
    if (!word) return;
    const hits = await shell.staffSearch(t.db, await t.as("st-dana"), word);
    expect(hits.filter((h) => h.type === "escalation" && h.id === e.id)).toHaveLength(0);
  });

  it("refuses family accounts", async () => {
    await expect(shell.staffSearch(t.db, await t.as("fm-daniel"), "Okafor")).rejects.toThrow();
  });
});

describe("bulk take and assign keep the per-item checks", () => {
  const unowned = async () =>
    (await staff.coordinationQueue(t.db, await t.as("st-dana")))
      .filter((r) => r.kind === "escalation" && r.ownerIds.length === 0)
      .map((r) => r.subjectId!);

  it("operations can assign several at once; each is recorded", async () => {
    const ids = (await unowned()).slice(0, 2);
    expect(ids.length).toBe(2);
    const res = await staff.bulkEscalations(t.db, await t.as("st-dana"), { ids, action: "assign", toActorId: "st-maya" });
    expect(res.every((r) => r.ok)).toBe(true);
    const audit = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "escalation.owner_assigned"));
    expect(audit.filter((a) => ids.includes(a.subjectId!))).toHaveLength(2);
  });

  it("care guides can't bulk-assign (operations only)", async () => {
    const ids = (await unowned()).slice(0, 1);
    await expect(
      staff.bulkEscalations(t.db, await t.as("st-maya"), { ids, action: "assign", toActorId: "st-dana" }),
    ).rejects.toThrow();
  });

  it("Jordan can't take or assign Willow Creek items: each one is refused", async () => {
    const ids = await unowned();
    const take = await staff.bulkEscalations(t.db, await jordan(), { ids, action: "take" });
    expect(take.every((r) => !r.ok)).toBe(true);
    const give = await staff.bulkEscalations(t.db, await jordan(), { ids, action: "assign", toActorId: "cst-jordan" });
    expect(give.every((r) => !r.ok)).toBe(true);
    const owned = await t.db.select().from(s.escalations).where(eq(s.escalations.ownerActorId, "cst-jordan"));
    expect(owned).toHaveLength(0);
  });

  it("a care guide's take is refused for a household that isn't theirs", async () => {
    const all = await t.db.select().from(s.escalations).where(eq(s.escalations.status, "open"));
    const maya = await t.as("st-maya");
    const notMine = all.filter((e) => !maya.assignedHouseholdIds.includes(e.householdId)).map((e) => e.id);
    if (!notMine.length) return;
    const res = await staff.bulkEscalations(t.db, maya, { ids: notMine, action: "take" });
    expect(res.every((r) => !r.ok)).toBe(true);
  });
});

describe("resolving an escalation (interaction review item 16)", () => {
  async function anOpen() {
    const [e] = await t.db
      .select()
      .from(s.escalations)
      .where(and(eq(s.escalations.status, "open"), eq(s.escalations.householdId, "hh-okafor")));
    return e!;
  }
  it("needs ownership first", async () => {
    const e = await anOpen();
    await expect(
      staff.updateEscalation(t.db, await t.as("st-dana"), { id: e.id, action: "resolve", resolution: "Done" }),
    ).rejects.toThrow(/Take ownership first/);
  });
  it("unowned: taking ownership and resolving in one confirmed step records both", async () => {
    const e = await anOpen();
    await staff.updateEscalation(t.db, await t.as("st-maya"), { id: e.id, action: "resolve", resolution: "Sorted", takeOver: true });
    const evs = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.subjectId, e.id));
    const actions = evs.map((x) => x.action);
    expect(actions).toContain("escalation.owned");
    expect(actions).toContain("escalation.resolved");
    const [row] = await t.db.select().from(s.escalations).where(eq(s.escalations.id, e.id));
    expect(row).toMatchObject({ status: "resolved", ownerActorId: "st-maya", resolvedByActorId: "st-maya" });
  });
  it("someone else's needs an explicit take-over, recorded with the previous owner", async () => {
    const e = await anOpen();
    await staff.updateEscalation(t.db, await t.as("st-maya"), { id: e.id, action: "take" });
    await expect(
      staff.updateEscalation(t.db, await t.as("st-dana"), { id: e.id, action: "resolve", resolution: "Done" }),
    ).rejects.toThrow(/Maya Chen owns this/);
    await staff.updateEscalation(t.db, await t.as("st-dana"), {
      id: e.id,
      action: "resolve",
      resolution: "Done",
      takeOver: true,
    });
    const [ev] = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "escalation.taken_over"));
    expect(ev!.context).toMatchObject({ previousOwner: "st-maya" });
  });
  it("'Let the family know' sends the previewed message to the household thread", async () => {
    const [e] = await t.db.select().from(s.escalations).where(eq(s.escalations.sourceType, "support_request"));
    expect(e).toBeTruthy();
    // The household's care guide: messaging the household is their permission, not operations'.
    const ctx = await t.as("st-maya");
    expect(ctx.assignedHouseholdIds).toContain(e!.householdId);
    await expect(
      staff.updateEscalation(t.db, await t.as("st-dana"), {
        id: e!.id,
        action: "resolve",
        resolution: "x",
        takeOver: true,
        familyMessage: "Hello",
      }),
    ).rejects.toThrow();
    if (!e!.ownerActorId) await staff.updateEscalation(t.db, ctx, { id: e!.id, action: "take" });
    await staff.updateEscalation(t.db, ctx, {
      id: e!.id,
      action: "resolve",
      resolution: "Called them",
      takeOver: true,
      familyMessage: "We've followed up on your request.",
    });
    const msgs = await t.db.select().from(s.messages).where(eq(s.messages.body, "We've followed up on your request."));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.householdId).toBe(e!.householdId);
  });
});

describe("density and saved views are each person's own", () => {
  it("density set by one person doesn't change another's", async () => {
    await shell.setDensity(t.db, await t.as("st-maya"), "compact");
    expect((await shell.staffShell(t.db, await t.as("st-maya"))).density).toBe("compact");
    expect((await shell.staffShell(t.db, await t.as("st-dana"))).density).toBe("comfortable");
  });
  it("saved views keep only filter keys, never a selected item", async () => {
    const views = await shell.saveQueueView(t.db, await t.as("st-dana"), {
      name: "Rivera unowned",
      search: { who: "unassigned", household: "hh-rivera", sel: "escalation:es-1", evil: "x" },
    });
    expect(views.at(-1)).toEqual({ name: "Rivera unowned", search: { who: "unassigned", household: "hh-rivera" } });
    expect((await shell.staffShell(t.db, await t.as("st-maya"))).savedViews).toEqual([]);
  });
});

describe("queue rows", () => {
  it("have stable ids, a status, a deep link, and count waiting from the last change", async () => {
    const q = await staff.coordinationQueue(t.db, await t.as("st-dana"));
    expect(new Set(q.map((r) => r.id)).size).toBe(q.length);
    for (const r of q) {
      expect(r.status.domain).toBeTruthy();
      expect(r.deepLink.startsWith("/staff/")).toBe(true);
    }
    const esc = q.find((r) => r.kind === "escalation")!;
    const [row] = await t.db.select().from(s.escalations).where(eq(s.escalations.id, esc.subjectId!));
    expect(esc.since.getTime()).toBe((row!.stateChangedAt ?? row!.createdAt).getTime());
  });

  it("the detail panel uses the screen's own checks: Jordan is refused a Willow Creek item", async () => {
    const q = await staff.coordinationQueue(t.db, await t.as("st-dana"));
    const r = q.find((x) => x.kind === "escalation")!;
    await expect(
      detail.queueDetail(t.db, await jordan(), { kind: r.kind, subjectId: r.subjectId, householdId: r.householdId }),
    ).rejects.toThrow();
    const ok = await detail.queueDetail(t.db, await t.as("st-dana"), {
      kind: r.kind,
      subjectId: r.subjectId,
      householdId: r.householdId,
    });
    expect(ok.kind).toBe("escalation");
  });
});
