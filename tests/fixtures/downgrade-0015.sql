-- Undo migration 0015_interaction_review, giving the schema exactly as it was at 0014.
DROP TRIGGER escalation_state_changed ON "escalations";
DROP FUNCTION escalation_state_changed();
DROP TABLE "thread_visits";
ALTER TABLE "escalations" DROP COLUMN "raised_by_actor_id";
ALTER TABLE "escalations" DROP COLUMN "topic";
ALTER TABLE "escalations" DROP COLUMN "state_changed_at";
ALTER TABLE "support_preferences" DROP COLUMN "contact_paused";
ALTER TABLE "support_preferences" DROP COLUMN "contact_paused_at";
ALTER TABLE "support_preferences" DROP COLUMN "contact_paused_by_actor_id";
