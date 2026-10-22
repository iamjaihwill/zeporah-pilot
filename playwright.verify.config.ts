import { defineConfig, devices } from "@playwright/test";

/**
 * Design-review verification sweep: every persona, every nav page, five widths, axe and keyboard
 * order, plus the review screenshots. Own server on port 3102 with its own database
 * (.data/e2e-verify-pglite) and Vite cache; never touches the development database or the other
 * test servers. Run with `bun run test:e2e:verify`.
 */
const PORT = 3102;
const ISOLATED =
  "ZEPORAH_DATA_DIR=.data/e2e-verify-pglite ZEPORAH_VITE_CACHE=.data/e2e-verify-vite-cache ZEPORAH_DEV_SIGN_IN=1";

export default defineConfig({
  testDir: "e2e-verify",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 600_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${ISOLATED} bun scripts/db-reset.ts && ${ISOLATED} bun --bun vite dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
