import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** The demo-safe Copilot foundation (decision 58, workstream 5): cited summaries, labelled drafts. */

test("Catch me up cites its sources, and a source opens on the timeline", async ({ page }) => {
  await resetData(page, "Demo week: mid-week (Day 4)");
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor");
  await page.getByRole("button", { name: "Catch me up" }).click();
  const dialog = page.getByRole("dialog", { name: "Catch me up" });
  await expect(dialog.getByTestId("brief-label")).toContainText("by fixed rules, not AI");
  await expect(dialog.getByTestId("brief-label")).toContainText(/As of [A-Z][a-z]{2} \d{1,2}, \d{4}/);
  const lines = dialog.getByTestId("brief-lines").locator("> li");
  await expect(lines.first()).toBeVisible();
  for (const l of await lines.all()) await expect(l.getByRole("link").first()).toBeVisible();
  await expectAccessible(page);
  const source = dialog.getByRole("link", { name: /^Partner event logged \(simulated\)/ }).first();
  const href = await source.getAttribute("href");
  await source.click();
  await expect(page).toHaveURL(new RegExp(`#${href!.split("#")[1]}$`));
  await expect(page.locator(`#${href!.split("#")[1]}`)).toContainText("Partner event logged (simulated)");
});

test("a synthetic prepared draft is labelled, used by a person, and recorded as prepared", async ({
  page,
}) => {
  await resetData(page, "Demo week: mid-week (Day 4)");
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor?tab=messages");
  const draft = page.getByTestId("prepared-draft");
  await expect(draft).toContainText("Prepared with Copilot · synthetic example");
  await draft.getByRole("button", { name: "Use this draft" }).click();
  await expect(page.getByLabel("Reply to the household")).toHaveValue(/Brightwater has a bed on Tuesday/);
  await page.getByRole("button", { name: "Send to household" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Message sent to the household.");

  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/audit?householdId=hh-okafor&days=1");
  const row = page.locator("tbody tr").filter({ hasText: "Message sent" }).first();
  await expect(row).toContainText("Prepared with Copilot");
  await expect(row).toContainText("Maya Chen");
});

test("no prepared drafts in the standard data", async ({ page }) => {
  await resetData(page);
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor?tab=messages");
  await expect(page.getByLabel("Reply to the household")).toBeVisible();
  await expect(page.getByTestId("prepared-draft")).toHaveCount(0);
});
