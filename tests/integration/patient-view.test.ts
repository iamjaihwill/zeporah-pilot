import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as patient from "@/server/services/patient";
import * as s from "@/server/db/schema";

/** Founder decision 46: the patient's own view, and nothing internal. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

describe("the patient's own view", () => {
  it("covers wishes, people, care team, milestones, tasks, sharing and packets", async () => {
    const v = await patient.patientView(t.db, await t.as("fm-grace"));
    expect(v.wishes.whatMatters).toMatch(/Keep Grace at home/);
    expect(v.people.map((p) => p.name)).toEqual(
      expect.arrayContaining(["Daniel Okafor", "Ada Okafor", "Chidi Okafor"]),
    );
    expect(v.careTeam.guides).toEqual(["Maya Chen"]);
    expect(v.careTeam.hotline).toMatch(/555-0100/);
    expect(v.milestones.some((m) => m.what.startsWith("Visits:"))).toBe(true);
    expect(v.sharing.some((c) => c.recipient.includes("Brightwater"))).toBe(true);
    expect(v.packets.some((p) => p.recipient.includes("Brightwater"))).toBe(true);
  });

  it("never carries staff notes, priorities, triage reasoning, staff ownership or reason codes", async () => {
    const v = JSON.stringify(await patient.patientView(t.db, await t.as("fm-grace")));
    const notes = await t.db.select().from(s.staffNotes).where(eq(s.staffNotes.householdId, "hh-okafor"));
    for (const n of notes) expect(v).not.toContain(n.body.slice(0, 30));
    expect(v).not.toMatch(/priority|ownerActorId|reasonCode|CONSENT_|AUTHORITY_|PACKET_|SCOPE_|escalation/i);
  });

  it("is for the patient only", async () => {
    for (const who of ["fm-daniel", "fm-ada", "fm-chidi"])
      await expect(patient.patientView(t.db, await t.as(who))).rejects.toMatchObject({
        code: "NOT_PERMITTED",
      });
    await expect(patient.patientView(t.db, await t.as("st-maya"))).rejects.toThrow();
  });

  it("private notes are the patient's alone, and their text never reaches the audit log", async () => {
    await patient.addPrivateNote(t.db, await t.as("fm-grace"), {
      body: "I'd like the window open in the mornings (synthetic).",
    });
    const v = await patient.patientView(t.db, await t.as("fm-grace"));
    expect(v.notes.map((n) => n.body)).toEqual(["I'd like the window open in the mornings (synthetic)."]);
    const events = await t.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.action, "private_note.saved"));
    expect(JSON.stringify(events)).not.toContain("window open");
    await expect(patient.addPrivateNote(t.db, await t.as("fm-daniel"), { body: "x" })).rejects.toMatchObject({
      code: "NOT_PERMITTED",
    });
    await expect(
      patient.editPrivateNote(t.db, await t.as("fm-daniel"), { id: v.notes[0]!.id, body: "x" }),
    ).rejects.toMatchObject({ code: "NOT_PERMITTED" });
  });
});
