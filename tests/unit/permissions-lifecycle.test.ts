import { describe, expect, it } from "vitest";
import { can, roleAllows } from "@/domain/permissions";
import { canTransition, hasProtectedAccess } from "@/domain/lifecycle";
import { HOUSEHOLD_ROLES, LIFECYCLE_STATES } from "@/domain/model";

describe("permissions", () => {
  it("denies anything a role doesn't explicitly list", () => {
    expect(roleAllows("external_recipient", "household.view")).toBe(false);
    expect(roleAllows("family_member", "vault.view")).toBe(false);
    expect(roleAllows("care_guide", "packet.release")).toBe(false);
    expect(roleAllows("hospice_ops", "authority.review")).toBe(false);
  });

  it("never lets a household role release packets or review authority", () => {
    for (const role of HOUSEHOLD_ROLES) {
      expect(roleAllows(role, "packet.release"), role).toBe(false);
      expect(roleAllows(role, "authority.review"), role).toBe(false);
      expect(roleAllows(role, "staff.note.view"), role).toBe(false);
    }
  });

  it("keeps internal notes away from every family role", () => {
    expect(HOUSEHOLD_ROLES.some((r) => roleAllows(r, "staff.note.view"))).toBe(false);
  });

  it("ends the patient's own permissions at bereavement but keeps the coordinator's practical ones", () => {
    expect(can(["patient"], "thread.send", "active_hospice")).toBe(true);
    expect(can(["patient"], "thread.send", "bereavement")).toBe(false);
    expect(can(["coordinator"], "tasks.view", "bereavement")).toBe(true);
    expect(can(["coordinator"], "thread.send", "bereavement")).toBe(true);
  });

  it("closes everything but read-only history when a household is closed", () => {
    expect(can(["coordinator"], "thread.send", "closed")).toBe(false);
    expect(can(["coordinator"], "updates.view", "closed")).toBe(true);
    expect(can(["hospice_ops"], "packet.release", "closed")).toBe(false);
  });
});

describe("lifecycle", () => {
  it("allows only the defined transitions", () => {
    expect(canTransition("active_hospice", "bereavement")).toBe(true);
    expect(canTransition("enrolled", "active_hospice")).toBe(true);
    expect(canTransition("bereavement", "active_hospice")).toBe(false);
    expect(canTransition("closed", "bereavement")).toBe(false);
    for (const s of LIFECYCLE_STATES) expect(canTransition(s, s), s).toBe(false);
  });

  it("never opens protected access from a household role alone", () => {
    expect(
      hasProtectedAccess({ roles: ["coordinator"], lifecycle: "active_hospice", activeAuthorityTypes: [] }),
    ).toBe(false);
    expect(
      hasProtectedAccess({ roles: ["proxy"], lifecycle: "active_hospice", activeAuthorityTypes: [] }),
    ).toBe(false);
  });

  it("lets the patient and an active authority holder see protected items while care is active", () => {
    expect(
      hasProtectedAccess({ roles: ["patient"], lifecycle: "active_hospice", activeAuthorityTypes: [] }),
    ).toBe(true);
    expect(
      hasProtectedAccess({
        roles: ["proxy"],
        lifecycle: "active_hospice",
        activeAuthorityTypes: ["healthcare_agent"],
      }),
    ).toBe(true);
  });

  it("narrows protected access at bereavement: care-period authority ends, a personal representative continues", () => {
    expect(
      hasProtectedAccess({
        roles: ["proxy"],
        lifecycle: "bereavement",
        activeAuthorityTypes: ["healthcare_agent"],
      }),
    ).toBe(false);
    expect(
      hasProtectedAccess({ roles: ["patient"], lifecycle: "bereavement", activeAuthorityTypes: [] }),
    ).toBe(false);
    expect(
      hasProtectedAccess({
        roles: ["coordinator"],
        lifecycle: "bereavement",
        activeAuthorityTypes: ["personal_representative"],
      }),
    ).toBe(true);
    expect(
      hasProtectedAccess({
        roles: ["coordinator"],
        lifecycle: "closed",
        activeAuthorityTypes: ["personal_representative"],
      }),
    ).toBe(false);
  });
});
