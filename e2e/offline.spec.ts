import { test as base, expect, type Page } from "@playwright/test";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/**
 * Offline status (founder decisions 84–87), with the test browser's network really cut.
 *
 * These tests break the connection on purpose, so the browser and the framework report it in the
 * console ("Failed to fetch", "net::ERR_INTERNET_DISCONNECTED", and React's report of the lost
 * request the root page caught). The shared console guard
 * (fixtures.ts) would fail on those, so this file keeps its own: those lines only, and anything else
 * still fails.
 */
const EXPECTED =
  /^(TypeError: Failed to fetch|Failed to load resource: net::ERR_(INTERNET_DISCONNECTED|FAILED)|Failed to load resource: the server responded with a status of (4\d\d|503))/;
/** React's own report of the lost request that the root page caught (and showed as "Couldn't reach"). */
const CAUGHT_LOST = /^%o\n\n%s\n\n%s\n\s*TypeError: Failed to fetch\n/;
const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" && !EXPECTED.test(m.text()) && !CAUGHT_LOST.test(m.text()))
          problems.push(`console.error: ${m.text().slice(0, 300)}`);
      });
      page.on("pageerror", (e) => problems.push(`page error: ${e.message.slice(0, 300)}`));
      await use();
      expect(problems, "browser reported errors during this test").toEqual([]);
    },
    { auto: true },
  ],
});

test.beforeEach(async ({ page }) => resetData(page));

const banner = (page: Page) => page.getByTestId("offline-banner");

test("offline: one banner with the 24-hour line, sends paused, and it clears on reconnect", async ({
  page,
  context,
}) => {
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/messages");
  await page.getByLabel("Message Maya Chen").fill("Synthetic: written while offline.");
  await context.setOffline(true);
  await expect(banner(page)).toContainText("You're offline.");
  await expect(banner(page)).toContainText("may be out of date");
  await expect(banner(page)).toContainText("555-0100 (synthetic 24-hour line)");
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await expectAccessible(page);

  await context.setOffline(false);
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  // Nothing was sent while offline (decision 84).
  await expect(page.getByText("Synthetic: written while offline.")).toHaveCount(1);
});

test("a send whose reply was lost is checked by its ID and reported as arrived, once", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/messages");
  // Let the first message send reach the server, then lose its answer on the way back.
  let lost = false;
  await page.route("**/_serverFn/**", async (route) => {
    const id = route.request().url().split("/_serverFn/")[1]?.split("?")[0] ?? "";
    const fn = Buffer.from(id, "base64url").toString();
    if (!lost && route.request().method() === "POST" && fn.includes("sendFamilyMessage")) {
      lost = true;
      await route.fetch();
      return route.abort("failed");
    }
    return route.continue();
  });
  const text = "Synthetic: checking a lost reply.";
  await page.getByLabel("Message Maya Chen").fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("alert").first()).toContainText("We couldn't confirm this was sent");
  // Decision 86: only the ID, the kind and the time are kept, never the words.
  const stored = await page.evaluate(() => sessionStorage.getItem("zeporah.uncertain-sends") ?? "");
  expect(stored).toContain('"kind":"message"');
  expect(stored).not.toContain("lost reply");
  await expect(page.getByTestId("uncertain-sends")).toContainText(/Your message from .+ arrived/, {
    timeout: 15_000,
  });
  // It arrived once, and the composer's resend is safe: nothing more was sent.
  // (The words also stay in the message box until cleared: that's the composer, not a second copy.)
  await expect(page.getByRole("listitem").filter({ hasText: text })).toHaveCount(1);
  expect(await page.evaluate(() => sessionStorage.getItem("zeporah.uncertain-sends"))).toBeNull();
});

test("opening another page while offline says it couldn't reach Zeporah, and Try again recovers", async ({
  page,
  context,
}) => {
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family");
  await context.setOffline(true);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /^Tasks/ })
    .click();
  await expect(page.getByTestId("connection-lost")).toContainText("Couldn't reach Zeporah");
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expectAccessible(page);
  await context.setOffline(false);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.getByTestId("connection-lost")).toHaveCount(0);
});
