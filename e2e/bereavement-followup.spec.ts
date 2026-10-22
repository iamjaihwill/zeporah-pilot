import { expect, test } from "./fixtures";
import { expectAccessible, expectNoSidewaysScroll, nav, open, resetData, signInAs } from "./helpers";

/** The 13-month bereavement follow-up: staff workload, recording a check-in, and the family's view. */
test.beforeEach(async ({ page }) => resetData(page));

test("a care guide sees what's due and records a check-in; the family sees only that it happened", async ({
  page,
}) => {
  await signInAs(page, "Tomás Alvarez");
  await nav(page, "Bereavement follow-up").click();
  await expect(page.getByRole("heading", { level: 1, name: "Bereavement follow-up" })).toBeVisible();
  const week = page.getByRole("region", { name: /Due this week/ });
  await expect(week).toContainText("The Lindqvist household");
  await expect(week).toContainText("First check-in");
  await expect(page.locator("main").getByText(/overdue/i)).toHaveCount(0);
  await expectAccessible(page);

  await week.getByRole("link", { name: "The Lindqvist household" }).click();
  const card = page.getByRole("region", { name: "Bereavement follow-up" });
  await expect(card).toContainText("Support continues until");
  await card.getByRole("button", { name: "Record the first check-in" }).click();
  const dialog = page.getByRole("dialog", { name: "Record the first check-in" });
  await dialog.getByRole("radio", { name: "Left a message" }).check();
  await dialog.getByLabel("Note (optional)").fill("Will try again next week (synthetic).");
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("First check-in recorded.");
  await expect(card).toContainText("Left a message");
  await expect(card).toContainText("Note (staff only): Will try again next week (synthetic).");
  await page.setViewportSize({ width: 820, height: 1180 });
  await expectNoSidewaysScroll(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  await signInAs(page, "Ingrid Lindqvist");
  await open(page, "/family/bereavement");
  const expect13 = page.getByRole("region", { name: "What to expect from your care team" });
  await expect(expect13).toContainText("In the first few weeks");
  await expect(expect13).toContainText("Done");
  await expect(page.getByText("Will try again next week")).toHaveCount(0);
  await expect(page.getByText("Left a message")).toHaveCount(0);
  await expectAccessible(page);
});
