import { expect, test } from "./fixtures";
import { expectAccessible, expectNoSidewaysScroll, open, resetData, signInAs } from "./helpers";

/** The enterprise direction's design refinements (plan Phase 7, stories D-1 to D-6). */

test("the record answers the questions, and prepared items say what they used", async ({ page }) => {
  await resetData(page, "Demo week: mid-week (Day 4)");
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor");
  const context = page.getByRole("complementary", { name: "Household context" });
  // D-1: what's agreed (consents and authority) apart from what's shared (outside access).
  const agreed = context.locator("section", {
    has: page.getByRole("heading", { name: "What has been agreed" }),
  });
  await expect(agreed).toContainText("Sharing with Oakwood Home Medical Supply (synthetic)");
  await expect(agreed).toContainText("Healthcare agent: active workflow");
  const shared = context.locator("section", {
    has: page.getByRole("heading", { name: "What has been shared" }),
  });
  await expect(shared).toContainText(/Rosa Lin reads “Coordinate a short respite stay”, read-only, until/);
  await expect(context.getByTestId("ehr-pointer")).toBeVisible();
  const waiting = context.locator("#open-items");
  await expect(waiting.getByText(/^Owner:/).first()).toBeVisible();

  // D-4: Catch me up and the prepared reply carry the same three lines.
  await page.getByRole("button", { name: "Catch me up" }).click();
  const brief = page.getByRole("dialog", { name: "Catch me up" });
  await expect(brief.getByTestId("prepared-evidence")).toContainText(/Used\s*\d+ recorded events/);
  await expect(brief.getByTestId("prepared-evidence")).toContainText("Nothing. Opening it is recorded");
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await open(page, "/staff/households/hh-okafor?tab=messages");
  const evidence = page.getByTestId("prepared-draft").getByTestId("prepared-evidence");
  await expect(evidence).toContainText("a fixed synthetic example written for this demo");
  await expect(evidence).toContainText("A reply to the household.");
  await expect(evidence).toContainText("Send sends it to the household from you");
  await expectAccessible(page);
});

test("an exception says what it rests on and what closes it", async ({ page }) => {
  await resetData(page, "Demo week: mid-week (Day 4)");
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/exceptions?view=consent");
  await page.getByRole("button", { name: /^Open Consent to share with Oakwood/ }).click();
  const panel = page.getByTestId("detail-panel");
  await expect(panel.getByTestId("exception-basis")).toHaveText(
    "Consent for Oakwood Home Medical Supply (synthetic), version 2: waiting for household confirmation. It must be active before anything is shared",
  );
  await expect(panel).toContainText(
    "What raised it is resolved through its own workflow. It can't be dismissed.",
  );
  await expectAccessible(page);
});

test("operations see where work is waiting, and each count opens that part of the list", async ({ page }) => {
  await resetData(page, "Demo week: mid-week (Day 4)");
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/exceptions");
  const table = page.getByTestId("bottlenecks");
  await table.locator("summary").click();
  const row = table.getByRole("row", { name: /^Coverage gap/ });
  const total = parseInt(await row.getByRole("cell").last().innerText(), 10);
  expect(total).toBeGreaterThan(0);
  await expectAccessible(page);
  await row.getByRole("link").last().click();
  await expect(page).toHaveURL(/category=coverage_gap/);
  await expect(page.getByRole("table", { name: /^Exceptions:/ }).locator("tbody tr")).toHaveCount(total);
  // A band narrows it further, and says so.
  await open(page, "/staff/exceptions?view=all&category=coverage_gap&age=longer");
  await expect(page.getByRole("button", { name: /^Open over 3 days · Show all/ })).toBeVisible();

  // Care guides don't get the table.
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/exceptions");
  await expect(page.getByRole("heading", { level: 1, name: "Exceptions" })).toBeVisible();
  await expect(page.getByTestId("bottlenecks")).toHaveCount(0);
});

test("a resolved item links to the record of what closed it; Reports count prepared work", async ({
  page,
}) => {
  await resetData(page, "Demo week: end of week (Day 7)");
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/exceptions?view=resolved");
  const first = page
    .getByRole("list", { name: /^Resolved in the last 14 days/ })
    .locator("> li")
    .first();
  await first.getByRole("link", { name: /^Show the record of it/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Audit review" })).toBeVisible();
  await expect(page.getByTestId("detail-panel")).toBeVisible();
  await expect(page).toHaveURL(/sel=/);

  await open(page, "/staff/reports?days=7");
  const prepared = page.locator("section", {
    has: page.getByRole("heading", { name: "Prepared with Copilot" }),
  });
  await expect(prepared).toContainText(/Prepared replies sent\s*1/);
  await expect(prepared).toContainText(/Prepared handoff notes used\s*1/);
  await expectAccessible(page);
  await expectNoSidewaysScroll(page);
});

test("polish: resolved footers say who and when; the administrator refusal says why, once", async ({
  page,
}) => {
  await resetData(page, "Demo week: end of week (Day 7)");
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/exceptions?view=resolved");
  const list = page.getByRole("list", { name: /^Resolved in the last 14 days/ });
  await expect(list.locator("> li").first()).toBeVisible();
  await expect(list).not.toContainText("Resolved by");
  await expect(list).toContainText("Stalled handoff rerouted");

  await signInAs(page, "Lena Hoffman");
  await open(page, "/staff/households/hh-okafor");
  const denied = page.getByTestId("access-denied");
  await expect(denied).toContainText("Administrators don't open household records (decision 39).");
  await expect(denied).not.toContainText("your care team can help");
  await expect(denied.getByRole("link", { name: "Back to Administration" })).toBeVisible();
  await expectAccessible(page);
});
