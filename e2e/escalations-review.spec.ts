import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** The Escalations review's improvements, carried into Exceptions (decision 58). */
test.beforeEach(async ({ page }) => resetData(page));

test("operations: owner-less first, take from the row, waiting time and history", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  // The old page's address lands on Exceptions, showing escalations.
  await open(page, "/staff/escalations");
  await expect(page).toHaveURL(/\/staff\/exceptions\?.*kind=escalation/);
  const rows = page.getByRole("table", { name: /^Exceptions/ }).locator("tbody tr");
  // Everything needing an owner comes before anything owned.
  const owned = await rows.evaluateAll((rs) => rs.map((r) => !/Needs an owner/.test(r.textContent ?? "")));
  expect(owned).toEqual([...owned].sort((a, b) => Number(a) - Number(b)));
  expect(owned[0]).toBe(false);
  await expect(page.getByRole("columnheader", { name: "Waiting" })).toBeVisible();
  // Take ownership from the row.
  const row = rows.filter({ hasText: "Authority identity unresolved" });
  await row.getByRole("button", { name: /^Take ownership/ }).click();
  await expect(page.getByTestId("live-region")).toHaveText("You own this now.");
  await expect(row).toContainText("Owned — in progress");
  // The panel shows its history from the audit log, and why it's here.
  await row.getByRole("button", { name: /^Open Authority identity unresolved/ }).click();
  const panel = page.getByTestId("detail-panel");
  await expect(panel.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(panel).toContainText("Dana Brooks took ownership");
  await expect(panel.getByRole("heading", { name: "Why this is here" })).toBeVisible();
  await expectAccessible(page);
});

test("care guide: owner filter, and the Resolved view", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/exceptions?view=all&kind=escalation");
  await page.getByRole("combobox", { name: "Owner", exact: true }).selectOption("mine");
  await expect(page).toHaveURL(/who=mine/);
  const rows = page.getByRole("table", { name: /^Exceptions/ }).locator("tbody tr");
  for (const r of await rows.all()) await expect(r).toContainText("Maya Chen");
  await open(page, "/staff/escalations?tab=resolved");
  await expect(page).toHaveURL(/view=resolved/);
  await expect(
    page
      .getByRole("list", { name: /Resolved in the last 14 days/ })
      .or(page.getByText("Nothing was resolved")),
  ).toBeVisible();
  await expectAccessible(page);
});
