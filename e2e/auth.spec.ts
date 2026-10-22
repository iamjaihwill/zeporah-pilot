import { expect, test } from "./fixtures";
import {
  SYNTHETIC_PASSWORD,
  expectAccessible,
  issuedLink,
  open,
  ready,
  resetData,
  signInAs,
  signInWithPassword,
  signOutFromShell,
} from "./helpers";

/**
 * Real sign-in, sign-out, invitations and signed-out protection. Persona sign-in (a development-only
 * shortcut) is used only to reach the inviter; every invited account signs in with a password.
 */
test.beforeEach(async ({ page }) => resetData(page));

const PASSWORD = SYNTHETIC_PASSWORD;

test("signed-out visitors are sent to sign in without seeing household data", async ({ page }) => {
  for (const url of ["/staff", "/staff/households/hh-okafor?tab=overview", "/family", "/family/vault"]) {
    await open(page, url);
    await expect(page.getByRole("heading", { level: 1, name: /Sign in/i })).toBeVisible();
    // Staff pages go to the care-team sign-in; family pages to the main one.
    await expect(page).toHaveURL(
      url.startsWith("/staff") ? /\/staff-sign-in(\?next=.*)?$/ : /\/(\?next=.*)?$/,
    );
    // No app shell and no household content (the development persona list may name synthetic people).
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    await expect(page.getByText(/The (Okafor|Rivera) household|Hello,/)).toHaveCount(0);
  }
});

test("the sign-in page refuses a wrong password with one generic message, by keyboard", async ({ page }) => {
  await open(page, "/");
  await expectAccessible(page);
  // Keyboard only: Tab to the email field, type, Tab to the password, Enter submits.
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    if (await page.getByLabel("Email", { exact: true }).evaluate((el) => el === document.activeElement))
      break;
  }
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await page.keyboard.type("nobody@example.invalid");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await page.keyboard.type("not-the-password");
  await page.keyboard.press("Enter");
  const message = "That email and password didn't work. Check them and try again.";
  await expect(page.getByText(message).first()).toBeVisible();
  await expect(page.getByTestId("live-region")).toHaveText(message);
  await expect(page).toHaveURL(/\/$/);
  await expectAccessible(page);
});

test("an unusable invitation link shows one calm, generic page", async ({ page }) => {
  await open(page, "/invite/not-a-real-token");
  await expect(page.getByRole("heading", { level: 1, name: "This invitation can't be used" })).toBeVisible();
  await expect(page.getByText(/may have expired, already been used, or been cancelled/)).toBeVisible();
  await expectAccessible(page);
});

