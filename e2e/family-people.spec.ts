import { expect, test } from "./fixtures";
import {
  SYNTHETIC_PASSWORD,
  expectAccessible,
  expectNoSidewaysScroll,
  issuedLink,
  open,
  resetData,
  signInAs,
  signOutFromShell,
} from "./helpers";

/** A household manages its own members: role changes and removal, with guards around consent and authority. */
test.beforeEach(async ({ page }) => resetData(page));

test("a coordinator changes a member's role and removes them", async ({ page }) => {
  await signInAs(page, "Marisol Rivera");
  await open(page, "/family/people");
  await page.getByLabel("Their name").fill("Luis Rivera");
  await page.getByLabel("Email", { exact: true }).fill("luis.people@example.invalid");
  await page.getByRole("button", { name: "Review access" }).click();
  await page.getByRole("button", { name: "Record invitation" }).click();
  const link = await issuedLink(page);
  await signOutFromShell(page);
  await open(page, link);
  await page.getByLabel("Create a password").fill(SYNTHETIC_PASSWORD);
  await page.getByLabel("Confirm the password").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page).toHaveURL(/\/family$/);
  await signOutFromShell(page);

  await signInAs(page, "Marisol Rivera");
  await open(page, "/family/people");
  await page.getByLabel("Role for Luis Rivera").selectOption("proxy");
  await page.getByRole("button", { name: "Change role for Luis Rivera" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Luis Rivera's role is now proxy.");
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  await page.getByRole("button", { name: "Remove Luis Rivera from the household" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove Luis Rivera from your household?" });
  await expect(dialog).toContainText("you can invite them again later");
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText(
    "Luis Rivera is no longer part of your household.",
  );
  await expect(page.getByRole("region", { name: "Your household" })).not.toContainText("Luis Rivera");
});

test("changes are held back while someone is named on a consent", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/people");
  const household = page.getByRole("region", { name: "Your household" });
  await expect(household).toContainText("as the person giving consent");
  await expect(page.getByRole("button", { name: "Remove Chidi Okafor from the household" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Remove Grace Okafor/ })).toHaveCount(0);
});
