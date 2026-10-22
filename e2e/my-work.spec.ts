import { expect, test } from "./fixtures";
import { expectAccessible, resetData, signInAs } from "./helpers";

/**
 * Role homes (decision 58, workstream 4): each widget is a number that opens its list and the three
 * oldest items behind it. Read-only: work happens where the items open.
 */
test.beforeEach(async ({ page }) => resetData(page));

const widget = (page: import("@playwright/test").Page, key: string) => page.locator(`[data-widget="${key}"]`);

test("care guide: her widgets, counts that match their lists, and nothing to act on here", async ({
  page,
}) => {
  await signInAs(page, "Maya Chen");
  const grid = page.getByRole("list", { name: "What needs attention" });
  for (const title of [
    "Needs you now",
    "Due or overdue",
    "Waiting on family",
    "Waiting on partners",
    "Access ending",
    "Changed in the last day",
  ])
    await expect(grid.getByRole("heading", { name: title })).toBeVisible();
  // At most three items each; the number opens the same list, and their counts agree.
  for (const key of ["mine", "due", "family"]) {
    const w = widget(page, key);
    const count = Number(await w.getByRole("link", { name: /open the list$/ }).innerText());
    await expect(w.locator("ol li")).toHaveCount(Math.min(3, count));
  }
  const due = widget(page, "due");
  const n = Number(await due.getByRole("link", { name: /open the list$/ }).innerText());
  await due.getByRole("link", { name: /open the list$/ }).click();
  await expect(page).toHaveURL(/\/staff\/exceptions\?view=due/);
  await expect(page.getByRole("table", { name: "Exceptions: Due" }).locator("tbody tr")).toHaveCount(n);
  // Read-only: nothing is taken, assigned or resolved from the home.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "My work" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Take ownership/ })).toHaveCount(0);
  await expectAccessible(page);
});

test("operations: no owner, coverage and releases; an item opens in Exceptions", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await expect(widget(page, "unowned")).toContainText("No owner");
  const coverage = widget(page, "coverage");
  await expect(coverage).toContainText("Coverage gap: No care guide assigned");
  await expect(coverage).toContainText("The Nguyen household");
  await expect(widget(page, "releases")).toBeVisible();
  await coverage.locator("ol a").first().click();
  await expect(page).toHaveURL(/\/staff\/exceptions\?.*sel=coverage/);
  await expect(
    page.getByTestId("detail-panel").getByRole("heading", { name: "Why this is here" }),
  ).toBeVisible();
});

test("reviewer: the review backlog comes first, with its oldest wait", async ({ page }) => {
  await signInAs(page, "Priya Raman");
  const first = page.locator("[data-widget]").first();
  await expect(first).toHaveAttribute("data-widget", "reviews");
  await expect(first).toContainText(/Oldest waiting \d+ (hours?|days?|weeks)/);
  await expectAccessible(page);
});

test("administrator: coverage and audit integrity as counts, with no household named", async ({ page }) => {
  await signInAs(page, "Lena Hoffman");
  await expect(page).toHaveURL(/\/staff\/admin$/);
  await expect(page.getByTestId("admin-integrity")).toContainText("Verified");
  await expect(page.getByRole("region", { name: "Coverage" })).toContainText(
    "households without a care guide",
  );
  await expect(page.locator("main")).not.toContainText(
    /Okafor|Nguyen|Bennett|Rivera|Hart household|Patel|Lindqvist/,
  );
  await expectAccessible(page);
});
