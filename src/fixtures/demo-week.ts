/**
 * The enterprise demo week for the Okafor household (docs/enterprise-demo-map.md, plan story F-5).
 * Two snapshots on top of the standard synthetic seed, reachable only from the development reset:
 *
 * - `demo_midweek`: "now" is Day 4, 9 AM. Days 1–3 are history; the live demo starts here
 *   (Ada's confirmation, Rosa opening the packet, planning Maya's absence).
 * - `demo_endweek`: "now" is Day 7, 9 AM. Everything through Day 6 has happened, for the audit
 *   and return beats.
 *
 * Everything is synthetic. Partner events are staff-entered and labelled simulated (decision 58);
 * nothing here is clinical. The standard seed is untouched when no snapshot is chosen.
 */
import { familyDateTime } from "@/domain/dates";
import { CONSENT_CONFIRMATION_METHOD, CONSENT_CONFIRMATION_STATEMENT } from "@/domain/consent";
import { PILOT_DISPLAY } from "@/domain/display-config";
import type { buildFixtures } from "./synthetic";

export const SEED_SNAPSHOTS = ["standard", "demo_midweek", "demo_endweek"] as const;
export type SeedSnapshot = (typeof SEED_SNAPSHOTS)[number];
export const SEED_SNAPSHOT_LABELS: Record<SeedSnapshot, string> = {
  standard: "Standard synthetic data",
  demo_midweek: "Demo week: mid-week (Day 4)",
  demo_endweek: "Demo week: end of week (Day 7)",
};

type Fixtures = ReturnType<typeof buildFixtures>;

/**
 * Synthetic prepared drafts for named demo moments (decision 58, workstream 5), offered only while
 * a demo snapshot is loaded. Written by hand for the demo; no model produced them.
 */
export const DEMO_DRAFTS: Record<string, { message: string; handoffNote: string; manifest: string[] }> = {
  "hh-okafor": {
    message:
      "Hi Ada and Daniel, Brightwater has a bed on Tuesday. I'll arrange transport and share only your contact details and the visit schedule with them. I'll confirm the time by Friday. (synthetic)",
    handoffNote:
      "Respite stay is booked for Tuesday; transport still to arrange (task due Friday). Daniel prefers a call after 5 PM. (synthetic)",
    manifest: ["contact_details", "visit_schedule"],
  },
};
type Row = Record<string, unknown>;

const W = "t-willow";
const HH = "hh-okafor";
const BRIGHTWATER = "Brightwater Respite House (synthetic)";
const OAKWOOD = "Oakwood Home Medical Supply (synthetic)";
/** The key the Access-ending exception will use for this packet's outside access (spec 1.3). */
export const RESPITE_ACCESS_KEY = "access_ending:packet:pk-okafor-respite";

