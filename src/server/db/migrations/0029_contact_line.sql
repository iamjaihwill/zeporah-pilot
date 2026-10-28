-- A verified 24-hour line (founder decision 72): proposed changes and confirmation calls. A change is
-- confirmed only by someone other than its proposer, with a note; rows are never deleted.
CREATE TABLE "contact_line_changes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"line" text NOT NULL,
	"backup_line" text,
	"status" text NOT NULL,
	"proposed_by_actor_id" text NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by_actor_id" text,
	"confirmed_at" timestamp with time zone,
	"confirmation_note" text,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "after_hours_backup_line" text;--> statement-breakpoint
ALTER TABLE "contact_line_changes" ADD CONSTRAINT "contact_line_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_line_changes" ADD CONSTRAINT "contact_line_changes_tenant_id_organization_id_organizations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "public"."organizations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_line_one_pending" ON "contact_line_changes" USING btree ("tenant_id","organization_id") WHERE "contact_line_changes"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "contact_line_org_idx" ON "contact_line_changes" USING btree ("tenant_id","organization_id","confirmed_at");--> statement-breakpoint
ALTER TABLE "contact_line_changes" ADD CONSTRAINT "contact_line_kind_chk" CHECK ("kind" IN ('change', 'reconfirmation'));--> statement-breakpoint
ALTER TABLE "contact_line_changes" ADD CONSTRAINT "contact_line_status_chk" CHECK ("status" IN ('pending', 'confirmed', 'withdrawn', 'superseded'));--> statement-breakpoint
ALTER TABLE "contact_line_changes" ADD CONSTRAINT "contact_line_confirmed_chk" CHECK (
  "status" <> 'confirmed' OR ("confirmed_by_actor_id" IS NOT NULL AND "confirmed_at" IS NOT NULL AND length(trim(coalesce("confirmation_note", ''))) > 0)
);--> statement-breakpoint
ALTER TABLE "contact_line_changes" ADD CONSTRAINT "contact_line_two_people_chk" CHECK (
  "kind" <> 'change' OR "status" <> 'confirmed' OR "confirmed_by_actor_id" <> "proposed_by_actor_id"
);--> statement-breakpoint
ALTER TABLE "contact_line_changes" ADD CONSTRAINT "contact_line_reconfirm_chk" CHECK ("kind" <> 'reconfirmation' OR "status" = 'confirmed');--> statement-breakpoint
CREATE OR REPLACE FUNCTION contact_line_changes_keep() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'contact_line_changes are never removed (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;--> statement-breakpoint
CREATE TRIGGER contact_line_changes_no_delete BEFORE DELETE ON contact_line_changes FOR EACH ROW EXECUTE FUNCTION contact_line_changes_keep();--> statement-breakpoint
CREATE TRIGGER contact_line_changes_no_truncate BEFORE TRUNCATE ON contact_line_changes FOR EACH STATEMENT EXECUTE FUNCTION contact_line_changes_keep();
