ALTER TABLE "family_updates" ALTER COLUMN "author_actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "family_updates" ADD COLUMN "audience_actor_ids" jsonb;--> statement-breakpoint
ALTER TABLE "family_updates" ADD COLUMN "system_kind" text;--> statement-breakpoint
ALTER TABLE "family_updates" ADD COLUMN "source_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "family_updates_system_once" ON "family_updates" USING btree ("tenant_id","system_kind","source_id") WHERE "family_updates"."system_kind" is not null;