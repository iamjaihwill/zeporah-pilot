-- Workflow rules the database enforces even if application code is wrong.
ALTER TABLE "consent_correction_requests" ADD CONSTRAINT "correction_status_valid"
  CHECK ("status" IN ('open', 'cancelled', 'resolved'));--> statement-breakpoint
ALTER TABLE "consent_correction_requests" ADD CONSTRAINT "correction_outcome_valid"
  CHECK ("outcome" IS NULL OR "outcome" IN ('amended', 'withdrawn', 'dismissed', 'closed'));--> statement-breakpoint
ALTER TABLE "consent_correction_requests" ADD CONSTRAINT "correction_resolved_has_outcome"
  CHECK ("status" <> 'resolved' OR "outcome" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "consent_correction_requests" ADD CONSTRAINT "correction_dismissal_explained"
  CHECK ("outcome" IS DISTINCT FROM 'dismissed' OR length(trim(coalesce("resolution_note", ''))) > 0);--> statement-breakpoint
ALTER TABLE "consent_correction_requests" ADD CONSTRAINT "correction_version_positive"
  CHECK ("consent_version" >= 1);--> statement-breakpoint
ALTER TABLE "message_expectations" ADD CONSTRAINT "expectation_version_positive"
  CHECK ("version" >= 1);--> statement-breakpoint
ALTER TABLE "message_expectations" ADD CONSTRAINT "expectation_enabled_has_wording"
  CHECK (NOT "enabled" OR length(trim("expectation")) > 0);
