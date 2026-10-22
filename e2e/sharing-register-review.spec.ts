import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** The Sharing register review's eight improvements (2026-10-21). */
test.beforeEach(async ({ page }) => resetData(page));

test("operations: what needs a person first, short chips, past ends, linked packets", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/sharing");
  const rows = page.getByRole("table", { name: /Consents: needing a person first/ }).locator("tbody tr");
  // 4. Needs a person first; ended and withdrawn last.
  await expect(rows.first()).toContainText(/Correction requested|needs review/);
  await expect(rows.last()).toContainText(/Withdrawn|Ended/);
  // 2. A short chip for the long hold, with the full wording kept for tooltips and screen readers.
  const maplewood = rows.filter({ hasText: "Maplewood" });
  await expect(maplewood.locator('[data-status="consent:needs_review"]')).toHaveText(/Held — needs review/);
  await expect(maplewood).toContainText("a person on the care team must review");
  // 6. Past end dates read "Ended".
  await expect(rows.filter({ hasText: "County Benefits" })).toContainText(/Ended Oct \d+, 2026/);
  // 8. The version only when amended.
  await expect(rows.filter({ hasText: "Oakwood" })).toContainText("amended (version 2)");
  await expect(rows.filter({ hasText: "Brightwater" })).not.toContainText("version");
  // 7. Packets are chips that open the packet.
  await rows
    .filter({ hasText: "Northside" })
    .getByRole("link", { name: /Open the packet/ })
    .click();
  await expect(page).toHaveURL(/\/staff\/packets\/pk-/);
  await expectAccessible(page);
});

test("filters, tabs and whole-row open; iPad doesn't scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/sharing");
  // 5. The standard tabs, plus household and recipient filters in the address.
  await page.getByRole("combobox", { name: "Household" }).selectOption({ label: "The Okafor household" });
  await expect(page).toHaveURL(/household=hh-okafor/);
  await page.getByLabel("Find a recipient").fill("Brightwater");
  await expect(page).toHaveURL(/q=Brightwater/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  // 1. Nothing pushes the table sideways on a tablet.
  const scrolls = await page
    .locator("table")
    .evaluate((t) => t.parentElement!.scrollWidth > t.parentElement!.clientWidth + 1);
  expect(scrolls).toBe(false);
  await expectAccessible(page);
  // 3. The whole row opens the consent.
  await page.getByRole("button", { name: /^Open the consent for Brightwater/ }).click();
  await expect(page).toHaveURL(/\/staff\/sharing\/cs-/);
});
