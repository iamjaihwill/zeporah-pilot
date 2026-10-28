-- Undo migration 0026_retention_holds. Only for the upgrade tests: a real database with holds must
-- never be downgraded past this migration, because dropping the table would drop the holds.
DROP TABLE "retention_holds";
DROP FUNCTION retention_holds_guard();
