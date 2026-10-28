import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** The Households review's seven improvements (2026-10-21). */
test.beforeEach(async ({ page }) => resetData(page));

test("operations: filters, count, sorting, unassigned stands out, rows open", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/households");
  await expect(page.getByTestId("household-count")).toHaveText("8 households");
  // 5. Not assigned is a warning with an Assign link to the care-team section.
  const nguyen = page.locator("tbody tr").filter({ hasText: "The Nguyen household" });
  await expect(nguyen.locator("[data-unassigned]")).toContainText("Not assigned");
  await expect(
    nguyen.getByRole("link", { name: /Assign a care guide to The Nguyen household/ }),
  ).toHaveAttribute("href", /hh-nguyen\?tab=overview#care-team/);
  // 3 and 7. Filters, with a count of what matches.
  await page.getByLabel("Care guide").selectOption("none");
  await expect(page).toHaveURL(/guide=none/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("household-count")).toHaveText("1 of 8 households match");
  await page.getByLabel("Care guide").selectOption("");
  await page.getByLabel("Stage").selectOption("bereavement");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Lindqvist");
  await page.getByLabel("Stage").selectOption("");
  // 4. Sorting by what's in your queue, most first.
  await page.getByRole("button", { name: /In your queue/ }).click();
  await page.getByRole("button", { name: /In your queue/ }).click();
  await expect(page).toHaveURL(/sort=open&dir=desc/);
  await expect(page.locator("tbody tr").first()).toContainText("The Hart household");
  // 6. The header says whose queue.
  await expect(page.getByRole("columnheader", { name: /In your queue/ })).toBeVisible();
  await expectAccessible(page);
  // 1. A whole row opens the household.
  await page.getByRole("button", { name: "Open The Okafor household" }).click();
  await expect(page).toHaveURL(/\/staff\/households\/hh-okafor\?tab=overview/);
});

test("iPad: the patient sits under the household and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/households");
  await expect(page.getByRole("columnheader", { name: "Patient" })).toBeHidden();
  await expect(page.locator("tbody tr").filter({ hasText: "The Hart household" })).toContainText(
    "Walter Hart",
  );
  const scrolls = await page
    .locator("table")
    .evaluate((t) => t.parentElement!.scrollWidth > t.parentElement!.clientWidth + 1);
  expect(scrolls).toBe(false);
  await expectAccessible(page);
});
