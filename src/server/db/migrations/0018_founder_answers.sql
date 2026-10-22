CREATE TABLE "packet_access_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"packet_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packet_recipient_access" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"packet_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"recipient_actor_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"setup_token_hash" text,
	CONSTRAINT "packet_recipient_access_setup_token_hash_unique" UNIQUE("setup_token_hash")
);
--> statement-breakpoint
CREATE TABLE "private_notes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "access_model" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "task_id" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "access_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "scope_note" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "task_id" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "packets" ADD COLUMN "recipient_contact_name" text;--> statement-breakpoint
ALTER TABLE "packets" ADD COLUMN "recipient_email" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "visibility" text DEFAULT 'household' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "shared_with" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "created_by_actor_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "closed_reason" text;--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "audience" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "owner_actor_id" text;--> statement-breakpoint
ALTER TABLE "vault_items" ADD COLUMN "shared_with" jsonb;--> statement-breakpoint
ALTER TABLE "packet_access_log" ADD CONSTRAINT "packet_access_log_tenant_id_packet_id_packets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","packet_id") REFERENCES "public"."packets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packet_recipient_access" ADD CONSTRAINT "packet_recipient_access_tenant_id_packet_id_packets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","packet_id") REFERENCES "public"."packets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packet_recipient_access" ADD CONSTRAINT "packet_recipient_access_tenant_id_recipient_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","recipient_actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_notes" ADD CONSTRAINT "private_notes_tenant_id_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_notes" ADD CONSTRAINT "private_notes_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Founder decisions 39 and 42: the hospice administrator and helper roles.
INSERT INTO "roles" ("code", "scope", "label", "description") VALUES
  ('hospice_admin', 'organization', 'Hospice administrator', 'Hospice staff member who manages roles, organization settings, security and access controls. Doesn''t work on households.'),
  ('helper', 'household', 'Helper', 'Someone helping with one task. Sees that task and what it needs, nothing else, until it''s done or their access ends.')
  ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
ALTER TABLE "staff_invitations" DROP CONSTRAINT "staff_invitation_staff_role";--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitation_staff_role"
  CHECK ("role_code" IN ('care_guide', 'hospice_ops', 'privileged_reviewer', 'hospice_admin'));--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitation_household_role";--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_household_role" CHECK ("role_code" IN ('family_member', 'proxy', 'helper'));--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_access_model_chk"
  CHECK ("access_model" IS NULL OR "access_model" IN ('task', 'collaboration'));--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_task_only_has_task"
  CHECK ("access_model" IS DISTINCT FROM 'task' OR ("task_id" IS NOT NULL AND "role_code" = 'helper'));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "membership_helper_has_task"
  CHECK ("role_code" <> 'helper' OR "task_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "task_status_chk" CHECK ("status" IN ('open', 'done', 'closed'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "task_visibility_chk" CHECK ("visibility" IN ('household', 'limited'));--> statement-breakpoint
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_audience_chk" CHECK ("audience" IN ('private', 'selected', 'household', 'staff'));--> statement-breakpoint
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_private_has_owner" CHECK ("audience" <> 'private' OR "owner_actor_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_protected_not_household" CHECK ("sensitivity" <> 'protected' OR "audience" <> 'household');--> statement-breakpoint
ALTER TABLE "packet_access_log" ADD CONSTRAINT "packet_access_action_chk" CHECK ("action" IN ('viewed', 'acknowledged', 'clarification_requested'));--> statement-breakpoint
CREATE INDEX "packet_recipient_access_actor_idx" ON "packet_recipient_access" ("tenant_id", "recipient_actor_id");
