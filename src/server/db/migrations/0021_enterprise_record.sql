CREATE TABLE "exception_claims" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"key" text NOT NULL,
	"owner_actor_id" text,
	"state" text,
	"waiting_on" text,
	"waiting_note" text,
	"dismissed_reason" text,
	"dismissed_by_actor_id" text,
	"dismissed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exception_claims_key" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"from_actor_id" text NOT NULL,
	"to_actor_id" text NOT NULL,
	"absence_id" text,
	"kind" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'offered' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"accept_by" timestamp with time zone NOT NULL,
	"offered_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"decline_reason" text
);
--> statement-breakpoint
CREATE TABLE "partner_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"organization_label" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"entered_by_actor_id" text NOT NULL,
	"source" text DEFAULT 'staff_entered' NOT NULL,
	"packet_id" text,
	"simulated" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_absences" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "care_coordination_records" ADD COLUMN "ehr_reference" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "cover_for_actor_id" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "grant_reason" text;--> statement-breakpoint
ALTER TABLE "exception_claims" ADD CONSTRAINT "exception_claims_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_claims" ADD CONSTRAINT "exception_claims_tenant_id_owner_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","owner_actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_id_from_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","from_actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_id_to_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","to_actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_events" ADD CONSTRAINT "partner_events_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_events" ADD CONSTRAINT "partner_events_tenant_id_entered_by_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","entered_by_actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_absences" ADD CONSTRAINT "staff_absences_tenant_id_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_absences" ADD CONSTRAINT "staff_absences_tenant_id_created_by_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","created_by_actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;