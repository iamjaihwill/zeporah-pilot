import { expect, test } from "./fixtures";
import { expectAccessible, expectNoSidewaysScroll, open, resetData, signInAs } from "./helpers";

/** Care-team navigation on phones (2026-10-21): a bottom bar per role, and Menu for every page. */
test.beforeEach(async ({ page }) => resetData(page));

test("a care guide's phone: content first, a bottom bar with counts, and Menu for everything", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, "Maya Chen");
  // The page starts near the top; the sidebar isn't stacked above it.
  const top = await page.getByRole("heading", { level: 1 }).evaluate((h) => h.getBoundingClientRect().top);
  expect(top).toBeLessThan(220);
  const bar = page.getByRole("navigation", { name: "Main" });
  for (const name of [/^My work/, /^Exceptions/, /^Households$/, /^Care-team tasks/])
    await expect(bar.getByRole("link", { name })).toBeVisible();
  await expect(bar.getByRole("link", { name: /^My work/ })).toHaveAttribute("aria-current", "page");
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);

  await bar.getByRole("link", { name: /^Exceptions/ }).click();
  await expect(page).toHaveURL(/\/staff\/exceptions/);
  await expect(bar.getByRole("link", { name: /^Exceptions/ })).toHaveAttribute("aria-current", "page");

  // Menu: every page, grouped; choosing one goes there and closes the menu.
  await bar.getByRole("button", { name: "Menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(
    menu.getByRole("list", { name: "Households" }).getByRole("link", { name: "Sharing register" }),
  ).toBeVisible();
  await expectAccessible(page);
  await menu.getByRole("link", { name: "Sharing register" }).click();
  await expect(page).toHaveURL(/\/staff\/sharing/);
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
  // Escape closes it too.
  await bar.getByRole("button", { name: "Menu" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
});

test("each role gets its own four, and wide screens keep the sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, "Dana Brooks");
  const bar = page.getByRole("navigation", { name: "Main" });
  await expect(bar.getByRole("link", { name: "Team & coverage" })).toBeVisible();
  await signInAs(page, "Lena Hoffman");
  await expect(bar.getByRole("link", { name: "Administration" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Audit review" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "/staff/admin");
  await expect(page.locator("[data-bottom-bar]")).toBeHidden();
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Hospice settings" }),
  ).toBeVisible();
});
