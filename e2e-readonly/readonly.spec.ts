import { expect, test } from "../e2e/fixtures";
import { expectAccessible, expectNoSidewaysScroll, open, signInAs } from "../e2e/helpers";

/**
 * Read-only incident mode (ZEPORAH_READ_ONLY=1): everyone sees the banner, reading and signing in
 * work, and every change is refused calmly with nothing written. Automated checks only; the banner
 * still needs a manual review (protocol Slice J).
 */
const BANNER = "Zeporah is read-only right now.";
const REFUSED =
  "Zeporah is read-only for a short while as the team checks something. Nothing was changed. Please try again later.";

test("the banner shows, reading works, and a change is refused with nothing written", async ({ page }) => {
  await open(page, "/");
  const banner = page.getByRole("status").filter({ hasText: BANNER });
  await expect(banner).toBeVisible();
  await expect(banner).toHaveCount(1);
  await expectAccessible(page);

  // Signing in and reading still work.
  await signInAs(page, "Dana Brooks");
  await expect(banner).toBeVisible();
  await open(page, "/staff/settings?section=invitations");
  await expect(page.getByRole("heading", { name: "Invite a care-team member" })).toBeVisible();

  // A change is refused with the calm message; nothing is created.
  await page.getByLabel("Their name").fill("Noor Haddad");
  await page.getByLabel("Their email").fill("noor.readonly@example.invalid");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByText(REFUSED).first()).toBeVisible();
  await expect(page.getByTestId("live-region")).toHaveText(REFUSED);
  await expect(page.getByTestId("invitation-link")).toHaveCount(0);
  await open(page, "/staff/settings?section=invitations");
  await expect(page.getByText("noor.readonly@example.invalid")).toHaveCount(0);
  await expectAccessible(page);

  // The banner never pushes the page sideways on a phone or at narrow reflow width.
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page, "/staff/settings?section=invitations");
    await expect(banner).toBeVisible();
    await expectNoSidewaysScroll(page);
  }
});

test("a family member's change is refused too", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/messages");
  await page.getByLabel(/^Message /).fill("A synthetic question for the care team.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(REFUSED).first()).toBeVisible();
  await open(page, "/family/messages");
  await expect(page.getByText("A synthetic question for the care team.")).toHaveCount(0);
});
