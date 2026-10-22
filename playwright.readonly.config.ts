import { defineConfig, devices } from "@playwright/test";

/**
 * Read-only incident mode, end to end. The main suite's server can't be restarted per test, so
 * this config starts its own server on port 3101 with ZEPORAH_READ_ONLY=1, a separate database
 * (.data/e2e-readonly-pglite) and Vite cache. It never touches the development database or the
 * main end-to-end server. Run with `bun run test:e2e:readonly`.
 */
const PORT = 3101;
const ISOLATED =
  "ZEPORAH_DATA_DIR=.data/e2e-readonly-pglite ZEPORAH_VITE_CACHE=.data/e2e-readonly-vite-cache ZEPORAH_DEV_SIGN_IN=1";

export default defineConfig({
  testDir: "e2e-readonly",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${ISOLATED} bun scripts/db-reset.ts && ${ISOLATED} ZEPORAH_READ_ONLY=1 bun --bun vite dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
