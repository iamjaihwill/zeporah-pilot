import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { expectAccessible, nav, resetData, signInAs, unread, open } from "./helpers";

test.beforeEach(async ({ page }) => resetData(page));

test("a message reaches the care team, the reply reaches the household, and unread state is shared", async ({
  page,
}) => {
  await signInAs(page, "Maya Chen");
  const mayaBefore = await unread(page);

  await signInAs(page, "Daniel Okafor");
  await nav(page, "Updates & messages").click();
  await expectAccessible(page);
  await page.getByLabel(/Message Maya Chen/).fill("Could the aide come at 9 on Friday?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Could the aide come at 9 on Friday?")).toBeVisible();
  await expect(page.getByTestId("live-region")).toHaveText("Message sent to your care guide.");
  await nav(page, "Home").click();
  await expect(page.getByText("Daniel sent a message to the care guide.").first()).toBeVisible();

  // The care guide sees it as unread and in the household thread, separate from internal notes.
  await signInAs(page, "Maya Chen");
  expect(await unread(page)).toBe(mayaBefore + 1);
  await open(page, "/staff/households/hh-okafor?tab=notes");
  await page.getByLabel("Add an internal note").fill("INTERNAL: check the aide roster");
  await page.getByRole("button", { name: "Save internal note" }).click();
  await page.getByRole("link", { name: /^Messages/ }).click();
  await expect(page.getByText("Could the aide come at 9 on Friday?")).toBeVisible();
  await page.getByLabel("Reply to the household").fill("Yes — 9 on Friday works.");
  await page.getByRole("button", { name: "Send to household" }).click();
  await expect(page.getByText("Yes — 9 on Friday works.")).toBeVisible();

  await signInAs(page, "Daniel Okafor");
  const before = await unread(page);
  expect(before).toBeGreaterThan(0);
  await nav(page, "Notifications").click();
  await page.getByRole("link", { name: /Unread: You have a new message from your care guide/ }).click();
  await expect(page).toHaveURL(/\/family\/messages/);
  await expect(page.getByText("Yes — 9 on Friday works.")).toBeVisible();
  await expect(page.getByText("INTERNAL: check the aide roster")).toHaveCount(0);
  // Opening the thread reads what's in it (item 9), so at least this one is no longer unread.
  await expect.poll(() => unread(page)).toBeLessThanOrEqual(before - 1);
  await nav(page, "Notifications").click();
  const all = page.getByRole("button", { name: "Mark all as read" });
  // Let the thread's "seen" refresh settle before deciding (it can re-render this list once).
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("You're all caught up.").or(all)).toBeVisible();
  if (await all.isVisible()) await all.click();
  await expect(page.getByTestId("unread-badge")).toHaveCount(0);
  await nav(page, "Home").click();
  await expect(page.getByRole("link", { name: /Unread notifications/ })).toContainText("0");
});
