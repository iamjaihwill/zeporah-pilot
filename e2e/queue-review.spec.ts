import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** The Queue review's nine improvements (2026-10-21), carried into Exceptions (decision 58). */
test.beforeEach(async ({ page }) => resetData(page));

test("care guide: only views they can act on, a Due view, and a visible Take ownership", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/exceptions");
  const tabs = page.getByRole("navigation", { name: "Exception views" });
  // Views a care guide can't act on are left out.
  await expect(tabs.getByRole("link", { name: /Releases in flight/ })).toHaveCount(0);
  await expect(tabs.getByRole("link", { name: /Handoffs/ })).toHaveCount(0);

  // Owners read the same on every row; quiet defaults and short waits, as on My work.
  const table = page.getByRole("table", { name: /^Exceptions/ });
  await expect(table).not.toContainText("(care guide)");
  const task = table.locator("tbody tr").filter({ hasText: "Schedule the first visit with Marisol" });
  await expect(task.getByText("Complete the task")).toHaveClass(/sr-only/);
  await expect(task.locator("td").nth(-2)).toContainText(/^\d+ (h|d|wk)/);

  // Take ownership is a real button in the Next step column, not a hover-only action.
  const row = table.locator("tbody tr").filter({ hasText: "Authority identity unresolved" });
  const take = row.getByRole("button", { name: /^Take ownership/ });
  await expect(take).toHaveCSS("opacity", "1");
  await expect(take.locator("xpath=ancestor::td[1]/preceding-sibling::td")).toHaveCount(5);
  await take.click();
  await expect(page.getByTestId("live-region")).toHaveText("You own this now.");
  await expect(row).toContainText("Owned — in progress");

  // Due: overdue first, then due today.
  await tabs.getByRole("link", { name: /^Due/ }).click();
  const due = page.getByRole("table", { name: "Exceptions: Due" }).locator("tbody tr");
  await expect(due.nth(0)).toContainText("Overdue");
  await expect(due.nth(1)).toContainText("Due today");
  await expectAccessible(page);
});

test("reviewer: consent and release views stay; mixed selection works; long lists fade", async ({ page }) => {
  await signInAs(page, "Priya Raman");
  await open(page, "/staff/exceptions");
  const tabs = page.getByRole("navigation", { name: "Exception views" });
  await expect(tabs.getByRole("link", { name: /Consent & access/ })).toBeVisible();
  await expect(tabs.getByRole("link", { name: /Releases in flight/ })).toBeVisible();
  await expect(page.getByLabel(/^Select all/)).toBeVisible();
  await page.locator("tbody tr input[type=checkbox]").first().check();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
  // 25 rows in a box shorter than the list: the bottom edge fades until the end is reached.
  const box = page.locator("[data-scroll-fade-y]");
  await expect(box).toHaveAttribute("data-more-below", "true");
  await box.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(box).toHaveAttribute("data-more-below", "false");
  // Back to the top, so no row sits half under the sticky header while the page is checked.
  await box.evaluate((el) => el.scrollTo(0, 0));
  await expectAccessible(page);
});

test("iPad: the tab row opens at its start, and the owner sits under the item", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/exceptions");
  const nav = page.getByRole("navigation", { name: "Exception views" });
  expect(await nav.evaluate((el) => el.scrollLeft)).toBe(0);
  const first = await nav.getByRole("link", { name: /Needs you now/ }).boundingBox();
  const navBox = await nav.boundingBox();
  expect(first!.x).toBeGreaterThanOrEqual(navBox!.x);
  const row = page.locator("tbody tr").filter({ hasText: "Family asked for a person to follow up" });
  await expect(row.locator(".q-second")).toContainText("Maya Chen");
  await expect(page.getByRole("columnheader", { name: "Next step" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Owner" })).toBeHidden();
  await expectAccessible(page);
});
