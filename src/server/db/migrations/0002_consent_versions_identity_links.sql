CREATE TABLE "authority_identity_links" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"basis" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"linked_by_actor_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"superseded_by_link_id" text
);
--> statement-breakpoint
CREATE TABLE "consent_confirmations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"consent_id" text NOT NULL,
	"consent_version" integer NOT NULL,
	"actor_id" text NOT NULL,
	"method" text NOT NULL,
	"statement" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_confirmation_once" UNIQUE("consent_id","consent_version")
);
--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "consents" ADD COLUMN "activated_version" integer;--> statement-breakpoint
ALTER TABLE "authority_identity_links" ADD CONSTRAINT "authority_identity_links_tenant_id_evidence_id_authority_evidence_tenant_id_id_fk" FOREIGN KEY ("tenant_id","evidence_id") REFERENCES "public"."authority_evidence"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_identity_links" ADD CONSTRAINT "authority_identity_links_tenant_id_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_confirmations" ADD CONSTRAINT "consent_confirmations_tenant_id_consent_id_consents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","consent_id") REFERENCES "public"."consents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_confirmations" ADD CONSTRAINT "consent_confirmations_tenant_id_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;