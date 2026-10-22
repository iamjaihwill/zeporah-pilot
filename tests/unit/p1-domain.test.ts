import { describe, expect, it } from "vitest";
import { CORRECTION_CATEGORIES, CORRECTION_CATEGORY_LABELS, selfConfirmBlocker } from "@/domain/consent";
import { actionLabel, ageLabel, byPriorityThenAge, NO_ACTION, NO_OWNER, type QueueRow } from "@/domain/queue";
import { roleAllows } from "@/domain/permissions";

describe("why a named person can't confirm in the app", () => {
  const base = {
    member: true,
    roles: ["proxy" as const],
    lifecycle: "active_hospice" as const,
    activeAuthorityTypes: [],
  };
  it("gives no reason when they can", () => {
    expect(selfConfirmBlocker({ ...base, roles: ["patient"] })).toBeNull();
    expect(selfConfirmBlocker({ ...base, activeAuthorityTypes: ["healthcare_agent"] })).toBeNull();
  });
  it("explains each case in plain words, never inferring capacity", () => {
    expect(selfConfirmBlocker({ ...base, member: false })).toMatch(/aren't a current member/);
    expect(selfConfirmBlocker({ ...base, lifecycle: "closed" })).toMatch(/closed/);
    expect(selfConfirmBlocker({ ...base, roles: ["patient"], lifecycle: "bereavement" })).toMatch(
      /patient's own access has ended/,
    );
    expect(
      selfConfirmBlocker({ ...base, lifecycle: "bereavement", activeAuthorityTypes: ["healthcare_agent"] }),
    ).toMatch(/doesn't allow confirming consent at this stage/);
    expect(selfConfirmBlocker({ ...base, roles: ["family_member"] })).toMatch(
      /Being in the household isn't enough/,
    );
  });
});

describe("correction categories", () => {
  it("has a plain label for each, including a free 'something else'", () => {
    for (const k of CORRECTION_CATEGORIES) expect(CORRECTION_CATEGORY_LABELS[k]).toBeTruthy();
    expect(CORRECTION_CATEGORIES).toContain("other");
  });
});

describe("queue row helpers", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
  it("words age as a stable duration", () => {
    expect(ageLabel(ago(0.2), now)).toBe("under an hour");
    expect(ageLabel(ago(1), now)).toBe("1 hour");
    expect(ageLabel(ago(5.9), now)).toBe("5 hours");
    expect(ageLabel(ago(24), now)).toBe("1 day");
    expect(ageLabel(ago(24 * 13), now)).toBe("13 days");
    expect(ageLabel(ago(24 * 21), now)).toBe("3 weeks");
    expect(ageLabel(new Date(now.getTime() + 1000), now)).toBe("under an hour"); // clock skew never goes negative
  });
  it("orders high, normal, routine, then longest waiting", () => {
    const row = (priority: QueueRow["priority"], h: number) => ({ priority, since: ago(h) }) as QueueRow;
    const sorted = [row("routine", 50), row("high", 1), row("normal", 9), row("high", 30)].sort(
      byPriorityThenAge,
    );
    expect(sorted.map((r) => [r.priority, (now.getTime() - r.since.getTime()) / 3_600_000])).toEqual([
      ["high", 30],
      ["high", 1],
      ["normal", 9],
      ["routine", 50],
    ]);
  });
  it("labels audit actions without ever using their summaries, and says plainly when nothing is known", () => {
    expect(actionLabel("consent.correction_requested")).toBe("asked for a correction");
    expect(actionLabel("something.new")).toBe("updated it");
    expect(NO_OWNER).toBe("No owner assigned");
    expect(NO_ACTION).toBe("No recorded action yet");
  });
});

describe("hospice settings permission", () => {
  it("belongs to hospice operations only", () => {
    expect(roleAllows("hospice_ops", "org.settings.manage")).toBe(true);
    for (const r of [
      "care_guide",
      "privileged_reviewer",
      "coordinator",
      "patient",
      "proxy",
      "family_member",
    ] as const)
      expect(roleAllows(r, "org.settings.manage"), r).toBe(false);
  });
});
