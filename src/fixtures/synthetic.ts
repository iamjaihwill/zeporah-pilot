/**
 * SYNTHETIC DATA ONLY. Every person, organization, household, phone number and record below is
 * invented for development and demonstration. Nothing here is, or is derived from, real PHI.
 *
 * The dataset is built relative to `now` so that "expired", "active" and "upcoming" scenarios stay
 * true whenever it is reseeded. IDs are fixed so tests and demos can refer to them.
 *
 * Scenario map (tenant t-willow unless noted):
 *   hh-rivera    enrolled, onboarding not started            → onboarding → dashboard flow
 *   hh-wells     enrolled today; Rehanna, the patient, hasn't signed in → first-time patient view
 *   hh-okafor    active, everything in order                  → normal packet release (ALLOW), messaging, vault,
 *                                                                 consent revocation, bereavement transition
 *   hh-bennett   two conflicting healthcare-agent records     → AUTHORITY_CONFLICT hold + open escalation
 *   hh-patel     proxy designation awaiting review (v2)       → AUTHORITY_REVIEW_PENDING hold, version lineage
 *   hh-nguyen    consent revoked; packet with empty manifest  → CONSENT_REVOKED hold, SCOPE_EMPTY hold;
 *                no care guide: Tomás's assignment ended 2 days ago → "Not assigned", assign-a-guide demo
 *   hh-hart      packet past expiry; consent past expiry      → PACKET_EXPIRED hold, CONSENT_EXPIRED hold
 *   hh-lindqvist already in bereavement                       → narrowed access, released bereavement packet
 *   t-cedar      a second hospice                             → wrong-tenant denial
 */
import type { ShareCategory } from "@/domain/model";
import { BEREAVEMENT_STEPS } from "@/domain/bereavement";
import { STARTER_VAULT } from "@/domain/starter-vault";
import { CONSENT_CONFIRMATION_METHOD, CONSENT_CONFIRMATION_STATEMENT } from "@/domain/consent";

type Row = Record<string, unknown>;

export const SEED = {
  tenants: { willow: "t-willow", cedar: "t-cedar" },
  orgs: { willow: "org-willow", cedar: "org-cedar" },
} as const;

/** Personas offered on the development sign-in screen, in display order. */
export const PERSONAS: { actorId: string; tenantId: string; blurb: string }[] = [
  {
    actorId: "fm-marisol",
    tenantId: "t-willow",
    blurb: "Sees the Rivera household as its coordinator. Hasn't set it up yet.",
  },
  {
    actorId: "fm-rehanna",
    tenantId: "t-willow",
    blurb:
      "A patient the hospice enrolled today. First time in Zeporah: hasn't added anything, and no one else is in her household yet.",
  },
  {
    actorId: "fm-daniel",
    tenantId: "t-willow",
    blurb: "Sees the Okafor household as coordinator: updates, tasks, messages and sharing. Setup done.",
  },
  {
    actorId: "fm-grace",
    tenantId: "t-willow",
    blurb: "Sees her own household, including her protected items. Gave consent for a respite stay.",
  },
  {
    actorId: "fm-ada",
    tenantId: "t-willow",
    blurb: "Sees protected items through an active healthcare-agent workflow. Can confirm sharing.",
  },
  {
    actorId: "fm-chidi",
    tenantId: "t-willow",
    blurb: "Sees updates and his own tasks — not protected items, messages or the Sharing page.",
  },
  {
    actorId: "fm-claire",
    tenantId: "t-willow",
    blurb:
      "Coordinates the Bennett household, where two healthcare-agent records conflict and sharing is held. Asked Jamie, a neighbor, to help with one task.",
  },
  {
    actorId: "fm-ravi",
    tenantId: "t-willow",
    blurb:
      "The patient in the Patel household. Asked for a correction to a sharing consent; nothing is shared under it until the care team resolves it.",
  },
  {
    actorId: "fm-ingrid",
    tenantId: "t-willow",
    blurb: "Sees continuing support after a death. Confirmed as the surviving contact.",
  },
  {
    actorId: "fm-jamie",
    tenantId: "t-willow",
    blurb:
      "A neighbor helping the Bennetts with one task. Sees that task only — nothing else in the household.",
  },
  { actorId: "st-maya", tenantId: "t-willow", blurb: "Sees only her four assigned households." },
  {
    actorId: "st-tom",
    tenantId: "t-willow",
    blurb: "Sees only his two assigned households, including one in bereavement.",
  },
  {
    actorId: "st-sofia",
    tenantId: "t-willow",
    blurb: "Shares the Hart household with Maya, so care-team tasks can be handed between them.",
  },
  {
    actorId: "st-dana",
    tenantId: "t-willow",
    blurb: "Sees every Willow Creek household. Manages the team, releases packets, runs reports.",
  },
  {
    actorId: "st-priya",
    tenantId: "t-willow",
    blurb: "Sees every Willow Creek household. Reviews authority and activates consents.",
  },
  {
    actorId: "st-lena",
    tenantId: "t-willow",
    blurb:
      "Hospice administrator: staff roles, organization settings and access. Doesn't open household records.",
  },
  {
    actorId: "rc-rosa",
    tenantId: "t-willow",
    blurb:
      "Intake coordinator at Brightwater Respite House. Reads the packets released to her, read-only: one is released now, and the respite packet is still a draft.",
  },
  {
    actorId: "cst-jordan",
    tenantId: "t-cedar",
    blurb: "Sees only Cedar Valley — used to check one hospice can't see another's households.",
  },
];

