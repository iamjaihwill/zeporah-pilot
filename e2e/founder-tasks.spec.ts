import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs, signOutFromShell } from "./helpers";

/** Founder decisions 40 and 44: care guides bulk-assign care-team tasks; coordinators manage household tasks. */
test.beforeEach(async ({ page }) => resetData(page));

test("the coordinator adds a sensitive task, must choose who sees it, then edits and closes it", async ({
  page,
}) => {
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/tasks");
  await page.getByRole("button", { name: "Add a task" }).click();
  await page.getByLabel("What needs doing").fill("Sort out the spare room for the respite stay");
  await page.getByLabel("Who's doing it").selectOption({ label: "Chidi Okafor" });
  await page.getByRole("checkbox", { name: /This is sensitive/ }).check();
  // Nothing is chosen for them: saving waits for a choice.
  await expect(page.getByRole("button", { name: "Add task" })).toBeDisabled();
  await page.getByRole("radio", { name: /Only some people/ }).check();
  await page.getByRole("checkbox", { name: "Ada Okafor" }).check();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Task added.");
  const card = page.getByRole("listitem").filter({ hasText: "Sort out the spare room" });
  await expect(card).toContainText("Only some people can see this: also Ada");

  await card.getByRole("button", { name: /^Edit/ }).click();
  await page.getByLabel("Due (optional)").fill("2026-11-03");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Task saved.");
  await expect(card).toContainText("Due Tue, Nov 3");

  await card.getByRole("button", { name: /^Close…/ }).click();
  const dialog = page.getByRole("dialog", { name: /Close “Sort out the spare room/ });
  await expect(dialog.getByRole("button", { name: "Close task" })).toBeDisabled();
  await dialog.getByLabel("Why isn't it needed?").fill("A neighbour sorted it (synthetic).");
  await dialog.getByRole("button", { name: "Close task" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Task closed.");
  await page.getByText(/Done or closed/).click();
  await expect(page.getByText("Closed — not needed")).toBeVisible();
});

test("medical orders are refused with a pointer to the care team", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/tasks");
  await page.getByRole("button", { name: "Add a task" }).click();
  await page.getByLabel("What needs doing").fill("Give the evening dose of morphine");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(
    page.getByText(/Medical orders and legal steps go through your care team — message them/),
  ).toBeVisible();
});

test("the patient gets the task form too (decision 48b); other family members don't", async ({ page }) => {
  await signInAs(page, "Grace Okafor");
  await open(page, "/family/tasks");
  await expect(page.getByRole("button", { name: "Add a task" })).toBeVisible();
  await signOutFromShell(page);
  await signInAs(page, "Chidi Okafor");
  await open(page, "/family/tasks");
  await expect(page.getByRole("button", { name: "Add a task" })).toHaveCount(0);
});

test("a care guide previews, gives a reason and confirms a bulk reassignment", async ({ page }) => {
  await signInAs(page, "Maya Chen");
  await open(page, "/staff/tasks");
  await expect(page.getByRole("heading", { level: 1, name: "Care-team tasks" })).toBeVisible();
  for (const title of ["Confirm the equipment delivery window", "Check whether the benefits letters"])
    await page.getByRole("checkbox", { name: new RegExp(`^Select ${title}.*, The Hart household$`) }).check();
  await page.getByRole("button", { name: "Assign to…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Assign to").selectOption({ label: "Sofia Reyes" });
  await expect(dialog.getByTestId("bulk-task-preview")).toContainText("Already overdue");
  await expect(dialog.getByTestId("bulk-task-preview")).toContainText("Due within 2 days");
  await expect(dialog.getByRole("button", { name: "Assign", exact: true })).toBeDisabled();
  await expectAccessible(page);
  await dialog.getByLabel("Reason").fill("Covering while I'm on leave (synthetic).");
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Tasks assigned.");
  await expect(
    page.locator("tbody tr").filter({ hasText: "Check whether the benefits letters" }),
  ).toContainText("Sofia Reyes");
});
