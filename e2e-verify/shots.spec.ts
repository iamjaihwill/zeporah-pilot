import { test, type Browser, type Page } from "@playwright/test";
import { ready } from "../e2e/helpers";

/**
 * Review screenshots for the 2026-10-13 interaction review. SHOT_SET=before|after picks the folder.
 * Runs only when SHOT_SET is given, so the ordinary verification run stays read-only.
 */
const SET = process.env["SHOT_SET"];
const out = `docs/review-screenshots/interaction-${SET}`;

async function as(browser: Browser, persona: string, width: number, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: `Sign in as ${persona}` }).click();
  await page.waitForURL(/\/(family|staff)$/);
  await ready(page);
  return { page, ctx };
}
const snap = (page: Page, name: string, full = false) =>
  page.screenshot({ path: `${out}/${name}.png`, fullPage: full });

test.describe(() => {
  test.skip(!SET, "SHOT_SET not given");

  test("reset first", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "Reset synthetic data…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset synthetic data", exact: true }).click();
    await page.getByTestId("live-region").filter({ hasText: "Synthetic data was reset." }).waitFor();
  });

  test("item 1 and 3", async ({ browser }) => {
    const m = await as(browser, "Marisol Rivera", 1280);
    await m.page.goto("/family/onboarding");
    await ready(m.page);
    await snap(m.page, "item1-setup-marisol");
    await m.ctx.close();
    const c = await as(browser, "Chidi Okafor", 1280);
    await c.page.goto("/family/vault");
    await ready(c.page);
    await snap(c.page, "item3-access-denied-chidi");
    await c.ctx.close();
  });

  test("item 7", async ({ browser }) => {
    const { page, ctx } = await as(browser, "Daniel Okafor", 1280);
    await page.goto("/family/people");
    await ready(page);
    await page.getByLabel("Their name").fill("Test Cousin");
    await page.getByLabel("Email", { exact: true }).fill("test.cousin@example.invalid");
    await page.getByRole("button", { name: "Review access" }).click();
    await page.getByRole("button", { name: "Record invitation" }).click();
    await page.getByTestId("invitation-link").waitFor();
    await page.getByTestId("invitation-link").scrollIntoViewIfNeeded();
    await snap(page, "item7-invitation-link-daniel");
    await ctx.close();
  });

  test("item 15", async ({ browser }) => {
    const { page, ctx } = await as(browser, "Maya Chen", 1338);
    await page.goto("/staff/exceptions");
    await ready(page);
    const btn = page.getByRole("button", { name: /^Take ownership/ }).first();
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.boundingBox();
    await snap(page, "item15-queue-before-click-maya");
    await btn.click();
    await page.waitForTimeout(1200);
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await snap(page, "item15-queue-after-click-maya");
    await ctx.close();
  });

  test("item 18", async ({ browser }) => {
    const { page, ctx } = await as(browser, "Priya Raman", 1338);
    await page.goto("/staff/households/hh-okafor?tab=sharing");
    await ready(page);
    await snap(page, "item18-consent-table-priya", true);
    await ctx.close();
  });

  test("item 19", async ({ browser }) => {
    const { page, ctx } = await as(browser, "Dana Brooks", 1338);
    await page.goto("/staff/packets/pk-okafor-respite");
    await ready(page);
    await page.getByRole("button", { name: "Request release…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Request release", exact: true }).click();
    await page.getByTestId("release-outcome").filter({ hasText: "Released" }).waitFor();
    await page.reload();
    await ready(page);
    await snap(page, "item19-packet-after-release-dana", true);
    await ctx.close();
  });
});