export function buildFixtures(now: Date) {
  // Seeded times land on the quarter hour (12:45 PM, not 12:41 PM) so they read like a real schedule.
  // Past times round down and future times up, so nothing crosses "now" (overdue stays overdue).
  const Q = 15 * 60_000;
  const h = (hours: number) => {
    const t = now.getTime() + hours * 3_600_000;
    return new Date(hours <= 0 ? Math.floor(t / Q) * Q : Math.ceil(t / Q) * Q);
  };
  const d = (days: number) => h(days * 24);
  /**
   * Later today in the pilot's time zone, whenever the seed runs: halfway between now and midnight
   * (so "Due today" stays true, rather than a fixed number of hours that can cross midnight).
   */
  const laterToday = () => {
    const tz = "America/New_York";
    const hm = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .reduce(
        (a, p) =>
          p.type === "hour" ? a + Number(p.value) * 60 : p.type === "minute" ? a + Number(p.value) : a,
        0,
      );
    const minutesLeft = 24 * 60 - hm;
    return new Date(now.getTime() + Math.max(1, Math.floor(minutesLeft / 2)) * 60_000);
  };
  /**
   * Tomorrow at a set hour in the pilot's time zone, whenever the seed runs (a fixed number of hours
   * from now lands on "today" when the seed runs after midnight).
   */
  const tomorrowAt = (hour: number) => {
    const t = laterToday();
    const midnight = new Date(t.getTime() + (t.getTime() - now.getTime()));
    return new Date(Math.ceil(midnight.getTime() / 60_000) * 60_000 + hour * 3_600_000);
  };
  const W: string = SEED.tenants.willow;
  const C: string = SEED.tenants.cedar;

  const tenants: Row[] = [
    { id: W, name: "Willow Creek Hospice (synthetic)" },
    { id: C, name: "Cedar Valley Hospice (synthetic)" },
  ];
  const organizations: Row[] = [
    {
      id: SEED.orgs.willow,
      tenantId: W,
      name: "Willow Creek Hospice (synthetic)",
      stateCode: "GA",
      afterHoursLine: "555-0100 (synthetic 24-hour line)",
    },
    {
      id: SEED.orgs.cedar,
      tenantId: C,
      name: "Cedar Valley Hospice (synthetic)",
      stateCode: "GA",
      afterHoursLine: "555-0199 (synthetic 24-hour line)",
    },
  ];

  const actor = (id: string, tenantId: string, kind: "family" | "staff", displayName: string) => ({
    id,
    tenantId,
    kind,
    displayName,
    email: `${id}@example.invalid`,
  });
  const actors: Row[] = [
    actor("st-maya", W, "staff", "Maya Chen"),
    actor("st-tom", W, "staff", "Tomás Alvarez"),
    actor("st-dana", W, "staff", "Dana Brooks"),
    actor("st-priya", W, "staff", "Priya Raman"),
    actor("st-lena", W, "staff", "Lena Hoffman"),
    actor("st-sofia", W, "staff", "Sofia Reyes"),
    actor("fm-elena", W, "family", "Elena Rivera"),
    actor("fm-marisol", W, "family", "Marisol Rivera"),
    actor("fm-rehanna", W, "family", "Rehanna Wells"),
    actor("fm-grace", W, "family", "Grace Okafor"),
    actor("fm-daniel", W, "family", "Daniel Okafor"),
    actor("fm-ada", W, "family", "Ada Okafor"),
    actor("fm-chidi", W, "family", "Chidi Okafor"),
    actor("fm-harold", W, "family", "Harold Bennett"),
    actor("fm-claire", W, "family", "Claire Bennett"),
    actor("fm-owen", W, "family", "Owen Bennett"),
    actor("fm-ravi", W, "family", "Ravi Patel"),
    actor("fm-meera", W, "family", "Meera Patel"),
    actor("fm-linh", W, "family", "Linh Nguyen"),
    actor("fm-bao", W, "family", "Bao Nguyen"),
    actor("fm-walter", W, "family", "Walter Hart"),
    actor("fm-june", W, "family", "June Hart"),
    actor("fm-erik", W, "family", "Erik Lindqvist"),
    actor("fm-ingrid", W, "family", "Ingrid Lindqvist"),
    actor("fm-jamie", W, "family", "Jamie Park"),
    {
      ...actor("rc-rosa", W, "family", "Rosa Lin"),
      kind: "recipient",
      email: "rosa.lin@brightwater.example.invalid",
    },
    actor("cst-sam", C, "staff", "Sam Whitfield"),
    actor("cst-jordan", C, "staff", "Jordan Ellis"),
    actor("cfm-alice", C, "family", "Alice Moss"),
    actor("cfm-ben", C, "family", "Ben Moss"),
  ];

  const household = (
    id: string,
    displayName: string,
    patientName: string,
    lifecycleState: string,
    enrolledDaysAgo: number,
    tenantId = W,
    organizationId: string = SEED.orgs.willow,
  ) => ({
    id,
    tenantId,
    organizationId,
    displayName,
    patientName,
    lifecycleState,
    enrolledAt: d(-enrolledDaysAgo),
  });
  const households: Row[] = [
    household("hh-rivera", "The Rivera household", "Elena Rivera", "enrolled", 1),
    household("hh-wells", "The Wells household", "Rehanna Wells", "enrolled", 0),
    household("hh-okafor", "The Okafor household", "Grace Okafor", "active_hospice", 21),
    household("hh-bennett", "The Bennett household", "Harold Bennett", "active_hospice", 14),
    household("hh-patel", "The Patel household", "Ravi Patel", "active_hospice", 9),
    household("hh-nguyen", "The Nguyen household", "Linh Nguyen", "active_hospice", 30),
    household("hh-hart", "The Hart household", "Walter Hart", "active_hospice", 40),
    {
      ...household("hh-lindqvist", "The Lindqvist household", "Erik Lindqvist", "bereavement", 75),
      lifecycleChangedAt: d(-12),
    },
    household("chh-moss", "The Moss household", "Alice Moss", "active_hospice", 10, C, SEED.orgs.cedar),
  ];

  let mid = 0;
  const member = (
    actorId: string,
    roleCode: string,
    scope: { householdId?: string; organizationId?: string },
    tenantId = W,
    extra: Row = {},
  ) => ({
    id: `m-${++mid}`,
    tenantId,
    actorId,
    roleCode,
    householdId: scope.householdId ?? null,
    organizationId: scope.organizationId ?? null,
    ...extra,
  });
  const org = { organizationId: SEED.orgs.willow };
  const memberships: Row[] = [
    // Staff roles date from when each person joined (before their first assignment), so "Role
    // history" on Team & coverage reads like a real team rather than "from today".
    member("st-maya", "care_guide", org, W, { createdAt: d(-120) }),
    member("st-tom", "care_guide", org, W, { createdAt: d(-90) }),
    member("st-dana", "hospice_ops", org, W, { createdAt: d(-200) }),
    member("st-priya", "privileged_reviewer", org, W, { createdAt: d(-150) }),
    member("st-lena", "hospice_admin", org, W, { createdAt: d(-240) }),
    member("st-sofia", "care_guide", org, W, { createdAt: d(-30) }),
    // Sofia shares the Hart household with Maya, so tasks there can move between them (decision 40).
    member("st-sofia", "care_guide", { householdId: "hh-hart" }, W, { createdAt: d(-6) }),
    // Sofia enrolled the Wells household today. Rehanna hasn't signed in yet.
    member("st-sofia", "care_guide", { householdId: "hh-wells" }, W, { createdAt: d(0) }),
    // Care-guide assignments (see services/assignments.ts), each dated from the household's enrollment.
    ...(
      [
        ["hh-rivera", 1],
        ["hh-okafor", 21],
        ["hh-bennett", 14],
        ["hh-hart", 40],
      ] as const
    ).map(([hid, days]) => member("st-maya", "care_guide", { householdId: hid }, W, { createdAt: d(-days) })),
    ...(
      [
        ["hh-patel", 9],
        ["hh-lindqvist", 75],
      ] as const
    ).map(([hid, days]) => member("st-tom", "care_guide", { householdId: hid }, W, { createdAt: d(-days) })),
    // Nguyen has no care guide right now: Tomás's assignment ended, and no one has been assigned yet.
    member("st-tom", "care_guide", { householdId: "hh-nguyen" }, W, {
      createdAt: d(-30),
      status: "ended",
      endedAt: d(-2),
      endReason: "Caseload rebalanced; a new care guide is still to be chosen (synthetic).",
    }),
    member("fm-elena", "patient", { householdId: "hh-rivera" }),
    member("fm-marisol", "coordinator", { householdId: "hh-rivera" }),
    // The only person in her household so far: no coordinator, no one else invited.
    member("fm-rehanna", "patient", { householdId: "hh-wells" }, W, { createdAt: d(0) }),
    member("fm-grace", "patient", { householdId: "hh-okafor" }),
    member("fm-daniel", "coordinator", { householdId: "hh-okafor" }),
    member("fm-ada", "proxy", { householdId: "hh-okafor" }),
    member("fm-chidi", "family_member", { householdId: "hh-okafor" }),
    member("fm-harold", "patient", { householdId: "hh-bennett" }),
    member("fm-claire", "coordinator", { householdId: "hh-bennett" }),
    member("fm-owen", "proxy", { householdId: "hh-bennett" }),
    // A task-only helper (decision 42): one task, until it's done or the date.
    member("fm-jamie", "helper", { householdId: "hh-bennett" }, W, {
      taskId: "tk-bennett-help",
      expiresAt: d(14),
    }),
    member("fm-ravi", "patient", { householdId: "hh-patel" }),
    member("fm-meera", "coordinator", { householdId: "hh-patel" }),
    member("fm-linh", "patient", { householdId: "hh-nguyen" }),
    member("fm-bao", "coordinator", { householdId: "hh-nguyen" }),
    member("fm-walter", "patient", { householdId: "hh-hart" }),
    member("fm-june", "coordinator", { householdId: "hh-hart" }),
    member("fm-erik", "patient", { householdId: "hh-lindqvist" }, W, {
      status: "ended",
      endedAt: d(-12),
      endReason: "bereavement_transition",
    }),
    member("fm-ingrid", "coordinator", { householdId: "hh-lindqvist" }),
    member("cst-sam", "care_guide", { organizationId: SEED.orgs.cedar }, C),
    member("cst-jordan", "hospice_ops", { organizationId: SEED.orgs.cedar }, C),
    member("cst-sam", "care_guide", { householdId: "chh-moss" }, C),
    member("cfm-alice", "patient", { householdId: "chh-moss" }, C),
    member("cfm-ben", "coordinator", { householdId: "chh-moss" }, C),
  ];

  const pref = (actorId: string, extra: Row = {}, tenantId = W) => ({ actorId, tenantId, ...extra });
  const preferences: Row[] = [
    pref("fm-grace", { textSize: "larger" }),
    pref("fm-daniel", { contactMethod: "phone", notificationCadence: "as_it_happens" }),
    pref("fm-ada", { notificationCadence: "daily_summary" }),
    pref("fm-chidi", { notificationCadence: "essential_only" }),
    ...[
      "fm-harold",
      "fm-claire",
      "fm-owen",
      "fm-ravi",
      "fm-meera",
      "fm-linh",
      "fm-bao",
      "fm-walter",
      "fm-june",
      "fm-ingrid",
    ].map((a) => pref(a)),
    pref("cfm-ben", {}, C),
  ];

  const allSteps = ["preferences", "trusted_contacts", "communication", "vault_review"];
  const onboarded: [string, string, number][] = [
    ["hh-okafor", "fm-daniel", 20],
    ["hh-bennett", "fm-claire", 13],
    ["hh-patel", "fm-meera", 8],
    ["hh-nguyen", "fm-bao", 29],
    ["hh-hart", "fm-june", 39],
    ["hh-lindqvist", "fm-ingrid", 74],
  ];
  const onboardingSteps: Row[] = onboarded.flatMap(([householdId, by, daysAgo]) =>
    allSteps.map((step, i) => ({
      tenantId: W,
      householdId,
      step,
      completedByActorId: by,
      completedAt: h(-daysAgo * 24 + i),
    })),
  );

  const supportPreferences: Row[] = [
    {
      householdId: "hh-okafor",
      tenantId: W,
      categories: ["practical_caregiver_support", "respite"],
      spiritualCare: true,
      preferredContactTime: "Weekdays after 5 pm",
    },
    {
      householdId: "hh-lindqvist",
      tenantId: W,
      categories: ["bereavement_support"],
      preferredContactTime: "Mornings",
    },
  ];

  const record = (
    householdId: string,
    careGuideActorId: string,
    visitRhythm: string,
    familyPriorities: string,
    extra: Row = {},
  ) => ({
    tenantId: W,
    householdId,
    careGuideActorId,
    visitRhythm,
    afterHoursRoute:
      "For anything urgent, call the hospice 24-hour line: 555-0100 (synthetic). Zeporah is not monitored for emergencies.",
    familyPriorities,
    ...extra,
  });
  const careCoordinationRecords: Row[] = [
    record("hh-rivera", "st-maya", "First visits being scheduled", ""),
    record("hh-wells", "st-sofia", "First visits being scheduled", ""),
    record(
      "hh-okafor",
      "st-maya",
      "Nurse visits Monday and Thursday mornings; aide visits Tuesday, Wednesday and Friday",
      "Keep Grace at home; short respite stay for Daniel next week",
      // A pointer to the hospice's clinical record, never its content (decision 58). Synthetic.
      { ehrReference: "000-SYN-4411" },
    ),
    record(
      "hh-bennett",
      "st-maya",
      "Nurse visits Tuesday and Friday",
      "Equipment pickup once no longer needed",
    ),
    record(
      "hh-patel",
      "st-tom",
      "Nurse visits Monday, Wednesday, Friday",
      "Chaplain visit in the family's tradition",
    ),
    record("hh-nguyen", "st-tom", "Nurse visits twice weekly", "Volunteer transport for Bao's appointments"),
    record(
      "hh-hart",
      "st-maya",
      "Nurse visits weekly; aide visits three times a week",
      "Help with benefits questions",
    ),
    record("hh-lindqvist", "st-tom", "Care visits ended", "Bereavement support for Ingrid", {
      archivedAt: d(-12),
    }),
  ];

  const vaultTemplate = STARTER_VAULT;
  let vid = 0;
  const vault = (householdId: string, statuses: (string | [string, string])[], tenantId = W) =>
    vaultTemplate.map(([title, category, description, sensitivity], i) => {
      const s = statuses[i] ?? "needs_review";
      const [status, keptWhere] = Array.isArray(s) ? s : [s, null];
      return {
        id: `vi-${householdId.replace(/^c?hh-/, "")}-${++vid}`,
        tenantId,
        householdId,
        title,
        category,
        description,
        sensitivity,
        status,
        keptWhere,
        starter: true,
        reviewedAt: status === "needs_review" ? null : d(-3),
      };
    });
  const vaultItems: Row[] = [
    ...vault("hh-rivera", []),
    ...vault("hh-wells", []),
    ...vault("hh-okafor", [
      ["reviewed", "On the fridge"],
      ["reviewed", "Kitchen drawer, blue folder"],
      "needs_review",
      ["reviewed", "Ada keeps the original"],
      ["reviewed", "With the advance directive"],
      "needs_review",
    ]),
    ...vault("hh-bennett", [
      "reviewed",
      "reviewed",
      "reviewed",
      "needs_review",
      "needs_review",
      "not_applicable",
    ]),
    ...vault("hh-patel", [
      "reviewed",
      "needs_review",
      "needs_review",
      "needs_review",
      "reviewed",
      "needs_review",
    ]),
    ...vault("hh-nguyen", ["reviewed", "reviewed", "reviewed", "reviewed", "reviewed", "not_available"]),
    ...vault("hh-hart", ["reviewed", "needs_review", "reviewed", "reviewed", "reviewed", "needs_review"]),
    ...vault("hh-lindqvist", ["reviewed", "reviewed", "not_applicable", "reviewed", "reviewed", "reviewed"]),
    ...vault("chh-moss", [], C),
  ];

  let tid = 0;
  const task = (householdId: string, t: Row) => ({
    id: `tk-${++tid}`,
    tenantId: W,
    householdId,
    detail: "",
    ...t,
  });
  const tasks: Row[] = [
    task("hh-okafor", {
      title: "Confirm which visit times work this week",
      detail: "Let Maya know in the message thread if Thursday 10am doesn't work.",
      audience: "family",
      assigneeActorId: "fm-daniel",
      ownerActorId: "st-maya",
      whenLabel: "This week",
      requiresAck: true,
      source: "care_team",
      createdAt: d(-2),
    }),
    task("hh-okafor", {
      title: "Pick up the equipment return form",
      detail: "The form is at the front desk of the hospice office.",
      audience: "family",
      assigneeActorId: "fm-chidi",
      ownerActorId: "fm-daniel",
      whenLabel: "When you can",
      source: "family",
      createdAt: d(-1),
    }),
    task("hh-okafor", {
      title: "Tell the care guide about visitors this weekend",
      audience: "family",
      assigneeActorId: "fm-daniel",
      ownerActorId: "st-maya",
      source: "care_team",
      status: "done",
      completedAt: d(-4),
      completedByActorId: "fm-daniel",
      createdAt: d(-6),
    }),
    task("hh-okafor", {
      title: "Call Daniel about respite options",
      detail: "He prefers calls after 5pm.",
      audience: "staff",
      assigneeActorId: "st-maya",
      ownerActorId: "st-maya",
      whenLabel: "Today",
      dueAt: laterToday(),
      source: "care_team",
      createdAt: d(-1),
    }),
    task("hh-rivera", {
      title: "Schedule the first visit with Marisol",
      audience: "staff",
      assigneeActorId: "st-maya",
      ownerActorId: "st-maya",
      whenLabel: "This week",
      source: "care_team",
      createdAt: d(-1),
    }),
    task("hh-bennett", {
      title: "Talk with Claire and Owen about the healthcare-agent paperwork",
      detail: "Human review needed; Zeporah doesn't decide authority.",
      audience: "staff",
      assigneeActorId: "st-maya",
      ownerActorId: "st-priya",
      whenLabel: "This week",
      source: "care_team",
      createdAt: d(-2),
    }),
    task("hh-hart", {
      title: "Bring the benefits letters to the next visit",
      audience: "family",
      assigneeActorId: "fm-june",
      ownerActorId: "st-maya",
      whenLabel: "Next visit",
      source: "care_team",
      createdAt: d(-5),
    }),
    task("hh-lindqvist", {
      title: "Choose whether to join the bereavement circle",
      detail: "Only if and when it feels right. There's no deadline.",
      audience: "family",
      assigneeActorId: "fm-ingrid",
      ownerActorId: "st-tom",
      whenLabel: "Whenever you're ready",
      source: "lifecycle",
      createdAt: d(-11),
    }),
    task("hh-lindqvist", {
      title: "Gather any letters about Erik's benefits",
      detail: "Just collect them in one place. A counselor can go through them with you.",
      audience: "family",
      assigneeActorId: "fm-ingrid",
      ownerActorId: "st-tom",
      whenLabel: "No rush",
      source: "lifecycle",
      createdAt: d(-11),
    }),
    {
      ...task("hh-bennett", {}),
      id: "tk-bennett-help",
      title: "Pick up groceries for Thursday",
      detail: "The list is on the fridge. Claire will be home between 2 and 4 PM.",
      audience: "family",
      assigneeActorId: "fm-jamie",
      ownerActorId: "fm-claire",
      createdByActorId: "fm-claire",
      dueAt: d(2),
      source: "family",
      createdAt: d(-1),
    },
    {
      ...task("hh-hart", {}),
      id: "tk-hart-a",
      title: "Confirm the equipment delivery window with June",
      audience: "staff",
      assigneeActorId: "st-maya",
      ownerActorId: "st-maya",
      dueAt: tomorrowAt(15),
      source: "care_team",
      createdAt: d(-2),
    },
    {
      ...task("hh-hart", {}),
      id: "tk-hart-b",
      title: "Check whether the benefits letters arrived",
      audience: "staff",
      assigneeActorId: "st-maya",
      ownerActorId: "st-maya",
      dueAt: d(-1),
      source: "care_team",
      createdAt: d(-4),
    },
    {
      ...task("hh-hart", {}),
      id: "tk-hart-c",
      title: "Find a volunteer driver for Thursday",
      audience: "staff",
      assigneeActorId: null,
      ownerActorId: "st-sofia",
      dueAt: d(5),
      source: "care_team",
      createdAt: d(-1),
    },
  ];

  const familyUpdates: Row[] = [
    {
      id: "up-okafor-1",
      tenantId: W,
      householdId: "hh-okafor",
      authorActorId: "st-maya",
      title: "This week's visit plan",
      body: "Nurse visits are Monday and Thursday at 10am. The aide comes Tuesday, Wednesday and Friday mornings. Please acknowledge so I know everyone has the same times.",
      requiresAck: true,
      createdAt: d(-3),
    },
    {
      id: "up-okafor-2",
      tenantId: W,
      householdId: "hh-okafor",
      authorActorId: "st-maya",
      title: "Respite stay — next steps",
      body: "Brightwater Respite House has space next week. Once the paperwork is reviewed I'll share only the contact details and visit schedule they need — nothing else.",
      requiresAck: false,
      createdAt: h(-5),
    },
    {
      id: "up-lindqvist-1",
      tenantId: W,
      householdId: "hh-lindqvist",
      authorActorId: "st-tom",
      title: "We're still here",
      body: "Your care team remains available. The bereavement circle meets on Wednesdays if and when you'd like to join.",
      requiresAck: false,
      createdAt: d(-10),
    },
  ];
  const acknowledgements: Row[] = [
    {
      tenantId: W,
      householdId: "hh-okafor",
      subjectType: "update",
      subjectId: "up-okafor-1",
      actorId: "fm-daniel",
      createdAt: d(-3),
    },
  ];

  const staffNotes: Row[] = [
    {
      tenantId: W,
      householdId: "hh-okafor",
      authorActorId: "st-maya",
      body: "Family prefers calls after 5pm. Daniel is the main contact for scheduling; Ada handles paperwork.",
      createdAt: d(-6),
    },
    {
      tenantId: W,
      householdId: "hh-bennett",
      authorActorId: "st-priya",
      body: "Two healthcare-agent documents with different dates. Holding all sharing until reviewed with the family and the hospice social worker.",
      createdAt: d(-2),
    },
  ];

  const thread = (householdId: string, tenantId = W) => ({
    id: `th-${householdId}`,
    tenantId,
    householdId,
    subject: "Messages with your care guide",
  });
  const messageThreads: Row[] = households.map((x) => thread(x["id"] as string, x["tenantId"] as string));
  let msid = 0;
  const msg = (
    householdId: string,
    authorActorId: string,
    authorSide: "family" | "staff",
    body: string,
    at: Date,
  ) => ({
    id: `ms-${++msid}`,
    tenantId: W,
    threadId: `th-${householdId}`,
    householdId,
    authorActorId,
    authorSide,
    body,
    createdAt: at,
  });
  const messages: Row[] = [
    msg(
      "hh-rivera",
      "st-maya",
      "staff",
      "Hello Marisol, I'm Maya, your care guide. When you're ready, the setup steps will help us keep everyone on the same page. There's no rush.",
      d(-1),
    ),
    msg(
      "hh-okafor",
      "fm-daniel",
      "family",
      "Mum slept better last night. Is Thursday still okay for the nurse visit?",
      d(-2),
    ),
    msg(
      "hh-okafor",
      "st-maya",
      "staff",
      "Thursday at 10 is confirmed. I'll post the week's plan as an update so everyone sees the same times.",
      h(-46),
    ),
    msg(
      "hh-okafor",
      "fm-ada",
      "family",
      "Thank you. Could someone tell us what the respite house will need from us?",
      h(-4),
    ),
    msg("hh-lindqvist", "st-tom", "staff", "Ingrid, I'm thinking of you this week. No need to reply.", d(-5)),
  ];

  let nid = 0;
  const note = (
    recipientActorId: string,
    householdId: string | null,
    kind: string,
    title: string,
    link: string,
    at: Date,
    read = false,
    tenantId = W,
  ) => ({
    id: `nt-${++nid}`,
    tenantId,
    recipientActorId,
    householdId,
    kind,
    title,
    link,
    createdAt: at,
    readAt: read ? at : null,
  });
  const notifications: Row[] = [
    note(
      "fm-ada",
      "hh-okafor",
      "consent",
      "A sharing consent changed and needs your confirmation",
      "/family/consents/cs-okafor-equipment",
      d(-1),
    ),
    note(
      "fm-ingrid",
      "hh-lindqvist",
      "consent",
      "Your care team reviewed your correction request",
      "/family/consents/cs-lindqvist-circle",
      d(-3),
    ),
    note(
      "fm-chidi",
      "hh-okafor",
      "consent",
      "A sharing consent names you",
      "/family/consents/cs-okafor-library",
      d(-1),
    ),
    note(
      "st-tom",
      "hh-patel",
      "consent",
      "A household asked for a consent correction",
      "/staff/households/hh-patel?tab=sharing",
      h(-20),
    ),
    note(
      "st-priya",
      "hh-patel",
      "consent",
      "A household asked for a consent correction",
      "/staff/households/hh-patel?tab=sharing",
      h(-20),
    ),
    note(
      "fm-marisol",
      "hh-rivera",
      "onboarding",
      "Your household space is ready to set up",
      "/family/onboarding",
      d(-1),
    ),
    note(
      "fm-marisol",
      "hh-rivera",
      "message",
      "You have a new message from your care guide",
      "/family/messages",
      d(-1),
    ),
    note(
      "fm-daniel",
      "hh-okafor",
      "update",
      "There's a new update from your care team",
      "/family/messages",
      h(-5),
    ),
    note(
      "fm-daniel",
      "hh-okafor",
      "message",
      "There's a new message from your care team",
      "/family/messages",
      h(-4),
    ),
    note("fm-daniel", "hh-okafor", "task", "A task was shared with you", "/family/tasks", d(-2), true),
    note(
      "fm-ada",
      "hh-okafor",
      "update",
      "There's a new update from your care team",
      "/family/messages",
      d(-3),
    ),
    note(
      "fm-ada",
      "hh-okafor",
      "update",
      "There's a new update from your care team",
      "/family/messages",
      h(-5),
    ),
    note("fm-chidi", "hh-okafor", "task", "A task was shared with you", "/family/tasks", d(-1)),
    note(
      "fm-grace",
      "hh-okafor",
      "update",
      "There's a new update from your care team",
      "/family/messages",
      h(-5),
    ),
    note(
      "st-maya",
      "hh-okafor",
      "message",
      "A household sent a new message",
      "/staff/households/hh-okafor?tab=messages",
      h(-4),
    ),
    note(
      "st-maya",
      "hh-bennett",
      "escalation",
      "A sharing hold needs a person to review it",
      "/staff/exceptions?view=all&kind=escalation",
      d(-2),
      true,
    ),
    note(
      "st-priya",
      "hh-patel",
      "authority",
      "Authority evidence is waiting for review",
      "/staff/reviews",
      d(-1),
    ),
    note(
      "st-priya",
      "hh-bennett",
      "escalation",
      "Conflicting authority evidence needs review",
      "/staff/reviews",
      d(-2),
    ),
    note(
      "st-dana",
      "hh-okafor",
      "packet",
      "A packet is ready for a release check",
      "/staff/packets/pk-okafor-respite",
      h(-3),
    ),
    note(
      "fm-ingrid",
      "hh-lindqvist",
      "update",
      "There's a new update from your care team",
      "/family/messages",
      d(-10),
      true,
    ),
  ];

  // ---- authority evidence (metadata + version lineage only; never documents)
  const ev = (
    id: string,
    householdId: string,
    holderActorId: string | null,
    holderName: string,
    authorityType: string,
    state: string,
    currentVersionId: string,
    createdDaysAgo: number,
  ) => ({
    id,
    tenantId: W,
    householdId,
    holderActorId,
    holderName,
    authorityType,
    state,
    currentVersionId,
    createdAt: d(-createdDaysAgo),
    updatedAt: d(-createdDaysAgo + 1),
  });
  const authorityEvidence: Row[] = [
    // Demo: signed only "E. Rivera" and not yet linked to a household person, so it's held for identity review.
    ev(
      "ev-rivera-unlinked",
      "hh-rivera",
      null,
      "E. Rivera",
      "healthcare_agent",
      "review_pending",
      "evv-rivera-unlinked-1",
      1,
    ),
    ev(
      "ev-okafor-ada",
      "hh-okafor",
      "fm-ada",
      "Ada Okafor",
      "healthcare_agent",
      "workflow_active",
      "evv-okafor-ada-1",
      19,
    ),
    ev(
      "ev-bennett-claire",
      "hh-bennett",
      "fm-claire",
      "Claire Bennett",
      "healthcare_agent",
      "conflict",
      "evv-bennett-claire-1",
      12,
    ),
    ev(
      "ev-bennett-owen",
      "hh-bennett",
      "fm-owen",
      "Owen Bennett",
      "healthcare_agent",
      "conflict",
      "evv-bennett-owen-1",
      3,
    ),
    ev(
      "ev-patel-meera",
      "hh-patel",
      "fm-meera",
      "Meera Patel",
      "patient_designated_proxy",
      "review_pending",
      "evv-patel-meera-2",
      7,
    ),
    ev(
      "ev-nguyen-bao",
      "hh-nguyen",
      "fm-bao",
      "Bao Nguyen",
      "healthcare_agent",
      "workflow_active",
      "evv-nguyen-bao-1",
      28,
    ),
    ev(
      "ev-hart-june",
      "hh-hart",
      "fm-june",
      "June Hart",
      "healthcare_agent",
      "workflow_active",
      "evv-hart-june-1",
      38,
    ),
    ev(
      "ev-lindqvist-hca",
      "hh-lindqvist",
      "fm-ingrid",
      "Ingrid Lindqvist",
      "healthcare_agent",
      "superseded",
      "evv-lindqvist-hca-1",
      70,
    ),
    ev(
      "ev-lindqvist-pr",
      "hh-lindqvist",
      "fm-ingrid",
      "Ingrid Lindqvist",
      "personal_representative",
      "workflow_active",
      "evv-lindqvist-pr-1",
      10,
    ),
  ];
  const ver = (
    id: string,
    evidenceId: string,
    versionNo: number,
    previousVersionId: string | null,
    documentLabel: string,
    effectiveDate: string,
    submittedByActorId: string,
    daysAgo: number,
    note = "",
  ) => ({
    id,
    tenantId: W,
    evidenceId,
    versionNo,
    previousVersionId,
    documentLabel,
    effectiveDate,
    submittedByActorId,
    submittedAt: d(-daysAgo),
    note,
  });
  const authorityEvidenceVersions: Row[] = [
    ver(
      "evv-rivera-unlinked-1",
      "ev-rivera-unlinked",
      1,
      null,
      "Healthcare agent form signed “E. Rivera” (synthetic)",
      "2026-09-30",
      "st-maya",
      1,
    ),
    ver(
      "evv-okafor-ada-1",
      "ev-okafor-ada",
      1,
      null,
      "Healthcare agent designation (synthetic)",
      "2024-03-02",
      "st-maya",
      19,
    ),
    ver(
      "evv-bennett-claire-1",
      "ev-bennett-claire",
      1,
      null,
      "Healthcare agent designation naming Claire (synthetic)",
      "2021-06-14",
      "st-maya",
      12,
    ),
    ver(
      "evv-bennett-owen-1",
      "ev-bennett-owen",
      1,
      null,
      "Healthcare agent designation naming Owen (synthetic)",
      "2025-01-09",
      "st-maya",
      3,
      "Different date from Claire's copy.",
    ),
    ver(
      "evv-patel-meera-1",
      "ev-patel-meera",
      1,
      null,
      "Proxy designation form (synthetic)",
      "2026-09-28",
      "st-tom",
      7,
      "Photo of the form was hard to read.",
    ),
    ver(
      "evv-patel-meera-2",
      "ev-patel-meera",
      2,
      "evv-patel-meera-1",
      "Proxy designation form — clearer copy (synthetic)",
      "2026-09-28",
      "st-tom",
      1,
      "Replaces version 1.",
    ),
    ver(
      "evv-nguyen-bao-1",
      "ev-nguyen-bao",
      1,
      null,
      "Healthcare agent designation (synthetic)",
      "2023-11-20",
      "st-tom",
      28,
    ),
    ver(
      "evv-hart-june-1",
      "ev-hart-june",
      1,
      null,
      "Healthcare agent designation (synthetic)",
      "2022-04-04",
      "st-maya",
      38,
    ),
    ver(
      "evv-lindqvist-hca-1",
      "ev-lindqvist-hca",
      1,
      null,
      "Healthcare agent designation (synthetic)",
      "2020-08-17",
      "st-tom",
      70,
    ),
    ver(
      "evv-lindqvist-pr-1",
      "ev-lindqvist-pr",
      1,
      null,
      "Personal representative appointment — metadata only (synthetic)",
      "2026-09-30",
      "st-tom",
      10,
    ),
  ];
  const review = (
    evidenceId: string,
    versionId: string,
    outcome: string,
    rationale: string,
    daysAgo: number,
  ) => ({
    tenantId: W,
    evidenceId,
    versionId,
    reviewerActorId: "st-priya",
    outcome,
    rationale,
    createdAt: d(-daysAgo),
  });
  const authorityReviews: Row[] = [
    review(
      "ev-okafor-ada",
      "evv-okafor-ada-1",
      "workflow_active",
      "Metadata complete; family and patient confirmed. Workflow status only.",
      18,
    ),
    review("ev-bennett-claire", "evv-bennett-claire-1", "workflow_active", "Metadata complete.", 11),
    review(
      "ev-bennett-owen",
      "evv-bennett-owen-1",
      "conflict",
      "A second designation with a later date names a different agent. Holding for human review; not a legal determination.",
      2,
    ),
    review(
      "ev-patel-meera",
      "evv-patel-meera-1",
      "needs_more_information",
      "Copy illegible; asked for a clearer copy.",
      6,
    ),
    review("ev-nguyen-bao", "evv-nguyen-bao-1", "workflow_active", "Metadata complete.", 27),
    review("ev-hart-june", "evv-hart-june-1", "workflow_active", "Metadata complete.", 37),
    review(
      "ev-lindqvist-pr",
      "evv-lindqvist-pr-1",
      "workflow_active",
      "Recorded after the bereavement transition. Workflow status only.",
      9,
    ),
  ];

  const RECORDER: Record<string, string> = {
    "hh-okafor": "st-maya",
    "hh-bennett": "st-maya",
    "hh-hart": "st-maya",
    "hh-patel": "st-tom",
    "hh-nguyen": "st-tom",
    "hh-lindqvist": "st-tom",
  };
  const consent = (
    id: string,
    householdId: string,
    c: {
      by: string;
      byActor: string | null;
      purpose: string;
      recipient: string;
      scope: ShareCategory[];
      starts: Date;
      expires: Date;
      state: string;
      extra?: Row;
    },
  ) => ({
    id,
    tenantId: W,
    householdId,
    grantedByName: c.by,
    grantedByActorId: c.byActor,
    // Recorded by the household's care guide; activated by a different person (the reviewer).
    recordedByActorId: RECORDER[householdId] ?? "st-maya",
    version: 1,
    activatedVersion: c.state === "draft" ? null : 1,
    purpose: c.purpose,
    recipientName: c.recipient,
    scope: c.scope,
    startsAt: c.starts,
    expiresAt: c.expires,
    state: c.state,
    revocationPath: "Withdraw any time in Zeporah under Sharing, or tell your care guide.",
    activatedByActorId: c.state === "draft" ? null : "st-priya",
    activatedAt: c.state === "draft" ? null : c.starts,
    createdAt: c.starts,
    ...(c.extra ?? {}),
  });
  const consents: Row[] = [
    // Demo: recorded and confirmed as version 1, then the end date changed, so version 2 needs Ada's confirmation.
    consent("cs-okafor-equipment", "hh-okafor", {
      by: "Ada Okafor",
      byActor: "fm-ada",
      purpose: "Coordinate a hospital-bed delivery",
      recipient: "Oakwood Home Medical Supply (synthetic)",
      scope: ["contact_details", "visit_schedule"],
      starts: d(-6),
      expires: d(40),
      state: "draft",
      extra: { version: 2 },
    }),
    consent("cs-okafor-library", "hh-okafor", {
      by: "Chidi Okafor",
      byActor: "fm-chidi",
      purpose: "Arrange audiobook deliveries",
      recipient: "Maplewood Library Homebound Service (synthetic)",
      scope: ["contact_details"],
      starts: d(-1),
      expires: d(29),
      state: "draft",
    }),
    consent("cs-okafor-respite", "hh-okafor", {
      by: "Grace Okafor",
      byActor: "fm-grace",
      purpose: "Coordinate a short respite stay",
      recipient: "Brightwater Respite House (synthetic)",
      scope: ["contact_details", "visit_schedule", "vault_status"],
      starts: d(-2),
      expires: d(28),
      state: "active",
    }),
    consent("cs-bennett-equipment", "hh-bennett", {
      by: "Harold Bennett",
      byActor: "fm-harold",
      purpose: "Arrange home equipment pickup",
      recipient: "Northside Equipment Services (synthetic)",
      scope: ["contact_details", "visit_schedule"],
      starts: d(-4),
      expires: d(26),
      state: "active",
    }),
    consent("cs-patel-chaplain", "hh-patel", {
      by: "Ravi Patel",
      byActor: "fm-ravi",
      purpose: "Arrange a community chaplain visit",
      recipient: "Riverside Interfaith Chaplaincy (synthetic)",
      scope: ["contact_details", "visit_schedule"],
      starts: d(-3),
      expires: d(27),
      state: "active",
    }),
    consent("cs-nguyen-meals", "hh-nguyen", {
      by: "Linh Nguyen",
      byActor: "fm-linh",
      purpose: "Coordinate meal deliveries",
      recipient: "Neighbors Table Meals (synthetic)",
      scope: ["contact_details", "visit_schedule"],
      starts: d(-20),
      expires: d(10),
      state: "revoked",
      extra: {
        revokedAt: d(-1),
        revokedByActorId: "fm-linh",
        revokeReason: "The family will arrange meals directly.",
      },
    }),
    consent("cs-nguyen-transport", "hh-nguyen", {
      by: "Linh Nguyen",
      byActor: "fm-linh",
      purpose: "Coordinate volunteer transport",
      recipient: "Helping Wheels Volunteers (synthetic)",
      scope: ["contact_details"],
      starts: d(-5),
      expires: d(25),
      state: "active",
    }),
    consent("cs-hart-pharmacy", "hh-hart", {
      by: "Walter Hart",
      byActor: "fm-walter",
      purpose: "Share the visit schedule with the community pharmacy",
      recipient: "Oakline Community Pharmacy (synthetic)",
      scope: ["contact_details", "visit_schedule"],
      starts: d(-30),
      expires: d(30),
      state: "active",
    }),
    consent("cs-hart-benefits", "hh-hart", {
      by: "Walter Hart",
      byActor: "fm-walter",
      purpose: "Coordinate with a benefits counselor",
      recipient: "County Benefits Navigation (synthetic)",
      scope: ["contact_details"],
      starts: d(-33),
      expires: d(-3),
      state: "active",
    }),
    consent("cs-lindqvist-circle", "hh-lindqvist", {
      by: "Ingrid Lindqvist",
      byActor: "fm-ingrid",
      purpose: "Connect with a bereavement support group",
      recipient: "Willow Creek Bereavement Circle (synthetic)",
      scope: ["contact_details", "bereavement_contact"],
      starts: d(-9),
      expires: d(80),
      state: "active",
    }),
  ];

  const packet = (
    id: string,
    householdId: string,
    p: {
      purpose: string;
      recipient: string;
      consentId: string | null;
      authorityId: string | null;
      expires: Date;
      state?: string;
      reason?: string;
      createdBy?: string;
      at: Date;
    },
    tenantId = W,
  ) => ({
    id,
    tenantId,
    householdId,
    purpose: p.purpose,
    recipientName: p.recipient,
    consentId: p.consentId,
    authorityEvidenceId: p.authorityId,
    expiresAt: p.expires,
    state: p.state ?? "draft",
    lastReasonCode: p.reason ?? null,
    createdByActorId: p.createdBy ?? "st-maya",
    createdAt: p.at,
    updatedAt: p.at,
  });
  const packets: Row[] = [
    {
      ...packet("pk-okafor-respite", "hh-okafor", {
        purpose: "Coordinate a short respite stay",
        recipient: "Brightwater Respite House (synthetic)",
        consentId: "cs-okafor-respite",
        authorityId: "ev-okafor-ada",
        expires: d(5),
        at: h(-3),
      }),
      // Decision 45: the person at Brightwater who reads it in Zeporah once it's released.
      recipientContactName: "Rosa Lin",
      recipientEmail: "rosa.lin@brightwater.example.invalid",
    },
    // Released to Rosa at Brightwater (decision 45), so her persona shows the recipient's view.
    {
      ...packet("pk-okafor-intake", "hh-okafor", {
        purpose: "Share contact details for respite intake",
        recipient: "Brightwater Respite House (synthetic)",
        consentId: "cs-okafor-respite",
        authorityId: "ev-okafor-ada",
        expires: d(5),
        state: "released",
        reason: "RELEASE_ALLOWED",
        at: d(-1),
      }),
      recipientContactName: "Rosa Lin",
      recipientEmail: "rosa.lin@brightwater.example.invalid",
    },
    packet("pk-bennett-equipment", "hh-bennett", {
      purpose: "Arrange home equipment pickup",
      recipient: "Northside Equipment Services (synthetic)",
      consentId: "cs-bennett-equipment",
      authorityId: "ev-bennett-claire",
      expires: d(6),
      state: "held",
      reason: "AUTHORITY_CONFLICT",
      at: d(-2),
    }),
    packet("pk-patel-chaplain", "hh-patel", {
      purpose: "Arrange a community chaplain visit",
      recipient: "Riverside Interfaith Chaplaincy (synthetic)",
      consentId: "cs-patel-chaplain",
      authorityId: "ev-patel-meera",
      expires: d(7),
      createdBy: "st-tom",
      at: d(-1),
    }),
    packet("pk-nguyen-meals", "hh-nguyen", {
      purpose: "Coordinate meal deliveries",
      recipient: "Neighbors Table Meals (synthetic)",
      consentId: "cs-nguyen-meals",
      authorityId: "ev-nguyen-bao",
      expires: d(4),
      createdBy: "st-tom",
      at: d(-3),
    }),
    packet("pk-nguyen-transport", "hh-nguyen", {
      purpose: "Coordinate volunteer transport",
      recipient: "Helping Wheels Volunteers (synthetic)",
      consentId: "cs-nguyen-transport",
      authorityId: "ev-nguyen-bao",
      expires: d(9),
      createdBy: "st-tom",
      at: d(-1),
    }),
    packet("pk-hart-pharmacy", "hh-hart", {
      purpose: "Share the visit schedule with the community pharmacy",
      recipient: "Oakline Community Pharmacy (synthetic)",
      consentId: "cs-hart-pharmacy",
      authorityId: "ev-hart-june",
      expires: d(-1),
      at: d(-8),
    }),
    packet("pk-hart-benefits", "hh-hart", {
      purpose: "Coordinate with a benefits counselor",
      recipient: "County Benefits Navigation (synthetic)",
      consentId: "cs-hart-benefits",
      authorityId: "ev-hart-june",
      expires: d(10),
      at: d(-2),
    }),
    packet("pk-lindqvist-circle", "hh-lindqvist", {
      purpose: "Connect with a bereavement support group",
      recipient: "Willow Creek Bereavement Circle (synthetic)",
      consentId: "cs-lindqvist-circle",
      authorityId: "ev-lindqvist-pr",
      expires: d(30),
      state: "released",
      reason: "RELEASE_ALLOWED",
      createdBy: "st-tom",
      at: d(-8),
    }),
    packet(
      "cpk-moss-transport",
      "chh-moss",
      {
        purpose: "Coordinate volunteer transport",
        recipient: "Valley Rides (synthetic)",
        consentId: null,
        authorityId: null,
        expires: d(7),
        createdBy: "cst-sam",
        at: d(-1),
      },
      C,
    ),
  ];
  const manifest = (packetId: string, categories: ShareCategory[], tenantId = W) =>
    categories.map((category) => ({ tenantId, packetId, category, justification: "" }));
  const packetManifestItems: Row[] = [
    ...manifest("pk-okafor-respite", ["contact_details", "visit_schedule"]),
    ...manifest("pk-okafor-intake", ["contact_details"]),
    ...manifest("pk-bennett-equipment", ["contact_details", "visit_schedule"]),
    ...manifest("pk-patel-chaplain", ["contact_details", "visit_schedule"]),
    ...manifest("pk-nguyen-meals", ["contact_details"]),
    // pk-nguyen-transport deliberately has no manifest items (missing scope scenario)
    ...manifest("pk-hart-pharmacy", ["contact_details", "visit_schedule"]),
    ...manifest("pk-hart-benefits", ["contact_details"]),
    ...manifest("pk-lindqvist-circle", ["contact_details", "bereavement_contact"]),
    ...manifest("cpk-moss-transport", ["contact_details"], C),
  ];

  const bereavementTransitions: Row[] = [
    {
      id: "bt-lindqvist",
      tenantId: W,
      householdId: "hh-lindqvist",
      state: "confirmed",
      proposedByActorId: "st-tom",
      proposedAt: d(-12),
      confirmedByActorId: "st-dana",
      confirmedAt: d(-12),
      survivingContactActorId: "fm-ingrid",
      survivingContactConfirmedAt: d(-11),
      note: "",
    },
  ];

  // Lindqvist's 13-month follow-up plan (src/domain/bereavement.ts), from the confirmed transition.
  const bereavementContacts: Row[] = BEREAVEMENT_STEPS.map((step) => ({
    tenantId: W,
    householdId: "hh-lindqvist",
    transitionId: "bt-lindqvist",
    step: step.code,
    dueOn: d(-12 + step.days),
  }));

  const escalations: Row[] = [
    {
      id: "es-lindqvist-correction",
      tenantId: W,
      householdId: "hh-lindqvist",
      kind: "consent_correction",
      sourceType: "consent_correction",
      sourceId: "cr-lindqvist-circle",
      summary:
        "A correction was requested for consent to share with Willow Creek Bereavement Circle (synthetic) (who receives it).",
      status: "resolved",
      ownerActorId: null,
      createdAt: d(-4),
      resolvedAt: d(-3),
      resolvedByActorId: "st-tom",
      resolution: "Checked with Ingrid by phone: this is the nearby group. (Synthetic, care team only.)",
    },
    {
      id: "es-okafor-library-review",
      tenantId: W,
      householdId: "hh-okafor",
      kind: "consent_review",
      sourceType: "consent",
      sourceId: "cs-okafor-library",
      summary:
        "The person named as giving consent (version 1) can't confirm it in the app under the current workflow. It is held; a person on the care team must review it. It is never confirmed automatically.",
      status: "open",
      ownerActorId: null,
      createdAt: d(-1),
    },
    {
      id: "es-rivera-identity",
      tenantId: W,
      householdId: "hh-rivera",
      kind: "identity_review",
      sourceType: "authority_evidence",
      sourceId: "ev-rivera-unlinked",
      summary:
        "An authority record isn't linked to a household person, so who it names can't be confirmed. Sharing that depends on it is held until a reviewer links it.",
      status: "open",
      ownerActorId: null,
      createdAt: d(-1),
    },
    {
      id: "es-patel-correction",
      tenantId: W,
      householdId: "hh-patel",
      kind: "consent_correction",
      sourceType: "consent_correction",
      sourceId: "cr-patel-chaplain",
      summary:
        "A correction was requested for consent to share with Riverside Interfaith Chaplaincy (synthetic) (the dates).",
      status: "open",
      ownerActorId: null,
      createdAt: h(-20),
    },
    {
      id: "es-bennett-authority",
      tenantId: W,
      householdId: "hh-bennett",
      kind: "authority_conflict",
      sourceType: "authority_evidence",
      sourceId: "ev-bennett-owen",
      summary:
        "Two healthcare-agent records name different people. Sharing is held until a person reviews them with the family.",
      // Taken by Priya: the live app sets the owner and "acknowledged" together.
      status: "acknowledged",
      ownerActorId: "st-priya",
      createdAt: d(-2),
    },
    {
      id: "es-hart-benefits",
      tenantId: W,
      householdId: "hh-hart",
      kind: "family_request",
      sourceType: "support_request",
      sourceId: null,
      summary: "June asked to talk with someone about benefits paperwork.",
      status: "acknowledged",
      ownerActorId: "st-maya",
      createdAt: d(-5),
    },
  ];

  /** History written through the audit chain (in time order) so the timelines aren't empty. */
  const history: { at: Date; e: Row }[] = [
    // Equipment consent: recorded, confirmed (v1), then changed (v2).
    {
      at: h(-6 * 24 - 2),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "st-maya",
        action: "consent.recorded",
        subjectType: "consent",
        subjectId: "cs-okafor-equipment",
        summary:
          "A consent to share with Oakwood Home Medical Supply (synthetic) was set up. It needs Ada Okafor to confirm it, then a care-team reviewer to approve it.",
        visibility: "sharing",
        context: { version: 1, grantor: "fm-ada", grantorCanConfirm: true },
      },
    },
    {
      at: d(-6),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "fm-ada",
        action: "consent.confirmed",
        subjectType: "consent",
        subjectId: "cs-okafor-equipment",
        summary:
          "Ada confirmed the consent to share with Oakwood Home Medical Supply (synthetic). A care-team reviewer still has to approve it.",
        visibility: "sharing",
        context: {
          confirmationId: "cc-okafor-equipment-1",
          consentVersion: 1,
          method: CONSENT_CONFIRMATION_METHOD,
          statement: CONSENT_CONFIRMATION_STATEMENT,
        },
      },
    },
    {
      at: d(-1),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "st-maya",
        action: "consent.amended",
        subjectType: "consent",
        subjectId: "cs-okafor-equipment",
        decision: "hold",
        reasonCode: "CONSENT_NOT_CONFIRMED",
        summary:
          "The consent to share with Oakwood Home Medical Supply (synthetic) changed: the end date. It needs confirming again before anything more is shared.",
        visibility: "sharing",
        context: {
          version: 2,
          previousVersion: 1,
          changed: ["expiry"],
          previous: { expiry: d(29).toISOString() },
          heldPackets: [],
        },
      },
    },
    // Lindqvist correction: requested by Ingrid, reviewed by Tomás with no change.
    {
      at: d(-4),
      e: {
        tenantId: W,
        householdId: "hh-lindqvist",
        actorId: "fm-ingrid",
        action: "consent.correction_requested",
        subjectType: "consent",
        subjectId: "cs-lindqvist-circle",
        decision: "hold",
        reasonCode: "CONSENT_CORRECTION_PENDING",
        summary:
          "Ingrid asked for a correction to a sharing consent. Nothing is shared under it until the care team resolves the request.",
        visibility: "sharing",
        context: { requestId: "cr-lindqvist-circle", version: 1, categories: ["recipient"] },
      },
    },
    {
      at: d(-3),
      e: {
        tenantId: W,
        householdId: "hh-lindqvist",
        actorId: "st-tom",
        action: "consent.correction_dismissed",
        subjectType: "consent",
        subjectId: "cs-lindqvist-circle",
        summary:
          "A person on the care team reviewed a correction request and made no change. They gave an explanation.",
        visibility: "sharing",
        context: { requestId: "cr-lindqvist-circle" },
      },
    },
    // Cedar Valley wording: set, then turned off.
    {
      at: d(-20),
      e: {
        tenantId: C,
        actorId: "cst-jordan",
        action: "settings.message_expectation_set",
        subjectType: "organization",
        subjectId: SEED.orgs.cedar,
        summary: "Routine-message wording for families was updated (version 1).",
        visibility: "staff",
        context: { version: 1, enabled: true },
      },
    },
    {
      at: d(-10),
      e: {
        tenantId: C,
        actorId: "cst-jordan",
        action: "settings.message_expectation_off",
        subjectType: "organization",
        subjectId: SEED.orgs.cedar,
        summary:
          "Routine-message wording for families was turned off (version 2). Families see no response expectation.",
        visibility: "staff",
        context: { version: 2, enabled: false },
      },
    },
    // Existing seeded escalations: the events the live app writes for them.
    {
      at: d(-5),
      e: {
        tenantId: W,
        householdId: "hh-hart",
        actorId: "fm-june",
        action: "escalation.raised",
        subjectType: "escalation",
        subjectId: "es-hart-benefits",
        summary: "An escalation was created in the care-team queue.",
        visibility: "family",
        context: { kind: "family_request" },
      },
    },
    {
      at: h(-5 * 24 + 2),
      e: {
        tenantId: W,
        householdId: "hh-hart",
        actorId: "st-maya",
        action: "escalation.owned",
        subjectType: "escalation",
        subjectId: "es-hart-benefits",
        summary: "Maya Chen took ownership of an escalation.",
        visibility: "staff",
      },
    },
    {
      at: h(-2 * 24 + 1),
      e: {
        tenantId: W,
        householdId: "hh-bennett",
        actorId: "st-priya",
        action: "escalation.owned",
        subjectType: "escalation",
        subjectId: "es-bennett-authority",
        summary: "Priya Raman took ownership of an escalation.",
        visibility: "staff",
      },
    },
    {
      at: d(-2),
      e: {
        tenantId: W,
        householdId: "hh-bennett",
        actorId: "st-maya",
        action: "authority.conflict_detected",
        subjectType: "authority_evidence",
        subjectId: "ev-bennett-owen",
        decision: "hold",
        reasonCode: "AUTHORITY_CONFLICT",
        summary: "Authority records linked to different people were detected and held for human review.",
        visibility: "staff",
      },
    },
    ...[30, 7].map((daysAgo, i) => ({
      at: d(-daysAgo),
      e: {
        tenantId: W,
        actorId: "st-dana",
        action: "settings.message_expectation_set",
        subjectType: "organization",
        subjectId: SEED.orgs.willow,
        summary: `Routine-message wording for families was updated (version ${i + 1}).`,
        visibility: "staff",
        context: { version: i + 1, enabled: true },
      },
    })),
    {
      at: h(-30),
      e: {
        tenantId: W,
        householdId: "hh-rivera",
        actorId: "st-maya",
        action: "authority.submitted",
        subjectType: "authority_evidence",
        subjectId: "ev-rivera-unlinked",
        summary:
          "Authority evidence metadata was recorded for review (version 1). This is a workflow status, not a legal determination.",
        visibility: "staff",
      },
    },
    {
      at: h(-30),
      e: {
        tenantId: W,
        householdId: "hh-rivera",
        actorId: "st-maya",
        action: "authority.identity_review_opened",
        subjectType: "authority_evidence",
        subjectId: "ev-rivera-unlinked",
        decision: "hold",
        reasonCode: "AUTHORITY_IDENTITY_UNRESOLVED",
        summary: "An identity review was opened: this record isn't linked to a household person.",
        visibility: "staff",
      },
    },
    {
      at: h(-24),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "st-maya",
        action: "consent.recorded",
        subjectType: "consent",
        subjectId: "cs-okafor-library",
        summary:
          "A consent to share with Maplewood Library Homebound Service (synthetic) was set up. The person named can't confirm it in the app, so a care-team reviewer will look at it first.",
        visibility: "sharing",
        context: { version: 1, grantor: "fm-chidi", grantorCanConfirm: false },
      },
    },
    {
      at: h(-20),
      e: {
        tenantId: W,
        householdId: "hh-patel",
        actorId: "fm-ravi",
        action: "consent.correction_requested",
        subjectType: "consent",
        subjectId: "cs-patel-chaplain",
        decision: "hold",
        reasonCode: "CONSENT_CORRECTION_PENDING",
        summary:
          "Ravi asked for a correction to a sharing consent. Nothing is shared under it until the care team resolves the request.",
        visibility: "sharing",
        context: { requestId: "cr-patel-chaplain", version: 1, categories: ["dates"] },
      },
    },
    ...onboarded.map(([householdId, by, daysAgo]) => ({
      at: h(-daysAgo * 24 + 4),
      e: {
        tenantId: W,
        householdId,
        actorId: by,
        action: "onboarding.completed",
        subjectType: "household",
        subjectId: householdId,
        summary: "Household setup was completed.",
        visibility: "family",
      },
    })),
    {
      at: d(-19),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "st-maya",
        action: "authority.submitted",
        subjectType: "authority_evidence",
        subjectId: "ev-okafor-ada",
        summary: "Authority evidence metadata was recorded for review.",
        visibility: "staff",
      },
    },
    {
      at: d(-18),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "st-priya",
        action: "authority.reviewed",
        subjectType: "authority_evidence",
        subjectId: "ev-okafor-ada",
        summary:
          "A reviewer marked the authority workflow active (workflow status, not a legal determination).",
        visibility: "staff",
      },
    },
    {
      at: d(-3),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "st-maya",
        action: "update.posted",
        subjectType: "family_update",
        subjectId: "up-okafor-1",
        summary: "The care team posted an update: “This week's visit plan”.",
        visibility: "family",
      },
    },
    {
      at: d(-3),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "fm-daniel",
        action: "update.acknowledged",
        subjectType: "family_update",
        subjectId: "up-okafor-1",
        summary: "Daniel acknowledged an update.",
        visibility: "family",
      },
    },
    {
      at: d(-3),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "fm-daniel",
        action: "vault.reviewed",
        subjectType: "vault_item",
        subjectId: null,
        summary: "A vault item was reviewed.",
        visibility: "family",
      },
    },
    {
      at: d(-2),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "st-priya",
        action: "consent.activated",
        subjectType: "consent",
        subjectId: "cs-okafor-respite",
        summary: "The consent to share with Brightwater Respite House (synthetic) is now active.",
        visibility: "family",
      },
    },
    {
      at: d(-2),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "fm-daniel",
        action: "message.sent",
        subjectType: "message",
        subjectId: "ms-2",
        summary: "Daniel sent a message to the care guide.",
        visibility: "family",
      },
    },
    {
      at: d(-2),
      e: {
        tenantId: W,
        householdId: "hh-bennett",
        actorId: "st-priya",
        action: "authority.reviewed",
        subjectType: "authority_evidence",
        subjectId: "ev-bennett-owen",
        decision: "hold",
        reasonCode: "AUTHORITY_CONFLICT",
        summary: "A reviewer recorded an authority conflict; sharing is held for human review.",
        visibility: "staff",
      },
    },
    {
      at: d(-2),
      e: {
        tenantId: W,
        householdId: "hh-bennett",
        actorId: "st-dana",
        action: "packet.release_requested",
        subjectType: "packet",
        subjectId: "pk-bennett-equipment",
        decision: "hold",
        reasonCode: "AUTHORITY_CONFLICT",
        summary: "A release was requested and held: conflicting authority evidence.",
        visibility: "staff",
      },
    },
    {
      at: d(-1),
      e: {
        tenantId: W,
        householdId: "hh-nguyen",
        actorId: "fm-linh",
        action: "consent.revoked",
        subjectType: "consent",
        subjectId: "cs-nguyen-meals",
        summary: "Consent to share with Neighbors Table Meals (synthetic) was withdrawn.",
        visibility: "family",
      },
    },
    {
      at: d(-12),
      e: {
        tenantId: W,
        householdId: "hh-lindqvist",
        actorId: "st-dana",
        action: "lifecycle.bereavement_confirmed",
        subjectType: "household",
        subjectId: "hh-lindqvist",
        summary:
          "The household moved to bereavement support. Practical support continues; protected access was narrowed.",
        visibility: "family",
      },
    },
    {
      at: d(-1),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "st-dana",
        action: "packet.released",
        subjectType: "packet",
        subjectId: "pk-okafor-intake",
        decision: "allow",
        reasonCode: "RELEASE_ALLOWED",
        summary:
          "Release to Brightwater Respite House (synthetic) for: Share contact details for respite intake. Released in Zeporah. Nothing was delivered outside Zeporah.",
        visibility: "family",
        context: { alerted: true },
      },
    },
    {
      at: d(-8),
      e: {
        tenantId: W,
        householdId: "hh-lindqvist",
        actorId: "st-dana",
        action: "packet.released",
        subjectType: "packet",
        subjectId: "pk-lindqvist-circle",
        decision: "allow",
        reasonCode: "RELEASE_ALLOWED",
        summary:
          "Release to Willow Creek Bereavement Circle (synthetic) for: Connect with a bereavement support group. Released in Zeporah. Nothing was delivered outside Zeporah.",
        visibility: "family",
      },
    },
    {
      at: h(-4),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "fm-ada",
        action: "message.sent",
        subjectType: "message",
        subjectId: "ms-4",
        summary: "Ada sent a message to the care guide.",
        visibility: "family",
      },
    },
    {
      at: h(-5),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "st-maya",
        action: "update.posted",
        subjectType: "family_update",
        subjectId: "up-okafor-2",
        summary: "The care team posted an update: “Respite stay — next steps”.",
        visibility: "family",
      },
    },
    {
      at: h(-3),
      e: {
        tenantId: W,
        householdId: "hh-okafor",
        actorId: "st-maya",
        action: "packet.drafted",
        subjectType: "packet",
        subjectId: "pk-okafor-respite",
        summary: "A sharing packet was drafted for review.",
        visibility: "staff",
      },
    },
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  /** Demo: Ravi, the named grantor, asked for the chaplain consent's dates to be corrected; sharing under it is held. */
  const consentCorrectionRequests: Row[] = [
    // Demo: Ingrid, the named grantor, asked about the recipient; the care team reviewed it and made no change.
    {
      id: "cr-lindqvist-circle",
      tenantId: W,
      householdId: "hh-lindqvist",
      consentId: "cs-lindqvist-circle",
      consentVersion: 1,
      requestedByActorId: "fm-ingrid",
      categories: ["recipient"],
      detail: "I wasn't sure this is the group that meets near us. (Synthetic.)",
      status: "resolved",
      outcome: "dismissed",
      resolutionNote: "Checked with Ingrid by phone: this is the nearby group. (Synthetic, care team only.)",
      resolvedByActorId: "st-tom",
      escalationId: "es-lindqvist-correction",
      createdAt: d(-4),
      resolvedAt: d(-3),
    },
    {
      id: "cr-patel-chaplain",
      tenantId: W,
      householdId: "hh-patel",
      consentId: "cs-patel-chaplain",
      consentVersion: 1,
      requestedByActorId: "fm-ravi",
      categories: ["dates"],
      detail: "The chaplain can only come after the 20th, so the dates need moving. (Synthetic.)",
      status: "open",
      escalationId: "es-patel-correction",
      createdAt: h(-20),
    },
  ];

  /**
   * Willow Creek's own wording about routine messages (two versions, so the history shows).
   * Cedar Valley has none, so its families see no expectation — the app supplies no default.
   */
  const messageExpectations: Row[] = [
    {
      tenantId: C,
      organizationId: SEED.orgs.cedar,
      version: 1,
      enabled: true,
      handlingHours: "",
      expectation: "Your hospice has shared guidance for routine messages.",
      fallback: "",
      effectiveFrom: d(-20),
      changedByActorId: "cst-jordan",
      createdAt: d(-20),
    },
    {
      tenantId: C,
      organizationId: SEED.orgs.cedar,
      version: 2,
      enabled: false,
      handlingHours: "",
      expectation: "",
      fallback: "",
      effectiveFrom: d(-10),
      changedByActorId: "cst-jordan",
      createdAt: d(-10),
    },
    {
      tenantId: W,
      organizationId: SEED.orgs.willow,
      version: 1,
      enabled: true,
      handlingHours: "",
      expectation: "Your hospice has shared guidance for routine messages.",
      fallback: "",
      effectiveFrom: d(-30),
      changedByActorId: "st-dana",
      createdAt: d(-30),
    },
    {
      tenantId: W,
      organizationId: SEED.orgs.willow,
      version: 2,
      enabled: true,
      handlingHours: "",
      // The 24-hour line is already shown beside the message box, so the wording doesn't repeat it.
      expectation: "Your hospice has shared guidance for routine messages.",
      fallback: "",
      // Founder decision 24: Willow Creek's expected reply time.
      replyTime: "within 1 business day",
      effectiveFrom: d(-7),
      changedByActorId: "st-dana",
      createdAt: d(-7),
    },
  ];

  const packetReleaseReceipts: Row[] = [
    {
      id: "rcpt-okafor-intake",
      tenantId: W,
      packetId: "pk-okafor-intake",
      releasedByActorId: "st-dana",
      releasedAt: d(-1),
      recipientName: "Brightwater Respite House (synthetic)",
      purpose: "Share contact details for respite intake",
      manifest: ["contact_details"],
      expiresAt: d(5),
    },
    {
      tenantId: W,
      packetId: "pk-lindqvist-circle",
      releasedByActorId: "st-dana",
      releasedAt: d(-8),
      recipientName: "Willow Creek Bereavement Circle (synthetic)",
      purpose: "Connect with a bereavement support group",
      manifest: ["contact_details", "bereavement_contact"],
      expiresAt: d(30),
    },
  ];

  /** Every non-draft seeded consent was confirmed in the app by its named grantor (version 1). */
  const consentConfirmations: Row[] = [
    ...consents
      .filter((c) => c["state"] !== "draft" && c["grantedByActorId"])
      .map((c) => ({
        tenantId: W,
        consentId: c["id"],
        consentVersion: 1,
        actorId: c["grantedByActorId"],
        method: CONSENT_CONFIRMATION_METHOD,
        statement: CONSENT_CONFIRMATION_STATEMENT,
        confirmedAt: new Date((c["startsAt"] as Date).getTime() - 3_600_000),
      })),
    // Ada confirmed version 1 of the equipment consent before it changed; it's kept, but doesn't count for version 2.
    {
      id: "cc-okafor-equipment-1",
      tenantId: W,
      consentId: "cs-okafor-equipment",
      consentVersion: 1,
      actorId: "fm-ada",
      method: CONSENT_CONFIRMATION_METHOD,
      statement: CONSENT_CONFIRMATION_STATEMENT,
      confirmedAt: d(-6),
    },
  ];

  /** Each seeded authority record names a household member in its submitted evidence. */
  const authorityIdentityLinks: Row[] = authorityEvidence
    .filter((e) => e["holderActorId"])
    .map((e) => ({
      tenantId: W,
      evidenceId: e["id"],
      actorId: e["holderActorId"],
      basis: "submitted_evidence",
      note: "",
      linkedByActorId:
        (authorityEvidenceVersions.find((v) => v["evidenceId"] === e["id"])?.[
          "submittedByActorId"
        ] as string) ?? "st-maya",
      linkedAt: e["createdAt"],
    }));

  // The assignment history behind Willow Creek's seeded care-guide memberships, made by operations (Dana).
  const actorName = (id: string) => actors.find((a) => a["id"] === id)?.["displayName"] as string;
  for (const m of memberships.filter(
    (r) => r["tenantId"] === W && r["roleCode"] === "care_guide" && r["householdId"],
  )) {
    const name = actorName(m["actorId"] as string);
    history.push({
      at: m["createdAt"] as Date,
      e: {
        tenantId: W,
        householdId: m["householdId"],
        actorId: "st-dana",
        action: "assignment.created",
        subjectType: "membership",
        subjectId: m["id"],
        summary: `${name} was assigned to this household as a care guide.`,
        visibility: "staff",
        context: { assignee: m["actorId"], role: "care_guide" },
      },
    });
    if (m["status"] === "ended")
      history.push({
        at: m["endedAt"] as Date,
        e: {
          tenantId: W,
          householdId: m["householdId"],
          actorId: "st-dana",
          action: "assignment.ended",
          subjectType: "membership",
          subjectId: m["id"],
          summary: `${name}'s care-guide assignment to this household ended.`,
          visibility: "staff",
          context: { assignee: m["actorId"], role: "care_guide", reason: m["endReason"] },
        },
      });
  }

  history.sort((a, b) => a.at.getTime() - b.at.getTime());
  return {
    tenants,
    consentCorrectionRequests,
    messageExpectations,
    consentConfirmations,
    authorityIdentityLinks,
    organizations,
    actors,
    households,
    memberships,
    preferences,
    onboardingSteps,
    supportPreferences,
    careCoordinationRecords,
    vaultItems,
    tasks,
    familyUpdates,
    acknowledgements,
    staffNotes,
    messageThreads,
    messages,
    notifications,
    authorityEvidence,
    authorityEvidenceVersions,
    authorityReviews,
    consents,
    packets,
    packetManifestItems,
    bereavementTransitions,
    bereavementContacts,
    escalations,
    history,
    packetReleaseReceipts,
    // Enterprise records (decision 58). Empty in the standard seed; the demo week fills them.
    staffAbsences: [] as Row[],
    handoffs: [] as Row[],
    partnerEvents: [] as Row[],
    exceptionClaims: [] as Row[],
    packetAccessLog: [] as Row[],
    /** Rosa can read the intake packet (decision 45); her account is already set up. */
    packetRecipientAccess: [
      {
        tenantId: W,
        packetId: "pk-okafor-intake",
        receiptId: "rcpt-okafor-intake",
        recipientActorId: "rc-rosa",
        grantedAt: d(-1),
        expiresAt: d(5),
      },
    ] as Row[],
  };
}
