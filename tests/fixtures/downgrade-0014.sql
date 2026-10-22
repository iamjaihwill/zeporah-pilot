-- Undo migration 0014_email_reply_reset, giving the schema exactly as it was at 0013.
-- Used only by tests that check an older database upgrades in place (interaction review, item 2).
DROP TABLE "dev_mailbox";
DROP TABLE "password_resets";
ALTER TABLE "message_expectations" DROP COLUMN "reply_time";
ALTER TABLE "notifications" DROP COLUMN "emailed_at";
ALTER TABLE "preferences" DROP COLUMN "email_notices";
ALTER TABLE "preferences" DROP COLUMN "last_email_notice_at";
