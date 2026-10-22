import { expect, test } from "./fixtures";
import { expectAccessible, nav, open, resetData, signInAs, signOutFromShell } from "./helpers";
import { supportConfirmation } from "../src/domain/claims";

test.beforeEach(async ({ page }) => resetData(page));

test("Willow staff can't read Cedar records by URL, and see nothing about them", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  for (const url of ["/staff/packets/cpk-moss-transport", "/staff/households/chh-moss"]) {
    await open(page, url);
    await expect(page.getByRole("heading", { name: "This isn't available" })).toBeVisible();
    await expect(page.getByText("OUT_OF_SCOPE")).toBeVisible();
    await expect(page.getByText(/Moss|Valley Rides/)).toHaveCount(0);
  }
});

test("a household persona opening staff URLs is sent back to the household app", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  for (const url of [
    "/staff",
    "/staff/packets/pk-okafor-respite",
    "/staff/households/hh-okafor?tab=sharing",
    "/staff/policy",
    "/staff/reviews",
  ]) {
    await open(page, url);
    await expect(page, url).toHaveURL(/\/family$/);
    await expect(page.getByRole("button", { name: "Request release" })).toHaveCount(0);
    await expect(page.getByText("Care team only")).toHaveCount(0);
  }
});

test("support says exactly what a request does, and the removed control is gone", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/support");
  await expect(page.getByText("Pause suggestions")).toHaveCount(0);
  await expect(page.getByText(/will reach out/)).toHaveCount(0);
  await page.getByRole("button", { name: "Send the request" }).click();
  // Founder decision 26: names the 24-hour line and, where set, the hospice's reply time.
  await expect(page.getByTestId("live-region")).toHaveText(
    supportConfirmation("555-0100 (synthetic 24-hour line)", "within 1 business day"),
  );
  // "Your requests" shows it with the family wording (item 6), never "Escalation created".
  await expect(page.getByTestId("your-requests").getByText("Sent to your care team").first()).toBeVisible();
  await expect(page.getByText("Escalation created")).toHaveCount(0);
  await expectAccessible(page);
});

test("the policy board labels evaluator-only rows and shows the runtime answer", async ({ page }) => {
  await signInAs(page, "Dana Brooks");
  await open(page, "/staff/policy");
  const cedar = page.getByRole("row").filter({ hasText: "Someone at Cedar Valley Hospice" });
  await expect(cedar).toContainText("OUT_OF_SCOPE");
  await expect(cedar).toContainText("Runtime");
  const sim = page.getByRole("row").filter({ hasText: "evaluator-only simulation" });
  await expect(sim).toContainText("TENANT_MISMATCH");
  await expect(sim).toContainText("Evaluator only — not what the app returns");
  await expectAccessible(page);
});

test("a refusal says it's about access, once, and its server call isn't a 200", async ({ page }) => {
  // Dana opens Audit review in the browser: its data comes from server-function calls.
  await signInAs(page, "Dana Brooks");
  const calls: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/_serverFn") && r.request().method() === "GET" && r.status() === 200)
      calls.push(r.url());
  });
  await nav(page, "Audit review").click();
  await expect(page.getByRole("heading", { level: 1, name: "Audit review" })).toBeVisible();
  expect(calls.length).toBeGreaterThan(0);
  await signOutFromShell(page);

  // Replayed by a care guide, the audit call is refused with 403 — not a 200 carrying an error.
  await signInAs(page, "Maya Chen");
  const statuses = await Promise.all(calls.map(async (u) => (await page.request.get(u)).status()));
  expect(statuses).toContain(403);
  expect(statuses.every((x) => x === 200 || x === 403)).toBe(true);

  // And the page says it's about access — once, with no "something went wrong".
  await open(page, "/staff/audit");
  const denied = page.getByTestId("access-denied");
  await expect(denied).toBeVisible();
  await expect(denied.getByText(/This isn't part of what your role can see/)).toHaveCount(1);
  await expect(page.getByTestId("unexpected-error")).toHaveCount(0);
  await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
});
