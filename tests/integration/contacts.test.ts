import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as contacts from "@/server/services/contacts";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";

/** Listed contacts (founder decisions 74–78), with synthetic people only. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const doula = {
  name: "Sam Rivers",
  relationship: "death_doula" as const,
  phone: "555-555-0161",
  note: "Vigil planning",
};
const names = async (who: string, householdId?: string) =>
  (await contacts.listContacts(t.db, await t.as(who), householdId)).contacts.map((c) => c.name);
const count = async (table: typeof s.memberships | typeof s.invitations | typeof s.notifications) =>
  (await t.db.select().from(table)).length;

describe("listing a contact (decision 74)", () => {
  it("shows them to the household and the care team, and gives them nothing", async () => {
    const before = [await count(s.memberships), await count(s.invitations), await count(s.notifications)];
    await contacts.addContact(t.db, await t.as("fm-daniel"), doula);
    for (const who of ["fm-daniel", "fm-grace", "fm-chidi", "fm-ada"])
      expect(await names(who)).toEqual(["Sam Rivers"]);
    for (const who of ["st-maya", "st-dana", "st-priya"])
      expect(await names(who, "hh-okafor")).toEqual(["Sam Rivers"]);
    // No account, invitation or notification comes from a listing.
    expect([await count(s.memberships), await count(s.invitations), await count(s.notifications)]).toEqual(
      before,
    );
  });

  it("keeps each household's and each hospice's list to itself", async () => {
    await contacts.addContact(t.db, await t.as("fm-daniel"), doula);
    expect(await names("fm-claire")).toEqual([]);
    await expect(contacts.listContacts(t.db, await t.as("st-tom"), "hh-okafor")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    await expect(contacts.listContacts(t.db, await t.as("cst-jordan"), "hh-okafor")).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
  });
});

describe("who manages the list (decision 75)", () => {
  it("is the patient, the coordinator, the care guide and operations", async () => {
    await contacts.addContact(t.db, await t.as("fm-grace"), { ...doula, name: "From Grace" });
    await contacts.addContact(t.db, await t.as("fm-daniel"), { ...doula, name: "From Daniel" });
    await contacts.addContact(t.db, await t.as("st-maya"), {
      ...doula,
      name: "From Maya",
      householdId: "hh-okafor",
    });
    await contacts.addContact(t.db, await t.as("st-dana"), {
      ...doula,
      name: "From Dana",
      householdId: "hh-okafor",
    });
    expect(await names("fm-chidi")).toEqual(["From Dana", "From Daniel", "From Grace", "From Maya"]);
  });

  it("isn't other family members, proxies or reviewers", async () => {
    for (const who of ["fm-chidi", "fm-ada"])
      await expect(contacts.addContact(t.db, await t.as(who), doula)).rejects.toMatchObject({
        code: "NOT_PERMITTED",
      });
    await expect(
      contacts.addContact(t.db, await t.as("st-priya"), { ...doula, householdId: "hh-okafor" }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });

  it("updates and removes, keeping the row as removed", async () => {
    const daniel = await t.as("fm-daniel");
    const { id } = await contacts.addContact(t.db, daniel, doula);
    await contacts.updateContact(t.db, daniel, {
      ...doula,
      id,
      organization: "Riverside Doulas (synthetic)",
    });
    expect((await contacts.listContacts(t.db, daniel)).contacts[0]?.organization).toBe(
      "Riverside Doulas (synthetic)",
    );
    await contacts.removeContact(t.db, await t.as("st-maya"), { id, householdId: "hh-okafor" });
    expect(await names("fm-daniel")).toEqual([]);
    const [row] = await t.db.select().from(s.householdContacts).where(eq(s.householdContacts.id, id));
    expect(row?.removedAt).not.toBeNull();
  });
});

describe("patient-private contacts (decision 76)", () => {
  it("are seen only by the patient and the care team, and changed only by the patient", async () => {
    const grace = await t.as("fm-grace");
    const { id } = await contacts.addContact(t.db, grace, {
      ...doula,
      name: "Pastor Lee",
      relationship: "faith_leader",
      patientPrivate: true,
    });
    expect(await names("fm-grace")).toEqual(["Pastor Lee"]);
    for (const who of ["fm-daniel", "fm-chidi", "fm-ada"]) expect(await names(who)).toEqual([]);
    const staffView = await contacts.listContacts(t.db, await t.as("st-maya"), "hh-okafor");
    expect(staffView.contacts).toMatchObject([{ name: "Pastor Lee", patientPrivate: true, canEdit: false }]);
    // The coordinator can't even find it; the care guide can see it but not change it.
    await expect(contacts.removeContact(t.db, await t.as("fm-daniel"), { id })).rejects.toMatchObject({
      code: "OUT_OF_SCOPE",
    });
    await expect(
      contacts.updateContact(t.db, await t.as("st-maya"), { ...doula, id, householdId: "hh-okafor" }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    await contacts.removeContact(t.db, grace, { id });
    expect(await names("fm-grace")).toEqual([]);
  });

  it("can be made private only by the patient", async () => {
    await expect(
      contacts.addContact(t.db, await t.as("fm-daniel"), { ...doula, patientPrivate: true }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
    const { id } = await contacts.addContact(t.db, await t.as("fm-daniel"), doula);
    await expect(
      contacts.updateContact(t.db, await t.as("st-maya"), {
        ...doula,
        id,
        householdId: "hh-okafor",
        patientPrivate: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });

  it("keeps a private contact out of the household's activity", async () => {
    const { id } = await contacts.addContact(t.db, await t.as("fm-grace"), {
      ...doula,
      patientPrivate: true,
    });
    const { id: shared } = await contacts.addContact(t.db, await t.as("fm-daniel"), {
      ...doula,
      name: "Shared",
    });
    const events = await t.db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "contact.added"));
    expect(events.find((e) => e.subjectId === id)?.visibility).toBe("staff");
    expect(events.find((e) => e.subjectId === shared)?.visibility).toBe("family");
    // Summaries name the kind of contact, never the person.
    expect(events.every((e) => !e.summary.includes("Sam Rivers") && !e.summary.includes("Shared"))).toBe(
      true,
    );
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
  });
});

describe("what a contact holds (decision 77)", () => {
  it("refuses an empty name, an unknown relationship, a bad phone number or email", async () => {
    const daniel = await t.as("fm-daniel");
    await expect(contacts.addContact(t.db, daniel, { ...doula, name: "  " })).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(
      contacts.addContact(t.db, daniel, { ...doula, relationship: "lawyer" as never }),
    ).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(contacts.addContact(t.db, daniel, { ...doula, phone: "call me" })).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(
      contacts.addContact(t.db, daniel, { ...doula, email: "not-an-email" }),
    ).rejects.toMatchObject({
      code: "INVALID",
    });
  });
});
