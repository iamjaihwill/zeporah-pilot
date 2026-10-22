CREATE TABLE "consent_correction_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"consent_id" text NOT NULL,
	"consent_version" integer NOT NULL,
	"requested_by_actor_id" text NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"resolution_note" text,
	"resolved_by_actor_id" text,
	"escalation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message_expectations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"version" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"handling_hours" text DEFAULT '' NOT NULL,
	"expectation" text DEFAULT '' NOT NULL,
	"fallback" text DEFAULT '' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"changed_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_expectation_version" UNIQUE("organization_id","version")
);
--> statement-breakpoint
ALTER TABLE "consent_correction_requests" ADD CONSTRAINT "consent_correction_requests_tenant_id_consent_id_consents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","consent_id") REFERENCES "public"."consents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_correction_requests" ADD CONSTRAINT "consent_correction_requests_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_correction_requests" ADD CONSTRAINT "consent_correction_requests_tenant_id_requested_by_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","requested_by_actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_expectations" ADD CONSTRAINT "message_expectations_tenant_id_organization_id_organizations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_expectations" ADD CONSTRAINT "message_expectations_tenant_id_changed_by_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","changed_by_actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_correction_one_open" ON "consent_correction_requests" USING btree ("consent_id") WHERE "consent_correction_requests"."status" = 'open';