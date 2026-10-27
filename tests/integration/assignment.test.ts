import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as assignments from "@/server/services/assignments";
import * as auth from "@/server/services/auth";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as sharing from "@/server/services/sharing";
import * as notifications from "@/server/services/notifications";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";
import { actorForToken, createSession } from "@/server/session";
import { loadContext } from "@/server/context";
import { NO_OWNER } from "@/domain/queue";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => {
  vi.unstubAllEnvs();
  return t.close();
});

const REASON = "Caseload change (synthetic).";

/** The id of an active care-guide assignment. */
async function assignmentId(actorId: string, householdId: string) {
  const [m] = await t.db
    .select()
    .from(s.memberships)
    .where(
      and(
        eq(s.memberships.actorId, actorId),
        eq(s.memberships.householdId, householdId),
        eq(s.memberships.roleCode, "care_guide"),
        eq(s.memberships.status, "active"),
      ),
    );
  return m?.id;
}
const events = (action: string) => t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, action));
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => "allowed",
    (e: Error) => e.message,
  );

/** A care guide who joined through an invitation and has no households yet. */
async function newCareGuide() {
  const inv = await auth.createStaffInvitation(t.db, await t.as("st-dana"), {
    name: "Noor Haddad",
    email: "noor@example.invalid",
    role: "care_guide",
  });
  const r = await auth.acceptInvitation(t.db, {
    token: inv.acceptPath.replace("/invite/", ""),
    displayName: "Noor Haddad",
    password: "synthetic-pass-phrase-1",
  });
  return { ...r, ctx: () => loadContext(t.db, r.actorId, r.tenantId) };
}

describe("seeded assignments", () => {
  it("leave Nguyen without a care guide and record the history", async () => {
    const dana = await t.as("st-dana");
    const list = await staff.searchHouseholds(t.db, dana, "");
    expect(list.find((h) => h.id === "hh-nguyen")?.careGuides).toEqual([]);
    expect(list.find((h) => h.id === "hh-okafor")?.careGuides).toEqual(["Maya Chen"]);
    expect((await t.as("st-tom")).assignedHouseholdIds.sort()).toEqual(["hh-lindqvist", "hh-patel"]);
    // Seven, Sofia's second-guide assignment on Hart (decision 40's seed) and hers on Wells.
    expect((await events("assignment.created")).length).toBe(9);
    expect((await events("assignment.ended")).length).toBe(1);
  });
});