test("hospice operations invites a care guide, who joins, signs out and signs back in", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/settings?section=invitations");
  await page.getByLabel("Their name").fill("Noor Haddad");
  await page.getByLabel("Their email").fill("noor.haddad@example.invalid");
  await page.getByLabel("Role").selectOption("care_guide");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByTestId("invitation-link")).toBeVisible();
  const link = await issuedLink(page);
  await expect(page.getByRole("table", { name: "Care-team invitations" })).toContainText(
    "noor.haddad@example.invalid",
  );
  await expectAccessible(page);
  await signOutFromShell(page);

  await open(page, link);
  await expect(page.getByRole("heading", { level: 1, name: /^Join .+ on Zeporah$/ })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("noor.haddad@example.invalid");
  await expectAccessible(page);
  // Mismatched passwords are caught before anything is sent.
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByLabel("Confirm the password").fill(PASSWORD + "x");
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page.getByText("The two passwords don't match.").first()).toBeVisible();
  await page.getByLabel("Confirm the password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByRole("button", { name: "Account: Noor Haddad" })).toBeVisible();
  // A new care guide has no assigned households, so another household's page is refused.
  await open(page, "/staff/households/hh-okafor?tab=overview");
  await expect(page.getByText(/isn't available to you/).first()).toBeVisible();
  await expect(page.getByText("Grace Okafor")).toHaveCount(0);
  await signOutFromShell(page);

  // The link worked once.
  await open(page, link);
  await expect(page.getByRole("heading", { level: 1, name: "This invitation can't be used" })).toBeVisible();

  // Separate sign-in pages: the family page turns a care-team account away, with no session.
  await signInWithPassword(page, "noor.haddad@example.invalid", PASSWORD);
  await expect(
    page
      .getByRole("form", { name: "Sign in" })
      .getByText("This is a care-team account. Sign in on the care-team sign-in page."),
  ).toBeVisible();
  await open(page, "/staff");
  await expect(page).toHaveURL(/\/staff-sign-in\?next=%2Fstaff$/);
  await signInWithPassword(page, "noor.haddad@example.invalid", PASSWORD, "/staff-sign-in");
  await expect(page).toHaveURL(/\/staff$/);
  await signOutFromShell(page);
  // After signing out, protected pages are closed again, and staff land on their own sign-in page.
  await expect(page).toHaveURL(/\/staff-sign-in$/);
  await open(page, "/staff");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to your workspace" })).toBeVisible();
});

test("a household coordinator invites a family member, who joins that household only", async ({ page }) => {
  await signInAs(page, "Marisol Rivera");
  await open(page, "/family/people");
  await page.getByLabel("Their name").fill("Luis Rivera");
  await page.getByLabel("Email", { exact: true }).fill("luis.rivera@example.invalid");
  await page.getByRole("button", { name: "Review access" }).click();
  await page.getByRole("button", { name: "Record invitation" }).click();
  const link = await issuedLink(page);
  await signOutFromShell(page);

  await open(page, link);
  await expect(page.getByRole("heading", { level: 1, name: /^Join .+ on Zeporah$/ })).toBeVisible();
  // The household's name isn't shown before joining.
  await expect(page.getByText("The Rivera household")).toHaveCount(0);
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByLabel("Confirm the password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page).toHaveURL(/\/family$/);
  await ready(page);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByText("The Rivera household").first()).toBeVisible();
  // No staff area for a family account: the staff workspace sends them back to their own.
  await open(page, "/staff/households/hh-okafor?tab=overview");
  await expect(page).toHaveURL(/\/family$/);
  await expect(page.getByText("Grace Okafor")).toHaveCount(0);
});

test("the sign-in page: one heading, show password, recovery guidance, described personas", async ({
  page,
}) => {
  await open(page, "/");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Sign in with your email" })).toHaveCount(0);
  await expect(page.getByText(/call 911 or your hospice's 24-hour line/)).toBeVisible();
  await expect(page.getByText(/authority status here is a workflow state/)).toHaveCount(0);

  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toHaveAttribute("type", "password");
  const toggle = page.getByRole("button", { name: "Show password" });
  await toggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  // A Caps Lock warning while typing the password; the footer links sit right under the form.
  // (Headless browsers don't toggle Caps Lock on a key press, so the key event carries it.)
  await password.dispatchEvent("keyup", { key: "A", modifierCapsLock: true, bubbles: true });
  await expect(page.getByText("Caps Lock is on.")).toBeVisible();
  await password.dispatchEvent("keyup", { key: "a", modifierCapsLock: false, bubbles: true });
  await expect(page.getByText("Caps Lock is on.")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "About Zeporah" }).getByRole("link", { name: "Privacy" }),
  ).toBeVisible();

  // Decision 27: family accounts can ask for a reset email here (the mail sink is on); the care
  // team's new invitation link is always explained too (decision 9, still the path for proxies and staff).
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Forgot your password?" })).toBeVisible();
  await expect(page.getByText(/send you a new invitation link/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me a reset link" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page.getByText(/Can't find your invite\? Ask your care guide to resend it\./)).toBeVisible();

  // Persona buttons are named by the person and described by what they can see.
  const daniel = page.getByRole("button", { name: "Sign in as Daniel Okafor" });
  await expect(daniel).toHaveAccessibleDescription(/Sees the Okafor household as coordinator/);
  await expectAccessible(page);
});

test("the care-team sign-in is for staff only, and each page points to the other", async ({ page }) => {
  await open(page, "/staff-sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to your workspace" })).toBeVisible();
  // Decision 56: no family-facing emergency box on the care-team sign-in.
  await expect(page.getByText("Not for emergencies")).toHaveCount(0);
  // Staff reset by a new invitation, never by email (decisions 9 and 27).
  await page.getByText("Forgot password?").click();
  await expect(
    page.getByText(/Ask your hospice administrator or hospice operations for a new invitation link/),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole("link", { name: "Sign in here" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Care-team sign-in" }).click();
  await expect(page).toHaveURL(/\/staff-sign-in$/);
});

test("the family sign-in mirrors the reference: remember me, create account, apps and terms", async ({
  page,
}) => {
  await open(page, "/");
  await expect(page.getByRole("checkbox", { name: "Remember me" })).not.toBeChecked();
  await expect(page.getByText("iPhone and Android apps are on the way")).toBeVisible();
  // No official store badges until an app is published (decision 51).
  await expect(page.getByRole("link", { name: /App Store|Google Play/ })).toHaveCount(0);
  await expect(
    page.getByText(/By signing in, you agree to the Terms of Service and Privacy Policy\./),
  ).toBeVisible();
  await page.getByRole("link", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "You join Zeporah through an invitation" }),
  ).toBeVisible();
  await expectAccessible(page);
  // The care-team sign-in doesn't offer "Remember me".
  await open(page, "/staff-sign-in");
  await expect(page.getByRole("checkbox", { name: "Remember me" })).toHaveCount(0);
});

test("signing in returns people to the page they asked for, and only to their own area", async ({ page }) => {
  await open(page, "/family/tasks");
  await expect(page).toHaveURL(/\/\?next=%2Ffamily%2Ftasks$/);
  await page.getByRole("button", { name: "Sign in as Daniel Okafor" }).click();
  await expect(page).toHaveURL(/\/family\/tasks$/);
  await ready(page);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await signOutFromShell(page);
  // A staff page sends you to the care-team sign-in, remembering where you were going.
  await open(page, "/staff/exceptions");
  await expect(page).toHaveURL(/\/staff-sign-in\?next=%2Fstaff%2Fexceptions$/);
  // Somewhere outside Zeporah is never followed.
  await open(page, "/?next=https%3A%2F%2Fevil.example%2F");
  await page.getByRole("button", { name: "Sign in as Daniel Okafor" }).click();
  await expect(page).toHaveURL(/localhost:\d+\/family$/);
});

test("sign-in guidance: wrong page links across, repeated failures mention the pause, staff forgot is a disclosure", async ({
  page,
}) => {
  await open(page, "/");
  for (let i = 0; i < 3; i++) {
    await page.getByLabel("Email", { exact: true }).fill("nobody@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill(`not-the-password-${i}`);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("form", { name: "Sign in" }).getByText(/didn't work/)).toBeVisible();
  }
  await expect(page.getByText("After 10 failed attempts, sign-in pauses for 15 minutes.")).toBeVisible();
  // The terms line sits right under the button, above the emergency box.
  const terms = await page.getByText(/By signing in, you agree/).boundingBox();
  const emergency = await page.getByText("Not for emergencies").boundingBox();
  expect(terms!.y).toBeLessThan(emergency!.y);

  await open(page, "/staff-sign-in");
  await page.getByText("Forgot password?").click();
  await expect(
    page.getByText("Ask your hospice administrator or hospice operations for a new invitation link."),
  ).toBeVisible();
  await expectAccessible(page);
});
