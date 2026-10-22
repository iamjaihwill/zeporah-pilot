import { expect, test } from "./fixtures";
import { expectAccessible, expectNoSidewaysScroll, nav, open, resetData, signInAs } from "./helpers";

/** Organization-wide audit review: filters, integrity check, and who can use it. */
test.beforeEach(async ({ page }) => resetData(page));

test("operations reviews people-and-staff events with the integrity check", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await nav(page, "Audit review").click();
  await expect(page.getByRole("heading", { level: 1, name: "Audit review" })).toBeVisible();
  await expect(page.getByTestId("integrity-line")).toContainText("Audit chain verified");
  await expectAccessible(page);
  await page.getByLabel("Kind of event").selectOption({ label: "People and staff" });
  await page.getByLabel("Period").selectOption("90");
  await expect(page).toHaveURL(/category=people/);
  const table = page.getByRole("table", { name: /Audit events, newest first/ });
  await expect(table).toContainText("Care guide assigned");
  // The raw code stays available as a tooltip for support work.
  await expect(table.locator(`[data-code="assignment.created"]`).first()).toHaveAttribute(
    "title",
    "Code: assignment.created",
  );
  await expect(table).not.toContainText("Consent recorded");
  await page.setViewportSize({ width: 820, height: 1180 });
  await expectNoSidewaysScroll(page);
});

test("care guides don't get the organization-wide audit review", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit review" }),
  ).toHaveCount(0);
  await open(page, "/staff/audit");
  await expect(page.getByRole("heading", { name: "Not available for your role" })).toBeVisible();
});
