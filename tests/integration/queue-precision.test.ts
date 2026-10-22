import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as sharing from "@/server/services/sharing";
import * as s from "@/server/db/schema";
import { appendAudit } from "@/server/audit";

/** "Last action" names the event that explains each row — never a later, unrelated one. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const day = (n: number) => new Date(Date.now() + n * 86_400_000);
const queueFor = async (actor: string) => staff.coordinationQueue(t.db, await t.as(actor));

describe("queue last action", () => {
  it("correction rows use the correction request's own events", async () => {
    await family.requestConsentCorrection(t.db, await t.as("fm-grace"), {
      consentId: "cs-okafor-respite",
      version: 1,
      categories: ["dates"],
      detail: "",
    });
    // A later event on the same consent that has nothing to do with the request.
    await appendAudit(t.db, {
      tenantId: "t-willow",
      householdId: "hh-okafor",
      actorId: "st-maya",
      action: "consent.recorded",
      subjectType: "consent",
      subjectId: "cs-okafor-respite",
      summary: "Unrelated consent event (test).",
      visibility: "staff",
    });
    const row = (await queueFor("st-priya")).find(
      (r) => r.kind === "correction" && r.householdId === "hh-okafor",
    );
    expect(row?.lastAction).toMatchObject({ actor: "Grace Okafor", did: "asked for a correction" });
  });

  it("consent-activation rows show what made the consent ready, not later correction events", async () => {
    const { id } = await sharing.recordConsent(t.db, await t.as("st-maya"), {
      householdId: "hh-okafor",
      grantedByActorId: "fm-grace",
      purpose: "Arrange companion visits",
      recipientName: "Lakeside Companion Care (synthetic)",
      scope: ["contact_details"],
      startsAt: day(-1),
      expiresAt: day(20),
      revocationPath: "Withdraw any time in Zeporah.",
    });
    const grace = await t.as("fm-grace");
    await family.confirmConsent(t.db, grace, { consentId: id, version: 1 });
    await family.requestConsentCorrection(t.db, grace, {
      consentId: id,
      version: 1,
      categories: [],
      detail: "",
    });
    const [req] = await t.db
      .select()
      .from(s.consentCorrectionRequests)
      .where(eq(s.consentCorrectionRequests.consentId, id));
    await sharing.dismissConsentCorrection(t.db, await t.as("st-maya"), {
      requestId: req!.id,
      explanation: "No change needed (test).",
    });
    const row = (await queueFor("st-priya")).find(
      (r) => r.kind === "consent" && r.summary.includes("Lakeside"),
    );
    expect(row?.lastAction).toMatchObject({ actor: "Grace Okafor", did: "confirmed it" });
  });

  it("escalations the system opens show the event that opened them", async () => {
    const q = await queueFor("st-priya");
    const identity = q.find((r) => r.kind === "escalation" && r.householdId === "hh-rivera");
    expect(identity?.lastAction).toMatchObject({ actor: "Maya Chen", did: "opened an identity review" });
    const held = q.find((r) => r.kind === "escalation" && r.summary.startsWith("Consent held"));
    expect(held?.lastAction).toMatchObject({ actor: "Maya Chen", did: "recorded the consent" });
    // A family-raised escalation still uses its own events only.
    const hart = q.find((r) => r.kind === "escalation" && r.householdId === "hh-hart");
    expect(hart?.lastAction).toMatchObject({ actor: "Maya Chen", did: "took ownership" });
  });

  it("shows the seeded Bennett escalation consistently as taken by Priya", async () => {
    const bennett = (await queueFor("st-priya")).find(
      (r) => r.kind === "escalation" && r.householdId === "hh-bennett",
    );
    expect(bennett).toMatchObject({
      owner: "Priya Raman",
      state: "Taken — still open",
      next: "Review both records with the family",
      priority: "normal", // the current pilot rule, unchanged
    });
    expect(bennett?.lastAction?.actor).toBe("Priya Raman");
  });
});
