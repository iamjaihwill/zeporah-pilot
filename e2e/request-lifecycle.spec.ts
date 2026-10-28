import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs, signOutFromShell } from "./helpers";
import type { Page } from "@playwright/test";

/** The request lifecycle on screen (founder decisions 79–82), with synthetic people and requests. */
test.beforeEach(async ({ page }) => resetData(page));

const requests = (page: Page) => page.getByTestId("your-requests");

/** Daniel asks for a person about paperwork. */
async function ask(page: Page) {
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/support");
  await page
    .getByLabel("What would you like help with?")
    .selectOption({ label: "Benefits or paperwork questions" });
  await page.getByRole("button", { name: "Send the request" }).click();
  await expect(requests(page)).toContainText("Received");
  await expect(requests(page)).toContainText("Your care team has it.");
}

/** Maya opens the Okafor family's request in Exceptions; returns the detail panel. */
async function openAsMaya(page: Page) {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/exceptions?view=all&kind=escalation");
  await page
    .locator("tbody tr")
    .filter({ hasText: "The Okafor household" })
    .filter({ hasText: "Family asked for a person" })
    .first()
    .locator("button")
    .first()
    .click();
  return page.getByTestId("detail-panel");
}

/** Tomorrow at 3 PM in the browser's own time, as a datetime-local value. */
const tomorrowAfternoon = (page: Page) =>
  page.evaluate(() => {
    const d = new Date(Date.now() + 86_400_000);
    d.setHours(15, 0, 0, 0);
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
    return z.toISOString().slice(0, 16);
  });

test("the family sees who has it, what it's waiting on and when they'll hear, then reopens it", async ({
  page,
}) => {
  await ask(page);
  await expectAccessible(page);
  await signOutFromShell(page);

  // Maya takes it and says where it stands (decisions 80 and 82).
  const panel = await openAsMaya(page);
  await panel.getByRole("button", { name: "Take ownership", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("You own this now.");
  await panel.getByLabel("It's").selectOption({ label: "Waiting on someone else" });
  await panel.getByLabel("Who, by kind (optional)").fill("the benefits office");
  await panel.getByLabel("The family will next hear by").fill(await tomorrowAfternoon(page));
  await expectAccessible(page);
  await panel.getByRole("button", { name: "Save where it stands" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Saved. The family sees where it stands.");
  await signOutFromShell(page);

  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/support");
  await expect(requests(page)).toContainText("Waiting on someone else: the benefits office");
  await expect(requests(page)).toContainText(
    "Maya is waiting to hear back from someone outside your household.",
  );
  await expect(requests(page)).toContainText("You'll hear about where it stands by");
  await expect(requests(page)).toContainText("not about care");
  await signOutFromShell(page);

  // Maya resolves it; Daniel reopens it with a reason, back to Maya (decision 81).
  const again = await openAsMaya(page);
  await again.getByRole("button", { name: "Resolve…" }).click();
  const resolve = page.getByRole("dialog", { name: "Resolve this escalation?" });
  await resolve.getByLabel("How was it resolved?").fill("Sent the form (synthetic).");
  await resolve.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Resolved.");
  await signOutFromShell(page);

  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/support");
  await expect(requests(page)).toContainText("Resolved");
  await requests(page).getByRole("button", { name: "Reopen…" }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen this request?" });
  await expect(reopen).toContainText("You can reopen it until");
  await expectAccessible(page);
  await reopen.getByLabel("What still needs attention?").fill("The form came back (synthetic).");
  await reopen.getByRole("button", { name: "Reopen it" }).click();
  await expect(page.getByTestId("live-region")).toHaveText(
    "Your request was reopened. It went back to the person who resolved it.",
  );
  await expect(requests(page)).toContainText("With Maya");
  await expect(requests(page)).toContainText("reopened");
});

test("the sender withdraws an open request, and it leaves the care team's queue", async ({ page }) => {
  await ask(page);
  await requests(page).getByRole("button", { name: "Withdraw…" }).click();
  const dialog = page.getByRole("dialog", { name: "Withdraw this request?" });
  await expect(dialog).toContainText("whoever has it is told");
  await dialog.getByRole("button", { name: "Withdraw it" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Your request was withdrawn.");
  await expect(requests(page)).toContainText("Withdrawn");
  await expect(requests(page)).toContainText("You withdrew this request.");
  await expect(requests(page).getByRole("button", { name: /Withdraw|Reopen/ })).toHaveCount(0);
  await signOutFromShell(page);

  await signInAs(page, "Maya Chen");
  await open(page, "/staff/exceptions?view=all&kind=escalation");
  await expect(
    page
      .locator("tbody tr")
      .filter({ hasText: "The Okafor household" })
      .filter({ hasText: "Family asked for a person" }),
  ).toHaveCount(0);
});
