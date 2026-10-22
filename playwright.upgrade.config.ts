import { defineConfig, devices } from "@playwright/test";

/**
 * Upgrade check: the server starts on a synthetic database written at the previous schema version
 * (scripts/db-seed-previous.ts), migrates it in place on first use, and every persona's pages must
 * load without errors. Own server on port 3103 with its own database (.data/e2e-upgrade-pglite) and
 * Vite cache; never touches the development database. Run with `bun run test:e2e:upgrade`.
 */
const PORT = 3103;
const ISOLATED =
  "ZEPORAH_DATA_DIR=.data/e2e-upgrade-pglite ZEPORAH_VITE_CACHE=.data/e2e-upgrade-vite-cache ZEPORAH_DEV_SIGN_IN=1";

export default defineConfig({
  testDir: "e2e-upgrade",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 300_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${ISOLATED} bun scripts/db-seed-previous.ts && ${ISOLATED} bun --bun vite dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
