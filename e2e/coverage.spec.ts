import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs } from "./helpers";

/** Planned absence, cover and handoffs (decision 58 workstream 3; decisions 59–61). */
test.beforeEach(async ({ page }) => resetData(page));

/** A datetime-local value, in the browser's own time zone, `hours` from now. */
const at = (page: Page, hours: number) =>
  page.evaluate((h) => {
    const d = new Date(Date.now() + h * 3_600_000);
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, hours);

async function recordMayaAway(page: Page) {
  await open(page, "/staff/team");
  await page.getByRole("button", { name: "Record an absence…" }).click();
  const d = page.getByRole("dialog", { name: "Record a planned absence" });
  await d.getByLabel("Care guide").selectOption({ label: "Maya Chen" });
  await d.getByLabel("From").fill(await at(page, -1));
  await d.getByLabel("Until").fill(await at(page, 5));
  await d.getByLabel(/^Reason/).fill("Annual leave (synthetic)");
  await d.getByRole("button", { name: "Record the absence" }).click();
  await expect(page.getByTestId("live-region")).toHaveText(/Absence recorded for Maya Chen/);
}

test("operations offer cover; the covering guide accepts and has access only until it ends", async ({
  page,
}) => {
  await signInAs(page, "Dana Brooks");
  await recordMayaAway(page);
  const absences = page
    .getByRole("region", { name: "Planned absences and cover" })
    .or(page.locator("section", { has: page.getByRole("heading", { name: "Planned absences and cover" }) }));
  await expect(absences).toContainText("Away now");
  const okafor = page.locator("tr", { hasText: "The Okafor household" }).filter({ hasText: "No cover yet" });
  await okafor.getByRole("button", { name: /Offer cover/ }).click();
  const offer = page.getByRole("dialog", { name: "Offer cover for The Okafor household?" });
  await expect(offer).toContainText("Nothing changes until they accept");
  await offer.getByLabel("Offer to").selectOption({ label: "Sofia Reyes" });
  await offer.getByLabel(/Handoff note/).fill("Respite stay on Tuesday (synthetic).");
  await offer.getByRole("button", { name: "Offer cover" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Cover offered to Sofia Reyes.");
  await expectAccessible(page);

  // Before accepting, Sofia sees the name and the note — not the record.
  await signInAs(page, "Sofia Reyes");
  await open(page, "/staff/households/hh-okafor");
  await expect(page.getByRole("heading", { name: "This isn't available" })).toBeVisible();
  await open(page, "/staff");
  const card = page.getByTestId("handoff-offer");
  await expect(card).toContainText("The Okafor household");
  await expect(card).toContainText("Respite stay on Tuesday (synthetic).");
  await expectAccessible(page);
  await card.getByRole("button", { name: /^Accept…/ }).click();
  const accept = page.getByRole("dialog", { name: "Accept The Okafor household?" });
  await expect(accept).toContainText("Your access ends by itself at that time.");
  await accept.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("You accepted The Okafor household.");

  // Now she can open it, and Who can see what marks her access Temporary.
  await open(page, "/staff/households/hh-okafor/access");
  await expect(page.getByRole("heading", { level: 1, name: "Who can see what" })).toBeVisible();
  const sofia = page.locator("tr", { hasText: "Sofia Reyes" });
  await expect(sofia).toContainText("covering for Maya Chen");
  await expect(sofia).toContainText(/Temporary until/);
});

test("a care guide declines with a reason, and operations see it", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await recordMayaAway(page);
  const bennett = page
    .locator("tr", { hasText: "The Bennett household" })
    .filter({ hasText: "No cover yet" });
  await bennett.getByRole("button", { name: /Offer cover/ }).click();
  const offer = page.getByRole("dialog", { name: "Offer cover for The Bennett household?" });
  await offer.getByLabel("Offer to").selectOption({ label: "Tomás Alvarez" });
  await offer.getByRole("button", { name: "Offer cover" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Cover offered to Tomás Alvarez.");

  await signInAs(page, "Tomás Alvarez");
  await page
    .getByTestId("handoff-offer")
    .getByRole("button", { name: /^Decline…/ })
    .click();
  const decline = page.getByRole("dialog", { name: "Decline The Bennett household?" });
  await decline.getByLabel("Reason").fill("Full caseload this week (synthetic).");
  await decline.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Declined. Operations will be told.");

  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/team");
  await expect(page.locator("tr", { hasText: "The Bennett household" }).first()).toContainText(
    "Tomás Alvarez declined: Full caseload this week (synthetic).",
  );
  await open(page, "/staff/exceptions?view=handoffs");
  await expect(page.getByRole("table", { name: /^Exceptions/ })).toContainText(
    "Cover offered to Tomás Alvarez",
  );
});

test("operations hand a household over; it moves only when the receiving guide accepts", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/households/hh-rivera");
  await page.getByRole("button", { name: /^Hand over… from Maya Chen/ }).click();
  const d = page.getByRole("dialog", { name: "Hand The Rivera household over?" });
  await d.getByLabel("Offer to").selectOption({ label: "Sofia Reyes" });
  await d.getByRole("button", { name: "Offer the handoff" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Handoff offered to Sofia Reyes.");

  await signInAs(page, "Sofia Reyes");
  const card = page.getByTestId("handoff-offer");
  await expect(card).toContainText("take over from Maya Chen");
  await card.getByRole("button", { name: /^Accept…/ }).click();
  await page
    .getByRole("dialog", { name: "Accept The Rivera household?" })
    .getByRole("button", { name: "Accept", exact: true })
    .click();
  await expect(page.getByTestId("live-region")).toHaveText("You accepted The Rivera household.");
  await open(page, "/staff/households/hh-rivera");
  await expect(page.getByRole("heading", { level: 1, name: "The Rivera household" })).toBeVisible();

  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-rivera");
  await expect(page.getByRole("heading", { name: "This isn't available" })).toBeVisible();
});
