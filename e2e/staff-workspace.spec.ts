import { expect, test } from "./fixtures";
import { expectAccessible, expectNoSidewaysScroll, open, resetData, signInAs } from "./helpers";

/** Staff workspace rework: the walkthroughs from the brief's verification section. */
test.beforeEach(async ({ page }) => resetData(page));

test("Maya triages the queue by keyboard, takes ownership without the rows moving, and replies", async ({
  page,
}) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/exceptions");
  await expectAccessible(page);
  const rows = page.locator("tbody tr");
  const before = await rows.evaluateAll((rs) => rs.map((r) => r.getAttribute("data-row-id")));
  // J opens the first item; Enter moves focus into the panel; Esc closes it.
  await page.locator("body").press("j");
  await expect(page.getByTestId("detail-panel")).toBeVisible();
  await expect(page).toHaveURL(/sel=/);
  await page.keyboard.press("Enter");
  await expect(page.locator("#detail-title")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("detail-panel")).toHaveCount(0);

  // Take ownership inline: the row updates in place and nothing moves under the pointer.
  const takeable = page.getByRole("button", { name: /^Take ownership\b/ }).first();
  const rowId = await takeable.locator("xpath=ancestor::tr").getAttribute("data-row-id");
  const box = await takeable.boundingBox();
  await takeable.click();
  await expect(page.getByTestId("live-region")).toHaveText("You own this now.");
  const row = page.locator(`tr[data-row-id="${rowId}"]`);
  await expect(row.getByText("You own this")).toBeVisible();
  const after = await rows.evaluateAll((rs) => rs.map((r) => r.getAttribute("data-row-id")));
  expect(after).toEqual(before);
  const box2 = await row.boundingBox();
  expect(Math.abs((box2?.y ?? 0) - (box?.y ?? 0))).toBeLessThan(40);

  // Reply to a household from the panel (R jumps to the reply box).
  await open(page, "/staff/exceptions?view=all&kind=message");
  await page.locator("tbody tr").first().locator("button").first().click();
  await expect(page.locator("#detail-reply")).toBeVisible();
  await page.locator("body").press("r");
  await expect(page.locator("#detail-reply")).toBeFocused();
  await page.locator("#detail-reply").fill("Thanks — I'll call this afternoon.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Reply sent to the household.");
});

test("Maya resolves an escalation with its context in the dialog", async ({ page }) => {
  await signInAs(page, "Maya Chen");
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
  const dialog = page.getByRole("dialog", { name: /Resolve this escalation\?|Take over/ });
  await expect(dialog).toContainText("Household");
  await expect(dialog).toContainText("Raised");
  await dialog.getByLabel("How was it resolved?").fill("Talked with the family; nothing further needed.");
  await expectAccessible(page);
  await dialog.getByRole("button", { name: /^(Resolve|Take over and resolve)$/ }).click();
  await expect(page.getByTestId("live-region")).toHaveText(/^Resolved/);
  await open(page, "/staff/exceptions?view=resolved");
  await expect(
    page
      .getByRole("list", { name: /Resolved in the last 14 days/ })
      .locator("li")
      .first(),
  ).toContainText("Resolved");
});

