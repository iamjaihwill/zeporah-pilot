-- Undo migration 0029_contact_line. Only for the upgrade tests: it drops the confirmation history.
DROP TABLE "contact_line_changes";
DROP FUNCTION contact_line_changes_keep();
ALTER TABLE "organizations" DROP COLUMN "after_hours_backup_line";
