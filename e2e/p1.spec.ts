import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { expectAccessible, expectNoSidewaysScroll, nav, open, resetData, signInAs } from "./helpers";

test.beforeEach(async ({ page }) => resetData(page));

const SHARING = "/staff/households/hh-okafor?tab=sharing";
const RECIPIENT = "Lakeside Companion Care (synthetic)";

async function recordNaming(page: Page, grantorOption: string) {
  await open(page, SHARING);
  await page.getByRole("button", { name: "Record a consent" }).click();
  await page.getByLabel("Named grantor").selectOption({ label: grantorOption });
}

test("a family member named in a consent sees it, asks for a correction, and sees the care team's answer", async ({
  page,
}) => {
  // Staff are warned, not blocked, when the named person can't confirm in the app.
  await signInAs(page, "Maya Chen");
  await recordNaming(page, "Chidi Okafor — can't confirm in the app");
  await expect(page.getByText("Chidi Okafor can't confirm this in the app", { exact: true })).toBeVisible();
  await expect(page.getByText(/Being in the household isn't enough/).first()).toBeVisible();
  await page.getByLabel("Named recipient").fill(RECIPIENT);
  await page.getByLabel("Purpose").fill("Arrange companion visits");
  await page.getByLabel("Household contact details").check();
  await page.getByRole("button", { name: "Record consent" }).click();
  await expect(page.getByTestId("live-region")).toContainText("Consent recorded.");

  // Chidi has no Sharing page, but is shown the consent that names him — and only that.
  await signInAs(page, "Chidi Okafor");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sharing" }),
  ).toHaveCount(0);
  // The seed already names Chidi in one held consent; this adds a second.
  await expect(page.getByText("2 sharing consents name you", { exact: true })).toBeVisible();
  await nav(page, "Consents for you").click();
  const card = page.getByRole("listitem").filter({ hasText: RECIPIENT });
  await expect(card).toContainText("Held for care-team review");
  await expect(card).toContainText(/active authority workflow/);
  // Being named doesn't grant withdrawal.
  await expect(card.getByRole("button", { name: "Withdraw consent" })).toHaveCount(0);
  await expect(page.getByText("Brightwater")).toHaveCount(0); // other consents stay private
  await expectAccessible(page);

  await card.getByRole("button", { name: "Request a correction" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Request a correction" });
  await expect(dialog).toContainText("It doesn't withdraw it");
  await dialog.getByLabel("Who receives it").check();
  await dialog
    .getByLabel("Anything you'd like them to know (optional)")
    .fill("It should be the Elm Street branch.");
  await dialog.getByRole("button", { name: "Send correction request" }).click();
  await expect(page.getByTestId("status-note")).toContainText("Correction request sent to your care team");
  await expect(page.getByTestId("correction-pending")).toContainText("You asked for a correction");
  const consentUrl = await card.getByRole("button", { name: "Cancel my correction request" }).isVisible();
  expect(consentUrl).toBe(true);

  // The care guide sees the words (care team only), the queue row, and dismisses with an explanation.
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/exceptions?view=all&kind=correction");
  const row = page.locator("tbody tr").first();
  await expect(row).toContainText("Consent held or correction");
  await expect(row).toContainText("Now");
  // The last action and who did it are on the Waiting cell's hover (staff rework, section 3).
  await expect(row.locator('[title*="Chidi Okafor asked for a correction"]')).toHaveCount(1);
  await expect(row).not.toContainText("Elm Street");
  await open(page, SHARING);
  const panel = page.getByTestId("staff-correction");
  await expect(panel).toContainText("It should be the Elm Street branch.");
  await expect(panel).toContainText("Care team only");
  await expectAccessible(page);
  await panel.getByRole("button", { name: "Dismiss with an explanation" }).click();
  const dismiss = page.getByRole("dialog").filter({ hasText: "Dismiss the correction request" });
  await expect(dismiss.getByRole("button", { name: "Dismiss with this explanation" })).toBeDisabled();
  await dismiss
    .getByLabel("Reason (care team only)")
    .fill("We checked with Grace: the main branch is right.");
  await dismiss.getByRole("button", { name: "Dismiss with this explanation" }).click();
  await expect(page.getByTestId("staff-correction")).toHaveCount(0);

  await signInAs(page, "Chidi Okafor");
  await nav(page, "Consents for you").click();
  // The household sees a fixed outcome, never the care team's reason.
  await expect(page.getByTestId("correction-reviewed")).toContainText("made no change");
  await expect(page.getByText("We checked with Grace")).toHaveCount(0);
});

test("a consent deep link only opens for the person it names", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await recordNaming(page, "Chidi Okafor — can't confirm in the app");
  await page.getByLabel("Named recipient").fill(RECIPIENT);
  await page.getByLabel("Purpose").fill("Arrange companion visits");
  await page.getByLabel("Household contact details").check();
  await page.getByRole("button", { name: "Record consent" }).click();
  await expect(page.getByTestId("live-region")).toContainText("Consent recorded.");

  await signInAs(page, "Chidi Okafor");
  await open(page, "/family/notifications");
  await page
    .getByRole("link", { name: /A sharing consent names you/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/family\/consents\/[\w-]+$/);
  const link = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: `Sharing with ${RECIPIENT}` })).toBeVisible();

  await signInAs(page, "Daniel Okafor");
  await open(page, link);
  await expect(page.getByRole("heading", { name: "This isn't available" })).toBeVisible();
  await expect(page.getByText(RECIPIENT)).toHaveCount(0);
});

