ALTER TABLE "organizations" ADD COLUMN "email_sender_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "density" text DEFAULT 'comfortable' NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "saved_views" jsonb DEFAULT '[]'::jsonb NOT NULL;