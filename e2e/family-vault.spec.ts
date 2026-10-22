import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { expectAccessible, nav, resetData, signInAs, unread, open } from "./helpers";

test.beforeEach(async ({ page }) => resetData(page));

test("dashboard → vault → review → back updates counts, activity and notifications", async ({ page }) => {
  await signInAs(page, "Ada Okafor");
  const adaUnreadBefore = await unread(page);

  await signInAs(page, "Daniel Okafor");
  const needs = page.getByRole("link", { name: /Vault items need a look/ });
  await expect(needs).toContainText("1");
  await needs.click();
  await expect(page.getByRole("heading", { name: "What exists, and where it's kept" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Advance directive" })).toHaveCount(0); // protected: hidden, not locked
  await expect(page.getByTestId("vault-count-needs_review")).toHaveText("1");
  await expectAccessible(page);

  await page.getByRole("link", { name: "Review", exact: true }).click();
  await page.getByRole("radio", { name: "We have it" }).check();
  await page.getByLabel("Where is it kept? (optional)").fill("Taped inside the pantry door");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("vault-count-needs_review")).toHaveText("0");

  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page.getByRole("link", { name: /Vault items need a look/ })).toContainText("0");
  await expect(page.getByText(/Daniel reviewed “Where the medication list is kept”/)).toBeVisible();

  // Ada is told, and the protected item stays visible to her.
  await signInAs(page, "Ada Okafor");
  expect(await unread(page)).toBe(adaUnreadBefore + 1);
  await nav(page, "Vault").click();
  await expect(page.getByRole("heading", { name: "Advance directive" })).toBeVisible();
});
