-- Undo migration 0028_access_log. Only for the upgrade tests: it drops the access log.
DROP TABLE "staff_access_events";
DROP FUNCTION staff_access_events_append_only();