test("Priya activates a consent from Exceptions with confirmation, and follows a deep link", async ({
  page,
}) => {
  await signInAs(page, "Priya Raman");
  await open(page, "/staff/exceptions?view=all&kind=consent");
  const first = page.locator("tbody tr").first();
  if (/Nothing is open|No exceptions match/.test((await first.textContent()) ?? ""))
    test.skip(true, "No consent waiting in the seed");
  await first.locator("button").first().click();
  const panel = page.getByTestId("detail-panel");
  await panel.getByRole("button", { name: "Activate…" }).click();
  const dialog = page.getByRole("dialog", { name: "Activate this consent?" });
  for (const t of ["Recipient", "Purpose", "What's included", "Dates", "Confirmed"])
    await expect(dialog).toContainText(t);
  await dialog.getByRole("button", { name: "Activate consent" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Consent activated.");
  // A deep link to a consent opens its household tab and highlights it.
  await panel.getByRole("link", { name: "Open the full record" }).click();
  await expect(page).toHaveURL(/tab=sharing#consent-/);
  const id = new URL(page.url()).hash.slice(1);
  await expect(page.locator(`#${id}`)).toBeFocused();
});

test("Dana bulk-assigns two items, changes the reply time, views reports and exports the audit log", async ({
  page,
}) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/exceptions?view=all&kind=escalation&who=unassigned");
  const boxes = page.locator("tbody tr input[type=checkbox]");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  const bulk = page.getByRole("region", { name: "Bulk actions" });
  await expect(bulk).toContainText("2 selected");
  await bulk.getByLabel("Assign selected to").focus();
  await bulk.getByLabel("Assign selected to").selectOption({ label: "Maya Chen" });
  await bulk.getByRole("button", { name: "Assign…" }).click();
  const confirm = page.getByRole("dialog", { name: /Assign 2 items to Maya Chen\?/ });
  await expect(confirm.getByRole("listitem")).toHaveCount(2);
  // Assigning several needs a reason, which only staff see (decision 40's pattern).
  await confirm.getByLabel(/Reason/).fill("Maya is covering these today (synthetic).");
  await confirm.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Assigned 2 items.");

  // Reply time, reflected on the family's Messages page.
  await open(page, "/staff/settings");
  await page.getByLabel("Expected reply time").fill("within 4 working hours");
  await page
    .getByLabel("What families should expect")
    .fill("Your hospice reads routine messages on weekdays (synthetic).");
  await page.getByRole("button", { name: "Save as a new version" }).click();
  await expect(page.getByTestId("live-region")).toHaveText(/Saved as a new version/);

  await open(page, "/staff/reports?days=30");
  await expect(page.getByRole("link", { name: /Last 30 days/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Escalations raised", { exact: true })).toBeVisible();
  await expectAccessible(page);

  await open(page, "/staff/audit?days=30");
  await page.getByLabel("Who").selectOption({ label: "Dana Brooks" });
  await page.getByLabel("Search summaries").fill("escalation");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).not.toHaveURL(/escalation/); // search words never go in the URL
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  await page
    .getByRole("dialog", { name: "Export this audit log?" })
    .getByRole("button", { name: "Download CSV" })
    .click();
  await download;

  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/messages");
  await expect(page.getByTestId("reply-time")).toHaveText(
    "Your care team usually replies within 4 working hours.",
  );
});

test("Jordan's search finds nothing from Willow Creek, and Willow Creek deep links are denied", async ({
  page,
}) => {
  await signInAs(page, "Jordan Ellis");
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: /Search households/ });
  await expect(input).toBeFocused();
  for (const q of ["Okafor", "Rivera", "Brightwater"]) {
    await input.fill(q);
    await expect(page.getByText("Nothing matches in the households you can see.")).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await open(page, "/staff/households/hh-okafor/consents/cs-okafor-respite");
  await expect(page.getByRole("heading", { name: "This isn't available" })).toBeVisible();
  await open(page, "/staff/exceptions?view=all&sel=escalation%3Aes-rivera-identity");
  await expect(page.getByTestId("detail-panel")).toHaveCount(0);
});

for (const width of [1024, 1280, 1440]) {
  test(`staff layout at ${width}px: no sideways scroll, panel or drawer`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signInAs(page, "Dana Brooks");
    for (const url of [
      "/staff",
      "/staff/exceptions",
      "/staff/households/hh-okafor",
      "/staff/settings",
      "/staff/reports",
    ]) {
      await open(page, url);
      await expectNoSidewaysScroll(page);
    }
    await open(page, "/staff/exceptions");
    await page.locator("tbody tr").first().locator("button").first().click();
    if (width < 1200) await expect(page.getByRole("dialog", { name: "Item details" })).toBeVisible();
    else await expect(page.getByRole("complementary", { name: "Item details" })).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
}

test("iPad, comfortable: tap targets and no sideways scroll", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/exceptions");
  await expectNoSidewaysScroll(page);
  const h = await page
    .locator("tbody tr")
    .first()
    .locator("[data-row-action]")
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(44);
  await ctx.close();
});
