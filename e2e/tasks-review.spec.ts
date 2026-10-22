import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** The Care-team tasks review's seven improvements (2026-10-21). */
test.beforeEach(async ({ page }) => resetData(page));

test("care guide: badge, filters, aligned due chips, and each task opens on its household", async ({
  page,
}) => {
  await signInAs(page, "Maya Chen");
  // 6. The sidebar counts what's overdue or due today.
  await expect(page.getByRole("link", { name: /^Care-team tasks 2 overdue or due today/ })).toBeVisible();
  await open(page, "/staff/tasks");
  // 4 and 7: clearer names.
  await expect(page.getByRole("columnheader", { name: "Assigned to" })).toBeVisible();
  await expect(page.getByLabel("Select all tasks")).toBeVisible();
  // 5. Due chips come first in the cell.
  const overdue = page.locator("tbody tr").filter({ hasText: "Check whether the benefits letters" });
  await expect(overdue.locator("td").last()).toHaveText(/^\s*!?\s*Overdue/);
  // 2. Filters.
  await page.getByLabel("Assigned to").selectOption("unassigned");
  await expect(page).toHaveURL(/who=unassigned/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Find a volunteer driver");
  await page.getByLabel("Assigned to").selectOption("");
  await page.getByRole("combobox", { name: "Household" }).selectOption({ label: "The Rivera household" });
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Household" }).selectOption("");
  await expectAccessible(page);
  // 1. A task opens on its household's Tasks tab, focused.
  await page.getByRole("link", { name: "Check whether the benefits letters arrived" }).click();
  await expect(page).toHaveURL(/\/staff\/households\/hh-hart\?tab=tasks#task-/);
  await expect(page.locator('tr[id^="task-"]:focus')).toContainText("Check whether the benefits letters");
});

test("care guide: a finished task appears under Done recently, with who and when", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/tasks?tab=done");
  await expect(page.getByText("Nothing was completed or closed in the last 14 days.")).toBeVisible();
  await open(page, "/staff/households/hh-hart?tab=tasks");
  await page
    .locator("tbody tr")
    .filter({ hasText: "Confirm the equipment delivery window" })
    .getByRole("button", { name: "Done" })
    .click();
  await expect(page.getByTestId("live-region")).toHaveText("Task marked done.");
  await open(page, "/staff/tasks?tab=done");
  const row = page.locator("tbody tr").filter({ hasText: "Confirm the equipment delivery window" });
  await expect(row).toContainText("Done by Maya Chen");
  await expectAccessible(page);
});
