import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as bereavement from "@/server/services/bereavement";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as s from "@/server/db/schema";
import { BEREAVEMENT_STEPS, dueWindow } from "@/domain/bereavement";
import { verifyAuditChain } from "@/server/audit";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const contacts = (householdId: string) =>
  t.db.select().from(s.bereavementContacts).where(eq(s.bereavementContacts.householdId, householdId));

describe("the 13-month plan", () => {
  it("is created when a transition is confirmed", async () => {
    expect(await contacts("hh-okafor")).toEqual([]);
    await staff.proposeBereavement(t.db, await t.as("st-maya"), {
      householdId: "hh-okafor",
      survivingContactActorId: "fm-daniel",
      note: "",
    });
    const [tr] = await t.db
      .select({ id: s.bereavementTransitions.id })
      .from(s.bereavementTransitions)
      .where(eq(s.bereavementTransitions.householdId, "hh-okafor"));
    const id = tr!.id;
    await staff.confirmBereavement(t.db, await t.as("st-dana"), id);
    const plan = await contacts("hh-okafor");
    expect(plan.map((c) => c.step).sort()).toEqual(BEREAVEMENT_STEPS.map((x) => x.code).sort());
    expect(plan.every((c) => c.status === "planned" && c.transitionId === id)).toBe(true);
    const first = plan.find((c) => c.step === "first_weeks")!;
    expect(Math.round((first.dueOn.getTime() - Date.now()) / 86_400_000)).toBe(14);
  });

  it("is seeded for Lindqvist, with the first check-in due this week", async () => {
    const plan = await contacts("hh-lindqvist");
    expect(plan).toHaveLength(BEREAVEMENT_STEPS.length);
    const first = plan.find((c) => c.step === "first_weeks")!;
    expect(dueWindow(first.dueOn, new Date())).toBe("this_week");
  });
});

describe("recording check-ins", () => {
  it("the assigned care guide records once; the note stays staff-only", async () => {
    const [first] = (await contacts("hh-lindqvist")).filter((c) => c.step === "first_weeks");
    await bereavement.recordCheckIn(t.db, await t.as("st-tom"), {
      contactId: first!.id,
      outcome: "reached",
      note: "Ingrid would like a call before the anniversary (synthetic).",
    });
    await expect(
      bereavement.recordCheckIn(t.db, await t.as("st-tom"), {
        contactId: first!.id,
        outcome: "reached",
        note: "",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [ev] = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "bereavement.check_in_recorded"));
    expect(ev!.summary).not.toContain("anniversary");
    expect(ev!.visibility).toBe("staff");
    // The family sees that it happened — not the outcome or the note.
    const fam = await family.getBereavement(t.db, await t.as("fm-ingrid"));
    expect(fam.plan?.steps.find((x) => x.label === "In the first few weeks")?.done).toBe(true);
    expect(JSON.stringify(fam)).not.toMatch(/anniversary \(synthetic\)|reached|Talked with/);
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });

  it("is refused for people who can't see the household, and for households not in bereavement", async () => {
    const [first] = (await contacts("hh-lindqvist")).filter((c) => c.step === "first_weeks");
    await expect(
      bereavement.recordCheckIn(t.db, await t.as("st-maya"), {
        contactId: first!.id,
        outcome: "reached",
        note: "",
      }),
    ).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    await expect(
      bereavement.recordCheckIn(t.db, await t.as("fm-ingrid"), {
        contactId: first!.id,
        outcome: "reached",
        note: "",
      }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await t.db
      .update(s.households)
      .set({ lifecycleState: "closed" })
      .where(eq(s.households.id, "hh-lindqvist"));
    await expect(
      bereavement.recordCheckIn(t.db, await t.as("st-dana"), {
        contactId: first!.id,
        outcome: "reached",
        note: "",
      }),
    ).rejects.toThrow();
  });

  it("the database keeps a recorded check-in complete", async () => {
    const [first] = (await contacts("hh-lindqvist")).filter((c) => c.step === "first_weeks");
    await expect(
      t.db
        .update(s.bereavementContacts)
        .set({ status: "done" })
        .where(eq(s.bereavementContacts.id, first!.id)),
    ).rejects.toThrow();
    await expect(
      t.db
        .update(s.bereavementContacts)
        .set({ step: "someday" })
        .where(eq(s.bereavementContacts.id, first!.id)),
    ).rejects.toThrow();
  });
});

describe("workload", () => {
  it("shows open check-ins for visible bereavement households, with the guide and a decline flag", async () => {
    const tom = await bereavement.bereavementWorkload(t.db, await t.as("st-tom"));
    expect(tom.households).toBe(1);
    expect(tom.open.filter((o) => o.window === "this_week").map((o) => o.label)).toEqual(["First check-in"]);
    // Due within a month: the first check-in and the one-month check-in.
    expect(tom.byGuide).toEqual([{ name: "Tomás Alvarez", n: 2 }]);
    expect((await bereavement.bereavementWorkload(t.db, await t.as("st-maya"))).open).toEqual([]);
    expect((await bereavement.bereavementWorkload(t.db, await t.as("st-dana"))).households).toBe(1);
    const [first] = (await contacts("hh-lindqvist")).filter((c) => c.step === "first_weeks");
    await bereavement.recordCheckIn(t.db, await t.as("st-tom"), {
      contactId: first!.id,
      outcome: "declined",
      note: "",
    });
    const after = await bereavement.bereavementWorkload(t.db, await t.as("st-tom"));
    expect(after.open.every((o) => o.declined)).toBe(true);
    expect(after.open.some((o) => o.label === "First check-in")).toBe(false);
    await expect(bereavement.bereavementWorkload(t.db, await t.as("fm-ingrid"))).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
    const plan = await staff.householdOverview(t.db, await t.as("st-tom"), "hh-lindqvist");
    expect(plan.bereavementPlan?.declined).toBe(true);
    expect(
      (
        await t.db
          .select()
          .from(s.bereavementContacts)
          .where(and(eq(s.bereavementContacts.status, "done")))
      ).length,
    ).toBe(1);
  });
});
