import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as os from "@/server/services/org-settings";
import * as staff from "@/server/services/staff";
import * as family from "@/server/services/family";
import * as ht from "@/server/services/household-tasks";
import * as assignments from "@/server/services/assignments";
import * as reports from "@/server/services/reports";
import * as shell from "@/server/services/staff-shell";
import * as s from "@/server/db/schema";
import { DEFAULT_ORG_SETTINGS } from "@/domain/org-settings";

/** Founder decision 39: the settings that weren't configurable before. Defaults change nothing. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const dana = () => t.as("st-dana");
const lena = () => t.as("st-lena");
const set = async (
  who: () => ReturnType<typeof dana>,
  group: keyof typeof DEFAULT_ORG_SETTINGS,
  value: unknown,
) => os.updateSettingsGroup(t.db, await who(), { group, value });

describe("who changes what", () => {
  it("operations change workflow groups; only administrators change access and retention", async () => {
    await set(dana, "queue", { messageHighAfterHours: 4, routineNormalAfterDays: null });
    await expect(
      set(dana, "access", { taskHelperMaxDays: 30, collaborationMaxDays: 90 }),
    ).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
    await expect(
      set(dana, "retention", { closedHouseholdsMonths: 12, messagesMonths: null }),
    ).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
    await set(lena, "access", { taskHelperMaxDays: 30, collaborationMaxDays: 90 });
    await set(lena, "reports", { defaultReport: "work", defaultDays: 7 }); // administrators may change workflow too
    await expect(
      set(() => t.as("st-maya"), "queue", { messageHighAfterHours: 1, routineNormalAfterDays: null }),
    ).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
  });

  it("validates values and records before and after", async () => {
    await expect(
      set(dana, "queue", { messageHighAfterHours: -1, routineNormalAfterDays: null }),
    ).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(
      set(dana, "taskCatalog", [
        { id: "a", title: "Give the morphine dose", detail: "", audience: "family", dueInDays: null },
      ]),
    ).rejects.toMatchObject({ code: "INVALID" });
    await set(dana, "notifications", { cadence: "daily_summary", quietStart: "20:00", quietEnd: "08:00" });
    const [ev] = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "settings.changed"));
    expect(ev?.context).toMatchObject({
      group: "notifications",
      before: DEFAULT_ORG_SETTINGS.notifications,
      after: { cadence: "daily_summary" },
    });
  });

  it("is scoped to the caller's own hospice", async () => {
    await set(() => t.as("cst-jordan", "t-cedar"), "queue", {
      messageHighAfterHours: 1,
      routineNormalAfterDays: null,
    });
    expect((await os.settingsView(t.db, await dana())).values.queue.messageHighAfterHours).toBeNull();
  });
});

describe("each setting takes effect", () => {
  it("defaults leave the queue exactly as it was", async () => {
    const before = await staff.coordinationQueue(t.db, await dana());
    expect(before.find((q) => q.kind === "message")?.priority).toBe("normal");
  });

  it("queue thresholds raise waiting items", async () => {
    await set(dana, "queue", { messageHighAfterHours: 1, routineNormalAfterDays: 1 });
    const q = await staff.coordinationQueue(t.db, await dana());
    const msg = q.find((x) => x.kind === "message")!;
    expect(msg).toMatchObject({ priority: "high" });
    expect(msg.priorityReason).toMatch(/hospice setting/);
    expect(q.some((x) => x.priority === "routine" && x.priorityReason !== "Routine follow-up")).toBe(false);
  });

  it("assignment defaults reach the team and household pages", async () => {
    await set(dana, "assignment", { handOverByDefault: true, caseloadWarnAt: 3 });
    expect((await assignments.roster(t.db, await dana())).defaults).toEqual({
      handOverByDefault: true,
      caseloadWarnAt: 3,
    });
    expect(
      (await staff.householdOverview(t.db, await dana(), "hh-okafor")).careTeam.defaults.caseloadWarnAt,
    ).toBe(3);
  });

  it("the task catalog is offered to staff (all) and households (household tasks only)", async () => {
    await set(dana, "taskCatalog", [
      { id: "a", title: "Book a volunteer driver", detail: "", audience: "family", dueInDays: 3 },
      { id: "b", title: "Check equipment delivery", detail: "", audience: "staff", dueInDays: null },
    ]);
    expect((await staff.householdOverview(t.db, await dana(), "hh-okafor")).taskCatalog).toHaveLength(2);
    expect((await ht.taskFormOptions(t.db, await t.as("fm-daniel"))).catalog.map((x) => x.id)).toEqual(["a"]);
  });

  it("notification defaults apply to someone who hasn't chosen yet", async () => {
    await set(dana, "notifications", { cadence: "essential_only", quietStart: "20:00", quietEnd: "09:00" });
    const o = await family.getOnboarding(t.db, await t.as("fm-marisol"));
    expect(o.prefDefaults).toEqual({
      notificationCadence: "essential_only",
      quietHoursStart: "20:00",
      quietHoursEnd: "09:00",
    });
  });

  it("report views set what opens first", async () => {
    await set(dana, "reports", { defaultReport: "exceptions", defaultDays: 90 });
    expect((await reports.reportSet(t.db, await dana())).defaults).toEqual({
      defaultReport: "exceptions",
      defaultDays: 90,
    });
  });

  it("status wording reaches the workspace", async () => {
    await set(dana, "statusLabels", { task: { open: "To do", done: "" }, escalation: {} });
    expect((await shell.staffShell(t.db, await dana())).statusLabels).toEqual({
      task: { open: "To do" },
      escalation: {},
    });
  });

  it("access limits cap helper and collaboration invitations", async () => {
    await set(lena, "access", { taskHelperMaxDays: 7, collaborationMaxDays: 30 });
    await expect(
      family.inviteContact(t.db, await t.as("fm-daniel"), {
        name: "X",
        contact: "x@example.invalid",
        role: "helper",
        accessModel: "task",
        taskId: "tk-2",
        accessEndsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      }),
    ).rejects.toThrow(/up to 7 days/);
  });

  it("retention rules count records for review and delete nothing", async () => {
    await set(lena, "retention", { closedHouseholdsMonths: 1, messagesMonths: 1 });
    const before = (await t.db.select().from(s.messages)).length;
    const r = await os.retentionReview(t.db, await lena(), new Date(Date.now() + 400 * 86_400_000));
    expect(r.messagesPast).toBeGreaterThan(0);
    expect((await t.db.select().from(s.messages)).length).toBe(before);
    await expect(os.retentionReview(t.db, await dana())).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });
});

describe("exception thresholds (decision 58)", () => {
  it("default to the plan's values, and operations change them within limits, with before and after", async () => {
    expect(DEFAULT_ORG_SETTINGS.exceptions).toEqual({
      handoffAcceptHours: 24,
      recipientUnopenedHours: 48,
      accessEndingDays: 7,
      ackOverdueHours: 24,
      noTeamContactDays: 5,
      coordinationRiskOpenCount: 3,
    });
    const next = { ...DEFAULT_ORG_SETTINGS.exceptions, handoffAcceptHours: 12 };
    await set(dana, "exceptions", next);
    await expect(set(dana, "exceptions", { ...next, coordinationRiskOpenCount: 1 })).rejects.toBeTruthy();
    const [e] = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "settings.changed"));
    expect(e?.context).toMatchObject({ group: "exceptions", actorRoles: ["hospice_ops"] });
  });
});
