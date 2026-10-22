import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against their own dev server on port 3100, always started fresh, with an
 * isolated database (.data/e2e-pglite) and an isolated Vite cache (.data/e2e-vite-cache). They never
 * reuse, wipe or alter the ordinary development server or its .data/pglite database.
 * Each test resets the isolated database through the app's reset control, so tests run serially.
 * ZEPORAH_DEV_SIGN_IN=1 turns on the development-only persona sign-in and reset control on this
 * test server only (see docs/authentication-and-access.md); password sign-in is tested as well.
 */
const PORT = 3100;
const ISOLATED =
  "ZEPORAH_DATA_DIR=.data/e2e-pglite ZEPORAH_VITE_CACHE=.data/e2e-vite-cache ZEPORAH_DEV_SIGN_IN=1 ZEPORAH_NOTICE_TIMER=off";

export default defineConfig({
  testDir: "e2e",
  // Warms every route on the fresh server before any test (see e2e/global-setup.ts).
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Reduced motion keeps fade-ins from skewing automated contrast checks.
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /family-.*\.spec\.ts/ },
  ],
  webServer: {
    command: `${ISOLATED} bun scripts/db-reset.ts && ${ISOLATED} bun --bun vite dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
