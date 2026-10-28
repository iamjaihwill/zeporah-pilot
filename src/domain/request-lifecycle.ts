/**
 * The request lifecycle (founder decisions 79–83). Tasks, escalations and exceptions keep their own
 * models (decision 79); a family support request is an escalation with these states alongside its
 * status, and shares these words wherever it is shown.
 */

/** What the family sees (decision 80). Waiting names the kind of party, never a clinical reason. */
export const FAMILY_REQUEST_STATES = [
  "received",
  "with_owner",
  "waiting_on_you",
  "waiting_on_other",
  "resolved",
  "withdrawn",
] as const;
export type FamilyRequestState = (typeof FAMILY_REQUEST_STATES)[number];

/** Reopening is for 7 days after a resolution, back to the same owner (decision 81). */
export const REOPEN_DAYS = 7;
/** "Next update by" is a coordination commitment, never a clinical promise (decision 82). */
export const NEXT_UPDATE_MAX_DAYS = 14;
export const WAITING_LABEL_MAX = 60;
export const REASON_MAX = 300;

type Row = {
  status: "open" | "acknowledged" | "resolved";
  closedReason: "resolved" | "withdrawn" | null;
  waitingOn: "family" | "other" | null;
};

export function familyRequestState(e: Row): FamilyRequestState {
  if (e.status === "resolved") return e.closedReason === "withdrawn" ? "withdrawn" : "resolved";
  if (e.status === "open") return "received";
  if (e.waitingOn === "family") return "waiting_on_you";
  if (e.waitingOn === "other") return "waiting_on_other";
  return "with_owner";
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? null;

/** The short label, with the owner's first name and the kind of party where they apply. */
export function familyRequestLabel(
  state: FamilyRequestState,
  ownerName: string | null,
  waitingLabel: string | null,
): string {
  const first = firstName(ownerName);
  switch (state) {
    case "received":
      return "Received";
    case "with_owner":
      return first ? `With ${first}` : "With your care team";
    case "waiting_on_you":
      return "Waiting on you";
    case "waiting_on_other":
      return waitingLabel ? `Waiting on someone else: ${waitingLabel}` : "Waiting on someone else";
    case "resolved":
      return "Resolved";
    case "withdrawn":
      return "Withdrawn";
  }
}

/** The one-line explanation shown under the label. */
export function familyRequestExplanation(state: FamilyRequestState, ownerName: string | null): string {
  const first = firstName(ownerName) ?? "Someone on your care team";
  switch (state) {
    case "received":
      return "Your care team has it. Someone will take it and follow up.";
    case "with_owner":
      return `${first} is working on it.`;
    case "waiting_on_you":
      return `${first} needs something from you. Check your messages.`;
    case "waiting_on_other":
      return `${first} is waiting to hear back from someone outside your household.`;
    case "resolved":
      return "Your care team marked this resolved.";
    case "withdrawn":
      return "You withdrew this request.";
  }
}

/** Staff words for the same states, in the queue and on the request's detail. */
export function staffRequestState(e: Row & { waitingOnLabel: string | null }): string | null {
  if (e.status !== "acknowledged") return null;
  if (e.waitingOn === "family") return "Waiting on the family";
  if (e.waitingOn === "other")
    return e.waitingOnLabel ? `Waiting on someone else: ${e.waitingOnLabel}` : "Waiting on someone else";
  return null;
}
