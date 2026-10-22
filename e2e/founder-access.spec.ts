import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { expectAccessible, open, ready, resetData, signInAs, signOutFromShell } from "./helpers";

/** Helpers and recipients land on their own single page (no app shell). */
async function signInTo(page: Page, name: string, url: RegExp) {
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await page.waitForURL(url);
  await expect(page.locator("main h1")).toBeVisible();
}

/** Founder decisions 42 (helpers), 43 (vault audience), 45 (packet recipients) and 46 (the patient's view). */
test.beforeEach(async ({ page }) => resetData(page));

test("a task-only helper sees their task and nothing else, and access ends when it's done", async ({
  page,
}) => {
  await signInTo(page, "Jamie Park", /\/helper$/);
  await expect(page.getByRole("heading", { level: 1, name: "What you're helping with" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Pick up groceries for Thursday" })).toBeVisible();
  await expect(page.getByText(/Your access/)).toBeVisible();
  await expectAccessible(page);
  // Household pages refuse them; they're sent back to their task.
  for (const path of ["/family", "/family/vault", "/family/people", "/family/messages"]) {
    await open(page, path);
    await expect(page).toHaveURL(/\/helper$|\/family\//);
    await expect(page.getByText("Harold")).toHaveCount(0);
  }
  await open(page, "/helper");
  await page.getByRole("button", { name: /^Mark done/ }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Thank you — marked done.");
  await expect(page.getByRole("heading", { level: 1, name: "Nothing to help with right now" })).toBeVisible();
});

test("the coordinator asks someone to help with one task", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/tasks");
  const card = page.getByRole("listitem").filter({ hasText: "Pick up the equipment return form" });
  await card.getByRole("button", { name: /^Ask someone to help…/ }).click();
  const dialog = page.getByRole("dialog", { name: /Ask someone to help with/ });
  await expect(dialog).toContainText("nothing else in your household");
  await dialog.getByLabel("Their name").fill("Sam Neighbour");
  await dialog.getByLabel("Their email").fill("sam.neighbour@example.invalid");
  await dialog.getByRole("button", { name: "Create invitation link" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Invitation link ready for Sam Neighbour.");
});

test("a vault item's audience is plain, and changing it is confirmed", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/vault");
  const first = page
    .getByRole("listitem")
    .filter({ has: page.getByTestId("vault-audience") })
    .first();
  await expect(first.getByTestId("vault-audience")).toContainText("Shared with staff:");
  await first.getByRole("button", { name: /^Change who can see it…/ }).click();
  const dialog = page.getByRole("dialog", { name: /Change who can see/ });
  await dialog.getByRole("radio", { name: /Visible to the household/ }).check();
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Change who can see it" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Who can see it was changed.");
  await expect(first.getByTestId("vault-audience")).toContainText(
    "Visible to the household and your care team",
  );

  // A family member now has a Vault page with just that item.
  await signOutFromShell(page);
  await signInAs(page, "Chidi Okafor");
  await open(page, "/family/vault");
  await expect(page.getByTestId("vault-audience")).toHaveCount(1);
});

test("a released packet's recipient reads it in Zeporah, read-only, and can acknowledge or ask", async ({
  page,
}) => {
  await signInTo(page, "Rosa Lin", /\/recipient$/);
  // The seed releases the intake packet to Rosa; the respite packet isn't hers until it's released.
  await expect(page.getByRole("link", { name: "Coordinate a short respite stay" })).toHaveCount(0);
  await signOutRecipient(page);

  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/packets/pk-okafor-respite");
  await expect(page.getByRole("region", { name: "Recipient access" })).toContainText("Rosa Lin");
  await page.getByRole("button", { name: "Request release…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Request release", exact: true }).click();
  await expect(page.getByTestId("release-outcome")).toContainText("Released");
  await expect(page.getByTestId("recipient-access")).toContainText("Active");
  await signOutFromShell(page);

  await signInTo(page, "Rosa Lin", /\/recipient$/);
  await page.getByRole("link", { name: "Coordinate a short respite stay" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Coordinate a short respite stay" }),
  ).toBeVisible();
  await expect(page.getByText("Willow Creek Hospice (synthetic)")).toBeVisible();
  await expect(page.getByRole("region", { name: "What's included" })).toBeVisible();
  await expect(page.getByText(/doesn't offer a download, print copy or forwarding/)).toBeVisible();
  await expect(page.getByRole("button", { name: /download|print|forward/i })).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole("button", { name: "Acknowledge receipt" }).click();
  await expect(page.getByTestId("live-region")).toHaveText(
    "Thank you — the hospice can see you received it.",
  );
  await page.getByLabel("Your question").fill("Which entrance should the family use? (synthetic)");
  await page.getByRole("button", { name: "Ask the hospice" }).click();
  await expect(page.getByRole("region", { name: "A question about it?" })).toContainText(
    "Your question went to the hospice care team.",
  );
  await expect(page.getByRole("region", { name: "Access history" })).toContainText(
    "You acknowledged receiving it",
  );
});

test("the patient's own view, with private notes and a way to flag a concern", async ({ page }) => {
  await signInAs(page, "Grace Okafor");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My care" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Your care, in one place" })).toBeVisible();
  for (const region of [
    "What matters to you",
    "Your care team",
    "People involved",
    "Coming up",
    "Tasks shared with you",
    "What's shared, and with whom",
    "Your private notes",
    "Ask for help or flag a concern",
  ])
    await expect(page.getByRole("region", { name: region })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("New note").fill("Morning light helps (synthetic).");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Morning light helps (synthetic).")).toBeVisible();
  await page.getByLabel("What's on your mind").fill("I'd like to talk about my evenings (synthetic).");
  await page.getByRole("button", { name: "Send to my care team" }).click();
  await expect(page.getByText("Your care team has it.")).toBeVisible();
});

async function signOutRecipient(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/$/);
}
