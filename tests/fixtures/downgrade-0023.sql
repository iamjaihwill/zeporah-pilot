-- Undo migration 0023_cover_notice. System-posted updates (no author) can't exist before it, so
-- they go first; acknowledgements of them go with them.
DELETE FROM "acknowledgements" WHERE "subject_type" = 'update' AND "subject_id" IN (SELECT "id" FROM "family_updates" WHERE "author_actor_id" IS NULL);
DELETE FROM "family_updates" WHERE "author_actor_id" IS NULL;
DROP INDEX "family_updates_system_once";
ALTER TABLE "family_updates" DROP COLUMN "source_id";
ALTER TABLE "family_updates" DROP COLUMN "system_kind";
ALTER TABLE "family_updates" DROP COLUMN "audience_actor_ids";
ALTER TABLE "family_updates" ALTER COLUMN "author_actor_id" SET NOT NULL;
