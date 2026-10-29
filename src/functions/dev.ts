/**
 * DEVELOPMENT ONLY: the mail sink (decisions 23 and 27). Refused unless development sign-in is on,
 * which is also the only place the sink exists (src/server/mail.ts).
 */
import { createServerFn } from "@tanstack/react-start";

async function gate() {
  const { devSignInEnabled } = await import("@/server/auth/dev-gate");
  if (!devSignInEnabled()) throw new Error("Not available.");
}

/** The newest emails Zeporah would have sent. Synthetic data only. */
export const listDevMail = createServerFn({ method: "GET" }).handler(async () => {
  await gate();
  const { getDb } = await import("@/server/db/client");
  const { devMailbox } = await import("@/server/db/schema");
  const { desc } = await import("drizzle-orm");
  const db = await getDb();
  return db.select().from(devMailbox).orderBy(desc(devMailbox.createdAt)).limit(50);
});

/** Send email nudges that are due now, instead of waiting for the once-a-minute check. */
export const sendDueNoticesNow = createServerFn({ method: "POST" }).handler(async () => {
  await gate();
  const { getDb } = await import("@/server/db/client");
  const { sendDueEmailNotices } = await import("@/server/services/email-notices");
  const { dispatchOutbox } = await import("@/server/services/outbox");
  const db = await getDb();
  const sent = await sendDueEmailNotices(db);
  // And any other email that's due, including retries (decisions 88–89).
  await dispatchOutbox(db);
  return { sent };
});
