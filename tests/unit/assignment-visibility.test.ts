import { describe, expect, it } from "vitest";
import { roleAllows } from "@/domain/permissions";
import { HOUSEHOLD_ROLES, STAFF_ROLES } from "@/domain/model";
import { staffSeesHousehold, type ActorContext } from "@/server/context";

const ctx = (over: Partial<ActorContext>): ActorContext => ({
  actorId: "a",
  tenantId: "t1",
  kind: "staff",
  displayName: "A",
  organizationId: "org1",
  staffRoles: ["care_guide"],
  assignedHouseholdIds: [],
  householdRoles: [],
  ...over,
});
const hh = (id: string, over: Partial<{ tenantId: string; organizationId: string }> = {}) => ({
  id,
  tenantId: "t1",
  organizationId: "org1",
  ...over,
});

describe("staff.assignment.manage", () => {
  it("belongs to hospice operations and administrators only (decision 39)", () => {
    expect(STAFF_ROLES.filter((r) => roleAllows(r, "staff.assignment.manage"))).toEqual([
      "hospice_ops",
      "hospice_admin",
    ]);
    expect(HOUSEHOLD_ROLES.some((r) => roleAllows(r, "staff.assignment.manage"))).toBe(false);
  });
});

describe("staffSeesHousehold", () => {
  it("shows a care guide only their assigned households", () => {
    const guide = ctx({ assignedHouseholdIds: ["h1"] });
    expect(staffSeesHousehold(guide, hh("h1"))).toBe(true);
    expect(staffSeesHousehold(guide, hh("h2"))).toBe(false);
    expect(staffSeesHousehold(ctx({}), hh("h1"))).toBe(false);
  });

  it("shows operations and reviewers their whole organization", () => {
    for (const r of ["hospice_ops", "privileged_reviewer"] as const)
      expect(staffSeesHousehold(ctx({ staffRoles: [r] }), hh("h9"))).toBe(true);
  });

  it("never crosses an organization or tenant, even with a stale assignment", () => {
    const guide = ctx({ assignedHouseholdIds: ["h1"] });
    expect(staffSeesHousehold(guide, hh("h1", { organizationId: "org2" }))).toBe(false);
    expect(staffSeesHousehold(guide, hh("h1", { tenantId: "t2" }))).toBe(false);
    const ops = ctx({ staffRoles: ["hospice_ops"] });
    expect(staffSeesHousehold(ops, hh("h1", { organizationId: "org2" }))).toBe(false);
    expect(staffSeesHousehold(ctx({ staffRoles: ["hospice_ops"], organizationId: null }), hh("h1"))).toBe(
      false,
    );
  });

  it("never applies to family members", () => {
    expect(
      staffSeesHousehold(ctx({ kind: "family", staffRoles: [], assignedHouseholdIds: ["h1"] }), hh("h1")),
    ).toBe(false);
  });
});
