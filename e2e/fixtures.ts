import { test as base, expect } from "@playwright/test";

/**
 * Every end-to-end test fails if the browser reports a console error or an uncaught page error.
 * This catches hydration mismatches (server HTML differing from the browser's), which make React
 * rebuild the page after it loads and made accessibility scans nondeterministic.
 */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (m) => {
        // A refused server call now answers with a 4xx status, which the browser itself reports as
        // "Failed to load resource". That's an expected refusal the page handles (as is 503 in
        // read-only mode); any other 5xx still fails.
        if (
          m.type() === "error" &&
          !/^Failed to load resource: the server responded with a status of (4\d\d|503)/.test(m.text())
        )
          problems.push(`console.error: ${m.text().slice(0, 300)}`);
      });
      page.on("pageerror", (e) => problems.push(`page error: ${e.message.slice(0, 300)}`));
      await use();
      expect(problems, "browser reported errors during this test").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
