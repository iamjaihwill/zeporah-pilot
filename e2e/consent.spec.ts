import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { expectAccessible, open, resetData, signInAs } from "./helpers";
import { RELEASE_NOTE, REVOCATION_NOTE } from "../src/domain/claims";

test.beforeEach(async ({ page }) => resetData(page));

const A = { recipient: "Lakeside Companion Care (synthetic)", purpose: "Arrange companion visits" };
const B = { recipient: "Hillcrest Library Outreach (synthetic)", purpose: "Arrange audiobook delivery" };
const SHARING = "/staff/households/hh-okafor?tab=sharing";

/** Record a consent for Grace from the household's sharing tab, as whoever is signed in. */
async function recordConsent(page: Page, c: typeof A) {
  await open(page, SHARING);
  await page.getByRole("button", { name: "Record a consent" }).click();
  await page.getByLabel("Named grantor").selectOption({ label: "Grace Okafor — can confirm in the app" });
  await page.getByLabel("Named recipient").fill(c.recipient);
  await page.getByLabel("Purpose").fill(c.purpose);
  await page.getByLabel("Household contact details").check();
  await page.getByRole("button", { name: "Record consent" }).click();
  await expect(page.getByTestId("live-region")).toContainText("Consent recorded.");
  await expect(consentRow(page, c)).toContainText("Waiting for household confirmation");
}
// Consents are cards on the household record (staff rework, section 5).
const consentRow = (page: Page, c: typeof A) =>
  page.locator('li[id^="consent-"]').filter({ hasText: c.recipient });
const familyCard = (page: Page, c: typeof A) => page.getByRole("listitem").filter({ hasText: c.recipient });

test("consent needs the named person's confirmation and a different reviewer's activation", async ({
  page,
}) => {
  // 1. A care guide records consent A and drafts a packet that relies on it.
  await signInAs(page, "Maya Chen");
  await recordConsent(page, A);
  // Packets have their own tab on the household record (staff rework, section 5).
  await open(page, "/staff/households/hh-okafor?tab=packets");
  await page.getByRole("button", { name: "Draft a packet" }).click();
  const option = page.getByLabel("Consent it relies on").locator("option", { hasText: A.recipient });
  await page.getByLabel("Consent it relies on").selectOption((await option.getAttribute("value"))!);
  await page.getByLabel("Authority workflow it relies on").selectOption("ev-okafor-ada");
  await page.getByLabel("Household contact details").check();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(
    page.getByRole("link", { name: new RegExp(A.recipient.replace(/[()]/g, "\\$&")) }),
  ).toBeVisible();
  const packetUrl = await page
    .getByRole("link", { name: new RegExp(A.recipient.replace(/[()]/g, "\\$&")) })
    .getAttribute("href");

  // 2. The reviewer records consent B herself.
  await signInAs(page, "Priya Raman");
  await recordConsent(page, B);

  // 3. Before confirmation, release is held.
  await signInAs(page, "Dana Brooks");
  await open(page, packetUrl!);
  await page.getByRole("button", { name: "Request release…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Request release", exact: true }).click();
  await expect(page.getByTestId("release-outcome")).toContainText("CONSENT_NOT_CONFIRMED");

  // 4. Grace sees both waiting and confirms each exact version.
  await signInAs(page, "Grace Okafor");
  await expect(
    page.getByText("2 consents are waiting for your confirmation.", { exact: false }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "What needs your attention" })
      .getByText("2 sharing consents are waiting for your confirmation", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Review and confirm sharing" }).click();
  await expect(familyCard(page, A)).toContainText("Waiting for your confirmation");
  await expect(familyCard(page, A)).toContainText("I confirm this sharing");
  await expectAccessible(page);
  for (const c of [A, B]) {
    await familyCard(page, c).getByRole("button", { name: "Confirm this sharing" }).click();
    await expect(familyCard(page, c)).toContainText("Confirmed — waiting for activation");
  }
  await expectAccessible(page);

  // 5. The reviewer can activate A (recorded by Maya) but not B (recorded by herself).
  await signInAs(page, "Priya Raman");
  await open(page, "/staff/reviews");
  const rowA = page.getByRole("listitem").filter({ hasText: A.recipient });
  const rowB = page.getByRole("listitem").filter({ hasText: B.recipient });
  await expect(rowB).toContainText("You recorded this consent, so a different reviewer must activate it.");
  await expect(rowB.getByRole("button", { name: /^Activate/ })).toHaveCount(0);
  await expectAccessible(page);
  // Activation confirms first, restating the consent (interaction review item 18).
  await rowA.getByRole("button", { name: /^Activate…/ }).click();
  const confirm = page.getByRole("dialog", { name: /Activate the consent for/ });
  await expect(confirm).toContainText("What's included");
  await expect(confirm).toContainText("Confirmed");
  await confirm.getByRole("button", { name: "Activate consent" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Consent activated.");
  await open(page, SHARING);
  await expect(consentRow(page, A)).toContainText("Active");
  await expect(consentRow(page, B)).toContainText("You recorded this consent");

  // 6. Operations releases; the outcome and receipt say exactly what happened.
  await signInAs(page, "Dana Brooks");
  await open(page, packetUrl!);
  await page.getByRole("button", { name: "Request release…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Request release", exact: true }).click();
  await expect(page.getByTestId("release-outcome")).toContainText("Released");
  await expect(page.getByTestId("release-outcome")).toContainText(RELEASE_NOTE);
  await expect(page.getByRole("heading", { name: "Release receipt" })).toBeVisible();

  // 7. Grace withdraws A; the dialog states exactly what withdrawal does.
  await signInAs(page, "Grace Okafor");
  await open(page, "/family/sharing");
  await familyCard(page, A).getByRole("button", { name: "Withdraw consent" }).click();
  await expect(page.getByRole("dialog")).toContainText(REVOCATION_NOTE);
  await page.getByRole("dialog").getByRole("button", { name: "Withdraw consent" }).click();
  await expect(familyCard(page, A)).toContainText("Withdrawn");

  // 8. Staff withdraw B on the household's request, with the same wording.
  await signInAs(page, "Priya Raman");
  await open(page, SHARING);
  await consentRow(page, B).getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByRole("dialog")).toContainText(REVOCATION_NOTE);
  await page.getByRole("dialog").getByLabel("Who asked, and why").fill("Grace asked in person (synthetic).");
  await page.getByRole("dialog").getByRole("button", { name: "Withdraw on the household's request" }).click();
  await expect(consentRow(page, B)).toContainText("Withdrawn");
});

test("a consent the named person can't confirm in the app is held for human review", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, SHARING);
  await page.getByRole("button", { name: "Record a consent" }).click();
  await page.getByLabel("Named grantor").selectOption({ label: "Chidi Okafor — can't confirm in the app" });
  await page.getByLabel("Named recipient").fill(A.recipient);
  await page.getByLabel("Purpose").fill(A.purpose);
  await page.getByLabel("Household contact details").check();
  await page.getByRole("button", { name: "Record consent" }).click();
  await expect(consentRow(page, A)).toContainText("Held");
  await expect(consentRow(page, A)).toContainText("can't be confirmed on their behalf");
  await signInAs(page, "Priya Raman");
  await open(page, "/staff/exceptions?view=all&kind=escalation");
  await expect(page.getByText("Consent held: named person can't confirm in the app").first()).toBeVisible();
});
