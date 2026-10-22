import { expect, test } from "./fixtures";
import { expectAccessible, expectNoSidewaysScroll, nav, open, resetData, signInAs } from "./helpers";

/** The sharing register: consents across the households a person can see, and one consent's history. */
test.beforeEach(async ({ page }) => resetData(page));

test("a reviewer filters to open corrections and opens a consent's history", async ({ page }) => {
  await signInAs(page, "Priya Raman");
  await nav(page, "Sharing register").click();
  await expect(page.getByRole("heading", { level: 1, name: "Sharing register" })).toBeVisible();
  await expectAccessible(page);
  await page
    .getByRole("navigation", { name: "Filter consents" })
    .getByRole("link", { name: /Correction requested/ })
    .click();
  await expect(page).toHaveURL(/view=correction/);
  const table = page.getByRole("table", { name: "Consents: Correction requested" });
  await expect(table).toContainText("The Patel household");
  await expect(table.getByRole("row")).toHaveCount(2);

  await open(page, "/staff/sharing/cs-okafor-equipment");
  await expect(page.getByRole("heading", { level: 1, name: /Consent to share with/ })).toBeVisible();
  const history = page.getByRole("region", { name: "History" });
  await expect(history).toContainText("changed the terms");
  await expect(history).toContainText("version 2");
  await expectAccessible(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await expectNoSidewaysScroll(page);
});

test("a care guide's register holds only their households", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/sharing");
  await expect(page.getByRole("table")).toContainText("The Okafor household");
  await expect(page.getByText("The Nguyen household")).toHaveCount(0);
  await open(page, "/staff/sharing/cs-nguyen-meals");
  await expect(page.getByRole("heading", { name: "This isn't available" })).toBeVisible();
  await expect(page.getByText("Neighbors Table")).toHaveCount(0);
});
