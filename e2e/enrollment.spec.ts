import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** Enrollment and getting started (founder decisions 66–70), with a synthetic patient. */
test.beforeEach(async ({ page }) => resetData(page));

test("operations enrolls a household with just a name, and its record opens on Getting started", async ({
  page,
}) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/households");
  await page.getByRole("button", { name: "Enroll a household" }).click();
  const card = page.getByRole("region", { name: "Enroll a household" });
  await expect(card).toContainText("It doesn't admit anyone to hospice care");
  await expect(card.getByTestId("pilot-count")).toContainText("households in the pilot");
  await card.getByLabel("Patient's name").fill("Avery Stone (synthetic)");
  await card.getByLabel("Care guide who gets it started").selectOption({ label: "Maya Chen" });
  await expectAccessible(page);
  await card.getByRole("button", { name: "Enroll", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Household enrolled.");
  await expect(page).toHaveURL(/\/staff\/households\/[^/?]+/);
  await expect(page.getByRole("region", { name: "Getting started" })).toBeVisible();
  await expectAccessible(page);

  await open(page, "/staff/households");
  await expect(page.getByTestId("household-count")).toHaveText("9 households");
});

test("care guides don't get the enroll form", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enroll a household" })).toHaveCount(0);
});
