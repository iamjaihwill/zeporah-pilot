import { expect, test } from "./fixtures";
import { expectAccessible, nav, open, resetData, signInAs } from "./helpers";

test.beforeEach(async ({ page }) => resetData(page));

test("the family dashboard leads with what needs attention and shows real times", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  const attention = page.getByRole("heading", { name: "What needs your attention" });
  const stats = page.getByRole("link", { name: /Open tasks/ });
  expect((await attention.boundingBox())!.y).toBeLessThan((await stats.boundingBox())!.y);
  const messages = page.getByRole("region", { name: /^Messages with/ });
  await expect(messages).toContainText(/Last message from .+, [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M\./);
  await expect(page.locator("main")).not.toContainText("$<");
  await expect(page.getByText(/24-hour line: 555-0100/).first()).toBeVisible();
});

test("messages say exactly who can read them", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await nav(page, "Updates & messages").click();
  const audience = page.getByTestId("thread-audience");
  for (const name of ["Grace Okafor", "Daniel Okafor", "Ada Okafor", "Maya Chen"])
    await expect(audience).toContainText(name);
  await expect(audience).not.toContainText("Chidi");
  await expect(page.getByText("Visible to the household")).toHaveCount(0);
});

test("completed actions show a visible note that can be dismissed and clears on navigation", async ({
  page,
}) => {
  await signInAs(page, "Ada Okafor");
  await open(page, "/family/messages");
  const note = page.getByTestId("status-note");
  // Clears when the person moves to another page…
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(note).toContainText("Acknowledged. Your care team can see that you've read it.");
  await nav(page, "Tasks").click();
  await expect(note).toHaveCount(0);
  // …and can be dismissed.
  await nav(page, "Updates & messages").click();
  await page.getByLabel(/Message Maya Chen/).fill("Thank you.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(note).toContainText("Message sent to your care guide.");
  await note.getByRole("button", { name: "Dismiss" }).click();
  await expect(note).toHaveCount(0);
});

test("dialogs that need a reason can't be confirmed without one", async ({ page }) => {
  await signInAs(page, "Priya Raman");
  await open(page, "/staff/households/hh-okafor?tab=sharing");
  await page
    .locator('li[id^="consent-"]')
    .filter({ hasText: "Brightwater" })
    .getByRole("button", { name: "Withdraw" })
    .click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Withdraw on the household's request" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Who asked, and why").fill("Grace asked in person (synthetic).");
  await expect(confirm).toBeEnabled();
  await dialog.getByRole("button", { name: "Go back" }).click();

  await open(page, "/staff/exceptions?view=all&kind=escalation");
  // A family request: resolvable from the panel (consent holds are worked on the household's page).
  await page
    .locator("tbody tr")
    .filter({ hasText: "Family asked for a person to follow up" })
    .getByRole("button", { name: /^Open / })
    .click();
  const panel = page.getByTestId("detail-panel");
  const take = panel.getByRole("button", { name: "Take ownership" });
  if (await take.isVisible()) {
    await take.click();
    await expect(page.getByTestId("live-region")).toHaveText("You own this now.");
  }
  await panel.getByRole("button", { name: /^(Resolve…|Take over and resolve…)$/ }).click();
  const resolve = page.getByRole("dialog", { name: /Resolve this escalation\?|Take over/ });
  await expect(resolve.getByRole("button", { name: /^(Resolve|Take over and resolve)$/ })).toBeDisabled();
});

test("cancelling a bereavement proposal asks first", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor?tab=lifecycle");
  await page.getByRole("button", { name: "Propose transition" }).click();
  await page.getByRole("button", { name: "Cancel proposal" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Cancel this proposal?" });
  await expect(dialog).toContainText("nothing is sent to them");
  await dialog.getByRole("button", { name: "Cancel the proposal" }).click();
  await expect(page.getByRole("heading", { name: "Propose bereavement support" })).toBeVisible();
});

test("staff counts open the matching exceptions slice, and only for roles that can act", async ({ page }) => {
  await signInAs(page, "Priya Raman");
  // The reviewer's home leads with the review backlog; its number opens that list.
  const backlog = page.locator('[data-widget="reviews"]');
  await backlog.getByRole("link", { name: /open the list$/ }).click();
  await expect(page).toHaveURL(/\/staff\/exceptions\?view=consent/);
  await expect(page.getByRole("heading", { level: 1, name: "Exceptions" })).toBeVisible();
  const rows = page.getByRole("table", { name: /^Exceptions/ }).locator("tbody tr");
  await expect(rows.filter({ hasText: "authority record" }).first()).toContainText(
    /Review the evidence|Review both records with the family|Link the record to a household person/,
  );
  await expectAccessible(page);

  // Operations don't review authority: no backlog widget on their home.
  await signInAs(page, "Dana Brooks");
  await expect(page.locator('[data-widget="reviews"]')).toHaveCount(0);
});

test("auditable surfaces show full absolute times, and the staff vault shows who reviewed", async ({
  page,
}) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor?tab=timeline");
  await expect(page.locator("tbody tr").first()).toContainText(
    /[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M ET/,
  );
  await open(page, "/staff/households/hh-okafor?tab=vault");
  await expect(page.locator("main")).not.toContainText("$<");
  await expect(page.getByRole("row", { name: /^Advance directive/ })).toContainText(/\d{1,2}:\d{2} [AP]M/);
  await expectAccessible(page);
});

test("households see plain words when something isn't available, with the code tucked away", async ({
  page,
}) => {
  await signInAs(page, "Chidi Okafor");
  // The Sharing page isn't part of Chidi's role (the vault is now, for household items: decision 43).
  await open(page, "/family/sharing");
  await expect(page.getByText("your care team can help")).toBeVisible();
  // The code is tucked away until asked for (item 3: a reason code, not a "reference").
  await expect(page.getByText("Reason code:")).toBeHidden();
  await page.getByText("Details for your care team").click();
  await expect(page.getByText(/Reason code:/)).toBeVisible();
  await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  await expectAccessible(page);
});
