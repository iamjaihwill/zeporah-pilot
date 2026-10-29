/**
 * The only wording Zeporah's emails may carry (founder decisions 23, 27, 29d, 48c and 88). No email
 * names a person or carries health details or message text: fixed words plus a link into Zeporah.
 * The outbox refuses to send anything that doesn't match (services/outbox.ts).
 */
export type EmailKind = "notice" | "password_reset" | "password_changed" | "recipient_alert" | "invitation";

export const NOTICE_SUBJECT = "You have a new update in Zeporah";
export const NOTICE_BODY =
  "There's something new for you in Zeporah. Sign in to see it. To keep things private, this email never includes names, health details or message text.";
export const NOTICE_LINK = "/family/notifications";

export const RESET_SUBJECT = "Reset your Zeporah password";
export const RESET_BODY =
  "Someone asked to reset the password for this Zeporah account. If it was you, open the link within 30 minutes. If it wasn't, ignore this email: your password hasn't changed.";
export const CHANGED_SUBJECT = "Your Zeporah password was changed";
export const CHANGED_BODY = "Your Zeporah password was changed. If this wasn't you, tell your care team.";

export const RECIPIENT_ALERT_SUBJECT = "A shared packet is ready for you in Zeporah";
export const RECIPIENT_ALERT_BODY =
  "A hospice has shared a packet with you in Zeporah. Sign in to read it. To keep things private, this email never includes names, health details or the packet's contents.";

/** A one-time token in a link (auth/crypto.ts newToken: 32 random bytes, base64url). */
const TOKEN = "[A-Za-z0-9_-]{16,200}";

export const EMAIL_WORDING: Record<EmailKind, { subject: string; body: string; link: RegExp } | null> = {
  notice: { subject: NOTICE_SUBJECT, body: NOTICE_BODY, link: /^\/family\/notifications$/ },
  password_reset: { subject: RESET_SUBJECT, body: RESET_BODY, link: new RegExp(`^/reset/${TOKEN}$`) },
  password_changed: { subject: CHANGED_SUBJECT, body: CHANGED_BODY, link: /^\/$/ },
  recipient_alert: {
    subject: RECIPIENT_ALERT_SUBJECT,
    body: RECIPIENT_ALERT_BODY,
    link: new RegExp(`^/recipient(/setup/${TOKEN})?$`),
  },
  // Invitations show their link to the inviter; nothing emails one yet.
  invitation: null,
};

/** True only for the fixed wording of this kind of email. */
export function allowedWording(kind: EmailKind, e: { subject: string; body: string; link: string | null }) {
  const w = EMAIL_WORDING[kind];
  return !!w && !!e.link && e.subject === w.subject && e.body === w.body && w.link.test(e.link);
}