export function applyDemoWeek(f: Fixtures, now: Date, snapshot: Exclude<SeedSnapshot, "standard">) {
  const today = snapshot === "demo_midweek" ? 4 : 7;
  // Today is Day `today`, and times are wall-clock times in the pilot's time zone, so "6 PM" in the
  // demo map reads as 6:00 PM on screen.
  // Before 9 AM, "today at 9" is still ahead, so the story's "now" is yesterday at 9: everything it
  // says has happened, has.
  const nineAm = nineToday(now);
  const nine = nineAm.getTime() > now.getTime() ? new Date(nineAm.getTime() - 24 * 3_600_000) : nineAm;
  /** A time on day `day` of the demo week, at `hour`:`minute` Eastern. */
  const at = (day: number, hour: number, minute = 0) =>
    new Date(nine.getTime() + ((day - today) * 24 + hour - 9) * 3_600_000 + minute * 60_000);
  const end = snapshot === "demo_endweek";
  // Maya's leave starts "tomorrow at 8 AM" (Day 5). Seeded before 9 AM, the story's "now" is
  // yesterday at 9, so between 8 and 9 AM that start has already passed in real time; midweek it
  // then starts an hour from now, so it's still ahead. At week's end it has started either way.
  const awayFrom =
    !end && at(5, 8).getTime() <= now.getTime() ? new Date(now.getTime() + 3_600_000) : at(5, 8);
  const ev = (when: Date, e: Row) => f.history.push({ at: when, e: { tenantId: W, householdId: HH, ...e } });
  const find = (rows: Row[], pred: (r: Row) => boolean, what: string) => {
    const r = rows.find(pred);
    if (!r) throw new Error(`Demo week: ${what} is missing from the standard seed.`);
    return r;
  };

  // ---------------------------------------------------------------- Day 0–1: a reply that waited
  const adaMsg = find(
    f.messages,
    (m) => m["householdId"] === HH && m["authorActorId"] === "fm-ada",
    "Ada's message",
  );
  adaMsg["createdAt"] = at(0, 7);
  find(
    f.history,
    (x) => (x.e as Row)["action"] === "message.sent" && (x.e as Row)["subjectId"] === adaMsg["id"],
    "Ada's message event",
  ).at = at(0, 7);
  f.messages.push({
    id: "ms-demo-reply",
    tenantId: W,
    threadId: `th-${HH}`,
    householdId: HH,
    authorActorId: "st-maya",
    authorSide: "staff",
    body: "Brightwater will need the household's contact details and the visit schedule, nothing else. I'll share only those once everything's ready, and I'll let you know when it's done.",
    createdAt: at(1, 9, 5),
  });
  ev(at(1, 9, 5), {
    actorId: "st-maya",
    action: "message.sent",
    subjectType: "message",
    subjectId: "ms-demo-reply",
    summary: "The care guide replied in the household's messages.",
    visibility: "family",
    prepared: true,
  });

  // Maya's planned absence, recorded on Day 1 for Days 5–6.
  f.staffAbsences.push({
    id: "ab-demo-maya",
    tenantId: W,
    actorId: "st-maya",
    startsAt: awayFrom,
    endsAt: at(6, 18),
    reason: "Annual leave (synthetic)",
    createdByActorId: "st-dana",
    createdAt: at(1, 8, 30),
  });
  ev(at(1, 8, 30), {
    householdId: null,
    actorId: "st-dana",
    action: "absence.recorded",
    subjectType: "staff_absence",
    subjectId: "ab-demo-maya",
    summary: "A planned absence was recorded for Maya Chen.",
    visibility: "staff",
    reason: "Annual leave (synthetic)",
  });

  // ---------------------------------------------------------------- Day 1: the respite release
  const respite = find(f.packets, (p) => p["id"] === "pk-okafor-respite", "the respite packet");
  Object.assign(respite, {
    state: "released",
    lastReasonCode: "RELEASE_ALLOWED",
    expiresAt: at(5, 18),
    createdAt: at(0, 15),
    updatedAt: at(1, 11),
  });
  find(
    f.history,
    (x) => (x.e as Row)["action"] === "packet.drafted" && (x.e as Row)["subjectId"] === "pk-okafor-respite",
    "the respite draft event",
  ).at = at(0, 15);
  ev(at(1, 10, 55), {
    actorId: "st-dana",
    action: "packet.recipient_contact_set",
    subjectType: "packet",
    subjectId: "pk-okafor-respite",
    summary: "The named recipient at Brightwater was confirmed for this packet.",
    visibility: "staff",
  });
  ev(at(1, 11), {
    actorId: "st-dana",
    action: "packet.released",
    subjectType: "packet",
    subjectId: "pk-okafor-respite",
    decision: "allow",
    reasonCode: "RELEASE_ALLOWED",
    summary: `Release to ${BRIGHTWATER} for: Coordinate a short respite stay. Released in Zeporah. Nothing was delivered outside Zeporah.`,
    visibility: "sharing",
    context: { alerted: true, manifest: ["contact_details", "visit_schedule"] },
  });
  ev(at(1, 11), {
    actorId: "st-dana",
    action: "packet.recipient_access_granted",
    subjectType: "packet",
    subjectId: "pk-okafor-respite",
    summary: "The named recipient can read this packet in Zeporah, read-only, until it expires.",
    visibility: "sharing",
    context: { recipientActorId: "rc-rosa", expiresAt: at(5, 18).toISOString(), alerted: true },
  });
  f.packetReleaseReceipts.push({
    id: "rcpt-demo-respite",
    tenantId: W,
    packetId: "pk-okafor-respite",
    releasedByActorId: "st-dana",
    releasedAt: at(1, 11),
    recipientName: BRIGHTWATER,
    purpose: "Coordinate a short respite stay",
    manifest: ["contact_details", "visit_schedule"],
    expiresAt: at(5, 18),
  });
  f.packetRecipientAccess.push({
    tenantId: W,
    packetId: "pk-okafor-respite",
    receiptId: "rcpt-demo-respite",
    recipientActorId: "rc-rosa",
    grantedAt: at(1, 11),
    expiresAt: at(5, 18),
  });

  // ---------------------------------------------------------------- Day 2: Oakwood asks
  f.partnerEvents.push({
    id: "pe-demo-oakwood",
    tenantId: W,
    householdId: HH,
    organizationLabel: OAKWOOD,
    kind: "request",
    summary: "Asked for the household's delivery contact for the hospital-bed delivery.",
    occurredAt: at(2, 10, 5),
    enteredByActorId: "st-maya",
    source: "staff_entered",
    simulated: true,
    createdAt: at(2, 10, 15),
  });
  ev(at(2, 10, 15), {
    actorId: "st-maya",
    action: "partner_event.logged",
    subjectType: "partner_event",
    subjectId: "pe-demo-oakwood",
    summary: `Maya Chen logged a simulated request from ${OAKWOOD}.`,
    visibility: "staff",
    source: "partner_simulated",
    context: { simulated: true, kind: "request" },
  });

  // ---------------------------------------------------------------- Day 3: next steps, a bed, a task
  const nextSteps = find(f.familyUpdates, (u) => u["id"] === "up-okafor-2", "the respite update");
  Object.assign(nextSteps, { requiresAck: true, createdAt: at(3, 8, 45) });
  find(
    f.history,
    (x) => (x.e as Row)["action"] === "update.posted" && (x.e as Row)["subjectId"] === "up-okafor-2",
    "the respite update event",
  ).at = at(3, 8, 45);
  f.partnerEvents.push({
    id: "pe-demo-brightwater-bed",
    tenantId: W,
    householdId: HH,
    organizationLabel: BRIGHTWATER,
    kind: "status",
    summary: "A bed is available on Tuesday next week.",
    occurredAt: at(3, 14, 50),
    enteredByActorId: "st-maya",
    source: "staff_entered",
    packetId: "pk-okafor-respite",
    simulated: true,
    createdAt: at(3, 15),
  });
  ev(at(3, 15), {
    actorId: "st-maya",
    action: "partner_event.logged",
    subjectType: "partner_event",
    subjectId: "pe-demo-brightwater-bed",
    summary: `Maya Chen logged a simulated status from ${BRIGHTWATER}.`,
    visibility: "staff",
    source: "partner_simulated",
    context: { simulated: true, kind: "status" },
  });
  f.tasks.push({
    id: "tk-demo-transport",
    tenantId: W,
    householdId: HH,
    title: "Book transport for the respite stay",
    detail: "Brightwater has a bed on Tuesday. Confirm a time with Daniel.",
    audience: "staff",
    assigneeActorId: "st-maya",
    ownerActorId: "st-maya",
    status: end ? "done" : "open",
    dueAt: at(5, 12),
    createdByActorId: "st-maya",
    updatedAt: end ? at(5, 10) : at(3, 15, 5),
    source: "care_team",
    createdAt: at(3, 15, 5),
    ...(end ? { completedAt: at(5, 10), completedByActorId: "st-sofia" } : {}),
  });
  ev(at(3, 15, 5), {
    actorId: "st-maya",
    action: "task.created",
    subjectType: "task",
    subjectId: "tk-demo-transport",
    summary: "A care-team task was added: “Book transport for the respite stay”.",
    visibility: "staff",
  });

  if (!end) return sortHistory(f);

  // ---------------------------------------------------------------- Day 4: confirmation, cover, Rosa
  ev(at(4, 9, 5), {
    actorId: "st-dana",
    action: "handoff.offered",
    subjectType: "handoff",
    subjectId: "ho-demo-okafor",
    summary: "Cover for a household was offered to Sofia Reyes while Maya Chen is away.",
    visibility: "staff",
    // Dana used the prepared handoff note, edited (demo map, Day 4 at 9:05).
    prepared: true,
  });
  for (const [id, hh] of [
    ["ho-demo-bennett", "hh-bennett"],
    ["ho-demo-rivera", "hh-rivera"],
  ] as const)
    ev(at(4, 9, 5), {
      householdId: hh,
      actorId: "st-dana",
      action: "handoff.offered",
      subjectType: "handoff",
      subjectId: id,
      summary: "Cover for a household was offered to Tomás Alvarez while Maya Chen is away.",
      visibility: "staff",
    });
  const cover = (id: string, hh: string, to: string, state: string, extra: Row = {}) => ({
    id,
    tenantId: W,
    householdId: hh,
    fromActorId: "st-maya",
    toActorId: to,
    absenceId: "ab-demo-maya",
    kind: "cover",
    note: "",
    state,
    startsAt: awayFrom,
    endsAt: at(6, 18),
    acceptBy: at(5, 9, 5),
    offeredByActorId: "st-dana",
    offeredAt: at(4, 9, 5),
    ...extra,
  });
  f.handoffs.push(
    cover("ho-demo-okafor", HH, "st-sofia", "accepted", {
      note: "Respite stay is booked for Tuesday; transport still to arrange (task due Friday). Daniel prefers a call after 5 PM.",
      respondedAt: at(4, 14),
    }),
    cover("ho-demo-bennett", "hh-bennett", "st-tom", "offered"),
    cover("ho-demo-rivera", "hh-rivera", "st-tom", "withdrawn", { respondedAt: at(5, 9, 10) }),
  );
  ev(at(4, 10), {
    actorId: "st-maya",
    action: "update.reached_by_phone",
    subjectType: "family_update",
    subjectId: "up-okafor-2",
    summary: "Maya Chen recorded reaching Daniel Okafor by phone.",
    visibility: "staff",
    context: { person: "fm-daniel" },
  });

  // Ada confirms Oakwood version 2; Priya, who didn't record it, activates it.
  const oakwood = find(f.consents, (c) => c["id"] === "cs-okafor-equipment", "the Oakwood consent");
  f.consentConfirmations.push({
    id: "cc-demo-oakwood-2",
    tenantId: W,
    consentId: "cs-okafor-equipment",
    consentVersion: 2,
    actorId: "fm-ada",
    method: CONSENT_CONFIRMATION_METHOD,
    statement: CONSENT_CONFIRMATION_STATEMENT,
    confirmedAt: at(4, 10, 20),
  });
  Object.assign(oakwood, {
    state: "active",
    activatedVersion: 2,
    activatedByActorId: "st-priya",
    activatedAt: at(4, 14, 30),
  });
  ev(at(4, 10, 20), {
    actorId: "fm-ada",
    action: "consent.confirmed",
    subjectType: "consent",
    subjectId: "cs-okafor-equipment",
    summary: `Ada confirmed the consent to share with ${OAKWOOD}. A care-team reviewer still has to approve it.`,
    visibility: "sharing",
    context: { confirmationId: "cc-demo-oakwood-2", consentVersion: 2 },
  });
  ev(at(4, 14, 30), {
    actorId: "st-priya",
    action: "consent.activated",
    subjectType: "consent",
    subjectId: "cs-okafor-equipment",
    summary: `The consent to share with ${OAKWOOD} is now active.`,
    visibility: "sharing",
    context: { version: 2, confirmationId: "cc-demo-oakwood-2", recordedBy: oakwood["recordedByActorId"] },
    approval: { requestedBy: oakwood["recordedByActorId"] as string, approvedBy: "st-priya" },
  });

  // Rosa opens the respite packet and acknowledges it.
  f.packetAccessLog.push(
    { tenantId: W, packetId: "pk-okafor-respite", actorId: "rc-rosa", action: "viewed", at: at(4, 13, 30) },
    {
      tenantId: W,
      packetId: "pk-okafor-respite",
      actorId: "rc-rosa",
      action: "acknowledged",
      at: at(4, 13, 35),
    },
  );
  ev(at(4, 13, 30), {
    actorId: "rc-rosa",
    action: "packet.recipient_viewed",
    subjectType: "packet",
    subjectId: "pk-okafor-respite",
    summary: "The named recipient opened the packet in Zeporah.",
    visibility: "sharing",
  });
  ev(at(4, 13, 35), {
    actorId: "rc-rosa",
    action: "packet.recipient_acknowledged",
    subjectType: "packet",
    subjectId: "pk-okafor-respite",
    summary: "The named recipient acknowledged receiving the packet.",
    visibility: "sharing",
  });

  // Sofia accepts cover: a care-guide membership that ends by itself (decision 59).
  f.memberships.push({
    id: "mb-demo-sofia-cover",
    tenantId: W,
    actorId: "st-sofia",
    householdId: HH,
    roleCode: "care_guide",
    status: "ended",
    createdAt: at(4, 14),
    expiresAt: at(6, 18),
    endedAt: at(6, 18),
    endReason: "Cover ended at its scheduled time.",
    coverForActorId: "st-maya",
    startsAt: awayFrom,
    grantReason: "Covering while Maya Chen is away (synthetic).",
  });
  ev(at(4, 14), {
    actorId: "st-sofia",
    action: "handoff.accepted",
    subjectType: "handoff",
    subjectId: "ho-demo-okafor",
    summary: "Sofia Reyes accepted cover for this household.",
    visibility: "staff",
  });
  ev(at(4, 14), {
    actorId: "st-sofia",
    action: "coverage.granted",
    subjectType: "membership",
    subjectId: "mb-demo-sofia-cover",
    summary: "Sofia Reyes covers this household until the end of Maya Chen's absence.",
    visibility: "staff",
    reason: "Covering while Maya Chen is away (synthetic).",
    context: { coverFor: "st-maya", endsAt: at(6, 18).toISOString() },
  });

  // ---------------------------------------------------------------- Day 5: cover in action
  // Decision 62: cover started at 8:00; the first load after it (Dana's, at 9:00) told the household.
  const coverNotice = {
    id: "up-demo-cover-notice",
    tenantId: W,
    householdId: HH,
    authorActorId: null,
    title: `Sofia Reyes is your care guide until ${familyDateTime(at(6, 18))}`,
    body: "Maya Chen is away until then. Messages reach your care team as usual, and your hospice's 24-hour line is unchanged.",
    requiresAck: false,
    audienceActorIds: ["fm-ada", "fm-daniel", "fm-grace"],
    systemKind: "cover_started",
    sourceId: "mb-demo-sofia-cover",
    createdAt: at(5, 9),
  };
  f.familyUpdates.push(coverNotice);
  ev(at(5, 9), {
    actorId: null,
    action: "update.cover_notice_posted",
    subjectType: "family_update",
    subjectId: coverNotice.id,
    summary: `A cover notice was posted to the household: Sofia Reyes is their care guide until ${familyDateTime(at(6, 18))}.`,
    visibility: "staff",
    source: "system",
    context: { coverMembershipId: "mb-demo-sofia-cover", audience: coverNotice.audienceActorIds },
  });
  ev(at(5, 9, 10), {
    householdId: "hh-rivera",
    actorId: "st-dana",
    action: "handoff.withdrawn",
    subjectType: "handoff",
    subjectId: "ho-demo-rivera",
    summary: "The cover offer to Tomás Alvarez was withdrawn; operations are covering this household.",
    visibility: "staff",
  });
  ev(at(5, 10), {
    actorId: "st-sofia",
    action: "task.completed",
    subjectType: "task",
    subjectId: "tk-demo-transport",
    summary: "A care-team task was completed: “Book transport for the respite stay”.",
    visibility: "staff",
  });
  f.exceptionClaims.push({
    tenantId: W,
    householdId: HH,
    key: RESPITE_ACCESS_KEY,
    dismissedReason: "Let it end: the stay is booked and Brightwater has what it needs (synthetic).",
    dismissedByActorId: "st-sofia",
    dismissedAt: at(5, 17),
    updatedAt: at(5, 17),
  });
  ev(at(5, 17), {
    actorId: "st-sofia",
    action: "exception.dismissed",
    subjectType: "exception",
    subjectId: RESPITE_ACCESS_KEY,
    summary: "Sofia Reyes dismissed an Access ending exception.",
    visibility: "staff",
    reason: "Let it end: the stay is booked and Brightwater has what it needs (synthetic).",
  });
  ev(at(5, 18), {
    actorId: null,
    action: "packet.recipient_access_ended",
    subjectType: "packet",
    subjectId: "pk-okafor-respite",
    summary: "Brightwater Respite House's access ended at its scheduled time.",
    visibility: "sharing",
    source: "system",
  });

  // ---------------------------------------------------------------- Day 6: cover ends by itself
  ev(at(6, 18), {
    actorId: null,
    action: "coverage.ended",
    subjectType: "membership",
    subjectId: "mb-demo-sofia-cover",
    summary: "Sofia Reyes's cover for this household ended at its scheduled time.",
    visibility: "staff",
    source: "system",
  });
  sortHistory(f);
}

/** 9:00 AM today in the pilot's time zone. */
function nineToday(now: Date) {
  const tz = PILOT_DISPLAY.timeZone;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const guess = new Date(`${day}T09:00:00Z`);
  const off = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(guess)
    .find((x) => x.type === "timeZoneName")!
    .value.match(/GMT([+-]\d+)?/);
  return new Date(guess.getTime() - Number(off?.[1] ?? 0) * 3_600_000);
}

function sortHistory(f: Fixtures) {
  f.history.sort((a, b) => a.at.getTime() - b.at.getTime());
}