describe("who can assign", () => {
  it("only hospice operations, and never family members", async () => {
    for (const who of ["st-maya", "st-tom", "st-priya", "fm-bao", "fm-daniel"])
      await expect(
        assignments.assignCareGuide(t.db, await t.as(who), { householdId: "hh-nguyen", actorId: "st-tom" }),
        who,
      ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    const id = (await assignmentId("st-maya", "hh-okafor"))!;
    await expect(
      assignments.endAssignment(t.db, await t.as("st-maya"), { membershipId: id, reason: REASON }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });

  it("only care guides of the same hospice can be assigned", async () => {
    const dana = await t.as("st-dana");
    for (const actorId of ["st-priya", "st-dana", "fm-bao", "cst-sam", "no-such-actor"])
      await expect(
        assignments.assignCareGuide(t.db, dana, { householdId: "hh-nguyen", actorId }),
        actorId,
      ).rejects.toMatchObject({ code: "INVALID" });
    expect(await assignmentId("st-priya", "hh-nguyen")).toBeUndefined();
  });

  it("only households in the caller's scope, and not closed ones", async () => {
    const dana = await t.as("st-dana");
    const other = await refusal(
      assignments.assignCareGuide(t.db, dana, { householdId: "chh-moss", actorId: "st-tom" }),
    );
    const missing = await refusal(
      assignments.assignCareGuide(t.db, dana, { householdId: "hh-nope", actorId: "st-tom" }),
    );
    expect(other).toBe(missing);
    await t.db.update(s.households).set({ lifecycleState: "closed" }).where(eq(s.households.id, "hh-nguyen"));
    await expect(
      assignments.assignCareGuide(t.db, dana, { householdId: "hh-nguyen", actorId: "st-tom" }),
    ).rejects.toThrow(/closed/);
  });
});

describe("assigning", () => {
  it("gives a new care guide exactly the assigned household, everywhere", async () => {
    const noor = await newCareGuide();
    expect((await staff.staffHome(t.db, await noor.ctx())).unassigned).toBe(true);
    expect(await staff.searchHouseholds(t.db, await noor.ctx(), "")).toEqual([]);
    await expect(staff.householdOverview(t.db, await noor.ctx(), "hh-nguyen")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });

    await assignments.assignCareGuide(t.db, await t.as("st-dana"), {
      householdId: "hh-nguyen",
      actorId: noor.actorId,
    });
    const ctx = await noor.ctx();
    const home = await staff.staffHome(t.db, ctx);
    expect(home.unassigned).toBe(false);
    expect(home.households.map((h) => h.id)).toEqual(["hh-nguyen"]);
    expect((await staff.searchHouseholds(t.db, ctx, "")).map((h) => h.id)).toEqual(["hh-nguyen"]);
    await expect(staff.householdOverview(t.db, ctx, "hh-nguyen")).resolves.toBeTruthy();
    expect(new Set((await sharing.listPackets(t.db, ctx)).map((p) => p.householdId))).toEqual(
      new Set(["hh-nguyen"]),
    );
    expect((await staff.coordinationQueue(t.db, ctx)).every((r) => r.householdId === "hh-nguyen")).toBe(true);
    // Still nothing else.
    await expect(staff.householdOverview(t.db, ctx, "hh-okafor")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    const [ev] = await events("assignment.created").then((r) =>
      r.filter(
        (e) =>
          e.actorId === "st-dana" &&
          e.householdId === "hh-nguyen" &&
          (e.context as { assignee?: string }).assignee === noor.actorId,
      ),
    );
    expect(ev).toBeTruthy();
  });

  it("refuses a duplicate calmly, even when two requests race", async () => {
    const dana = await t.as("st-dana");
    await expect(
      assignments.assignCareGuide(t.db, dana, { householdId: "hh-okafor", actorId: "st-maya" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const results = await Promise.allSettled([
      assignments.assignCareGuide(t.db, dana, { householdId: "hh-nguyen", actorId: "st-tom" }),
      assignments.assignCareGuide(t.db, dana, { householdId: "hh-nguyen", actorId: "st-tom" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const active = await t.db
      .select()
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.actorId, "st-tom"),
          eq(s.memberships.householdId, "hh-nguyen"),
          eq(s.memberships.status, "active"),
        ),
      );
    expect(active).toHaveLength(1);
  });

  it("allows several care guides on one household", async () => {
    await assignments.assignCareGuide(t.db, await t.as("st-dana"), {
      householdId: "hh-okafor",
      actorId: "st-tom",
    });
    const o = await staff.householdOverview(t.db, await t.as("st-dana"), "hh-okafor");
    expect(o.careTeam.guides.map((g) => g.name)).toEqual(["Maya Chen", "Tomás Alvarez"]);
    expect(o.careTeam.eligible.map((g) => g.actorId)).toEqual(["st-sofia"]);
  });

  it("shows the care team to everyone who can see the household, with controls only for operations", async () => {
    const asOps = (await staff.householdOverview(t.db, await t.as("st-dana"), "hh-okafor")).careTeam;
    expect(asOps).toMatchObject({ canManage: true, closed: false });
    expect(asOps.eligible.map((g) => g.actorId)).toEqual(["st-sofia", "st-tom"]);
    for (const who of ["st-maya", "st-priya"]) {
      const team = (await staff.householdOverview(t.db, await t.as(who), "hh-okafor")).careTeam;
      expect(team.guides.map((g) => g.name)).toEqual(["Maya Chen"]);
      expect(team).toMatchObject({ canManage: false, eligible: [] });
    }
  });

  it("counts only care-guide household rows as assignments", async () => {
    const noor = await newCareGuide();
    // A staff actor with some other household role is not an assignment (the service never writes one).
    await t.db.insert(s.memberships).values({
      tenantId: "t-willow",
      actorId: noor.actorId,
      householdId: "hh-nguyen",
      roleCode: "family_member",
    });
    const ctx = await noor.ctx();
    expect(ctx.assignedHouseholdIds).toEqual([]);
    await expect(staff.householdOverview(t.db, ctx, "hh-nguyen")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    const team = (await staff.householdOverview(t.db, await t.as("st-dana"), "hh-nguyen")).careTeam;
    expect(team.guides).toEqual([]);
  });
});

describe("ending an assignment", () => {
  it("takes the household away on the guide's next request, with the same refusal as a missing one", async () => {
    vi.stubEnv("ZEPORAH_DEV_SIGN_IN", "1");
    vi.stubEnv("NODE_ENV", "development");
    const token = await createSession(t.db, {
      tenantId: "t-willow",
      actorId: "st-maya",
      userId: null,
      method: "development_persona",
    });
    const before = (await actorForToken(t.db, token))!;
    await expect(staff.householdOverview(t.db, before, "hh-hart")).resolves.toBeTruthy();

    const id = (await assignmentId("st-maya", "hh-hart"))!;
    await assignments.endAssignment(t.db, await t.as("st-dana"), { membershipId: id, reason: REASON });

    const after = (await actorForToken(t.db, token))!;
    const hart = await refusal(staff.householdOverview(t.db, after, "hh-hart"));
    const missing = await refusal(staff.householdOverview(t.db, after, "hh-nope"));
    expect(hart).toBe(missing);
    expect((await staff.searchHouseholds(t.db, after, "")).some((h) => h.id === "hh-hart")).toBe(false);
    expect((await staff.coordinationQueue(t.db, after)).some((r) => r.householdId === "hh-hart")).toBe(false);
    expect((await sharing.listPackets(t.db, after)).some((p) => p.householdId === "hh-hart")).toBe(false);
    expect((await staff.listEscalations(t.db, after)).some((e) => e.householdId === "hh-hart")).toBe(false);
    const denied = await t.db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.action, "access.denied"), eq(s.auditEvents.actorId, "st-maya")));
    expect(denied.some((e) => e.subjectId === "hh-hart")).toBe(true);
    // Her other households are untouched.
    await expect(staff.householdOverview(t.db, after, "hh-okafor")).resolves.toBeTruthy();
  });

  it("keeps the row as ended, with when and why, and audits it", async () => {
    const id = (await assignmentId("st-maya", "hh-hart"))!;
    await assignments.endAssignment(t.db, await t.as("st-dana"), {
      membershipId: id,
      reason: `  ${REASON}  `,
    });
    const [m] = await t.db.select().from(s.memberships).where(eq(s.memberships.id, id));
    expect(m).toMatchObject({ status: "ended", endReason: REASON });
    expect(m!.endedAt).toBeInstanceOf(Date);
    const ended = (await events("assignment.ended")).filter((e) => e.subjectId === id);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ actorId: "st-dana", householdId: "hh-hart", visibility: "staff" });
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });

  it("needs a reason, ends once, and can't touch family memberships or other tenants", async () => {
    const dana = await t.as("st-dana");
    const id = (await assignmentId("st-maya", "hh-hart"))!;
    await expect(
      assignments.endAssignment(t.db, dana, { membershipId: id, reason: "  " }),
    ).rejects.toMatchObject({
      code: "INVALID",
    });
    await assignments.endAssignment(t.db, dana, { membershipId: id, reason: REASON });
    await expect(
      assignments.endAssignment(t.db, dana, { membershipId: id, reason: REASON }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const [familyRow] = await t.db.select().from(s.memberships).where(eq(s.memberships.actorId, "fm-daniel"));
    const [cedarRow] = await t.db
      .select()
      .from(s.memberships)
      .where(and(eq(s.memberships.actorId, "cst-sam"), eq(s.memberships.householdId, "chh-moss")));
    for (const row of [familyRow!, cedarRow!])
      await expect(
        assignments.endAssignment(t.db, dana, { membershipId: row.id, reason: REASON }),
      ).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
  });

  it("releases open escalations the departing guide owned in that household, and only those", async () => {
    const dana = await t.as("st-dana");
    const [hart] = await t.db.select().from(s.escalations).where(eq(s.escalations.householdId, "hh-hart"));
    expect(hart).toMatchObject({ ownerActorId: "st-maya", status: "acknowledged" });
    const [bennett] = await t.db
      .select()
      .from(s.escalations)
      .where(eq(s.escalations.householdId, "hh-bennett"));

    await assignments.endAssignment(t.db, dana, {
      membershipId: (await assignmentId("st-maya", "hh-hart"))!,
      reason: REASON,
    });

    const [after] = await t.db.select().from(s.escalations).where(eq(s.escalations.id, hart!.id));
    expect(after).toMatchObject({ ownerActorId: null, status: "open" });
    const [untouched] = await t.db.select().from(s.escalations).where(eq(s.escalations.id, bennett!.id));
    expect(untouched).toMatchObject({ ownerActorId: bennett!.ownerActorId, status: bennett!.status });
    const released = await events("escalation.owner_released");
    expect(released.map((e) => e.subjectId)).toEqual([hart!.id]);

    // The queue says so plainly: no owner, and why it changed.
    const row = (await staff.coordinationQueue(t.db, dana)).find(
      (r) => r.kind === "escalation" && r.householdId === "hh-hart",
    );
    // owner: null is shown as NO_OWNER ("No owner assigned") on screen.
    expect(row).toMatchObject({ owner: null, next: "Take ownership", priority: "high" });
    expect(NO_OWNER).toBe("No owner assigned");
    expect(row?.lastAction).toMatchObject({
      actor: "Dana Brooks",
      did: "released ownership",
    });
    // Someone still assigned can take it again.
    await assignments.assignCareGuide(t.db, dana, { householdId: "hh-hart", actorId: "st-tom" });
    await staff.updateEscalation(t.db, await t.as("st-tom"), { id: hart!.id, action: "take" });
  });

  it("hides that household's notifications from the guide, but not others", async () => {
    await t.db.insert(s.notifications).values([
      {
        tenantId: "t-willow",
        recipientActorId: "st-maya",
        householdId: "hh-hart",
        kind: "support",
        title: "Hart item (synthetic)",
        link: "/staff/households/hh-hart",
      },
      {
        tenantId: "t-willow",
        recipientActorId: "st-maya",
        householdId: "hh-okafor",
        kind: "support",
        title: "Okafor item (synthetic)",
        link: "/staff/households/hh-okafor",
      },
      {
        tenantId: "t-willow",
        recipientActorId: "st-maya",
        householdId: null,
        kind: "system",
        title: "General item (synthetic)",
        link: "/staff",
      },
    ]);
    const titles = async () =>
      (await notifications.listNotifications(t.db, await t.as("st-maya"))).map((n) => n.title);
    const unreadBefore = await notifications.unreadCount(t.db, await t.as("st-maya"));
    expect(await titles()).toEqual(
      expect.arrayContaining([
        "Hart item (synthetic)",
        "Okafor item (synthetic)",
        "General item (synthetic)",
      ]),
    );

    await assignments.endAssignment(t.db, await t.as("st-dana"), {
      membershipId: (await assignmentId("st-maya", "hh-hart"))!,
      reason: REASON,
    });
    const now = await titles();
    expect(now).not.toContain("Hart item (synthetic)");
    expect(now).toEqual(expect.arrayContaining(["Okafor item (synthetic)", "General item (synthetic)"]));
    expect(await notifications.unreadCount(t.db, await t.as("st-maya"))).toBeLessThan(unreadBefore);
  });
});

describe("unchanged boundaries", () => {
  it("operations and reviewers still see the whole organization, and only it", async () => {
    for (const who of ["st-dana", "st-priya"]) {
      const ids = (await staff.searchHouseholds(t.db, await t.as(who), "")).map((h) => h.id);
      expect(ids).toContain("hh-nguyen");
      expect(ids).not.toContain("chh-moss");
    }
  });

  it("family members keep their household view; the care guide shown follows the assignment", async () => {
    const daniel = await t.as("fm-daniel");
    await expect(family.familyHome(t.db, daniel)).resolves.toBeTruthy();
    await assignments.endAssignment(t.db, await t.as("st-dana"), {
      membershipId: (await assignmentId("st-maya", "hh-okafor"))!,
      reason: REASON,
    });
    await expect(family.familyHome(t.db, await t.as("fm-daniel"))).resolves.toBeTruthy();
    const people = await family.listPeople(t.db, await t.as("fm-daniel"));
    expect(people.careTeam).toEqual([]);
  });

  it("Chidi still reaches only consents naming him", async () => {
    const chidi = await t.as("fm-chidi");
    await expect(family.listHouseholdConsents(t.db, chidi)).rejects.toThrow();
    await expect(family.consentsForMe(t.db, chidi)).resolves.toBeDefined();
  });
});

describe("database protections", () => {
  it("refuse a second active row and an ended row without when or why", async () => {
    await expect(
      t.db.insert(s.memberships).values({
        tenantId: "t-willow",
        actorId: "st-maya",
        householdId: "hh-okafor",
        roleCode: "care_guide",
      }),
    ).rejects.toThrow();
    const id = (await assignmentId("st-maya", "hh-okafor"))!;
    await expect(
      t.db.update(s.memberships).set({ status: "ended" }).where(eq(s.memberships.id, id)),
    ).rejects.toThrow();
    await expect(
      t.db
        .update(s.memberships)
        .set({ status: "ended", endedAt: new Date(), endReason: " " })
        .where(eq(s.memberships.id, id)),
    ).rejects.toThrow();
    await expect(
      t.db.update(s.memberships).set({ endReason: "x" }).where(eq(s.memberships.id, id)),
    ).rejects.toThrow();
  });
});
