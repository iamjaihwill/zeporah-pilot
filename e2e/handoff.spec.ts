import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** Handing work on: reassigning a household with its open work, and giving an escalation to a named person. */
test.beforeEach(async ({ page }) => resetData(page));

test("reassigning with hand-over moves the open escalation to the new care guide", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/team");
  await page.getByRole("button", { name: "Reassign The Hart household from Maya Chen" }).click();
  const dialog = page.getByRole("dialog", { name: "Reassign The Hart household" });
  await dialog.getByLabel("New care guide").selectOption({ label: "Tomás Alvarez" });
  const hand = dialog.getByRole("checkbox", { name: /Hand Maya Chen's open work here to Tomás Alvarez/ });
  await expect(hand).not.toBeChecked();
  await expect(dialog).toContainText('go back to "No owner assigned"');
  await hand.check();
  await expect(dialog).toContainText("move to the new care guide, who is notified");
  await expectAccessible(page);
  await dialog.getByLabel("Reason").fill("Caseload change (synthetic).");
  await dialog.getByRole("button", { name: "Reassign", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("The Hart household is now with Tomás Alvarez.");

  await open(page, "/staff/exceptions?view=all&kind=escalation");
  const hart = page.locator("tbody tr").filter({ hasText: "The Hart household" }).first();
  await expect(hart).toContainText("Tomás Alvarez");
});

test("operations gives an escalation to a named person who can see the household", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/exceptions?view=all&kind=escalation");
  await expectAccessible(page);
  await page
    .locator("tbody tr")
    .filter({ hasText: "The Bennett household" })
    .first()
    .locator("button")
    .first()
    .click();
  const panel = page.getByTestId("detail-panel");
  const select = panel.getByLabel("Assign to");
  await select.focus();
  await expect(select.locator("option", { hasText: "Maya Chen" })).toHaveCount(1);
  await select.selectOption({ label: "Maya Chen" });
  await panel.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Assigned.");
  await expect(panel).toContainText("Owner: Maya Chen");
});

test("care guides don't get the assign control", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/exceptions?view=all&kind=escalation");
  await page.locator("tbody tr").first().locator("button").first().click();
  await expect(page.getByTestId("detail-panel")).toBeVisible();
  await expect(page.getByLabel("Assign to")).toHaveCount(0);
});
