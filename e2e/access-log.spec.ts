import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs, signOutFromShell } from "./helpers";

/** The staff read access log (founder decision 71): who opened which household's record, and when. */
test.beforeEach(async ({ page }) => resetData(page));

test("a care guide's visit to a household record is listed for the reviewer", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor");
  await expect(page.locator("main h1")).toContainText("Okafor");
  await signOutFromShell(page);

  await signInAs(page, "Priya Raman");
  await open(page, "/staff/access-log");
  await expect(page.getByRole("heading", { level: 1, name: "Who opened records" })).toBeVisible();
  const visit = page.locator("tbody tr").filter({ hasText: "Maya Chen" }).filter({
    hasText: "The Okafor household",
  });
  await expect(visit.first()).toBeVisible();
  await expect(visit.first()).toContainText("Assigned or covering");
  await expectAccessible(page);
});

test("a care guide can't open the access log", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/access-log");
  await expect(page.getByTestId("access-denied")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(0);
});
