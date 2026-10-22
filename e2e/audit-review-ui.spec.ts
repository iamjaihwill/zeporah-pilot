import { expect, test } from "./fixtures";
import { expectAccessible, expectNoSidewaysScroll, open, resetData, signInAs } from "./helpers";

/** The Audit review's seven improvements (2026-10-21). */
test.beforeEach(async ({ page }) => resetData(page));

test("operations: one-line integrity, live filters, day groups, decisions inline, and an event opens", async ({
  page,
}) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/audit?days=90");
  // 7. One line while the chain verifies.
  await expect(page.getByTestId("integrity-line")).toContainText(/Audit chain verified · \d+ events/);
  // 3. Day headings, with times on the rows.
  const table = page.getByRole("table", { name: /Audit events, newest first, grouped by day/ });
  await expect(table.getByRole("rowheader").first()).toHaveText(/^(Today · )?[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  // 2. A decision sits beside its event, not in its own column.
  await expect(page.getByRole("columnheader", { name: "Decision" })).toHaveCount(0);
  await expect(table.locator("tbody tr").filter({ hasText: "Correction requested" }).first()).toContainText(
    "Held",
  );
  // 4. Filters apply as soon as they change.
  await page.getByLabel("Kind of event").selectOption({ label: "Sharing, consent and authority" });
  await expect(page).toHaveURL(/category=sharing/);
  await expect(table).not.toContainText("Care guide assigned");
  await expectAccessible(page);
  // 5. An event opens with a link to its record.
  await table
    .getByRole("button", { name: /^Open Consent withdrawn/ })
    .first()
    .click();
  const panel = page.getByTestId("detail-panel");
  await expect(panel).toContainText("consent.revoked");
  await panel.getByRole("link", { name: "Open the record" }).click();
  await expect(page).toHaveURL(/\/staff\/sharing\/cs-/);
});

test("periods: the last 24 hours, a year, and a date range; exports stay within 90 days", async ({
  page,
}) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/audit");
  await page.getByLabel("Period").selectOption("365");
  await expect(page).toHaveURL(/days=365/);
  await expect(page.getByText(/events in the last 12 months/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  await expect(page.getByText("Exports cover at most 90 days.", { exact: false })).toBeVisible();
  await page.getByLabel("Period").selectOption("range");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  await page.getByLabel("From", { exact: true }).fill(today);
  await page.getByLabel("To", { exact: true }).fill(today);
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`from=${today}&to=${today}|to=${today}.*from=${today}`));
  await expect(page.getByText(new RegExp(`from ${today} to ${today}`))).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();
});

test("iPad: nothing scrolls sideways and who sits under the event", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signInAs(page, "Priya Raman");
  await open(page, "/staff/audit?days=90");
  await expectNoSidewaysScroll(page);
  await expect(page.getByRole("columnheader", { name: "Household" })).toBeHidden();
  await expectAccessible(page);
});

test("each event shows the role at the time and where it came from (decision 58)", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/audit?householdId=hh-okafor&days=90");
  const table = page.getByRole("table", { name: /Audit events, newest first, grouped by day/ });
  // Maya's events carry her role under her name; family events carry a Family badge.
  const maya = table.locator("tbody tr").filter({ hasText: "Maya Chen" }).first();
  await expect(maya).toContainText("Care guide");
  const family = table.locator("tbody tr").filter({ hasText: "Ada Okafor" }).first();
  await expect(family).toContainText("Family");
  await family.getByRole("button").first().click();
  const panel = page.getByTestId("detail-panel");
  await expect(panel).toContainText("Role");
  await expect(panel).toContainText("Proxy");
  await expect(panel).toContainText("Source");
  await expectAccessible(page);
});
