-- Undo migration 0022_cover_start.
ALTER TABLE "memberships" DROP COLUMN "starts_at";
