import { getRouteApi } from "@tanstack/react-router";
import { ButtonLink } from "@/components/ui";
import { can } from "@/domain/permissions";
import type { RoleCode } from "@/domain/model";

const staffApi = getRouteApi("/staff");

/** True for staff whose roles open households (everyone but administrators, decision 39). */
export function useOpensHouseholds() {
  const { me } = staffApi.useLoaderData();
  return can(me.roleCodes as RoleCode[], "staff.household.view");
}

/** Where to go from a household page that refused: Households, or Administration for administrators. */
export function BackFromHousehold() {
  return useOpensHouseholds() ? (
    <ButtonLink to="/staff/households">Back to households</ButtonLink>
  ) : (
    <ButtonLink to="/staff/admin">Back to Administration</ButtonLink>
  );
}
