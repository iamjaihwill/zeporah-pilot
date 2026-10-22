import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs, signOutFromShell } from "./helpers";

/** The Bereavement follow-up review's seven improvements (2026-10-21). */
test.beforeEach(async ({ page }) => resetData(page));

test("care guide: one row per household, dates only, badge, and the link lands on the check-in", async ({
  page,
}) => {
  await signInAs(page, "Tomás Alvarez");
  // 7. The sidebar counts what's due this week or overdue.
  await expect(
    page.getByRole("link", { name: /^Bereavement follow-up 1 due this week or overdue/ }),
  ).toBeVisible();
  await open(page, "/staff/bereavement");
  // 2. One row for Lindqvist, with the rest of the plan behind it; "Later" is collapsed.
  const rows = page.locator("main li").filter({ hasText: "The Lindqvist household" });
  await expect(rows).toHaveCount(1);
  await expect(rows.getByText(/more planned/)).toBeVisible();
  // 4. "Due around" a date, never a time.
  await expect(rows).toContainText(/Due around [A-Z][a-z]{2} \d{1,2}, \d{4}/);
  await expect(rows).not.toContainText(/Due around [^·]*\d:\d\d/);
  await expectAccessible(page);
  // 3. The link opens the check-in on the household's plan card, focused.
  await rows.getByRole("link", { name: "The Lindqvist household" }).click();
  await expect(page).toHaveURL(/hh-lindqvist\?tab=overview#checkin-/);
  await expect(page.locator('li[id^="checkin-"]:focus')).toContainText("First check-in");
});

test("a family's pause moves them out of the due list, so nobody calls", async ({ page }) => {
  await signInAs(page, "Ingrid Lindqvist");
  await page.getByRole("button", { name: "I'd rather not be contacted for now" }).click();
  await expect(page.getByText("You've asked not to be contacted for now.")).toBeVisible();
  await signOutFromShell(page);
  await signInAs(page, "Tomás Alvarez");
  // The badge no longer counts a paused household.
  await expect(page.getByRole("link", { name: /^Bereavement follow-up$/ })).toBeVisible();
  await open(page, "/staff/bereavement");
  const paused = page.getByRole("region", { name: /Contact paused/ });
  await expect(paused).toContainText("The Lindqvist household");
  await expect(paused).toContainText(/Contact paused by Ingrid Lindqvist/);
  await expect(page.getByRole("heading", { name: /Due this week/ })).toHaveCount(0);
  await expectAccessible(page);
});

test("operations: the by-guide card filters the list", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/bereavement");
  await page.getByRole("link", { name: "Tomás Alvarez" }).click();
  await expect(page).toHaveURL(/guide=Tom/);
  await expect(page.getByText(/Showing Tomás Alvarez's households/)).toBeVisible();
  await expect(page.locator("main li").filter({ hasText: "The Lindqvist household" })).toHaveCount(1);
});
