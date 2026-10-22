import { expect, test } from "./fixtures";
import { expectAccessible, expectNoSidewaysScroll, open, resetData, signInAs } from "./helpers";

/** Exceptions (decision 58): one list replacing the queue and escalations, with deterministic rules. */
test.beforeEach(async ({ page }) => resetData(page));

test("old Queue and Escalations links land on Exceptions, with the same view", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/queue?view=unassigned");
  await expect(page).toHaveURL(/\/staff\/exceptions\?view=unowned/);
  await expect(page.getByRole("heading", { level: 1, name: "Exceptions" })).toBeVisible();
  await open(page, "/staff/escalations");
  await expect(page).toHaveURL(/\/staff\/exceptions\?.*kind=escalation/);
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Exceptions/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Queue/ }),
  ).toHaveCount(0);
});

test("operations see a coverage gap with why it's here, and it can't be dismissed", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/exceptions?view=unowned");
  await page.getByRole("button", { name: /^Open No care guide assigned, The Nguyen household/ }).click();
  const panel = page.getByTestId("detail-panel");
  await expect(panel.getByRole("heading", { name: "Why this is here" })).toBeVisible();
  await expect(panel).toContainText("No care guide is assigned to this household.");
  await expect(panel).toContainText("Coverage gap");
  await expect(panel).toContainText("can't be dismissed");
  await expect(panel.getByRole("button", { name: "Dismiss…" })).toHaveCount(0);
  await expectAccessible(page);
});

test("a care guide marks an exception as waiting, then dismisses it with a reason", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/exceptions?view=consent");
  await page
    .getByRole("button", { name: /^Open Brightwater Respite House \(synthetic\)'s access/ })
    .first()
    .click();
  const panel = page.getByTestId("detail-panel");
  await expect(panel).toContainText("Access ending");
  await panel.getByLabel("Waiting on").selectOption("partner");
  await panel.getByLabel("Note (optional)").fill("Left a voicemail");
  await panel.getByRole("button", { name: "Mark as waiting" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Marked as waiting.");
  await panel.getByRole("button", { name: "Dismiss…" }).click();
  const dialog = page.getByRole("dialog", { name: "Dismiss this exception?" });
  await expect(dialog).toContainText("only staff see it");
  await dialog.getByLabel("Reason").fill("Let it end: the stay is booked (synthetic).");
  await dialog.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Dismissed, with your reason recorded.");
  await open(page, "/staff/exceptions?view=resolved");
  await expect(page.getByRole("list", { name: /Resolved in the last 14 days/ })).toContainText(
    "Let it end: the stay is booked (synthetic).",
  );
  await expectAccessible(page);
});

test("operations set the exception thresholds in Hospice settings", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/settings?section=workflow");
  await expect(page.getByRole("heading", { name: "Exception thresholds" })).toBeVisible();
});

test("Exceptions fit an iPad and a phone", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  for (const [width, height] of [
    [820, 1180],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await open(page, "/staff/exceptions");
    await expect(page.getByRole("heading", { level: 1, name: "Exceptions" })).toBeVisible();
    await expectNoSidewaysScroll(page);
  }
});
