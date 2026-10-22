/**
 * Exact wording for what Zeporah does and does not do (founder-approved). Honest about effects —
 * nothing is delivered outside Zeporah — without calling the product a prototype; the environment
 * banner and the docs carry the non-production status. The UI, the audit summaries and the
 * claims test all read from here so no screen can overstate an effect.
 */
export const RELEASE_NOTE = "Released in Zeporah. Nothing was delivered outside Zeporah.";

/**
 * Founder decision 48c (amends decision 1): shown instead of RELEASE_NOTE when the named recipient
 * was given access and sent the sign-in alert. Where no alert went out, RELEASE_NOTE stays true.
 */
export const RELEASE_NOTE_RECIPIENT =
  "Released in Zeporah. The recipient reads it in Zeporah; only a sign-in link was emailed, never the contents.";
export const releaseNote = (recipientAlerted: boolean) => (recipientAlerted ? RELEASE_NOTE_RECIPIENT : RELEASE_NOTE);

export const REVOCATION_NOTE =
  "Future access through Zeporah is revoked. Nothing is recalled, and no external recipient was contacted.";

/**
 * After a support request (founder decision 26, superseding decision 1's earlier support wording).
 * The hospice's 24-hour line is always included; its expected reply time is added when it's set.
 */
export function supportConfirmation(line: string, replyTime?: string | null) {
  return [
    "Your request was sent to your care team. A person will decide how to follow up.",
    replyTime ? `Your care team usually replies ${replyTime}.` : null,
    `If it's urgent, call ${line}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export const OUT_OF_APP_NOTE =
  "Saved for future out-of-app notifications. Zeporah shows in-app notifications right away.";

/**
 * Where an email channel exists (decision 23), OUT_OF_APP_NOTE would be untrue, so the settings say
 * what these choices do instead.
 */
export const EMAIL_SETTINGS_NOTE =
  "These apply to email notices, if you turn them on. Zeporah shows in-app notifications right away.";

export { AUTHORITY_STATUS_NOTE } from "./authority-identity";

/** What each notification choice emails (founder decision 47). Shown only where email exists. */
export const CADENCE_HINTS = {
  as_it_happens: "Email right away for things that need you; anything else at most once a day.",
  daily_summary: "At most one email a day.",
  essential_only:
    "Email only for invitations and access changes, messages, consent and sharing outcomes, your tasks and deadlines, important changes in care, and account alerts.",
} as const;
