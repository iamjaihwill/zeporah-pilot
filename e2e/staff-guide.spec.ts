import { expect, test } from "./fixtures";
import {
  SYNTHETIC_PASSWORD,
  expectAccessible,
  issuedLink,
  open,
  resetData,
  signInAs,
  signOutFromShell,
} from "./helpers";

/** The care-team first-time guide (2026-10-21): welcome card, tour, checklist. */
test.beforeEach(async ({ page }) => resetData(page));

test("a new care guide is offered the tour, takes it by keyboard, and the checklist ticks it off", async ({
  page,
}) => {
  // Operations invites a new care guide, who joins.
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/settings?section=invitations");
  await page.getByLabel("Their name").fill("Robin Ash");
  await page.getByLabel("Their email").fill("robin.ash@example.test");
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = await issuedLink(page);
  await signOutFromShell(page);
  await open(page, link);
  await page.getByLabel("Create a password").fill(SYNTHETIC_PASSWORD);
  await page.getByLabel("Confirm the password").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page).toHaveURL(/\/staff$/);

  const started = page.getByTestId("getting-started");
  await expect(started).toContainText("Welcome to Zeporah");
  await expect(page.getByTestId("getting-started-progress")).toHaveText("0 of 4 done");
  await expectAccessible(page);

  // The tour: a dialog, step by step, pointing at the real sidebar.
  await page.getByRole("button", { name: "Start the tour" }).click();
  const tour = page.getByRole("dialog", { name: "Welcome to Zeporah" });
  await expect(tour).toContainText("Step 1 of 6");
  await expectAccessible(page);
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "My work" })).toContainText("Step 2 of 6");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to Zeporah" })).toBeVisible();
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "Help is always here" })).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Tour finished. You can take it again from Help.");
  await expect(started).not.toContainText("Welcome to Zeporah");
  await expect(page.getByTestId("getting-started-progress")).toHaveText("1 of 4 done");

  // Hidden for good; the tour stays in Help.
  await page.getByRole("button", { name: "Hide getting started" }).click();
  await expect(page.getByTestId("getting-started")).toHaveCount(0);
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("button", { name: "Take the tour" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to Zeporah" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("people who've been here a while see no checklist, and their tour is about their role", async ({
  page,
}) => {
  await signInAs(page, "Dana Brooks");
  await expect(page.getByTestId("getting-started")).toHaveCount(0);
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("button", { name: "Take the tour" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "Team & coverage" })).toBeVisible();
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
