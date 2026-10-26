/**
 * Where this server is running and how it's configured — read from the environment once, checked,
 * and never sent to the browser in full. See docs/operations-runbook.md.
 *
 * | Variable              | Meaning                                                                   |
 * | --------------------- | ------------------------------------------------------------------------- |
 * | NODE_ENV              | development (default), test, or production                                |
 * | ZEPORAH_DEV_SIGN_IN   | "1" turns on persona sign-in and reset — never honoured in production      |
 * | ZEPORAH_DATA_DIR      | Local database folder (default .data/pglite)                              |
 * | ZEPORAH_READ_ONLY     | "1" refuses every change while the team checks something (incidents)      |
 * | ZEPORAH_ENVIRONMENT   | A deliberate name for a non-development deployment (required in production) |
 * | ZEPORAH_APP_URL       | The family address, e.g. https://app.zeporah.co (with ZEPORAH_CARE_URL)    |
 * | ZEPORAH_CARE_URL      | The hospice team address, e.g. https://care.zeporah.co                     |
 */
import { devSignInEnabled } from "./auth/dev-gate";
import { parseAddresses, type Addresses } from "@/domain/addresses";

export type Environment = {
  mode: "development" | "test" | "production";
  name: string;
  devSignIn: boolean;
  readOnly: boolean;
};

export function environment(): Environment {
  const node = process.env["NODE_ENV"];
  const mode = node === "production" ? "production" : node === "test" ? "test" : "development";
  return {
    mode,
    name: process.env["ZEPORAH_ENVIRONMENT"]?.trim() || mode,
    devSignIn: devSignInEnabled(),
    readOnly: process.env["ZEPORAH_READ_ONLY"] === "1",
  };
}

/**
 * Refuse to start in production unless the environment is named on purpose. Zeporah has no approved
 * production deployment; this stops a build from quietly running as one with the synthetic setup.
 * Also refuses addresses that are set wrongly, rather than redirecting to the wrong place.
 */
export function assertEnvironment(env = environment()) {
  addresses();
  if (env.mode === "production" && !process.env["ZEPORAH_ENVIRONMENT"]?.trim())
    throw new Error(
      "Zeporah won't start with NODE_ENV=production unless ZEPORAH_ENVIRONMENT names the environment. " +
        "No production deployment is approved; see docs/production-readiness-gates.md.",
    );
}

/** The app and care addresses (domain/addresses.ts), or null when none are configured. Throws if misconfigured. */
export function addresses(): Addresses | null {
  return parseAddresses(process.env["ZEPORAH_APP_URL"], process.env["ZEPORAH_CARE_URL"]);
}

/** Calm wording for a write refused in read-only mode. */
export const READ_ONLY_MESSAGE =
  "Zeporah is read-only for a short while as the team checks something. Nothing was changed. Please try again later.";
