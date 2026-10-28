import { expect, test, type Browser } from "@playwright/test";
import { ready } from "../e2e/helpers";

/**
 * The staff workspace rework must not change the family app. Pixel comparison of three family
 * pages (desktop and phone) against baselines taken before the rework. Times and dates are masked:
 * they're relative to when the synthetic data was seeded. Update baselines only on purpose:
 * `bunx playwright test --config playwright.verify.config.ts family-unchanged --update-snapshots`.
 */
const PAGES = [
  ["Daniel Okafor", "/family"],
  ["Daniel Okafor", "/family/messages"],
  ["Ada Okafor", "/family/sharing"],
] as const;

async function shoot(
  browser: Browser,
  persona: string,
  path: string,
  width: number,
  height: number,
  name: string,
) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: `Sign in as ${persona}` }).click();
  await page.waitForURL(/\/family/);
  await page.goto(path);
  await ready(page);
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    // Dates without a time too ("Oct 28, 2026"): they move with the seed day.
    mask: [
      page.locator("time"),
      page.getByText(/\d{1,2}:\d\d [AP]M/),
      page.getByText(/\b[A-Z][a-z]{2} \d{1,2}, \d{4}\b/),
    ],
    maxDiffPixelRatio: 0.002,
  });
  await ctx.close();
}

test.describe("family app is unchanged by the staff rework", () => {
  test("reset", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "Reset synthetic data…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset synthetic data", exact: true }).click();
    await page.getByTestId("live-region").filter({ hasText: "Synthetic data was reset." }).waitFor();
  });
  for (const [persona, path] of PAGES) {
    const slug = path.replaceAll("/", "-").replace(/^-/, "");
    test(`${slug} desktop`, async ({ browser }) =>
      shoot(browser, persona, path, 1280, 900, `${slug}-1280.png`));
    test(`${slug} phone`, async ({ browser }) => shoot(browser, persona, path, 390, 844, `${slug}-390.png`));
  }
});
