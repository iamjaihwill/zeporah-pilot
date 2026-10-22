import { expect, test, type Page } from "@playwright/test";
import { ready } from "../e2e/helpers";

/**
 * Every persona's pages on a database that was written at the previous schema version and migrated
 * in place (interaction review 2026-10-13, item 2). No error pages, no console errors.
 */
function guard(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()}: ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message.slice(0, 200)}`));
  return errors;
}

async function signIn(page: Page, name: string) {
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await page.waitForURL(/\/(family|staff)$/);
  await ready(page);
  await expect(page.getByRole("navigation", { name: "Main" }).locator("a[href]").first()).toBeVisible();
}

const EXTRA: Record<string, string[]> = {
  "Marisol Rivera": [
    "/family/onboarding",
    "/family/onboarding?step=preferences",
    "/family/onboarding?step=trusted_contacts",
    "/family/onboarding?step=communication",
    "/family/onboarding?step=vault_review",
  ],
  "Dana Brooks": ["/staff/households/hh-okafor", "/staff/settings", "/staff/audit"],
};

for (const persona of [
  "Marisol Rivera",
  "Daniel Okafor",
  "Ada Okafor",
  "Chidi Okafor",
  "Grace Okafor",
  "Ingrid Lindqvist",
  "Maya Chen",
  "Priya Raman",
  "Dana Brooks",
  "Jordan Ellis",
]) {
  test(`upgraded database: ${persona}`, async ({ page }) => {
    const errors = guard(page);
    await signIn(page, persona);
    const links = await page
      .getByRole("navigation", { name: "Main" })
      .locator("a[href]")
      .evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).pathname));
    for (const path of [...new Set(links), ...(EXTRA[persona] ?? [])]) {
      await page.goto(path);
      await ready(page);
      await expect(page.locator("main h1").first(), path).toBeVisible();
      await expect(page.getByTestId("unexpected-error"), path).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
