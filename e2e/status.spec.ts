import { expect, test } from "./fixtures";
import { expectAccessible, nav, open, resetData, signInAs } from "./helpers";

/** System status for operations; no read-only banner in normal running. */
test.beforeEach(async ({ page }) => resetData(page));

test("operations sees configuration, schema and audit integrity", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await expect(page.getByText("Zeporah is read-only right now.")).toHaveCount(0);
  await nav(page, "System status").click();
  await expect(page.getByRole("heading", { level: 1, name: "System status" })).toBeVisible();
  const data = page.getByRole("region", { name: "Data and access" });
  await expect(data).toContainText(/Up to date \(\d+ migrations\)/);
  await expect(data).toContainText(/Verified \(\d+ events\)/);
  await expect(page.getByRole("region", { name: "Environment" })).toContainText("On (development only)");
  const integrations = page.getByRole("region", { name: "Integrations" });
  await expect(integrations).toContainText("EHR / hospice system");
  await expect(integrations.getByText("Not connected")).toHaveCount(4);
  await expectAccessible(page);
});

test("a verdict first, marks on every row, sign-in health linked, copy for support", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/status");
  await expect(page.getByTestId("status-verdict")).toContainText("All checks passed");
  await expect(page.locator('[data-tone="attention"]')).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Environment" })).toContainText(
    "Development mailbox only. Nothing leaves this computer.",
  );
  await expect(page.getByRole("region", { name: "Data and access" })).toContainText(
    /\d+ failed · \d+ paused/,
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy for support" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Copied. Paste it into your support request.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^Zeporah \S+ \(development\)\nSchema: \d+ of \d+ migrations/);
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Checked again.");
  await page.getByRole("link", { name: /failed · \d+ paused/ }).click();
  await expect(page).toHaveURL(/\/staff\/audit\?.*category=access/);
});

test("care guides don't get system status", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/status");
  await expect(page.getByRole("heading", { name: "Not available for your role" })).toBeVisible();
});
