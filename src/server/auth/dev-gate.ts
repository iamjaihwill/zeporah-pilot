/**
 * DEVELOPMENT-ONLY SHORTCUTS live behind this gate: signing in as a synthetic persona without a
 * password, and resetting the local database to the synthetic seed. Both need an explicit
 * ZEPORAH_DEV_SIGN_IN=1 and are always off when NODE_ENV is "production". Nothing else in the
 * app depends on them; password sign-in and invitations work with the gate off.
 */
export function devSignInEnabled() {
  return process.env["ZEPORAH_DEV_SIGN_IN"] === "1" && process.env["NODE_ENV"] !== "production";
}
