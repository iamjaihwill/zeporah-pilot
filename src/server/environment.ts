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
 */
import { devSignInEnabled } from "./auth/dev-gate";

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
 */
export function assertEnvironment(env = environment()) {
  if (env.mode === "production" && !process.env["ZEPORAH_ENVIRONMENT"]?.trim())
    throw new Error(
      "Zeporah won't start with NODE_ENV=production unless ZEPORAH_ENVIRONMENT names the environment. " +
        "No production deployment is approved; see docs/production-readiness-gates.md.",
    );
}

/** Calm wording for a write refused in read-only mode. */
export const READ_ONLY_MESSAGE =
  "Zeporah is read-only for a short while as the team checks something. Nothing was changed. Please try again later.";
