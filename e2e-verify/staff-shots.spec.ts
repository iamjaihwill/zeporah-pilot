import { test, type Browser } from "@playwright/test";
import { ready } from "../e2e/helpers";

/**
 * Staff workspace screenshots and measurements for the rework. STAFF_SHOTS=before|after picks the
 * folder; skipped otherwise so the ordinary verification run stays read-only.
 */
const SET = process.env["STAFF_SHOTS"];
const out = `docs/review-screenshots/staff-${SET}`;

async function as(browser: Browser, persona: string, width = 1338, height = 788) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: `Sign in as ${persona}` }).click();
  await page.waitForURL(/\/staff/);
  await ready(page);
  return { page, ctx };
}

test.describe(() => {
  test.skip(!SET, "STAFF_SHOTS not given");
  test("reset", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "Reset synthetic data…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset synthetic data", exact: true }).click();
    await page.getByTestId("live-region").filter({ hasText: "Synthetic data was reset." }).waitFor();
  });
  test("screens", async ({ browser }) => {
    const { page, ctx } = await as(browser, "Dana Brooks");
    for (const [path, name] of [
      ["/staff", "dashboard"],
      ["/staff/exceptions", "queue"],
      ["/staff/households/hh-okafor", "household-record"],
      ["/staff/packets/pk-okafor-respite", "packet-detail"],
      ["/staff/settings", "settings"],
      ["/staff/reports", "reports"],
    ] as const) {
      await page.goto(path);
      await ready(page);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/${name}-1338.png` });
    }
    // Measurement: queue rows visible above the fold at 1338×788, in each density.
    const count = () =>
      page.evaluate(() => ({
        visible: Array.from(document.querySelectorAll("table tbody tr")).filter((r) => {
          const b = r.getBoundingClientRect();
          return b.height > 0 && b.top >= 0 && b.bottom <= innerHeight;
        }).length,
        total: document.querySelectorAll("table tbody tr").length,
      }));
    await page.goto("/staff/exceptions");
    await ready(page);
    console.log(
      `MEASURE comfortable: queue rows fully visible at 1338x788: ${JSON.stringify(await count())}`,
    );
    if (SET === "after") {
      await page.getByRole("button", { name: /^Account:/ }).click();
      await page.getByRole("radio", { name: "Compact" }).check();
      await page.waitForTimeout(800);
      await page.goto("/staff/exceptions");
      await ready(page);
      await page.screenshot({ path: `${out}/queue-compact-1338.png` });
      console.log(`MEASURE compact: queue rows fully visible at 1338x788: ${JSON.stringify(await count())}`);
      await page.getByRole("button", { name: /^Account:/ }).click();
      await page.getByRole("radio", { name: "Comfortable" }).check();
      await page.waitForTimeout(800);
    }
    await ctx.close();
  });

  test("clicks to take ownership of and resolve an escalation, from the dashboard", async ({ browser }) => {
    test.skip(SET !== "after", "measured on the new workspace only");
    const { page, ctx } = await as(browser, "Dana Brooks");
    let clicks = 0;
    const click = async (l: ReturnType<typeof page.locator>) => {
      clicks++;
      await l.click();
    };
    // 1: open the unassigned item from My work (it opens in the queue's detail panel).
    await click(page.locator('[data-widget="unowned"] ol a').first());
    const panel = page.getByTestId("detail-panel");
    // 2: "Take ownership and resolve…" (one confirmed step).
    await click(panel.getByRole("button", { name: "Take ownership and resolve…" }));
    const dialog = page.getByRole("dialog", { name: "Take ownership and resolve?" });
    await dialog.getByLabel("How was it resolved?").fill("Followed up (synthetic).");
    // 3: confirm.
    await click(dialog.getByRole("button", { name: "Take ownership and resolve" }));
    await page.getByTestId("live-region").filter({ hasText: "Resolved." }).waitFor();
    console.log(`MEASURE clicks from My work to own and resolve an escalation: ${clicks} (plus the note)`);
    await ctx.close();
  });
});
