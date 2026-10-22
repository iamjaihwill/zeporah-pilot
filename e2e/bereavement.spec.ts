import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { expectAccessible, nav, resetData, signInAs, open } from "./helpers";

test.beforeEach(async ({ page }) => resetData(page));

test("bereavement transition narrows protected access while practical support continues", async ({
  page,
}) => {
  await signInAs(page, "Ada Okafor");
  await nav(page, "Vault").click();
  await expect(page.getByRole("heading", { name: "Advance directive" })).toBeVisible();

  // Proposed by the care guide…
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor?tab=lifecycle");
  await page.getByLabel("Surviving contact").selectOption({ label: "Daniel Okafor · Household coordinator" });
  await page.getByRole("button", { name: "Propose transition" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for confirmation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm transition" })).toHaveCount(0); // care guides can't confirm

  // …confirmed by a different operations user.
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/households/hh-okafor?tab=lifecycle");
  await page.getByRole("button", { name: "Confirm transition" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm transition" }).click();
  await expect(page.getByRole("heading", { name: "Bereavement support confirmed" })).toBeVisible();

  // Protected access that depended on care-period authority is gone.
  await signInAs(page, "Ada Okafor");
  await nav(page, "Vault").click();
  // Wait for the vault to finish loading before checking what's absent (and before navigating away).
  await expect(page.getByRole("heading", { name: "What exists, and where it's kept" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Advance directive" })).toHaveCount(0);

  // The patient's own access has ended.
  await signInAs(page, "Grace Okafor");
  await expect(page.getByText("You're not part of a household right now.")).toBeVisible();

  // The surviving contact keeps coordinating, and confirms.
  // In bereavement support, the household lands on Continuing support (item 13).
  await page.goto("/");
  await page.locator("html[data-hydrated]").waitFor();
  await page.getByRole("button", { name: "Sign in as Daniel Okafor" }).click();
  await expect(page).toHaveURL(/\/family\/bereavement$/);
  await expect(page.getByRole("heading", { name: "Are you the main contact going forward?" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Yes, that's me" }).click();
  await expect(page.getByText("You're the main contact for your household.")).toBeVisible();
  await nav(page, "Tasks").click();
  await expect(page.getByText("Choose whether you'd like bereavement support")).toBeVisible();
  await nav(page, "Updates & messages").click();
  await page.getByLabel(/Message Maya Chen/).fill("Thank you for everything.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Thank you for everything.")).toBeVisible();
});

test("sessions opened before bereavement are re-checked on every request afterwards", async ({
  page,
  browser,
}, info) => {
  const baseURL = String(info.project.use.baseURL);
  // Ada and Grace sign in, in their own browsers, before anything changes.
  const adaCtx = await browser.newContext({ baseURL });
  const graceCtx = await browser.newContext({ baseURL });
  const ada = await adaCtx.newPage();
  const grace = await graceCtx.newPage();
  await signInAs(ada, "Ada Okafor");
  await open(ada, "/family/vault");
  await expect(ada.getByRole("heading", { name: "Advance directive" })).toBeVisible();
  await signInAs(grace, "Grace Okafor");
  await expect(grace.getByRole("navigation", { name: "Main" })).toBeVisible();

  // Care guide proposes; operations confirms.
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor?tab=lifecycle");
  await page.getByLabel("Surviving contact").selectOption({ label: "Daniel Okafor · Household coordinator" });
  await page.getByRole("button", { name: "Propose transition" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for confirmation" })).toBeVisible();
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/households/hh-okafor?tab=lifecycle");
  await page.getByRole("button", { name: "Confirm transition" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm transition" }).click();
  await expect(page.getByRole("heading", { name: "Bereavement support confirmed" })).toBeVisible();

  // The same sessions, reused: protected access and the patient's access are gone.
  await open(ada, "/family/vault");
  await expect(ada.getByRole("heading", { name: "Advance directive" })).toHaveCount(0);
  await open(ada, "/family/vault/vi-okafor-10");
  await expect(ada.getByRole("heading", { name: /^Not available|^This isn't available/ })).toBeVisible();
  await open(grace, "/family");
  await expect(grace.getByText("You're not part of a household right now.")).toBeVisible();
  await open(grace, "/family/sharing");
  await expect(grace.getByRole("button", { name: /Withdraw consent|Confirm this sharing/ })).toHaveCount(0);
  await adaCtx.close();
  await graceCtx.close();
});
