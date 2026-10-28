-- Undo migration 0025_submission_ids. The IDs only prevent duplicates; dropping them loses no content.
DROP INDEX "messages_one_per_submission";
DROP INDEX "escalations_one_per_submission";
ALTER TABLE "messages" DROP COLUMN "submission_id";
ALTER TABLE "escalations" DROP COLUMN "submission_id";
