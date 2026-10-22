CREATE TABLE "acknowledgements" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acknowledgements_once" UNIQUE("subject_type","subject_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "actors" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actors_tenant_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"seq" bigserial NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text,
	"actor_id" text,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"decision" text,
	"reason_code" text,
	"summary" text NOT NULL,
	"visibility" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authority_evidence" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"holder_actor_id" text,
	"holder_name" text NOT NULL,
	"authority_type" text NOT NULL,
	"state" text DEFAULT 'review_pending' NOT NULL,
	"current_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authority_evidence_tenant_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "authority_evidence_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"previous_version_id" text,
	"document_label" text NOT NULL,
	"effective_date" text,
	"submitted_by_actor_id" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "authority_versions_seq" UNIQUE("evidence_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "authority_reviews" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"version_id" text NOT NULL,
	"reviewer_actor_id" text NOT NULL,
	"outcome" text NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bereavement_transitions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"proposed_by_actor_id" text NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by_actor_id" text,
	"confirmed_at" timestamp with time zone,
	"surviving_contact_actor_id" text,
	"surviving_contact_confirmed_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_coordination_records" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"care_guide_actor_id" text NOT NULL,
	"visit_rhythm" text NOT NULL,
	"after_hours_route" text NOT NULL,
	"family_priorities" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_coordination_records_household_id_unique" UNIQUE("household_id")
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"granted_by_name" text NOT NULL,
	"granted_by_actor_id" text,
	"recorded_by_actor_id" text NOT NULL,
	"purpose" text NOT NULL,
	"recipient_name" text NOT NULL,
	"scope" jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"revocation_path" text NOT NULL,
	"activated_by_actor_id" text,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_actor_id" text,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_tenant_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"summary" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"owner_actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_actor_id" text,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "family_updates" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"author_actor_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"requires_ack" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"display_name" text NOT NULL,
	"patient_name" text NOT NULL,
	"lifecycle_state" text DEFAULT 'enrolled' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifecycle_changed_at" timestamp with time zone,
	CONSTRAINT "households_tenant_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"invited_by_actor_id" text NOT NULL,
	"invitee_name" text NOT NULL,
	"invitee_contact" text NOT NULL,
	"role_code" text NOT NULL,
	"relationship" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"household_id" text,
	"organization_id" text,
	"role_code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_threads_tenant_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"household_id" text NOT NULL,
	"author_actor_id" text NOT NULL,
	"author_side" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"recipient_actor_id" text NOT NULL,
	"household_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"link" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_steps" (
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"step" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_by_actor_id" text NOT NULL,
	CONSTRAINT "onboarding_steps_household_id_step_pk" PRIMARY KEY("household_id","step")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"state_code" text NOT NULL,
	"after_hours_line" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_tenant_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "packet_manifest_items" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"packet_id" text NOT NULL,
	"category" text NOT NULL,
	"justification" text DEFAULT '' NOT NULL,
	CONSTRAINT "packet_manifest_once" UNIQUE("packet_id","category")
);
--> statement-breakpoint
CREATE TABLE "packet_release_receipts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"packet_id" text NOT NULL,
	"released_by_actor_id" text NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipient_name" text NOT NULL,
	"purpose" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"audit_event_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"recipient_name" text DEFAULT '' NOT NULL,
	"consent_id" text,
	"authority_evidence_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"last_reason_code" text,
	"created_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packets_tenant_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"actor_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"text_size" text DEFAULT 'standard' NOT NULL,
	"simpler_explanations" boolean DEFAULT false NOT NULL,
	"contact_method" text DEFAULT 'in_app' NOT NULL,
	"notification_cadence" text DEFAULT 'as_it_happens' NOT NULL,
	"quiet_hours_start" text DEFAULT '21:00' NOT NULL,
	"quiet_hours_end" text DEFAULT '08:00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"code" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_notes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"author_actor_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_preferences" (
	"household_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spiritual_care" boolean DEFAULT false NOT NULL,
	"preferred_contact_time" text,
	"recommendations_paused" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"audience" text NOT NULL,
	"assignee_actor_id" text,
	"owner_actor_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"when_label" text,
	"requires_ack" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_actor_id" text
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_items" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'needs_review' NOT NULL,
	"sensitivity" text DEFAULT 'standard' NOT NULL,
	"kept_where" text,
	"starter" boolean DEFAULT false NOT NULL,
	"reviewed_by_actor_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_evidence" ADD CONSTRAINT "authority_evidence_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_evidence_versions" ADD CONSTRAINT "authority_evidence_versions_previous_version_id_authority_evidence_versions_id_fk" FOREIGN KEY ("previous_version_id") REFERENCES "public"."authority_evidence_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_evidence_versions" ADD CONSTRAINT "authority_evidence_versions_tenant_id_evidence_id_authority_evidence_tenant_id_id_fk" FOREIGN KEY ("tenant_id","evidence_id") REFERENCES "public"."authority_evidence"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_reviews" ADD CONSTRAINT "authority_reviews_tenant_id_evidence_id_authority_evidence_tenant_id_id_fk" FOREIGN KEY ("tenant_id","evidence_id") REFERENCES "public"."authority_evidence"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bereavement_transitions" ADD CONSTRAINT "bereavement_transitions_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_coordination_records" ADD CONSTRAINT "care_coordination_records_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_updates" ADD CONSTRAINT "family_updates_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_tenant_id_organization_id_organizations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."roles"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."roles"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_organization_id_organizations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_thread_id_message_threads_tenant_id_id_fk" FOREIGN KEY ("tenant_id","thread_id") REFERENCES "public"."message_threads"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_recipient_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","recipient_actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packet_manifest_items" ADD CONSTRAINT "packet_manifest_items_tenant_id_packet_id_packets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","packet_id") REFERENCES "public"."packets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packet_release_receipts" ADD CONSTRAINT "packet_release_receipts_tenant_id_packet_id_packets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","packet_id") REFERENCES "public"."packets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packets" ADD CONSTRAINT "packets_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packets" ADD CONSTRAINT "packets_tenant_id_consent_id_consents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","consent_id") REFERENCES "public"."consents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packets" ADD CONSTRAINT "packets_tenant_id_authority_evidence_id_authority_evidence_tenant_id_id_fk" FOREIGN KEY ("tenant_id","authority_evidence_id") REFERENCES "public"."authority_evidence"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_tenant_id_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_preferences" ADD CONSTRAINT "support_preferences_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;