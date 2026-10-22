import { expect, test, type Browser, type Page } from "@playwright/test";
import { ready } from "../e2e/helpers";

/**
 * The enterprise demo run-through (decision 58, plan story A-3; docs/enterprise-demo-map.md), as
 * screenshots in docs/review-screenshots/enterprise/. ENTERPRISE_SHOTS=1 runs it; skipped
 * otherwise, so the ordinary verification run stays read-only. Synthetic data only.
 */
const ON = !!process.env["ENTERPRISE_SHOTS"];
const out = "docs/review-screenshots/enterprise";

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

async function as(browser: Browser, persona: string, width = 1440, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: `Sign in as ${persona}` }).click();
  await page.waitForURL(/\/(staff|family|recipient)/);
  await ready(page);
  return { page, ctx };
}
const shot = (page: Page, name: string, full = true) =>
  page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
const go = async (page: Page, path: string) => {
  await page.goto(path);
  await ready(page);
  await page.waitForTimeout(250);
};

test.describe.serial("enterprise demo run-through", () => {
  test.skip(!ON, "ENTERPRISE_SHOTS not given");
  test.setTimeout(240_000);

  test("mid-week (Day 4)", async ({ browser, page }) => {
    await reset(page, "Demo week: mid-week (Day 4)");
    // 1. Two front doors.
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await ctx.newPage();
      await go(p, "/");
      await shot(p, "01-family-sign-in-phone", false);
      await ctx.close();
      const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const p2 = await ctx2.newPage();
      await go(p2, "/staff-sign-in");
      await shot(p2, "02-care-team-sign-in", false);
      await ctx2.close();
    }
    // 2–5. Maya: her home, the Okafor record, Catch me up, Who can see what, a prepared draft.
    {
      const { page: p, ctx } = await as(browser, "Maya Chen");
      await shot(p, "03-care-guide-home");
      await go(p, "/staff/households/hh-okafor");
      await shot(p, "04-coordination-record");
      await p.getByRole("button", { name: "Catch me up" }).click();
      await p.getByTestId("brief-lines").waitFor();
      await shot(p, "05-catch-me-up", false);
      await p.keyboard.press("Escape");
      await go(p, "/staff/households/hh-okafor/access");
      await shot(p, "06-who-can-see-what");
      await go(p, "/staff/households/hh-okafor?tab=messages");
      await shot(p, "07-prepared-draft");
      await go(p, "/staff/exceptions?view=consent");
      await p.getByRole("button", { name: /^Open Consent to share with Oakwood/ }).click();
      await p.getByTestId("detail-panel").getByRole("heading", { name: "Why this is here" }).waitFor();
      await shot(p, "08-exceptions-missing-consent", false);
      await ctx.close();
    }
    // 7. Rosa reads the respite packet, read-only.
    {
      const { page: p, ctx } = await as(browser, "Rosa Lin");
      await p.getByRole("link", { name: "Coordinate a short respite stay" }).click();
      await ready(p);
      await shot(p, "09-recipient-portal");
      await ctx.close();
    }
    // 8. Dana: the operations home, then offers cover; Sofia sees the offer.
    {
      const { page: p, ctx } = await as(browser, "Dana Brooks");
      await shot(p, "10-operations-home");
      await go(p, "/staff/team");
      await shot(p, "11-planned-absence-board");
      const row = p.locator("tr", { hasText: "The Okafor household" }).filter({ hasText: "No cover yet" });
      await row.getByRole("button", { name: /Offer cover/ }).click();
      const d = p.getByRole("dialog", { name: "Offer cover for The Okafor household?" });
      await d.getByLabel("Offer to").selectOption({ label: "Sofia Reyes" });
      await d.getByRole("button", { name: "Use this draft" }).click();
      await shot(p, "12-offer-cover-with-prepared-note", false);
      await d.getByRole("button", { name: "Offer cover" }).click();
      await expect(p.getByTestId("live-region")).toHaveText("Cover offered to Sofia Reyes.");
      await ctx.close();
      const s = await as(browser, "Sofia Reyes", 1024, 768);
      await s.page.getByTestId("handoff-offer").waitFor();
      await shot(s.page, "13-handoff-offered-ipad", false);
      // Demo rehearsal S-11: once Sofia accepts, operations see her cover before it starts.
      await s.page
        .getByRole("button", { name: /^Accept/ })
        .first()
        .click();
      await s.page.getByRole("dialog").getByRole("button", { name: "Accept", exact: true }).click();
      await expect(s.page.getByTestId("live-region")).toHaveText("You accepted The Okafor household.");
      await s.ctx.close();
      const ops = await as(browser, "Dana Brooks");
      await go(ops.page, "/staff/households/hh-okafor/access");
      await ops.page
        .getByText(/^Temporary from /)
        .first()
        .waitFor();
      await shot(ops.page, "21-cover-arranged-before-it-starts");
      await ops.ctx.close();
    }
  });

  test("end of week (Day 7)", async ({ browser, page }) => {
    await reset(page, "Demo week: end of week (Day 7)");
    {
      const { page: p, ctx } = await as(browser, "Dana Brooks");
      await go(p, "/staff/exceptions?view=resolved");
      await shot(p, "14-resolved");
      await go(p, "/staff/audit?householdId=hh-okafor&days=7");
      await shot(p, "15-audit-okafor-week");
      await go(p, "/staff/audit?householdId=hh-okafor&days=7&source=approval");
      await p
        .getByRole("button", { name: /^Open Consent activated/ })
        .first()
        .click();
      await p.getByTestId("detail-panel").getByText("Approved by").waitFor();
      await shot(p, "16-audit-two-person-approval", false);
      // Direction refinements D-3 and D-6: where work is waiting, and prepared work in Reports.
      await go(p, "/staff/exceptions");
      await p.getByTestId("bottlenecks").locator("summary").click();
      await shot(p, "19-where-work-is-waiting", false);
      await go(p, "/staff/reports?days=7");
      await shot(p, "20-reports-prepared-work");
      await ctx.close();
    }
    {
      const { page: p, ctx } = await as(browser, "Lena Hoffman");
      await shot(p, "17-administrator-home");
      await ctx.close();
    }
    {
      const { page: p, ctx } = await as(browser, "Maya Chen", 390, 844);
      await p.getByRole("heading", { level: 1, name: "My work" }).waitFor();
      await shot(p, "18-care-guide-home-phone", false);
      await ctx.close();
    }
    // Decision 62: Daniel was told on Day 5, when Sofia's cover started.
    {
      const { page: p, ctx } = await as(browser, "Daniel Okafor", 390, 844);
      await p
        .getByText(/is your care guide until/)
        .first()
        .scrollIntoViewIfNeeded();
      await shot(p, "22-family-told-when-cover-started-phone", false);
      await ctx.close();
    }
  });
});
