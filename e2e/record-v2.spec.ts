import { expect, test } from "./fixtures";
import { expectAccessible, expectNoSidewaysScroll, open, resetData, signInAs } from "./helpers";

/** Coordination Record v2 (decision 58): timeline, context column, Who can see what, partner events. */
test.beforeEach(async ({ page }) => resetData(page));

test("a care guide reads the record, logs a simulated partner event, and checks who can see what", async ({
  page,
}) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor");
  // The timeline: exact times, each person with their role, and the record each event is about.
  const timeline = page.getByTestId("record-timeline");
  await expect(timeline.locator("li").first()).toContainText(
    /[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d\d [AP]M ET/,
  );
  await expect(timeline).toContainText("Care guide");
  // The context column beside it.
  const context = page.getByRole("complementary", { name: "Household context" });
  for (const heading of [
    "Who is involved",
    "Care team",
    "What has been agreed",
    "What has been shared",
    "Care-plan context",
  ])
    await expect(context.getByRole("heading", { name: heading })).toBeVisible();
  await expect(
    context.getByRole("heading", { name: /^What's waiting and who owns it \(\d+\)$/ }),
  ).toBeVisible();
  await expect(page.getByTestId("ehr-pointer")).toHaveText("000-SYN-4411 in the hospice's EHR.");
  await expectAccessible(page);

  // Decision 60: a partner event, staff-entered and labelled simulated.
  await page.getByRole("button", { name: "Log a partner event" }).click();
  const dialog = page.getByRole("dialog", { name: "Log a partner event" });
  await expect(dialog).toContainText("isn't sent anywhere");
  await dialog.getByLabel("Organization").fill("Brightwater Respite House (synthetic)");
  await dialog.getByLabel(/What they said/).fill("A bed is available on Tuesday (synthetic).");
  await dialog.getByRole("button", { name: "Add to the timeline" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Partner event added to the timeline.");
  const first = timeline.locator("li").first();
  await expect(first).toContainText("Partner event logged (simulated)");
  await expect(first).toContainText("Partner · simulated");
  await expect(first).toContainText("A bed is available on Tuesday (synthetic).");
  await page.getByRole("button", { name: "Partner events", exact: true }).click();
  await expect(timeline.locator("li")).toHaveCount(1);

  // Who can see what: generated from the rules, each cell opens to say why.
  await context.getByRole("link", { name: "Who can see what" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Who can see what" })).toBeVisible();
  const ada = page.getByTestId("access-row-fm-ada");
  await expect(ada).toContainText("Healthcare agent");
  const admins = page.getByTestId("access-row-role:hospice_admin");
  await admins.locator("summary").first().click();
  await expect(admins).toContainText("without opening household records");
  await expect(page.getByRole("heading", { name: "Outside recipients" })).toBeVisible();
  await expect(page.getByText(/Rosa Lin, Brightwater Respite House/)).toBeVisible();
  await expectAccessible(page);
});

test("the record and Who can see what fit an iPad and a phone", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  for (const [width, height] of [
    [820, 1180],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await open(page, "/staff/households/hh-okafor");
    await expect(page.getByRole("heading", { name: /^What's waiting/ }).first()).toBeVisible();
    await expectNoSidewaysScroll(page);
    await open(page, "/staff/households/hh-okafor/access");
    await expect(page.getByText("Ada Okafor").filter({ visible: true }).first()).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectAccessible(page);
  }
});

test("a reviewer can read the record but not log partner events; an administrator can't open the map", async ({
  page,
}) => {
  await signInAs(page, "Priya Raman");
  await open(page, "/staff/households/hh-okafor");
  await expect(page.getByTestId("record-timeline")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log a partner event" })).toHaveCount(0);
  await signInAs(page, "Lena Hoffman");
  await open(page, "/staff/households/hh-okafor/access");
  await expect(page.getByRole("heading", { name: "This isn't available" })).toBeVisible();
  await expect(page.getByText("Okafor")).toHaveCount(0);
});
