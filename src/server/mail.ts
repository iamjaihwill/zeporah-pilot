/**
 * Outgoing email (founder decisions 18, 23 and 27).
 *
 * Zeporah has no email provider: connecting one is an integration under decision 18 (vendor,
 * security and BAA review plus founder approval). Until then the only channel is the development
 * mail sink, which keeps each email in the `dev_mailbox` table instead of delivering it. The sink
 * is on only where development sign-in is on, because that's the only place someone can read it
 * (/dev/mail). Everywhere else there is no channel, and the app doesn't offer email at all.
 *
 * Every email names no person and carries no health details or message text: fixed wording plus
 * a link into Zeporah. Callers pass the wording; this module refuses anything else by shape.
 */
import { eq } from "drizzle-orm";
import type { Conn } from "./db/client";
import * as s from "./db/schema";
import { devSignInEnabled } from "./auth/dev-gate";
import { addresses } from "./environment";
import { publicUrl } from "@/domain/addresses";

export type Email = {
  tenantId: string;
  /** Sender name (the hospice's email sender name setting); defaults to "Zeporah". */
  fromName?: string | undefined;
  to: string;
  kind: "notice" | "password_reset" | "password_changed" | "recipient_alert" | "invitation";
  subject: string;
  body: string;
  /** A path inside Zeporah, e.g. "/family/notifications". Sent as a full address: see emailLink. */
  link: string;
};

/**
 * The link as it goes out: on the address the page opens on (domain/addresses.ts), so the person
 * lands where their sign-in works. Every email here is for a family member except the recipient
 * alert, whose /recipient page belongs to the care address. A path when no addresses are set.
 */
export const emailLink = (email: Pick<Email, "link">) => publicUrl(addresses(), email.link);

export interface MailChannel {
  readonly name: string;
  send(conn: Conn, email: Email): Promise<void>;
}

const devSink: MailChannel = {
  name: "development mail sink",
  async send(conn, email) {
    await conn.insert(s.devMailbox).values({
      tenantId: email.tenantId,
      toEmail: email.to,
      fromName: email.fromName || "Zeporah",
      kind: email.kind,
      subject: email.subject,
      body: email.body,
      link: emailLink(email),
    });
  },
};

/** The channel to use, or null when email isn't available here. */
export function mailChannel(): MailChannel | null {
  return devSignInEnabled() ? devSink : null;
}

export const emailAvailable = () => mailChannel() !== null;

/** The hospice's sender name for email notices, or "Zeporah" (staff rework, section 6). */
export async function senderNameFor(conn: Conn, tenantId: string): Promise<string> {
  const [o] = await conn
    .select({ n: s.organizations.emailSenderName })
    .from(s.organizations)
    .where(eq(s.organizations.tenantId, tenantId))
    .limit(1);
  return o?.n?.trim() || "Zeporah";
}
