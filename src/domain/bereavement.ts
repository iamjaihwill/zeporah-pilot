/**
 * The bereavement follow-up programme: planned check-ins across the 13 months after a death.
 *
 * DEFAULT, awaiting founder/hospice confirmation: the steps and their timing below. A hospice's
 * own bereavement programme should eventually configure them; until then every household gets the
 * same plan when its bereavement transition is confirmed. Check-ins are human contacts recorded by
 * the care team — Zeporah never contacts anyone itself.
 */
export const BEREAVEMENT_SUPPORT_MONTHS = 13;

export const BEREAVEMENT_STEPS = [
  { code: "first_weeks", days: 14, staff: "First check-in", family: "In the first few weeks" },
  { code: "one_month", days: 30, staff: "One-month check-in", family: "Around one month" },
  { code: "three_months", days: 91, staff: "Three-month check-in", family: "Around three months" },
  { code: "six_months", days: 182, staff: "Six-month check-in", family: "Around six months" },
  { code: "nine_months", days: 273, staff: "Nine-month check-in", family: "Around nine months" },
  {
    code: "anniversary",
    days: 365,
    staff: "First-anniversary check-in",
    family: "Around the first anniversary",
  },
  { code: "closing", days: 395, staff: "Closing conversation", family: "Near the end of the 13 months" },
] as const;
export type BereavementStep = (typeof BEREAVEMENT_STEPS)[number]["code"];

export const CONTACT_OUTCOMES = ["reached", "message_left", "declined", "not_needed"] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];
export const CONTACT_OUTCOME_LABELS: Record<ContactOutcome, string> = {
  reached: "Talked with the family",
  message_left: "Left a message",
  declined: "They'd rather not be contacted",
  not_needed: "Not needed",
};

export const stepOf = (code: string) => BEREAVEMENT_STEPS.find((s) => s.code === code)!;

/** The date support ends: 13 months after the transition was confirmed. */
export function supportEndsAt(confirmedAt: Date) {
  const d = new Date(confirmedAt);
  d.setMonth(d.getMonth() + BEREAVEMENT_SUPPORT_MONTHS);
  return d;
}

/** Calm due-window wording: never "overdue". */
export function dueWindow(dueOn: Date, now: Date): "earlier" | "this_week" | "this_month" | "later" {
  const days = (dueOn.getTime() - now.getTime()) / 86_400_000;
  if (days < 0) return "earlier";
  if (days <= 7) return "this_week";
  if (days <= 31) return "this_month";
  return "later";
}
export const DUE_WINDOW_LABELS = {
  earlier: "Due earlier — still open",
  this_week: "Due this week",
  this_month: "Due this month",
  later: "Later",
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * An approximate date for a planned check-in, e.g. "early Nov" (interaction review, item 13).
 * Families see roughly when, not an appointment. Computed in the pilot's display zone.
 */
export function approxWhen(due: Date, timeZone = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "numeric",
    month: "numeric",
  }).formatToParts(due);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? 1);
  const month = Number(parts.find((p) => p.type === "month")?.value ?? 1);
  return `${day <= 10 ? "early" : day <= 20 ? "mid" : "late"} ${MONTHS[month - 1]}`;
}
