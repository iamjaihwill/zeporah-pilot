-- Submission IDs (brief reconciliation increment 3): a message or family request sent again with the
-- same ID from the same person is recognised and not stored twice. Existing rows have none.
ALTER TABLE "escalations" ADD COLUMN "submission_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "submission_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "escalations_one_per_submission" ON "escalations" USING btree ("tenant_id","raised_by_actor_id","submission_id") WHERE "escalations"."submission_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_one_per_submission" ON "messages" USING btree ("tenant_id","author_actor_id","submission_id") WHERE "messages"."submission_id" is not null;