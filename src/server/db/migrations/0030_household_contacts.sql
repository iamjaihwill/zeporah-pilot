-- Listed contacts (founder decisions 74-78). A listing grants nothing; rows are marked removed, never deleted.
CREATE TABLE "household_contacts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"organization" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"patient_private" boolean DEFAULT false NOT NULL,
	"added_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by_actor_id" text
);
--> statement-breakpoint
ALTER TABLE "household_contacts" ADD CONSTRAINT "household_contacts_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_contacts_household_idx" ON "household_contacts" USING btree ("tenant_id","household_id");--> statement-breakpoint
ALTER TABLE "household_contacts" ADD CONSTRAINT "household_contacts_relationship_chk" CHECK ("relationship" IN ('death_doula', 'private_caregiver', 'outside_clinician', 'faith_leader', 'friend_neighbor', 'service_provider', 'other'));--> statement-breakpoint
ALTER TABLE "household_contacts" ADD CONSTRAINT "household_contacts_name_chk" CHECK (length(trim("name")) > 0);
