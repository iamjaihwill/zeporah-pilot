/**
 * Listed contacts (founder decisions 74–78): the people around a household who aren't Zeporah
 * users. A listing is information only: no account, no notifications, no access.
 */
export const CONTACT_RELATIONSHIPS = [
  "death_doula",
  "private_caregiver",
  "outside_clinician",
  "faith_leader",
  "friend_neighbor",
  "service_provider",
  "other",
] as const;
export type ContactRelationship = (typeof CONTACT_RELATIONSHIPS)[number];

export const CONTACT_RELATIONSHIP_LABELS: Record<ContactRelationship, string> = {
  death_doula: "Death doula",
  private_caregiver: "Private caregiver",
  outside_clinician: "Outside clinician",
  faith_leader: "Faith or spiritual leader",
  friend_neighbor: "Friend or neighbor",
  service_provider: "Service provider",
  other: "Other",
};

/** A phone number with at least 7 digits; spaces, dashes, dots, brackets and a leading + allowed. */
export const looksLikePhone = (text: string) =>
  /^[+()\d\s.\-x]{7,30}$/i.test(text.trim()) && (text.match(/\d/g)?.length ?? 0) >= 7;

export const NAME_MAX = 120;
export const NOTE_MAX = 300;
