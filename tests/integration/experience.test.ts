import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import * as family from "@/server/services/family";
import * as staff from "@/server/services/staff";
import * as sharing from "@/server/services/sharing";
import { NO_OWNER, PRIORITIES } from "@/domain/queue";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => void (t = await freshDb()));
afterEach(() => t.close());

const day = (n: number) => new Date(Date.now() + n * 86_400_000);

describe("staff coordination queue", () => {
  it("orders by stated priority, then longest waiting, and every row is complete", async () => {
    const q = await staff.coordinationQueue(t.db, await t.as("st-priya"));
    const rank = q.map((x) => PRIORITIES.indexOf(x.priority));
    expect(rank).toEqual([...rank].sort((a, b) => a - b));
    expect(q[0]!.priority).toBe("high");
    for (const p of PRIORITIES) {
      const times = q.filter((x) => x.priority === p).map((x) => x.since.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
    for (const r of q) {
      expect(r.state, r.kind).toBeTruthy();
      expect(r.next, r.kind).toBeTruthy();
      expect(r.age, r.kind).toMatch(/hour|day|week/);
      expect(r.priorityReason, r.kind).toBeTruthy();
      expect(r.owner === null || r.owner.length > 0, r.kind).toBe(true);
    }
    expect(NO_OWNER).toBe("No owner assigned");
  });

  it("includes unresolved holder identity and confirmed consents for reviewers only", async () => {
    await sharing.submitEvidence(t.db, await t.as("st-maya"), {
      householdId: "hh-okafor",
      holderName: "A. Okafor",
      holderActorId: null,
      authorityType: "healthcare_agent",
      documentLabel: "Copy with initials only (synthetic)",
    });
    const { id } = await sharing.recordConsent(t.db, await t.as("st-maya"), {
      householdId: "hh-okafor",
      grantedByActorId: "fm-grace",
      purpose: "Arrange companion visits",
      recipientName: "Lakeside Companion Care (synthetic)",
      scope: ["contact_details"],
      startsAt: day(-1),
      expiresAt: day(20),
      revocationPath: "Withdraw any time in Zeporah under Sharing.",
    });
    await family.confirmConsent(t.db, await t.as("fm-grace"), { consentId: id, version: 1 });

    const priya = await staff.coordinationQueue(t.db, await t.as("st-priya"));
    expect(
      priya.some(
        (x) => x.kind === "authority" && /identity unresolved/.test(x.state) && x.priority === "high",
      ),
    ).toBe(true);
    expect(priya.find((x) => x.kind === "consent")).toMatchObject({
      summary: expect.stringMatching(/Lakeside/),
      state: expect.stringMatching(/waiting for activation/),
      next: "Activate it",
    });

    for (const who of ["st-dana", "st-maya"]) {
      const q = await staff.coordinationQueue(t.db, await t.as(who));
      expect(
        q.some((x) => x.kind === "authority" || x.kind === "consent"),
        who,
      ).toBe(false);
    }
  });

  it("tells the dashboard which counts each role can act on", async () => {
    const priya = await staff.staffHome(t.db, await t.as("st-priya"));
    expect(priya).toMatchObject({ canReview: true, canActivate: true });
    const dana = await staff.staffHome(t.db, await t.as("st-dana"));
    expect(dana).toMatchObject({ canReview: false, canActivate: false, canConfirmTransitions: true });
    expect(dana.counts.authority).toBe(0);
    const maya = await staff.staffHome(t.db, await t.as("st-maya"));
    expect(maya).toMatchObject({ canReview: false, canActivate: false, canConfirmTransitions: false });
  });
});

describe("household messages and help", () => {
  it("names exactly who can read the care-guide thread", async () => {
    const thread = await family.getThread(t.db, await t.as("fm-daniel"));
    expect(new Set(thread.audience)).toEqual(new Set(["Grace Okafor", "Daniel Okafor", "Ada Okafor"]));
    expect(thread.audience).not.toContain("Chidi Okafor");
    const chidi = await family.getThread(t.db, await t.as("fm-chidi"));
    expect(chidi.audience).toEqual([]);
  });

  it("shows each hospice's own 24-hour line", async () => {
    expect((await family.familyHome(t.db, await t.as("fm-daniel"))).hotline).toMatch(/^555-0100/);
    expect((await family.getSupport(t.db, await t.as("fm-daniel"))).hotline).toMatch(/^555-0100/);
    expect((await family.familyHome(t.db, await t.as("cfm-ben"))).hotline).toMatch(/^555-0199/);
  });
});
