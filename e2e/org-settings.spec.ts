import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs, signOutFromShell } from "./helpers";

/** Founder decision 39: the workflow settings operations change, and the controls only administrators change. */
test.beforeEach(async ({ page }) => resetData(page));

test("operations change a workflow setting and see it take effect", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/settings?section=workflow");
  const statuses = page.getByTestId("settings-statusLabels");
  await statuses.getByLabel("Escalation: no owner").fill("Unclaimed");
  await statuses.getByRole("button", { name: "Save workflow status wording" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Workflow status wording saved.");
  // Administrators' controls are visible but locked for operations.
  await open(page, "/staff/settings?section=controls");
  await expect(page.getByTestId("settings-access")).toContainText("Only an administrator can change these.");
  await expect(page.getByTestId("settings-access").getByRole("button")).toHaveCount(0);
  await expectAccessible(page);

  await open(page, "/staff/exceptions");
  await expect(page.locator('[data-status="escalation:open"]').first()).toHaveText(/Unclaimed/);
});

test("an administrator changes access limits and reviews retention, which deletes nothing", async ({
  page,
}) => {
  await signInAs(page, "Lena Hoffman");
  await open(page, "/staff/settings?section=controls");
  const access = page.getByTestId("settings-access");
  await access.getByLabel("Task-only helper access: at most (days)").fill("30");
  await access.getByRole("button", { name: "Save access limits" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Access limits saved.");
  const retention = page.getByTestId("settings-retention");
  await expect(retention).toContainText("never deletes anything automatically");
  await retention.getByRole("button", { name: "Count records past retention" }).click();
  await expect(page.getByTestId("retention-review")).toContainText("no rule set");
  await expectAccessible(page);
  await signOutFromShell(page);
});
