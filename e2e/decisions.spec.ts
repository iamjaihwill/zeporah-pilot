import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import {
  SYNTHETIC_PASSWORD,
  expectAccessible,
  issuedLink,
  nav,
  open,
  ready,
  resetData,
  signInAs,
  signInWithPassword,
  signOutFromShell,
} from "./helpers";

/** Founder decisions 23–28 (2026-10-13), end to end on the isolated test server. */
test.beforeEach(async ({ page }) => resetData(page));

test("a household member resets a forgotten password from an emailed link (decision 27)", async ({
  page,
}) => {
  // An account with a password, made through the normal invitation.
  await signInAs(page, "Marisol Rivera");
  await open(page, "/family/people");
  await page.getByLabel("Their name").fill("Luis Rivera");
  await page.getByLabel("Email", { exact: true }).fill("luis.rivera@example.invalid");
  await page.getByRole("button", { name: "Review access" }).click();
  await page.getByRole("button", { name: "Record invitation" }).click();
  const link = await issuedLink(page);
  await signOutFromShell(page);
  await open(page, link);
  await page.getByLabel("Create a password").fill(SYNTHETIC_PASSWORD);
  await page.getByLabel("Confirm the password").fill(SYNTHETIC_PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page).toHaveURL(/\/family$/);
  await signOutFromShell(page);

  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Forgot your password?" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("luis.rivera@example.invalid");
  await page.getByRole("button", { name: "Email me a reset link" }).click();
  const sent = /If that email belongs to a family account, we've sent it a link/;
  await expect(page.getByRole("main").getByText(sent)).toBeVisible();
  await expectAccessible(page);

  // An unknown email gets exactly the same answer.
  await open(page, "/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill("nobody@example.invalid");
  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(page.getByRole("main").getByText(sent)).toBeVisible();

  // The development mail sink holds the one email that would have gone out.
  await open(page, "/dev/mail");
  const mail = page.getByTestId("dev-mail");
  await expect(mail).toHaveCount(1);
  await expect(mail).toContainText("To luis.rivera@example.invalid");
  await expect(mail).toContainText("Reset your Zeporah password");
  await expectAccessible(page);
  await mail.getByRole("link", { name: "Open the reset link" }).click();
  await ready(page);
  await expect(page.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("New password", { exact: true }).fill("a-new-synthetic-pass-2");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("main").getByText("Your password was changed", { exact: true })).toBeVisible();
  const resetUrl = page.url();
  // Decision 29d: the account is told its password changed.
  await open(page, "/dev/mail");
  await expect(page.getByTestId("dev-mail").first()).toContainText("Your Zeporah password was changed");

  await signInWithPassword(page, "luis.rivera@example.invalid", SYNTHETIC_PASSWORD);
  await expect(page.getByText("That email and password didn't work.").first()).toBeVisible();
  await signInWithPassword(page, "luis.rivera@example.invalid", "a-new-synthetic-pass-2");
  await expect(page).toHaveURL(/\/family$/);
  await signOutFromShell(page);

  // The link worked once.
  await open(page, new URL(resetUrl).pathname);
  await expect(page.getByRole("main").getByText("This link can't be used", { exact: true })).toBeVisible();
});

test("operations exports the audit log as CSV; care guides can't (decision 28)", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/audit");
  await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  await signOutFromShell(page);

  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/audit?days=90&category=sharing");
  // Decision 29f: a confirmation says what the file is and how to handle it.
  await page.getByRole("button", { name: "Export CSV" }).click();
  const dialog = page.getByRole("dialog", { name: "Export this audit log?" });
  await expect(dialog).toContainText("It's confidential.");
  await expectAccessible(page);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^zeporah-audit-\d{4}-\d\d-\d\d-last-90-days\.csv$/);
  const csv = await readFile((await file.path())!, "utf8");
  const lines = csv.split("\r\n");
  // Decision 29g: the file says what it is and who made it, then the columns.
  expect(lines[0]).toMatch(/^"Confidential: Zeporah audit export/);
  expect(lines[1]).toMatch(/^"Exported by Dana Brooks at /);
  expect(lines[4]).toBe("timestamp,event_code,summary,actor,household,decision");
  expect(csv).not.toContain("Cedar");
  await expect(page.getByTestId("live-region")).toHaveText(/recorded in the audit log/);
  // The export is itself in the log.
  await open(page, "/staff/audit?days=7");
  await expect(page.getByText("Audit log exported (CSV)").first()).toBeVisible();
  await expectAccessible(page);
});

test("email nudges, reply time and a care guide marking a task done (decisions 23–25)", async ({ page }) => {
  // Daniel turns on email and switches quiet hours off so the test doesn't depend on the clock.
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/settings");
  await page.getByRole("checkbox", { name: /Email me when there's something new/ }).check();
  await page.getByLabel("From").fill("00:00");
  await page.getByLabel("Until").fill("00:00");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Saved.");
  await expectAccessible(page);
  await nav(page, "Updates & messages").click();
  await expect(page.getByTestId("reply-time")).toHaveText(
    "Your care team usually replies within 1 business day.",
  );
  await signOutFromShell(page);

  // His care guide marks his task done for him.
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor?tab=tasks");
  await page.getByRole("button", { name: /^Mark done for Daniel\b.*Confirm which visit times/ }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Marked done for Daniel.");
  await signOutFromShell(page);

  await open(page, "/dev/mail");
  await page.getByRole("button", { name: "Send due email notices now" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("1 email notice was sent.");
  const mail = page.getByTestId("dev-mail").first();
  await expect(mail).toContainText("You have a new update in Zeporah");
  await expect(mail).not.toContainText("visit");
  await expect(mail).not.toContainText("Maya");

  await signInAs(page, "Daniel Okafor");
  await nav(page, "Tasks").click();
  await page.getByText(/^Done or closed \(/).click();
  await expect(page.getByText(/^Done by Maya for Daniel · /)).toBeVisible();
});

test("operations are told when their hospice hasn't set a reply time (decision 29b)", async ({ page }) => {
  await signInAs(page, "Jordan Ellis");
  await expect(page.getByTestId("reply-time-missing")).toContainText(
    "Required: set your expected reply time",
  );
  await expectAccessible(page);
  await page.getByTestId("reply-time-missing").getByRole("link", { name: "Hospice settings" }).click();
  await expect(page.getByTestId("reply-time-missing")).toBeVisible();
  await page
    .getByLabel("What families should expect")
    .fill("Routine messages are read on weekdays (synthetic).");
  await page.getByLabel("Expected reply time").fill("within 2 business days");
  await page.getByRole("button", { name: "Save as a new version" }).click();
  await expect(page.getByTestId("reply-time-missing")).toHaveCount(0);
  await open(page, "/staff");
  await expect(page.getByTestId("reply-time-missing")).toHaveCount(0);
});
