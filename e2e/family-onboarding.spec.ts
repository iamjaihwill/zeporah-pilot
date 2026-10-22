import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { expectAccessible, expectNoSidewaysScroll, nav, resetData, signInAs } from "./helpers";

test.beforeEach(async ({ page }) => resetData(page));

test("onboarding progressively updates the dashboard", async ({ page }) => {
  await signInAs(page, "Marisol Rivera");
  await expect(page.getByText("0 of 4 steps done")).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expect(page.getByText(/(Messaging|Replying) turns on once communication settings are/)).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "Start setup" }).click();
  // Step 1 — preferences
  await page.getByRole("radio", { name: "Larger" }).check();
  await page.getByRole("radio", { name: "Phone call" }).check();
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
  await page.getByRole("button", { name: "Save and continue" }).click();
  // Step 2 — trusted contacts, with an access review before recording
  await expect(page.getByRole("heading", { name: "Who else should be part of this?" })).toBeVisible();
  await page.getByLabel("Their name").fill("Luis Rivera");
  await page.getByLabel("Email", { exact: true }).fill("luis@example.invalid");
  await page.getByRole("button", { name: "Review access" }).click();
  await expect(page.getByText("Won't be able to see")).toBeVisible();
  await page.getByRole("button", { name: "Record invitation" }).click();
  await expect(page.getByText("Luis Rivera").first()).toBeVisible();
  // No email is sent: the one-time link is shown to the inviter instead.
  await expect(page.getByTestId("invitation-link")).toContainText("/invite/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // Step 3 — communication
  await expect(page.getByRole("heading", { name: "How should we keep you posted?" })).toBeVisible();
  await page.getByRole("radio", { name: /A daily summary/ }).check();
  await page.getByRole("button", { name: "Save and continue" }).click();

  // Messaging is on now: the dashboard reflects it before setup is finished.
  await nav(page, "Home").click();
  await expect(page.getByText("3 of 4 steps done")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open messages" })).toBeVisible();

  // Step 4 — starter vault review
  await page.getByRole("link", { name: "Continue setup" }).click();
  await expect(page.getByRole("heading", { name: "Your starter vault" })).toBeVisible();
  await page.getByRole("link", { name: "Review", exact: true }).first().click();
  // Nothing is pre-selected (item 10): a choice is needed first.
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Choose what you know about this before saving.")).toBeVisible();
  await page.getByRole("radio", { name: /We have it/ }).check();
  await page.getByLabel("Where is it kept? (optional)").fill("Hall table");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Your starter vault" })).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page).toHaveURL(/\/family$/);
  await expect(page.getByText("Finish setting up your household space")).toHaveCount(0);
  await expect(page.getByText("Vault items need a look")).toBeVisible();
  await expect(page.getByText("Household setup was completed.")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-text", "larger");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Setup" }),
  ).toHaveCount(0);
});

test("every setup step loads directly for a household that's getting started", async ({ page }) => {
  await signInAs(page, "Marisol Rivera");
  const steps: [string, RegExp][] = [
    ["/family/onboarding", /Make Zeporah easier to use/],
    ["/family/onboarding?step=preferences", /Make Zeporah easier to use/],
    ["/family/onboarding?step=trusted_contacts", /Who else should be part of this\?/],
    ["/family/onboarding?step=communication", /How should we keep you posted\?/],
    ["/family/onboarding?step=vault_review", /Your starter vault/],
  ];
  for (const [url, heading] of steps) {
    await page.goto(url);
    await page.locator("html[data-hydrated]").waitFor();
    await expect(page.getByRole("heading", { level: 1, name: heading }), url).toBeVisible();
    await expect(page.getByTestId("unexpected-error"), url).toHaveCount(0);
    await expect(page.getByTestId("access-denied"), url).toHaveCount(0);
  }
  // And from the home page's button.
  await page.goto("/family");
  await page.getByRole("link", { name: "Start setup" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Make Zeporah easier to use/ })).toBeVisible();
});
