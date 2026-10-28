-- Undo migration 0031_request_lifecycle. Only for the upgrade tests: it drops the request-lifecycle columns.
ALTER TABLE "escalations" DROP CONSTRAINT "escalations_waiting_on_chk";
ALTER TABLE "escalations" DROP CONSTRAINT "escalations_closed_reason_chk";
ALTER TABLE "escalations" DROP COLUMN "waiting_on", DROP COLUMN "waiting_on_label", DROP COLUMN "next_update_by", DROP COLUMN "closed_reason", DROP COLUMN "reopened_at", DROP COLUMN "reopen_reason", DROP COLUMN "offered_to_actor_id", DROP COLUMN "offered_by_actor_id", DROP COLUMN "offered_at";
