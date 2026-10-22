/**
 * Stable reason codes for packet-release decisions. Codes never change meaning once shipped;
 * add new ones instead. Each has a fixed decision and a safe, plain-language explanation that
 * can be shown to the person who asked — it never reveals another tenant's data or private content.
 */
export type Decision = "allow" | "hold" | "deny";

export const REASONS = {
  RELEASE_ALLOWED: {
    decision: "allow",
    explain:
      "Every check passed. The packet can be released to the named recipient for the stated purpose until it expires.",
  },
  // ---- deny: who is asking is wrong; nothing a reviewer can fix in this workflow
  NOT_AUTHENTICATED: {
    decision: "deny",
    explain: "You need to be signed in to do this.",
  },
  TENANT_MISMATCH: {
    decision: "deny",
    explain: "This isn't part of your organization's workspace, so it can't be released from here.",
  },
  OUT_OF_SCOPE: {
    decision: "deny",
    explain: "This item isn't available to you. It may not exist, or it may belong to another organization.",
  },
  ROLE_NOT_PERMITTED: {
    decision: "deny",
    explain: "Your role can't release packets. A hospice operations user or authority/consent reviewer can.",
  },
  HOUSEHOLD_CLOSED: {
    decision: "deny",
    explain: "This household's workspace is closed. Nothing new can be shared from it.",
  },
  AUDIT_UNAVAILABLE: {
    decision: "deny",
    explain: "The release couldn't be recorded, so nothing was sent. Please try again or contact support.",
  },
  // ---- hold: the workflow isn't ready; a person can resolve it
  PACKET_NOT_RELEASABLE: {
    decision: "hold",
    explain:
      "This packet has already been released, revoked or closed. Start a new packet if something still needs to be shared.",
  },
  PURPOSE_MISSING: {
    decision: "hold",
    explain: "The packet needs a stated purpose before anything can be shared.",
  },
  RECIPIENT_MISSING: {
    decision: "hold",
    explain: "The packet needs a named recipient before anything can be shared.",
  },
  SCOPE_EMPTY: {
    decision: "hold",
    explain: "The packet doesn't list any information to share. Add only what the recipient needs.",
  },
  AUTHORITY_MISSING: {
    decision: "hold",
    explain: "No authority workflow is linked to this packet. A reviewer needs to record one first.",
  },
  AUTHORITY_REVIEW_PENDING: {
    decision: "hold",
    explain:
      "The authority evidence is still waiting for review. Release is held until a reviewer records a decision.",
  },
  AUTHORITY_CONFLICT: {
    decision: "hold",
    explain:
      "There is conflicting authority evidence. Release is held until a person reviews it. Zeporah does not decide who has legal authority.",
  },
  AUTHORITY_IDENTITY_UNRESOLVED: {
    decision: "hold",
    explain:
      "It isn't yet clear whether authority records name the same person. Release is held until a reviewer links each record to a verified household person. A link is a workflow association, not a legal determination.",
  },
  AUTHORITY_NOT_ACTIVE: {
    decision: "hold",
    explain:
      "The linked authority workflow isn't active (it may have been withdrawn or replaced). Release is held.",
  },
  AUTHORITY_ENDED_BY_LIFECYCLE: {
    decision: "hold",
    explain:
      "The linked authority type no longer applies at this stage of the household's journey. A reviewer needs to link a current one.",
  },
  CONSENT_MISSING: {
    decision: "hold",
    explain: "There's no consent on record for this sharing. Release is held until one is recorded.",
  },
  CONSENT_NOT_ACTIVE: {
    decision: "hold",
    explain: "The consent for this sharing hasn't been activated by a reviewer. Release is held.",
  },
  CONSENT_NOT_CONFIRMED: {
    decision: "hold",
    explain:
      "The named person hasn't confirmed the current version of this consent. Release is held until they confirm it and a different reviewer activates it.",
  },
  CONSENT_CORRECTION_PENDING: {
    decision: "hold",
    explain:
      "Someone asked for this consent to be corrected. Release is held until a person on the care team resolves the request.",
  },
  CONSENT_REVOKED: {
    decision: "hold",
    explain:
      "The consent for this sharing was withdrawn. Nothing will be shared unless new consent is given.",
  },
  CONSENT_EXPIRED: {
    decision: "hold",
    explain: "The consent for this sharing has expired. Nothing will be shared unless it is renewed.",
  },
  CONSENT_NOT_STARTED: {
    decision: "hold",
    explain: "The consent for this sharing doesn't start yet. Release is held until its start date.",
  },
  CONSENT_RECIPIENT_MISMATCH: {
    decision: "hold",
    explain: "The packet's recipient isn't the recipient named in the consent. Release is held.",
  },
  CONSENT_PURPOSE_MISMATCH: {
    decision: "hold",
    explain: "The packet's purpose doesn't match the purpose in the consent. Release is held.",
  },
  CONSENT_SCOPE_MISMATCH: {
    decision: "hold",
    explain:
      "The packet includes information the consent doesn't cover. Remove it, or ask for consent that covers it.",
  },
  PACKET_EXPIRED: {
    decision: "hold",
    explain: "The packet's sharing window has already ended. Set a new future expiry to continue.",
  },
  LIFECYCLE_SCOPE_NARROWED: {
    decision: "hold",
    explain:
      "Some of this information stopped being shareable when the household moved to bereavement support. Remove it to continue.",
  },
} as const satisfies Record<string, { decision: Decision; explain: string }>;

export type ReasonCode = keyof typeof REASONS;
