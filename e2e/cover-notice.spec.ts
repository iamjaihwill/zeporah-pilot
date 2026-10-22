import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** Decision 62: the household is told when cover becomes active; staff see the system update. */
test("the household's update about cover, for the right people, and its record for staff", async ({
  page,
}) => {
  await resetData(page, "Demo week: end of week (Day 7)");
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family");
  await expect(page.getByText(/^Sofia Reyes is your care guide until Oct \d{1,2}, 6:00 PM$/)).toBeVisible();
  // Cover has ended, so Home names Maya again, with no end time.
  await expect(page.getByText("Care guide:").locator("..")).toContainText("Maya Chen");
  await expect(page.getByTestId("care-guide-until")).toHaveCount(0);
  await expectAccessible(page);

  await signInAs(page, "Chidi Okafor");
  await open(page, "/family");
  await expect(page.getByText(/is your care guide until/)).toHaveCount(0);

  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor?tab=updates");
  await expect(page.getByTestId("update-audience")).toContainText(
    "Seen by: Ada Okafor, Daniel Okafor, Grace Okafor.",
  );
  await open(page, "/staff/households/hh-okafor");
  await expect(page.getByTestId("record-timeline")).toContainText("Cover notice posted to the household");
  await expectAccessible(page);
});
