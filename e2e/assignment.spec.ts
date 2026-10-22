import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import {
  SYNTHETIC_PASSWORD,
  expectAccessible,
  expectNoSidewaysScroll,
  issuedLink,
  open,
  resetData,
  signInAs,
  signInWithPassword,
  signOutFromShell,
} from "./helpers";

/**
 * Care-guide assignment, end to end: a newly invited care guide sees nothing until hospice
 * operations assigns a household, sees exactly that household, and loses it when the assignment
 * ends. The seeded Nguyen household has no care guide.
 */
test.beforeEach(async ({ page }) => resetData(page));

const EMAIL = "noor.haddad@example.invalid";
const UNASSIGNED = "You aren't assigned to any households yet";

async function nguyenOverview(page: Page) {
  await open(page, "/staff/households/hh-nguyen?tab=overview");
  await expect(page.getByRole("heading", { name: "Care team" })).toBeVisible();
}

test("invite → accept → empty state → assign → visible → end → refused", async ({ page }) => {
  // Operations invites a care guide.
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/settings?section=invitations");
  await page.getByLabel("Their name").fill("Noor Haddad");
  await page.getByLabel("Their email").fill(EMAIL);
  await page.getByLabel("Role").selectOption("care_guide");
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = await issuedLink(page);
  await signOutFromShell(page);

  // The care guide joins and sees an explicit empty state, not someone else's data.
  await open(page, link);
  await page.getByLabel("Create a password").fill(SYNTHETIC_PASSWORD);
  await page.getByLabel("Confirm the password").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByText(UNASSIGNED)).toBeVisible();
  await expectAccessible(page);
  await open(page, "/staff/households");
  await expect(page.getByText(UNASSIGNED)).toBeVisible();
  await expectAccessible(page);
  await open(page, "/staff/households/hh-nguyen?tab=overview");
  await expect(page.getByText(/isn't available to you/).first()).toBeVisible();
  await signOutFromShell(page);

  // Operations finds the unassigned household and assigns the new guide, by keyboard.
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/households");
  const row = page.getByRole("row", { name: /The Nguyen household/ });
  await expect(row).toContainText("Not assigned");
  await expectAccessible(page);
  await nguyenOverview(page);
  await expect(page.getByText("No care guide assigned.")).toBeVisible();
  const select = page.getByLabel("Assign a care guide");
  await select.focus();
  await select.selectOption({ label: "Noor Haddad (0 households)" });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Assign to this household" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("live-region")).toHaveText("Noor Haddad was assigned to this household.");
  await expect(page.getByRole("button", { name: "End assignment for Noor Haddad" })).toBeVisible();
  await expectAccessible(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await expectNoSidewaysScroll(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await signOutFromShell(page);

  // The guide now sees exactly that household.
  await signInWithPassword(page, EMAIL, SYNTHETIC_PASSWORD, "/staff-sign-in");
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByText(UNASSIGNED)).toHaveCount(0);
  // Their home now shows the household's latest change (decision 58, workstream 4).
  await expect(page.locator('[data-widget="changed"]')).toContainText("The Nguyen household");
  await open(page, "/staff/households");
  await expect(page.getByRole("row")).toHaveCount(2);
  await nguyenOverview(page);
  await expect(page.getByRole("heading", { level: 1, name: "The Nguyen household" })).toBeVisible();
  // A care guide sees the team but can't change it.
  await expect(page.getByRole("button", { name: /End assignment/ })).toHaveCount(0);
  await expect(page.getByLabel("Assign a care guide")).toHaveCount(0);
  await signOutFromShell(page);

  // Operations ends the assignment through a dialog that needs a reason.
  await signInAs(page, "Dana Brooks");
  await nguyenOverview(page);
  const trigger = page.getByRole("button", { name: "End assignment for Noor Haddad" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "End Noor Haddad's assignment?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "End assignment", exact: true })).toBeDisabled();
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByLabel("Reason").fill("Caseload change (synthetic).");
  await dialog.getByRole("button", { name: "End assignment", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("live-region")).toHaveText("Noor Haddad's assignment ended.");
  await expect(page.getByText("No care guide assigned.")).toBeVisible();
  await signOutFromShell(page);

  // The guide is back to the empty state, and the household is refused like any other.
  await signInWithPassword(page, EMAIL, SYNTHETIC_PASSWORD, "/staff-sign-in");
  await expect(page.getByText(UNASSIGNED)).toBeVisible();
  await open(page, "/staff/households/hh-nguyen?tab=overview");
  await expect(page.getByText(/isn't available to you/).first()).toBeVisible();
  await expect(page.getByText("Linh Nguyen")).toHaveCount(0);
});

test("care guides and reviewers can't change a care team", async ({ page }) => {
  for (const who of ["Maya Chen", "Priya Raman"]) {
    await signInAs(page, who);
    await open(page, "/staff/households/hh-okafor?tab=overview");
    await expect(page.getByRole("heading", { name: "Care team" })).toBeVisible();
    await expect(page.getByText("Maya Chen").first()).toBeVisible();
    await expect(page.getByLabel("Assign a care guide")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /End assignment/ })).toHaveCount(0);
  }
});

test("operations sees coverage, assigns an uncovered household and reassigns another", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Team & coverage" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Team & coverage" })).toBeVisible();
  const uncovered = page.getByRole("region", { name: /Households without a care guide/ });
  await expect(uncovered).toContainText("The Nguyen household");
  await expectAccessible(page);

  await uncovered
    .getByLabel("Assign a care guide to The Nguyen household")
    .selectOption({ label: "Tomás Alvarez (2 households)" });
  await uncovered.getByRole("button", { name: "Assign to The Nguyen household" }).click();
  await expect(page.getByTestId("live-region")).toHaveText(
    "Tomás Alvarez was assigned to The Nguyen household.",
  );
  await expect(page.getByText("Every household has a care guide")).toBeVisible();

  // Reassign Hart from Maya to Tomás, with a reason.
  await page.getByRole("button", { name: "Reassign The Hart household from Maya Chen" }).click();
  const dialog = page.getByRole("dialog", { name: "Reassign The Hart household" });
  await expect(dialog.getByRole("button", { name: "Reassign", exact: true })).toBeDisabled();
  await expectAccessible(page);
  await dialog.getByLabel("New care guide").selectOption({ label: "Tomás Alvarez" });
  await dialog.getByLabel("Reason").fill("Caseload change (synthetic).");
  await dialog.getByRole("button", { name: "Reassign", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("live-region")).toHaveText("The Hart household is now with Tomás Alvarez.");
  // Each care guide is a group of rows in the Care guides table (Team & coverage review).
  const tomas = page.locator("tbody").filter({ has: page.getByRole("rowheader", { name: "Tomás Alvarez" }) });
  await expect(tomas).toContainText("4 households");
  await expect(tomas).toContainText("The Hart household");
  await page.setViewportSize({ width: 820, height: 1180 });
  await expectNoSidewaysScroll(page);
});

test("the Team page is for operations only", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Team & coverage" }),
  ).toHaveCount(0);
  await open(page, "/staff/team");
  await expect(page.getByRole("heading", { name: /isn't available|not available/i }).first()).toBeVisible();
  await expect(page.getByText("The Nguyen household")).toHaveCount(0);
});
