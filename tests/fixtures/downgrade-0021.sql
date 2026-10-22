-- Undo migration 0021_enterprise_record.
DROP TABLE "exception_claims";
DROP TABLE "handoffs";
DROP TABLE "partner_events";
DROP TABLE "staff_absences";
ALTER TABLE "care_coordination_records" DROP COLUMN "ehr_reference";
ALTER TABLE "memberships" DROP COLUMN "cover_for_actor_id";
ALTER TABLE "memberships" DROP COLUMN "grant_reason";
