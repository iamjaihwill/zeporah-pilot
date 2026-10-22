import { expect, test } from "./fixtures";
import {
  expectAccessible,
  expectNoSidewaysScroll,
  nav,
  open,
  resetData,
  signInAs,
  signOutFromShell,
} from "./helpers";

/** Interaction review 2026-10-13, family app (items 4–14). Runs on desktop and phone. */
test.beforeEach(async ({ page }) => resetData(page));

test("mark a task done, undo it from the note, and focus never drops to the page", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await nav(page, "Tasks").click();
  const task = page.getByRole("listitem").filter({ hasText: "Confirm which visit times work this week" });
  await task.getByRole("button", { name: "Mark done" }).click();
  const note = page.getByTestId("status-note");
  await expect(note).toContainText("Task marked done.");
  // Focus goes to Undo, not to <body>.
  const undo = note.getByRole("button", { name: "Undo" });
  await expect(undo).toBeFocused();
  await expectAccessible(page);
  await undo.click();
  await expect(page.getByTestId("live-region")).toHaveText("Undone.");
  await expect(task.getByRole("button", { name: "Mark done" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await expectNoSidewaysScroll(page);
});

test("reopen from the Done list; the list says who did it and when", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await nav(page, "Tasks").click();
  await page.getByText(/^Done or closed \(/).click();
  await expect(page.getByText(/^Done by Daniel · /)).toBeVisible();
  await expect(page.getByText(/finished “/)).toHaveCount(0);
  await page
    .getByRole("button", { name: /^Reopen/ })
    .first()
    .click();
  await expect(page.getByTestId("live-region")).toHaveText("Task reopened.");
});

test("text size is each person's own, even on a shared browser", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await nav(page, "Settings").click();
  await page.getByRole("radio", { name: "Largest" }).check();
  // Previewed straight away, before saving.
  await expect(page.locator("html")).toHaveAttribute("data-text", "largest");
  await expect(page.getByTestId("settings-state")).toHaveText("You have unsaved changes.");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByTestId("settings-state")).toHaveText("All changes saved.");
  await signOutFromShell(page);
  await signInAs(page, "Ada Okafor");
  await expect(page.locator("html")).toHaveAttribute("data-text", "standard");
  await signOutFromShell(page);
  await signInAs(page, "Daniel Okafor");
  await expect(page.locator("html")).toHaveAttribute("data-text", "largest");
});

test("leaving Settings with unsaved changes asks first", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await nav(page, "Settings").click();
  await page.getByRole("radio", { name: "Larger" }).check();
  await nav(page, "Tasks").click();
  const ask = page.getByRole("alertdialog", { name: "Leave without saving?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Stay on this page" }).click();
  await expect(page).toHaveURL(/\/family\/settings$/);
  await nav(page, "Tasks").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Leave without saving" }).click();
  await expect(page).toHaveURL(/\/family\/tasks$/);
  await expect(page.locator("html")).toHaveAttribute("data-text", "standard");
});

test("an invitation link can be copied, replaced and revoked", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signInAs(page, "Daniel Okafor");
  await nav(page, "People").click();
  await page.getByLabel("Their name").fill("Test Cousin");
  await page.getByLabel("Email", { exact: true }).fill("test.cousin@example.invalid");
  await page.getByRole("button", { name: "Review access" }).click();
  await page.getByRole("button", { name: "Record invitation" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Invitation link ready for Test Cousin.");
  const box = page.getByTestId("invitation-link");
  await box.getByRole("button", { name: "Copy link" }).click();
  await expect(box.getByText("Copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/invite\//);
  const row = page.getByRole("listitem").filter({ hasText: "Test Cousin" });
  await row.getByRole("button", { name: /^Create a new link/ }).click();
  await page
    .getByRole("dialog", { name: "Create a new link for Test Cousin?" })
    .getByRole("button", { name: "Create a new link" })
    .click();
  await expect(page.getByTestId("live-region")).toHaveText("New invitation link ready for Test Cousin.");
  await row.getByRole("button", { name: /^Revoke/ }).click();
  await page
    .getByRole("dialog", { name: "Revoke the invitation for Test Cousin?" })
    .getByRole("button", { name: "Revoke invitation" })
    .click();
  await expect(page.getByTestId("live-region")).toHaveText("Invitation revoked.");
  await expectAccessible(page);
});

test("Chidi: accurate consent wording, ask about an update, and the vault label says who can see it", async ({
  page,
}) => {
  await signInAs(page, "Chidi Okafor");
  await expect(page.getByText("See what it covers, and request a correction")).toBeVisible();
  await expect(page.getByText(/confirm, request a correction or withdraw/)).toHaveCount(0);
  await nav(page, "Updates").click();
  await page
    .getByRole("link", { name: /^Ask about this/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Ask your care team about this update" })).toBeVisible();
  await page.getByRole("button", { name: "Send my question" }).click();
  await expect(page.getByTestId("your-requests")).toContainText("A question about an update");
  await expectAccessible(page);
  // Decision 43: Chidi sees only items visible to the household (none yet); Daniel's labels name
  // exactly who can see each item.
  await open(page, "/family/vault");
  await expect(page.getByText("Nothing in the vault is shared with you yet.")).toBeVisible();
  await expect(page.getByTestId("vault-audience")).toHaveCount(0);
  await signOutFromShell(page);
  await signInAs(page, "Daniel Okafor");
  await nav(page, "Vault").click();
  await expect(page.getByTestId("vault-audience").first()).toContainText(
    "Shared with staff: Grace, you and Ada and your care team",
  );
  await expect(
    page.getByTestId("vault-audience").filter({ hasText: "Visible to the household" }),
  ).toHaveCount(0);
});

test("staff opening the family app go to their workspace", async ({ page }) => {
  await signInAs(page, "Jordan Ellis");
  await open(page, "/family");
  await expect(page).toHaveURL(/\/staff$/);
  await open(page, "/family/tasks");
  await expect(page).toHaveURL(/\/staff$/);
});

test("Grace sees her wishes section; Marisol's unfinished setup comes first", async ({ page }) => {
  await signInAs(page, "Grace Okafor");
  await expect(
    page.getByRole("heading", { name: "Your wishes and who can see your information" }),
  ).toBeVisible();
  await expectAccessible(page);
  await signOutFromShell(page);
  await signInAs(page, "Marisol Rivera");
  const attention = page.getByRole("region", { name: "What needs your attention" });
  await expect(attention.getByTestId("setup-attention")).toBeVisible();
  await expect(page.getByText("Nothing needs you right now")).toHaveCount(0);
  await expectNoSidewaysScroll(page);
});

test("Ingrid lands on Continuing support and can pause contact", async ({ page }) => {
  await signInAs(page, "Ingrid Lindqvist");
  await expect(page).toHaveURL(/\/family\/bereavement$/);
  await expect(page.getByText(/· (early|mid|late) [A-Z][a-z]{2}/).first()).toBeVisible();
  await page.getByRole("button", { name: "I'd rather not be contacted for now" }).click();
  await expect(page.getByText("You've asked not to be contacted for now.")).toBeVisible();
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
});
