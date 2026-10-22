import { expect, test } from "./fixtures";
import { expectAccessible, expectNoSidewaysScroll, nav, open, resetData, signInAs } from "./helpers";

/** Operational reports and closing a household after bereavement support. */
test.beforeEach(async ({ page }) => resetData(page));

test("operations reads the report and closes a bereavement household", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await nav(page, "Reports").click();
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  // Founder decision 41: six reports (short tab names; the full name heads each report). The stage
  // chart is in "Households and caseload".
  for (const tab of ["Overview", "Households", "Open work", "Sharing", "Bereavement", "Workforce"])
    await expect(
      page.getByRole("navigation", { name: "Reports" }).getByRole("link", { name: tab, exact: true }),
    ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Reports" })
    .getByRole("link", { name: "Households", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 2, name: "Households and caseload" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Households by stage" })).toContainText(
    "without a care guide (not closed)",
  );
  await expectAccessible(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await expectNoSidewaysScroll(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  await open(page, "/staff/households/hh-lindqvist?tab=lifecycle");
  await page.getByRole("button", { name: "Close household…" }).click();
  const dialog = page.getByRole("dialog", { name: "Close The Lindqvist household?" });
  await expect(dialog).toContainText("bereavement support window hasn't ended yet");
  await expect(dialog.getByRole("button", { name: "Close household", exact: true })).toBeDisabled();
  await expectAccessible(page);
  await dialog.getByLabel("Reason").fill("Family asked to close early (synthetic).");
  await dialog.getByRole("button", { name: "Close household", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("The household was closed.");
  await expect(
    page.getByText("This household was closed after bereavement support. It's read-only."),
  ).toBeVisible();
});

test("care guides get neither reports nor closing", async ({ page }) => {
  await signInAs(page, "Tomás Alvarez");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Reports" }),
  ).toHaveCount(0);
  await open(page, "/staff/households/hh-lindqvist?tab=lifecycle");
  await expect(page.getByRole("button", { name: "Close household…" })).toHaveCount(0);
});

test("administrators don't get Reports (decision 39)", async ({ page }) => {
  await signInAs(page, "Lena Hoffman");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Reports" }),
  ).toHaveCount(0);
  await open(page, "/staff/reports");
  await expect(page.getByRole("heading", { name: "Not available for your role" })).toBeVisible();
});
