import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** The Packets review's seven improvements (2026-10-21). */
test.beforeEach(async ({ page }) => resetData(page));

test("operations: tabs, plain draft status, ends-soon flags, contents in the panel", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/packets");
  const tabs = page.getByRole("navigation", { name: "Packet views" });
  for (const t of [/^To release/, /^Released/, /^Ended/])
    await expect(tabs.getByRole("link", { name: t })).toBeVisible();
  const table = page.getByRole("table", { name: /Packets to release/ });
  // To release holds only drafts and held packets, soonest end date first.
  await expect(table).not.toContainText("Released");
  await expect(table).not.toContainText("Expired");
  // 1. "Draft", not "Draft — not checked", beside "Ready to release".
  const brightwater = table.locator("tbody tr").filter({ hasText: "Brightwater" });
  await expect(brightwater).toContainText("Ready to release");
  await expect(brightwater.locator('[data-status="packet:draft"]')).toHaveText(/^\s*Draft\s*$/);
  // 3. Drafts ending within a week say so.
  await expect(table.locator("[data-ends-soon]").first()).toHaveText("Ends soon");
  // 6. The panel lists what the packet carries.
  await brightwater.getByRole("button", { name: /^Open the packet/ }).click();
  const panel = page.getByTestId("detail-panel");
  await expect(panel).toContainText("Includes");
  await expect(panel).toContainText("Visit schedule");
  await expectAccessible(page);

  // 5. Released: what the recipient has done; Ended: expired and withdrawn.
  await tabs.getByRole("link", { name: /^Released/ }).click();
  await expect(page.getByRole("columnheader", { name: "Recipient", exact: true })).toBeVisible();
  await tabs.getByRole("link", { name: /^Ended/ }).click();
  await expect(page.getByRole("table", { name: "Ended packets" })).toContainText("Oakline");
});

test("care guide: draft from the list via the household; iPad rows stay on one line", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/packets");
  // 4. Below wide screens the household sits under the purpose, and dates don't wrap.
  await expect(page.getByRole("columnheader", { name: "Household" })).toBeHidden();
  const until = page.locator("tbody tr").first().locator("td").last();
  // The date's text lays out on a single line.
  const lines = await until.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
  });
  expect(lines).toBe(1);
  // 7. Draft a packet… chooses the household and opens its Packets tab.
  await page.getByRole("button", { name: "Draft a packet…" }).click();
  await page.getByLabel("For which household?").selectOption({ label: "The Hart household" });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/staff\/households\/hh-hart\?tab=packets/);
  await expectAccessible(page);
});

test("reviewer: no draft button (reviewers release, they don't draft)", async ({ page }) => {
  await signInAs(page, "Priya Raman");
  await open(page, "/staff/packets");
  await expect(page.getByRole("button", { name: "Draft a packet…" })).toHaveCount(0);
});
