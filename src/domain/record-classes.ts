/**
 * Record classes (brief reconciliation increment 5). **A proposal for decision D-05 and counsel, not
 * an approved schedule:** no retention period is attached to any class, and nothing in Zeporah
 * deletes records for age. Every table is listed so a new table can't be added without a class
 * (tests/unit/record-classes.test.ts). `review` marks classifications that need counsel or clinical
 * review before they're relied on, for example whether something is part of a designated record set.
 */

export const RECORD_CLASSES = [
  "configuration",
  "participation",
  "routine_coordination",
  "clinical_record_candidate",
  "consent_authority_evidence",
  "acknowledgement",
  "view_receipt",
  "notification",
  "account_security",
  "security_audit",
  "hold",
  "development_only",
] as const;
export type RecordClass = (typeof RECORD_CLASSES)[number];

type Entry = { class: RecordClass; review?: string };

/** Every table, by its database name. */
export const TABLE_CLASSES: Record<string, Entry> = {
  tenants: { class: "configuration" },
  organizations: { class: "configuration" },
  roles: { class: "configuration" },
  message_expectations: { class: "configuration" },
  actors: { class: "participation" },
  households: { class: "participation" },
  memberships: { class: "participation" },
  invitations: { class: "participation" },
  staff_invitations: { class: "participation" },
  preferences: { class: "participation" },
  onboarding_steps: { class: "participation" },
  support_preferences: { class: "participation" },
  care_coordination_records: {
    class: "clinical_record_candidate",
    review: "Visit rhythm, priorities and an EHR pointer: may be part of the hospice's record",
  },
  tasks: { class: "routine_coordination" },
  family_updates: { class: "routine_coordination" },
  message_threads: { class: "routine_coordination" },
  messages: {
    class: "routine_coordination",
    review: "Care-guide messages may need to go into the clinical record",
  },
  staff_notes: { class: "clinical_record_candidate", review: "Internal care-team notes" },
  escalations: { class: "routine_coordination", review: "Requests for follow-up may record a concern" },
  exception_claims: { class: "routine_coordination" },
  staff_absences: { class: "routine_coordination" },
  handoffs: { class: "routine_coordination" },
  partner_events: { class: "routine_coordination" },
  vault_items: { class: "routine_coordination" },
  private_notes: {
    class: "routine_coordination",
    review: "The patient's own notes: who may ever see or keep them",
  },
  bereavement_transitions: { class: "routine_coordination" },
  bereavement_contacts: { class: "routine_coordination" },
  authority_evidence: { class: "consent_authority_evidence" },
  authority_evidence_versions: { class: "consent_authority_evidence" },
  authority_identity_links: { class: "consent_authority_evidence" },
  authority_reviews: { class: "consent_authority_evidence" },
  consents: { class: "consent_authority_evidence" },
  consent_confirmations: { class: "consent_authority_evidence" },
  consent_correction_requests: { class: "consent_authority_evidence" },
  packets: { class: "consent_authority_evidence" },
  packet_manifest_items: { class: "consent_authority_evidence" },
  packet_release_receipts: { class: "consent_authority_evidence" },
  packet_recipient_access: { class: "consent_authority_evidence" },
  packet_access_log: { class: "consent_authority_evidence" },
  acknowledgements: { class: "acknowledgement" },
  thread_visits: { class: "view_receipt" },
  notifications: { class: "notification" },
  users: { class: "account_security" },
  sessions: { class: "account_security" },
  password_resets: { class: "account_security" },
  audit_events: { class: "security_audit" },
  retention_holds: { class: "hold" },
  dev_mailbox: { class: "development_only" },
};

export const classOf = (table: string): RecordClass => {
  const e = TABLE_CLASSES[table];
  if (!e) throw new Error(`No record class for table "${table}".`);
  return e.class;
};
