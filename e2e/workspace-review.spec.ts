import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** The workspace review's twelve improvements (2026-10-21). */
test.beforeEach(async ({ page }) => resetData(page));

test("care guide: overdue work stands out, named activity, one-line next steps", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  // My work's "Due or overdue" names the work, and changes say who did them (never "Someone").
  await expect(page.locator('[data-widget="due"]')).toContainText("Care-team task:");
  await expect(page.locator('[data-widget="changed"]')).not.toContainText("Someone ");
  await open(page, "/staff/tasks");
  await expect(
    page.locator("tbody tr").filter({ hasText: "Check whether the benefits letters" }),
  ).toContainText("Overdue");
  await open(page, "/staff/packets");
  await expect(page.getByRole("columnheader", { name: "Release check" })).toBeVisible();
  await expect(page.getByText("Your role can't release")).toHaveCount(0);
  await expect(
    page.getByText(/Hospice operations or an authority\/consent reviewer releases them/),
  ).toBeVisible();
  await expectAccessible(page);
});

test("operations: households show open items and filter as you type; settings are in sections", async ({
  page,
}) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/households");
  await expect(page.getByRole("columnheader", { name: /In your queue/ })).toBeVisible();
  await page.getByLabel("Find a household").fill("Okafor");
  await expect(page).toHaveURL(/q=Okafor/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await open(page, "/staff/settings");
  for (const tab of ["Messaging", "Workflow", "Organization", "Organization controls", "Invitations"])
    await expect(
      page
        .getByRole("navigation", { name: "Settings sections" })
        .getByRole("link", { name: tab, exact: true }),
    ).toBeVisible();
  await expectAccessible(page);
});

test("administrator: an overview, and search finds staff", async ({ page }) => {
  await signInAs(page, "Lena Hoffman");
  await expect(page.getByRole("heading", { level: 1, name: "Administration" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Invitations waiting/ })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Recent changes to people, access and settings" }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Search staff" }).click();
  await page.getByRole("dialog").getByLabel("Search staff").fill("Maya");
  await expect(page.getByRole("dialog").getByText("Maya Chen")).toBeVisible();
});

test("reviewer: the Reviews page fits an iPad", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signInAs(page, "Priya Raman");
  await open(page, "/staff/reviews");
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBe(0);
});
