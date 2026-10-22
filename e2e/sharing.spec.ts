import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { expectAccessible, nav, resetData, signInAs, open } from "./helpers";
import { RELEASE_NOTE_RECIPIENT, REVOCATION_NOTE } from "../src/domain/claims";

test.beforeEach(async ({ page }) => resetData(page));

async function requestRelease(page: Page, packetId: string) {
  await open(page, `/staff/packets/${packetId}`);
  await page.getByRole("button", { name: "Request release…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Request release", exact: true }).click();
  return page.getByTestId("release-outcome");
}

test("consent revocation holds release", async ({ page }) => {
  await signInAs(page, "Grace Okafor");
  await nav(page, "Sharing").click();
  await expectAccessible(page);
  // Grace, as the patient, can withdraw any open consent; this test withdraws the respite one.
  const respite = page.getByRole("listitem").filter({ hasText: "Brightwater Respite House" });
  await respite.getByRole("button", { name: "Withdraw consent" }).click();
  await page
    .getByRole("dialog", { name: "Withdraw this consent?" })
    .filter({ visible: true })
    .getByRole("button", { name: "Withdraw consent" })
    .click();
  await expect(respite.getByText("Withdrawn", { exact: true })).toBeVisible();

  await signInAs(page, "Dana Brooks");
  const outcome = await requestRelease(page, "pk-okafor-respite");
  await expect(outcome).toContainText("Held");
  await expect(outcome).toContainText("CONSENT_REVOKED");
  await expect(outcome).toContainText("withdrawn");
});

test("an authority conflict holds release and points to a person", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  const outcome = await requestRelease(page, "pk-bennett-equipment");
  await expect(outcome).toContainText("AUTHORITY_CONFLICT");
  await expect(outcome).toContainText("Zeporah does not decide who has legal authority");
  await open(page, "/staff/exceptions?view=all&kind=escalation");
  await page
    .locator("tbody tr")
    .filter({ hasText: "Authority conflict" })
    .first()
    .locator("button")
    .first()
    .click();
  await expect(page.getByTestId("detail-panel")).toContainText(
    "Two healthcare-agent records name different people",
  );
});

test("an expired packet holds release", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  const outcome = await requestRelease(page, "pk-hart-pharmacy");
  await expect(outcome).toContainText("PACKET_EXPIRED");
  await expectAccessible(page);
});

test("the normal scenario releases with a receipt", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  const outcome = await requestRelease(page, "pk-okafor-respite");
  await expect(outcome).toContainText("Released");
  await expect(page.getByRole("heading", { name: "Release receipt" })).toBeVisible();
});

test("an insufficient role is denied without changing the packet", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  const outcome = await requestRelease(page, "pk-okafor-respite");
  await expect(outcome).toContainText("Denied");
  await expect(outcome).toContainText("ROLE_NOT_PERMITTED");
  await page.reload();
  await expect(page.locator('[data-status="packet:draft"]').first()).toBeVisible();
});

test("another hospice is denied as out of scope and sees nothing", async ({ page }) => {
  await signInAs(page, "Jordan Ellis");
  await open(page, "/staff/packets/pk-okafor-respite");
  await expect(page.getByRole("heading", { name: "This isn't available" })).toBeVisible();
  await expect(page.getByText("OUT_OF_SCOPE")).toBeVisible();
  await expect(page.getByText("Brightwater")).toHaveCount(0);
  await open(page, "/staff/households/hh-okafor");
  await expect(page.getByRole("heading", { name: "This isn't available" })).toBeVisible();
  await expect(page.getByText("Okafor")).toHaveCount(0);
});

for (const [scenario, packetId, code] of [
  ["authority review pending", "pk-patel-chaplain", "AUTHORITY_REVIEW_PENDING"],
  ["expired consent", "pk-hart-benefits", "CONSENT_EXPIRED"],
  ["missing scope", "pk-nguyen-transport", "SCOPE_EMPTY"],
] as const) {
  test(`${scenario} holds release`, async ({ page }) => {
    await signInAs(page, "Dana Brooks");
    const outcome = await requestRelease(page, packetId);
    await expect(outcome).toContainText("Held");
    await expect(outcome).toContainText(code);
  });
}

test("release and revocation say exactly what happened", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  const outcome = await requestRelease(page, "pk-okafor-respite");
  // Decision 48c: Brightwater's named recipient was sent the sign-in alert.
  await expect(outcome).toContainText(RELEASE_NOTE_RECIPIENT);
  // Item 19: one "Released" summary (with the note) and the receipt, not two "Released" boxes.
  const receipt = page.getByRole("region", { name: "Release receipt" });
  await expect(receipt).toBeVisible();
  await expect(receipt).not.toContainText(RELEASE_NOTE_RECIPIENT);
  await expect(page.getByRole("region", { name: "Release check" })).toHaveCount(0);
  await page.getByRole("button", { name: "Revoke release" }).click();
  await expect(page.getByRole("dialog")).toContainText(REVOCATION_NOTE);
  await expect(page.getByRole("dialog")).not.toContainText("told to stop");
  await page.getByRole("dialog").getByLabel("Reason").fill("Household asked (synthetic).");
  await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByTestId("live-region")).toHaveText(REVOCATION_NOTE);
  await expect(
    page.getByText(`Release to Brightwater Respite House (synthetic) revoked. ${REVOCATION_NOTE}`),
  ).toBeVisible();
});
