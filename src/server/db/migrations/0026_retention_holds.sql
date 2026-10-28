-- Retention holds (brief reconciliation increment 5). A hold is never deleted, and the only change
-- allowed is releasing it once, with an authorization reference. Nothing here deletes records.
CREATE TABLE "retention_holds" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"household_id" text,
	"record_classes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"authorization_ref" text NOT NULL,
	"placed_by_actor_id" text NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"released_at" timestamp with time zone,
	"released_by_actor_id" text,
	"release_authorization_ref" text
);
--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_holds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_holds_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_hold_status_chk" CHECK ("status" IN ('active', 'released'));--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_hold_authorized_chk" CHECK (length(trim("authorization_ref")) > 0 AND length(trim("reason")) > 0);--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_hold_release_chk" CHECK (
  ("status" = 'active' AND "released_at" IS NULL AND "released_by_actor_id" IS NULL AND "release_authorization_ref" IS NULL)
  OR ("status" = 'released' AND "released_at" IS NOT NULL AND "released_by_actor_id" IS NOT NULL AND length(trim(coalesce("release_authorization_ref", ''))) > 0)
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION retention_holds_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'retention_holds are never removed (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'active' OR NEW.status <> 'released'
     OR (NEW.id, NEW.tenant_id, NEW.household_id, NEW.record_classes, NEW.reason, NEW.authorization_ref, NEW.placed_by_actor_id, NEW.placed_at)
        IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.household_id, OLD.record_classes, OLD.reason, OLD.authorization_ref, OLD.placed_by_actor_id, OLD.placed_at) THEN
    RAISE EXCEPTION 'a retention hold can only be released, once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER retention_holds_no_change BEFORE UPDATE OR DELETE ON retention_holds FOR EACH ROW EXECUTE FUNCTION retention_holds_guard();--> statement-breakpoint
CREATE TRIGGER retention_holds_no_truncate BEFORE TRUNCATE ON retention_holds FOR EACH STATEMENT EXECUTE FUNCTION retention_holds_guard();
