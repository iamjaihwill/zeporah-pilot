import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ROLES } from "@/domain/model";
import { roleAllows } from "@/domain/permissions";
import { hasProtectedAccess } from "@/domain/lifecycle";

/** The vault labels name exactly who can see an item (interaction review, item 8). */
describe("vault visibility labels match the rules", () => {
  it("'patient, coordinator and proxy' is exactly the roles that can open the vault", () => {
    expect(HOUSEHOLD_ROLES.filter((r) => roleAllows(r, "vault.view")).sort()).toEqual(
      ["coordinator", "patient", "proxy"].sort(),
    );
  });
  it("'the patient and people with active authority' is the protected-access rule", () => {
    expect(hasProtectedAccess({ roles: ["patient"], lifecycle: "active_hospice", activeAuthorityTypes: [] })).toBe(true);
    expect(hasProtectedAccess({ roles: ["coordinator"], lifecycle: "active_hospice", activeAuthorityTypes: [] })).toBe(false);
  });
});
