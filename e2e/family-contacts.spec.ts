import { expect, test } from "./fixtures";
import { expectAccessible, open, resetData, signInAs, signOutFromShell } from "./helpers";

/** Listed contacts (founder decisions 74–78): a household's other supporters, with synthetic people. */
test.beforeEach(async ({ page }) => resetData(page));

const contacts = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Other people who help" });

test("a coordinator lists a doula and can start an invitation from them", async ({ page }) => {
  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/people");
  const card = contacts(page);
  await expect(card).toContainText("Listing someone doesn't give them an account");
  await card.getByRole("button", { name: "Add someone" }).click();
  await card.getByLabel("Their name").fill("Sam Rivers (synthetic)");
  await card.getByLabel("How they're involved").selectOption({ label: "Death doula" });
  await card.getByLabel("Email (optional)").fill("sam.rivers@example.invalid");
  // Only the patient can keep a contact private (decision 76).
  await expect(card.getByRole("checkbox")).toHaveCount(0);
  await expectAccessible(page);
  await card.getByRole("button", { name: "Add to the list" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Sam Rivers (synthetic) was added to the list.");
  await expect(card).toContainText("Death doula");

  // Decision 78: an invitation starts from the contact, filled in; nothing is sent yet.
  await card.getByRole("button", { name: "Invite them to help…" }).click();
  await expect(page.getByLabel("Their name").first()).toHaveValue("Sam Rivers (synthetic)");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("sam.rivers@example.invalid");
  await expectAccessible(page);
});

test("the patient keeps a contact private: the coordinator can't see it", async ({ page }) => {
  await signInAs(page, "Grace Okafor");
  await open(page, "/family/people");
  const card = contacts(page);
  await card.getByRole("button", { name: "Add someone" }).click();
  await card.getByLabel("Their name").fill("Pastor Lee (synthetic)");
  await card.getByLabel("How they're involved").selectOption({ label: "Faith or spiritual leader" });
  await card.getByRole("checkbox", { name: "Only me and the care team can see this contact" }).check();
  await card.getByRole("button", { name: "Add to the list" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Pastor Lee (synthetic) was added to the list.");
  await expect(card).toContainText("Only you and the care team");
  await expectAccessible(page);
  await signOutFromShell(page);

  await signInAs(page, "Daniel Okafor");
  await open(page, "/family/people");
  await expect(contacts(page)).toContainText("No one listed yet.");
  await expect(page.getByText("Pastor Lee (synthetic)")).toHaveCount(0);
});

test("the care team sees the household's contacts, private ones marked", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "the staff household record is a desktop and tablet page");
  await signInAs(page, "Grace Okafor");
  await open(page, "/family/people");
  const card = contacts(page);
  await card.getByRole("button", { name: "Add someone" }).click();
  await card.getByLabel("Their name").fill("Pastor Lee (synthetic)");
  await card.getByLabel("How they're involved").selectOption({ label: "Faith or spiritual leader" });
  await card.getByRole("checkbox", { name: "Only me and the care team can see this contact" }).check();
  await card.getByRole("button", { name: "Add to the list" }).click();
  await expect(page.getByTestId("live-region")).toHaveText("Pastor Lee (synthetic) was added to the list.");
  await signOutFromShell(page);

  await signInAs(page, "Maya Chen");
  await open(page, "/staff/households/hh-okafor");
  const listed = page.getByRole("region", { name: "Listed contacts" });
  await expect(listed).toContainText("Pastor Lee (synthetic)");
  await expect(listed).toContainText("Private to the patient");
  // Only the patient changes a private contact.
  await expect(listed.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expectAccessible(page);
});
