-- Undo migration 0016_staff_workspace, giving the schema exactly as it was at 0015.
ALTER TABLE "preferences" DROP COLUMN "density";
ALTER TABLE "preferences" DROP COLUMN "saved_views";
ALTER TABLE "organizations" DROP COLUMN "email_sender_name";
