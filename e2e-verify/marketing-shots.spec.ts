import { test, type Browser, type Page } from "@playwright/test";
import { ready } from "../e2e/helpers";

/**
 * Product screenshots for the marketing website, saved as PNGs to ../zeporah-website/assets-src/app/
 * (the website's optimize-images.sh turns them into web-sized JPEGs).
 * MARKETING_SHOTS=1 runs it; skipped otherwise, so the ordinary verification run stays read-only.
 * Synthetic data only. At capture time it hides the development banner, test-only controls and
 * "(synthetic)" labels so the images read as product views; the app itself is unchanged.
 */
const ON = !!process.env["MARKETING_SHOTS"];
const out = "../zeporah-website/assets-src/app";

async function reset(page: Page, snapshot: string) {
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "Reset synthetic data…" }).click();
  const d = page.getByRole("dialog", { name: "Reset synthetic data?" });
  await d.getByLabel(snapshot).check();
  await d.getByRole("button", { name: "Reset synthetic data", exact: true }).click();
  await page
    .getByTestId("live-region")
    .filter({ hasText: "Synthetic data was reset." })
    .waitFor({ timeout: 30_000 });
}

const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

async function as(browser: Browser, persona: string, options: typeof phone | typeof desk) {
  const ctx = await browser.newContext({ ...options, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: `Sign in as ${persona}` }).click();
  await page.waitForURL(/\/(family|staff)(\/bereavement|\/team|\/admin)?$/);
  await ready(page);
  // Signed in only once the app shell is on screen (sidebar on desktop, bottom bar on phones).
  await page.getByRole("navigation", { name: "Main" }).first().waitFor();
  await page.locator("main h1").first().waitFor();
  return { page, ctx };
}

async function go(page: Page, path: string) {
  await page.goto(path);
  await ready(page);
  await page.waitForTimeout(300);
}

/** Remove development-only chrome from the page before a capture. */
async function tidy(page: Page) {
  await page.evaluate(() => {
    for (const note of document.querySelectorAll('[role="note"]'))
      if (note.textContent?.includes("Synthetic pilot prototype")) note.remove();
    for (const button of document.querySelectorAll("button"))
      if (/Reset synthetic data/.test(button.textContent ?? "")) (button as HTMLElement).style.display = "none";
    for (const link of document.querySelectorAll('a[href="/staff/policy"]')) {
      const group = link.closest("li, div, section");
      (group?.parentElement?.closest("div, section") ?? group)?.querySelectorAll("*").forEach((el) => {
        if (el.textContent?.trim().toLowerCase() === "testing") (el as HTMLElement).style.display = "none";
      });
      (link as HTMLElement).style.display = "none";
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      // Copilot drafts keep their "synthetic example" label: no model is connected, so it must stay.
      if (node.nodeValue && /synthetic|simulated/i.test(node.nodeValue) && !/Copilot/i.test(node.nodeValue))
        node.nodeValue = node.nodeValue
          .replace(/\s*\((?:a )?(?:synthetic|simulated)[^)]*\)/gi, "")
          .replace(/\s*·\s*(?:synthetic|simulated)(?: example)?/gi, "")
          .replace(/\b(?:synthetic|simulated) /gi, "");
  });
}

async function shot(page: Page, name: string) {
  await tidy(page);
  await page.screenshot({ path: `${out}/${name}.png` });
}

test.describe.serial("marketing website screenshots", () => {
  test.skip(!ON, "MARKETING_SHOTS not given");
  test.setTimeout(300_000);

  test("family app and coordination desk", async ({ browser, page }) => {
    await reset(page, "Demo week: mid-week (Day 4)");

    // Family app, on a phone.
    {
      const { page: p, ctx } = await as(browser, "Daniel Okafor", phone);
      await shot(p, "family-home");
      await go(p, "/family/messages");
      await shot(p, "family-messages");
      await go(p, "/family/people");
      await shot(p, "family-people");
      await go(p, "/family/sharing");
      await shot(p, "family-sharing");
      await ctx.close();
    }
    {
      // A household coordinator receiving continuing support after a death.
      const { page: p, ctx } = await as(browser, "Ingrid Lindqvist", phone);
      await shot(p, "family-bereavement");
      await ctx.close();
    }

    // Coordination desk, on a laptop.
    {
      const { page: p, ctx } = await as(browser, "Maya Chen", desk);
      await shot(p, "desk-my-work");
      await go(p, "/staff/households/hh-okafor");
      await shot(p, "desk-record");
      await p.getByRole("button", { name: "Catch me up" }).click();
      await p.getByTestId("brief-lines").waitFor();
      await shot(p, "desk-catch-me-up");
      await p.keyboard.press("Escape");
      await go(p, "/staff/households/hh-okafor?tab=messages");
      await shot(p, "desk-prepared-draft");
      await go(p, "/staff/households/hh-okafor/access");
      await shot(p, "desk-who-can-see-what");
      await go(p, "/staff/exceptions?view=consent");
      await p.getByRole("button", { name: /^Open Consent to share with Oakwood/ }).click();
      await p.getByTestId("detail-panel").getByRole("heading", { name: "Why this is here" }).waitFor();
      await shot(p, "desk-consent-hold");
      await ctx.close();
    }
    {
      const { page: p, ctx } = await as(browser, "Dana Brooks", desk);
      await go(p, "/staff/exceptions");
      await shot(p, "desk-exceptions");
      await go(p, "/staff/audit?householdId=hh-okafor&days=7");
      await shot(p, "desk-audit");
      await ctx.close();
    }
  });
});
