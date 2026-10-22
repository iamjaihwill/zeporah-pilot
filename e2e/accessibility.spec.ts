import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { expectAccessible, resetData, signInAs, open } from "./helpers";

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await resetData(page);
  await page.close();
});

test("start page", async ({ page }) => {
  await open(page, "/");
  await expectAccessible(page);
});

test("keyboard: skip link, persona sign-in and main navigation", async ({ page }) => {
  await open(page, "/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.getByRole("button", { name: "Sign in as Daniel Okafor" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/family$/);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tasks" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/family\/tasks/);
  await expect(page.locator("#main")).toBeFocused(); // focus moves to the new page
});

const familyPages = [
  "/family",
  "/family/tasks",
  "/family/messages",
  "/family/vault",
  "/family/people",
  "/family/sharing",
  "/family/support",
  "/family/settings",
  "/family/notifications",
];
test("family pages", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  for (const p of familyPages) {
    await open(page, p);
    await expect(page.locator("main h1")).toBeVisible();
    await expectAccessible(page);
  }
});

const staffPages = [
  "/staff",
  "/staff/exceptions",
  "/staff/households",
  "/staff/households/hh-okafor?tab=overview",
  "/staff/households/hh-okafor?tab=sharing",
  "/staff/households/hh-okafor?tab=timeline",
  "/staff/packets",
  "/staff/packets/pk-bennett-equipment",
  "/staff/policy",
  "/staff/reviews",
];
test("staff pages", async ({ page }) => {
  await signInAs(page, "Priya Raman");
  for (const p of staffPages) {
    await open(page, p);
    await expect(page.locator("main h1")).toBeVisible();
    await expectAccessible(page);
  }
});

const opsPages = [
  "/staff",
  "/staff/exceptions?kind=packet",
  "/staff/households/hh-okafor?tab=messages",
  "/staff/households/hh-okafor?tab=updates",
  "/staff/households/hh-okafor?tab=notes",
  "/staff/households/hh-okafor?tab=tasks",
  "/staff/households/hh-okafor?tab=vault",
  "/staff/households/hh-okafor?tab=lifecycle",
  "/staff/exceptions",
  "/staff/packets",
  "/staff/packets/pk-okafor-respite",
  "/staff/packets/pk-lindqvist-circle",
  "/staff/households/hh-bennett?tab=sharing",
  "/staff/policy",
];
test("staff pages as operations", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  for (const p of opsPages) {
    await open(page, p);
    await expect(page.locator("main h1")).toBeVisible();
    await expectAccessible(page);
  }
});

test("sharing and vault as the patient and a proxy", async ({ page }) => {
  for (const [who, pages] of [
    ["Grace Okafor", ["/family/sharing", "/family/support"]],
    ["Ada Okafor", ["/family/vault", "/family/vault/vi-okafor-10"]],
  ] as const) {
    await signInAs(page, who);
    for (const p of pages) {
      await open(page, p);
      await expect(page.locator("main h1")).toBeVisible();
      await expectAccessible(page);
    }
  }
});
