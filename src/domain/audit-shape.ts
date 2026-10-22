/**
 * The approved audit shape (enterprise blueprint, decision 58): where each event came from, and
 * how a second step on a sensitive action is recorded. Plain data, shared by the server and screens.
 */

/**
 * `partner_simulated`: entered by staff on behalf of an outside organization, always labelled
 * simulated in the pilot. `rule`: raised by a deterministic rule. `recipient`: a named outside
 * recipient in the read-only packet portal.
 */
export const AUDIT_SOURCES = ["staff", "family", "recipient", "partner_simulated", "system", "rule"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const AUDIT_SOURCE_LABELS: Record<AuditSource, string> = {
  staff: "Staff",
  family: "Family",
  recipient: "Outside recipient",
  partner_simulated: "Partner · simulated",
  system: "System",
  rule: "Rule",
};

/** A second step on a sensitive action: who asked, and who approved it (a different person). */
export type AuditApproval = { requestedBy: string; approvedBy: string };

export const PREPARED_LABEL = "Prepared with Copilot";
