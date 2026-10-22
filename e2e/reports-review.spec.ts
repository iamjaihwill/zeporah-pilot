import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { expectAccessible, expectNoSidewaysScroll, open, resetData, signInAs } from "./helpers";

/** The Reports review's five improvements and report export (founder decision 57), 2026-10-21. */
test.beforeEach(async ({ page }) => resetData(page));

test("counts open the list behind them; charts name every period", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/reports?report=overview&days=30");
  // 2 and 3. Every week is labelled by its range, and the latest is marked as part-way through.
  const chart = page.getByRole("img", { name: /Escalations raised per week/ });
  await expect(chart).toBeVisible();
  await expect(page.getByText(/, so far$/).first()).toBeAttached();
  await expectAccessible(page);
  // 1. A count opens its list, already filtered.
  await page
    .getByRole("link", { name: /— show escalations with no owner/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/staff\/exceptions\?.*who=unassigned/);
  await open(page, "/staff/reports?report=overview&days=30");
  await page.getByRole("link", { name: /— show without a care guide/ }).click();
  await expect(page).toHaveURL(/\/staff\/households\?guide=none/);
});

test("an empty chart is a sentence, and the tabs fit an iPad", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/reports?report=work&days=7");
  // 4. Nothing resolved this week: said plainly.
  await expect(page.getByText("No escalations were resolved in the last 7 days.")).toBeVisible();
  // 5. Short tab names fit at 1024.
  await page.setViewportSize({ width: 1024, height: 768 });
  const nav = page.getByRole("navigation", { name: "Reports" });
  const fits = await nav.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  await expectNoSidewaysScroll(page);
});

test("operations export a report after a confirmation; the file and the log say so", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/reports?report=overview&days=30");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const dialog = page.getByRole("dialog", { name: "Export this report?" });
  await expect(dialog).toContainText("It's confidential.");
  await expect(dialog).toContainText("never names patients, families or households");
  await expectAccessible(page);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^zeporah-report-overview-\d{4}-\d\d-\d\d-last-30-days\.csv$/);
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv.split("\r\n")[0]).toMatch(/^"Confidential: Zeporah report export/);
  await expect(page.getByTestId("live-region")).toHaveText(/recorded in the audit log/);
  await open(page, "/staff/audit?days=1");
  await expect(page.getByText("Report exported (CSV)").first()).toBeVisible();
});
