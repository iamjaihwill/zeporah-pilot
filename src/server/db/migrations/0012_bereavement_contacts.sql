CREATE TABLE "bereavement_contacts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"transition_id" text NOT NULL,
	"step" text NOT NULL,
	"due_on" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"outcome" text,
	"note" text DEFAULT '' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bereavement_contacts_one_per_step" UNIQUE("tenant_id","transition_id","step")
);
--> statement-breakpoint
ALTER TABLE "bereavement_contacts" ADD CONSTRAINT "bereavement_contacts_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;