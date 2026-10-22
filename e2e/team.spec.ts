import { expect, test } from "./fixtures";
import {
  expectAccessible,
  expectNoSidewaysScroll,
  open,
  ready,
  resetData,
  signInAs,
  signOutFromShell,
} from "./helpers";

/** Staff lifecycle from the Team page: changing a role and deactivating someone, with the impact shown first. */
test.beforeEach(async ({ page }) => resetData(page));

test("operations can't change roles (decision 39)", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/team/st-tom");
  await expect(page.getByText("Only an administrator can change someone's role.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change role…" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Ownership history" })).toContainText("The Patel household");
  await expect(page.getByRole("region", { name: "Audit timeline" })).toBeVisible();
});

test("an administrator changes a care guide's role, and their assignments end", async ({ page }) => {
  await signInAs(page, "Lena Hoffman");
  // Administrators land on Administration: they have no household work (decision 39).
  await expect(page).toHaveURL(/\/staff\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "Administration" })).toBeVisible();
  await open(page, "/staff/team");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Exceptions/ }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Tomás Alvarez" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Tomás Alvarez" })).toBeVisible();
  await expect(page.getByRole("region", { name: "What they cover" })).toContainText("The Patel household");
  await expectAccessible(page);

  await page.getByLabel("New role").selectOption("privileged_reviewer");
  await page.getByRole("button", { name: "Change role…" }).click();
  const dialog = page.getByRole("dialog", {
    name: /Change Tomás Alvarez's role to authority\/consent reviewer\?/,
  });
  await expect(dialog).toContainText("2 household assignments end");
  await expect(dialog.getByRole("button", { name: "Change role", exact: true })).toBeDisabled();
  // Automated checks with the dialog open (manual review is still required: protocol Slice C).
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Change role…" })).toBeFocused();
  await page.getByRole("button", { name: "Change role…" }).click();
  await dialog.getByLabel("Reason").fill("Moved to the review team (synthetic).");
  await dialog.getByRole("button", { name: "Change role", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText(
    "Tomás Alvarez's role is now authority/consent reviewer.",
  );
  await expect(
    page.getByText("Not assigned to households; their role covers the whole hospice."),
  ).toBeVisible();

  await open(page, "/staff/team");
  await expect(page.getByRole("region", { name: "Organization-wide by role" })).toContainText(
    "Tomás Alvarez",
  );
  await expect(page.getByRole("region", { name: /Households without a care guide/ })).toContainText(
    "The Patel household",
  );
});

test("operations deactivates a care guide, who can no longer get in", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/team");
  await page.getByRole("link", { name: "Maya Chen" }).first().click();
  await page.getByRole("button", { name: "Deactivate…" }).click();
  const dialog = page.getByRole("dialog", { name: "Deactivate Maya Chen?" });
  await expect(dialog).toContainText("4 household assignments end");
  await expect(dialog).toContainText('go back to "No owner assigned"');
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Deactivate…" })).toBeFocused();
  await page.getByRole("button", { name: "Deactivate…" }).click();
  await dialog.getByLabel("Reason").fill("Left the hospice (synthetic).");
  await dialog.getByRole("button", { name: "Deactivate", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Maya Chen was deactivated.");
  await expect(page.getByText(/They can't sign in and have no access/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Deactivate…" })).toHaveCount(0);
  await expectAccessible(page);

  await open(page, "/staff/team");
  await expect(page.getByRole("region", { name: "Former staff" })).toContainText("Maya Chen");
  await page.setViewportSize({ width: 820, height: 1180 });
  await expectNoSidewaysScroll(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Maya's development persona no longer opens the staff workspace.
  await signOutFromShell(page);
  await open(page, "/");
  await page.getByRole("button", { name: "Sign in as Maya Chen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await open(page, "/staff");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("operations can't change their own account here", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/team/st-dana");
  await expect(page.getByText("You can't change your own role or account.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Deactivate…" })).toHaveCount(0);
});

test("an administrator reactivates someone, without their old assignments", async ({ page }) => {
  await signInAs(page, "Lena Hoffman");
  await open(page, "/staff/team/st-tom");
  await page.getByRole("button", { name: "Deactivate…" }).click();
  const off = page.getByRole("dialog", { name: "Deactivate Tomás Alvarez?" });
  await off.getByLabel("Reason").fill("On leave (synthetic).");
  await off.getByRole("button", { name: "Deactivate", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Tomás Alvarez was deactivated.");
  await page.getByRole("button", { name: "Reactivate…" }).click();
  const on = page.getByRole("dialog", { name: "Reactivate Tomás Alvarez as care guide?" });
  await expect(on).toContainText("No household assignments, escalations or tasks come back.");
  await expect(on.getByRole("button", { name: "Reactivate", exact: true })).toBeDisabled();
  await expectAccessible(page);
  await on.getByLabel("Reason").fill("Back from leave (synthetic).");
  await on.getByRole("button", { name: "Reactivate", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Tomás Alvarez was reactivated as care guide.");
  await expect(page.getByRole("region", { name: "What they cover" })).toContainText("None yet.");
  await expect(page.getByRole("region", { name: "Audit timeline" })).toContainText(
    "Staff member reactivated",
  );
});
