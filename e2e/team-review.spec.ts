import { expect, test } from "./fixtures";
import { expectAccessible, expectNoSidewaysScroll, open, resetData, signInAs } from "./helpers";

/** The Team & coverage review's six improvements (2026-10-21). */
test.beforeEach(async ({ page }) => resetData(page));

test("one table of load, quiet actions, invitations and former staff on the page", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/team");
  const table = page.getByRole("table", { name: /Care guides: households, open escalations/ });
  const maya = page.locator("tbody").filter({ has: page.getByRole("rowheader", { name: "Maya Chen" }) });
  await expect(maya).toContainText("4 households");
  await expect(table.getByRole("columnheader", { name: "Overdue tasks" })).toBeVisible();
  await expect(maya.getByRole("button", { name: /^Reassign The Hart household/ })).toBeVisible();
  // Invitations: invite from here; see who's waiting.
  await page.getByRole("button", { name: "Invite staff" }).click();
  await page.getByLabel("Their name").fill("Noor Haddad");
  await page.getByLabel("Their email").fill("noor.haddad@example.test");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByTestId("invitation-link")).toBeVisible();
  await expect(page.getByRole("region", { name: "Waiting to join" })).toContainText("Noor Haddad");
  await expect(page.getByRole("region", { name: "Former staff" })).toContainText(
    "No one has been deactivated.",
  );
  await expectAccessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSidewaysScroll(page);
});

test("a staff member's escalations and tasks are named and linked; roles date from joining", async ({
  page,
}) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/team/st-maya");
  await page.getByRole("link", { name: "Family asked for a person to follow up" }).click();
  await expect(page).toHaveURL(/\/staff\/exceptions\?.*sel=escalation/);
  await expect(page.getByTestId("detail-panel")).toBeVisible();
  await open(page, "/staff/team/st-maya");
  await page.getByRole("link", { name: "Check whether the benefits letters arrived" }).click();
  await expect(page).toHaveURL(/tab=tasks#task-/);
  await open(page, "/staff/team/st-maya");
  const roles = page.getByRole("region", { name: "Role history" });
  await expect(roles).not.toContainText(
    new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  );
});
