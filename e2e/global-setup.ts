import { chromium, type FullConfig } from "@playwright/test";

/**
 * Runs once, after the isolated test server is up and before any test. Visits every route as a
 * family and a staff persona so Vite compiles each page and optimizes every dependency now —
 * never in the middle of an accessibility scan. Each page is loaded twice; the second load must
 * be served from the warm server without a reload.
 */
const FAMILY = [
  "/family",
  "/family/onboarding",
  "/family/tasks",
  "/family/messages",
  "/family/vault",
  "/family/vault/vi-okafor-7",
  "/family/vault/vi-okafor-10",
  "/family/people",
  "/family/sharing",
  "/family/consents",
  "/family/support",
  "/family/settings",
  "/family/bereavement",
  "/family/notifications",
];
const STAFF = [
  "/staff",
  "/staff/exceptions",
  "/staff/households",
  "/staff/households/hh-okafor?tab=overview",
  "/staff/households/hh-okafor?tab=messages",
  "/staff/households/hh-okafor?tab=updates",
  "/staff/households/hh-okafor?tab=notes",
  "/staff/households/hh-okafor?tab=tasks",
  "/staff/households/hh-okafor?tab=vault",
  "/staff/households/hh-okafor?tab=sharing",
  "/staff/households/hh-okafor?tab=lifecycle",
  "/staff/households/hh-okafor?tab=timeline",
  "/staff/packets",
  "/staff/packets/pk-okafor-respite",
  "/staff/reviews",
  "/staff/policy",
  "/staff/settings",
  "/staff/team",
  "/staff/bereavement",
  "/staff/audit",
  "/staff/reports",
  "/staff/status",
  "/staff/sharing",
  "/staff/sharing/cs-okafor-equipment",
  "/staff/team/st-tom",
  "/staff/notifications",
];

async function warm(baseURL: string, persona: string, paths: string[]) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  // The invitation page (signed out) compiles here too; an unknown token shows the generic refusal.
  await page.goto("/invite/warm-up-not-a-token");
  await page.locator("html[data-hydrated]").waitFor({ timeout: 120_000 });
  await page.goto("/");
  await page.locator("html[data-hydrated]").waitFor({ timeout: 120_000 });
  await page.getByRole("button", { name: `Sign in as ${persona}` }).click();
  await page.waitForURL(/\/(family|staff)$/, { timeout: 120_000 });
  for (const p of paths)
    for (let i = 0; i < 2; i++) {
      await page.goto(p, { waitUntil: "load", timeout: 120_000 });
      await page.locator("html[data-hydrated]").waitFor({ timeout: 120_000 });
    }
  await browser.close();
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = String(config.projects[0]?.use.baseURL);
  await warm(baseURL, "Ada Okafor", FAMILY);
  await warm(baseURL, "Priya Raman", STAFF);
}
