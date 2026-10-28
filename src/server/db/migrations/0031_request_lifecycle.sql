-- The request lifecycle (founder decisions 79-83): states alongside status, withdraw and reopen, next update, offers.
ALTER TABLE "escalations" ADD COLUMN "waiting_on" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "waiting_on_label" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "next_update_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "closed_reason" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "reopen_reason" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "offered_to_actor_id" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "offered_by_actor_id" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "offered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_waiting_on_chk" CHECK ("waiting_on" IS NULL OR "waiting_on" IN ('family', 'other'));--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_closed_reason_chk" CHECK ("closed_reason" IS NULL OR "closed_reason" IN ('resolved', 'withdrawn'));
