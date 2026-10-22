import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Wait until React has hydrated the page, so clicks are never lost. */
export async function ready(page: Page) {
  await page.locator("html[data-hydrated]").waitFor();
}

/** Put the synthetic dataset back to its starting state through the app's own reset control. */
export async function resetData(
  page: Page,
  snapshot:
    | "Standard synthetic data"
    | "Demo week: mid-week (Day 4)"
    | "Demo week: end of week (Day 7)" = "Standard synthetic data",
) {
  await page.goto("/");
  await ready(page);
  // Reset asks for confirmation first; the demo week (decision 58) is one of its choices.
  await page.getByRole("button", { name: "Reset synthetic data…" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset synthetic data?" });
  await dialog.getByLabel(snapshot).check();
  await dialog.getByRole("button", { name: "Reset synthetic data", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Synthetic data was reset.", { timeout: 30_000 });
}

/** Sign in as a synthetic persona from the start page. */
export async function signInAs(page: Page, name: string) {
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await page.waitForURL(/\/(family|staff|helper|recipient)(\/bereavement|\/team|\/admin)?$/);
  // Helpers and packet recipients (decisions 42 and 45) have one page each and no app shell.
  if (!/\/(helper|recipient)$/.test(page.url()))
    // Either the app shell or, for someone whose access has ended, the calm "not available" page.
    await expect(
      page
        .getByRole("navigation", { name: "Main" })
        .or(page.getByRole("heading", { name: /^Not available|^This isn't available/ })),
    ).toBeVisible();
  await expect(page.locator("main h1")).toBeVisible();
}

/** Open a URL and wait until the page is interactive. */
export async function open(page: Page, url: string) {
  await page.goto(url);
  await ready(page);
}

export async function unread(page: Page) {
  // Only the badge on screen: phones hide the sidebar and show the bottom bar instead.
  const badge = page.locator(`[data-testid="unread-badge"]:visible`);
  if ((await badge.count()) === 0) return 0;
  return Number((await badge.first().innerText()).replace(/\D/g, ""));
}

/**
 * Main navigation on any screen size. Desktop and tablet have the sidebar; phones (family app) have a
 * bottom bar with short labels plus a "More" sheet for the rest.
 */
const SHORT: Record<string, string> = { "Updates & messages": "Messages" };
export const nav = (page: Page, name: string) => ({
  click: async () => {
    const main = page.getByRole("navigation", { name: "Main" });
    for (const label of [name, SHORT[name]].filter(Boolean) as string[]) {
      const link = main.getByRole("link", { name: new RegExp(`^${label}`) }).first();
      if ((await link.count()) && (await link.isVisible())) return link.click();
    }
    await page.getByRole("button", { name: /^More/ }).click();
    await page
      .getByRole("dialog", { name: "More" })
      .getByRole("link", { name: new RegExp(`^${name}`) })
      .click();
  },
});

/** WCAG 2.2 A/AA automated checks. Not a substitute for an accessibility assessment. */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 3)
          .join(" | ")}`,
    ),
  ).toEqual([]);
}

/** Responsive layouts must never scroll sideways. */
export async function expectNoSidewaysScroll(page: Page) {
  const { cw, sw } = await page.evaluate(() => ({
    cw: document.documentElement.clientWidth,
    sw: document.documentElement.scrollWidth,
  }));
  expect(sw, "page is wider than the screen").toBeLessThanOrEqual(cw);
}

/** A synthetic password for accounts created during tests. Never a real one. */
export const SYNTHETIC_PASSWORD = "synthetic-pass-phrase-1";

export async function signOutFromShell(page: Page) {
  // Family phones: Sign out is in the "More" sheet. Staff: it's in the account menu.
  const direct = page.getByRole("button", { name: "Sign out" }).first();
  if (!(await direct.isVisible())) {
    const account = page.getByRole("button", { name: /^Account:/ });
    if (await account.isVisible()) await account.click();
    else await page.getByRole("button", { name: /^More/ }).click();
  }
  await page.getByRole("button", { name: "Sign out" }).filter({ visible: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
}

/** Password sign-in on the family page ("/") or, for staff, the care-team page ("/staff-sign-in"). */
export async function signInWithPassword(page: Page, email: string, password: string, at = "/") {
  await open(page, at);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** The one-time invitation link shown to the inviter, as a path. */
export async function issuedLink(page: Page) {
  const text = await page.getByTestId("invitation-link").innerText();
  const m = text.match(/https?:\/\/\S+\/invite\/\S+/);
  expect(m).not.toBeNull();
  return new URL(m![0]).pathname;
}
