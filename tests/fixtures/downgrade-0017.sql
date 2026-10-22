-- Undo migration 0017_mail_sender.
ALTER TABLE "dev_mailbox" DROP COLUMN "from_name";