test("the patient can ask for a correction while confirming, which pauses confirmation until cancelled", async ({
  page,
}) => {
  await signInAs(page, "Maya Chen");
  await recordNaming(page, "Grace Okafor — can confirm in the app");
  await page.getByLabel("Named recipient").fill(RECIPIENT);
  await page.getByLabel("Purpose").fill("Arrange companion visits");
  await page.getByLabel("Household contact details").check();
  await page.getByRole("button", { name: "Record consent" }).click();
  await expect(page.getByTestId("live-region")).toContainText("Consent recorded.");

  await signInAs(page, "Grace Okafor");
  await open(page, "/family/sharing");
  const card = page.getByRole("listitem").filter({ hasText: RECIPIENT });
  await expect(card.getByRole("list", { name: "Consent steps" })).toContainText(
    "Confirmed by the named person",
  );
  await card.getByRole("button", { name: "Request a correction" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Request a correction" })
    .getByRole("button", { name: "Send correction request" })
    .click();
  await expect(card.getByRole("button", { name: "Confirm this sharing" })).toHaveCount(0);
  await card.getByRole("button", { name: "Cancel my correction request" }).click();
  await expect(card.getByRole("button", { name: "Confirm this sharing" })).toBeVisible();
});

test("routine-message wording is the hospice's own, shown only when set, and only operations can set it", async ({
  page,
}) => {
  // Willow Creek's seeded wording (version 2) is shown beside the message box, with its reply time.
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/messages");
  await expect(page.getByTestId("message-expectation")).toContainText(
    "Your hospice has shared guidance for routine messages.",
  );
  await expect(page.getByTestId("reply-time")).toHaveText(
    "Your care team usually replies within 1 business day.",
  );
  await expect(page.getByRole("link", { name: "Ask your care team for support" })).toBeVisible();

  await signInAs(page, "Maya Chen");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Hospice settings" }),
  ).toHaveCount(0);
  await open(page, "/staff/settings");
  await expect(page.getByRole("heading", { name: "Not available for your role" })).toBeVisible();

  // Turned off: families see the fixed sentence that names no time (founder decision 24).
  await signInAs(page, "Dana Brooks");
  await nav(page, "Hospice settings").click();
  // The history is folded away under "History · N versions" (settings redesign).
  await page.getByText(/^History · \d+ versions?$/).click();
  await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn it off" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Turn it off" }).click();
  await expect(page.getByText("No wording is set")).toBeVisible();
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/messages");
  await expect(page.getByTestId("reply-time")).toHaveText(
    "Your care team reads messages during business hours. For anything urgent, call 555-0100 (synthetic 24-hour line).",
  );
  await expect(page.getByText("Your hospice has shared guidance for routine messages.")).toHaveCount(0);
  await expect(page.getByText("Not for emergencies")).toBeVisible();

  // New wording, as a new version, shown in both places.
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/settings");
  await page
    .getByLabel("What families should expect")
    .fill("Your care guide reads routine messages during office hours (synthetic).");
  await page
    .getByLabel("When messages are handled (optional)")
    .fill("Weekdays; closed on public holidays (synthetic)");
  // The expected reply time is required (decision 24).
  await expect(page.getByRole("button", { name: "Save as a new version" })).toBeDisabled();
  await page.getByLabel("Expected reply time").fill("within 2 business days");
  await page.getByRole("button", { name: "Save as a new version" }).click();
  await expect(page.getByTestId("live-region")).toHaveText(
    "Saved as a new version. Families now see this wording.",
  );
  await page.getByText(/^History · \d+ versions?$/).click();
  await expect(page.getByText("Version 4", { exact: true })).toBeVisible();
  await expectAccessible(page);

  await signInAs(page, "Daniel Okafor");
  for (const url of ["/family/messages", "/family/support"]) {
    await open(page, url);
    const note = page.getByTestId("message-expectation");
    await expect(note).toContainText("during office hours (synthetic)");
    await expect(page.getByTestId("reply-time")).toHaveText(
      "Your care team usually replies within 2 business days.",
    );
    await expect(note).toContainText(/ET$/m);
    await expect(page.getByText("Not for emergencies")).toBeVisible();
  }
});

test("exception rows show urgency, state, owner, last action, next step and age — and reflow on a phone", async ({
  page,
}) => {
  await signInAs(page, "Priya Raman");
  await open(page, "/staff/exceptions");
  for (const h of ["Status", "Item", "Urgency", "Owner", "Next step", "Waiting"])
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${h}`) })).toBeVisible();
  const authority = page.locator("tbody tr").filter({ hasText: "authority record" }).first();
  await expect(authority).toContainText("Unassigned");
  await expect(authority).toContainText(/Now|Today/);
  await expect(authority).toContainText(/hour|day|week/);
  await expectAccessible(page);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  // Narrow screens keep the table and drop the less important columns; nothing scrolls sideways.
  await expect(page.getByRole("table", { name: /^Exceptions/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /^Owner/ })).toBeHidden();
  await expectNoSidewaysScroll(page);
  await expectAccessible(page);
});
