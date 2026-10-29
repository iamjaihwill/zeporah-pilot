-- The outbox (founder decisions 88-90): every outgoing email, sent separately from the change it reports.
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text,
	"kind" text NOT NULL,
	"to_actor_id" text NOT NULL,
	"to_email" text NOT NULL,
	"from_name" text DEFAULT 'Zeporah' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"about" jsonb,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"reason" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_due_idx" ON "outbox" USING btree ("state","next_attempt_at");--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_state_chk" CHECK ("state" IN ('pending', 'sent', 'dropped', 'failed'));--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_attempts_chk" CHECK ("attempts" BETWEEN 0 AND 5);
