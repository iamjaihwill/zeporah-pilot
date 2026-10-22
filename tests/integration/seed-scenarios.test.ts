import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as sharing from "@/server/services/sharing";
import * as settings from "@/server/services/settings";
import * as s from "@/server/db/schema";
import { verifyAuditChain } from "@/server/audit";

/** The seeded demo states used by the founder-review walkthrough, read-only. */
let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => void (t = await freshDb()));
afterAll(() => t.close());

describe("seeded demo states", () => {
  it("dismissed correction: Ingrid sees only that it was reviewed with no change; the reason stays with staff", async () => {
    const ingrid = await t.as("fm-ingrid");
    const c = (await family.listHouseholdConsents(t.db, ingrid)).find((x) => x.id === "cs-lindqvist-circle")!;
    expect(c.correction).toBeNull();
    expect(c.lastDismissal?.at).toBeInstanceOf(Date);
    expect(c.canRequestCorrection).toBe(true); // nothing is held; she can ask again
    expect(JSON.stringify(await family.listHouseholdConsents(t.db, ingrid))).not.toMatch(
      /Checked with Ingrid/,
    );
    const [r] = await t.db
      .select()
      .from(s.consentCorrectionRequests)
      .where(eq(s.consentCorrectionRequests.id, "cr-lindqvist-circle"));
    expect(r).toMatchObject({ status: "resolved", outcome: "dismissed", resolvedByActorId: "st-tom" });
    const q = await staff.coordinationQueue(t.db, await t.as("st-tom"));
    expect(q.some((x) => x.kind === "correction" && x.householdId === "hh-lindqvist")).toBe(false);
  });

  it("amended consent: Ada sees version 2, what changed, and can confirm it", async () => {
    const c = await family.getConsentForMe(t.db, await t.as("fm-ada"), "cs-okafor-equipment");
    expect(c).toMatchObject({
      version: 2,
      stage: "awaiting_confirmation",
      changedInThisVersion: ["expiry"],
      canConfirm: true,
      confirmation: null, // version 1's confirmation is kept but doesn't count for version 2
    });
    expect((await family.familyHome(t.db, await t.as("fm-ada"))).sharing?.waitingForMe).toBe(1);
  });

  it("turned-off wording: Cedar Valley families see nothing; its history shows both versions", async () => {
    expect((await family.getThread(t.db, await t.as("cfm-ben", "t-cedar"))).expectation).toBeNull();
    const h = await settings.getMessageSettings(t.db, await t.as("cst-jordan", "t-cedar"));
    expect(h.current).toBeNull();
    expect(h.history.map((x) => [x.version, x.enabled])).toEqual([
      [2, false],
      [1, true],
    ]);
  });

  it("seeded escalations show the actions the live app records", async () => {
    const maya = await staff.coordinationQueue(t.db, await t.as("st-maya"));
    expect(
      maya.find((x) => x.kind === "escalation" && x.householdId === "hh-hart")?.lastAction,
    ).toMatchObject({
      actor: "Maya Chen",
      did: "took ownership",
    });
    const priya = await staff.coordinationQueue(t.db, await t.as("st-priya"));
    const owen = priya.find((x) => x.kind === "authority" && x.summary.startsWith("Owen"));
    // The latest action is Priya's seeded review; the conflict detection now sits earlier in the timeline.
    expect(owen?.lastAction).toMatchObject({ actor: "Priya Raman", did: "recorded a review" });
    const timeline = (await staff.householdOverview(t.db, await t.as("st-priya"), "hh-bennett")).audit;
    expect(timeline.some((a) => a.action === "authority.conflict_detected")).toBe(true);
  });

  it("leaves every existing release scenario and the audit chains intact", async () => {
    const dana = await t.as("st-dana");
    const expected: Record<string, string> = {
      "pk-okafor-respite": "RELEASE_ALLOWED",
      "pk-bennett-equipment": "AUTHORITY_CONFLICT",
      "pk-patel-chaplain": "AUTHORITY_REVIEW_PENDING",
      "pk-nguyen-meals": "CONSENT_REVOKED",
      "pk-nguyen-transport": "SCOPE_EMPTY",
      "pk-hart-pharmacy": "PACKET_EXPIRED",
      "pk-hart-benefits": "CONSENT_EXPIRED",
    };
    const previews = (await sharing.listPackets(t.db, dana)).filter((p) => p.id in expected);
    expect(Object.fromEntries(previews.map((p) => [p.id, p.preview.reasonCode]))).toEqual(expected);
    expect((await verifyAuditChain(t.db, "t-willow")).ok).toBe(true);
    expect((await verifyAuditChain(t.db, "t-cedar")).ok).toBe(true);
  });
});
