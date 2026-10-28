import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** The Hospice settings review's five improvements (2026-10-21). */
test.beforeEach(async ({ page }) => resetData(page));

test("messaging history says which version is current", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/settings?section=messaging");
  await page.getByText(/^History · \d+ versions?$/).click();
  const history = page.getByRole("region", { name: "History" });
  await expect(history.getByText("Current")).toHaveCount(1);
  await expect(history).toContainText(/Replaced [A-Z][a-z]{2} \d/);
  await expectAccessible(page);
});

test("unsaved changes are marked, leaving asks first, and saving records who changed it", async ({
  page,
}) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/settings?section=workflow");
  const card = page.getByTestId("settings-assignment");
  await expect(card.getByTestId("last-changed")).toHaveText("Not changed yet: the standard setting.");
  await card.getByLabel(/hand over open work/).check();
  await expect(page.getByTestId("unsaved")).toHaveText("Unsaved changes");
  // Leaving asks; declining keeps you here with the edit.
  page.once("dialog", (d) => {
    expect(d.message()).toMatch(/Leave without saving\? One card has unsaved changes/);
    void d.dismiss();
  });
  await page.getByRole("link", { name: "Messaging", exact: true }).click();
  await expect(page).toHaveURL(/section=workflow/);
  await card.getByRole("button", { name: "Save assignment defaults" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Assignment defaults saved.");
  await expect(page.getByTestId("unsaved")).toHaveCount(0);
  await expect(card.getByTestId("last-changed")).toContainText("Last changed by Dana Brooks");
  await page.getByRole("link", { name: "Messaging", exact: true }).click();
  await expect(page).toHaveURL(/section=messaging/);
});

test("operations read administrator settings as text, and Invitations points to Team & coverage", async ({
  page,
}) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/settings?section=controls");
  const access = page.getByTestId("settings-access");
  await expect(access).toContainText("at most 90 days");
  await expect(access.getByRole("spinbutton")).toHaveCount(0);
  await expect(page.getByTestId("settings-retention")).toContainText("Not set");
  await open(page, "/staff/settings?section=organization");
  // The one field is for re-confirming the 24-hour line by calling it (decision 72).
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "What you reached" })).toBeVisible();
  await expect(page.getByText("555-0100 (synthetic 24-hour line)")).toBeVisible();
  await open(page, "/staff/settings?section=invitations");
  await page.getByRole("link", { name: "Team & coverage" }).last().click();
  await expect(page).toHaveURL(/\/staff\/team/);
  await expectAccessible(page);
});

test("redesign: section list with access, live family preview, and a save bar that saves everything", async ({
  page,
}) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/settings?section=messaging");
  // The section list says what each section covers and whether you can change it.
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.getByRole("link", { name: "Organization controls", exact: true })).toBeVisible();
  await expect(sections).toContainText("View only");
  // The preview shows what families will read, as it's typed.
  await page.getByLabel("Expected reply time").fill("within 4 working hours");
  const preview = page.getByRole("complementary", { name: "Preview" });
  await expect(preview.getByTestId("reply-time")).toHaveText(
    "Your care team usually replies within 4 working hours.",
  );
  // The save bar names the edit; Discard puts it back.
  const bar = page.getByTestId("save-bar");
  await expect(bar).toContainText("1 unsaved change · Messaging wording");
  await bar.getByRole("button", { name: "Discard" }).click();
  await expect(bar).toHaveCount(0);
  await expectAccessible(page);

  // Two rows edited on Workflow: one Save all saves both, each with its own audit entry.
  await page.getByRole("link", { name: "Workflow", exact: true }).click();
  await page.getByTestId("settings-queue").getByLabel("Turn on").first().check();
  await expect(page.getByTestId("settings-queue").getByTestId("setting-effect")).toContainText(
    "moves to high priority",
  );
  await page.getByLabel("Task: open").fill("To do");
  await expect(page.getByTestId("settings-statusLabels").getByTestId("setting-effect")).toContainText(
    "To do",
  );
  await expect(bar).toContainText("2 unsaved changes");
  await bar.getByRole("button", { name: "Save all" }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId("settings-queue").getByTestId("last-changed")).toContainText("Dana Brooks");
  await expect(page.getByTestId("settings-statusLabels").getByTestId("last-changed")).toContainText(
    "Dana Brooks",
  );
});
