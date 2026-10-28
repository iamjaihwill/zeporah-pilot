-- Staff read-access log (founder decision 71). Append-only: no update, delete or truncate.
CREATE TABLE "staff_access_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"roles" jsonb NOT NULL,
	"household_id" text,
	"view" text NOT NULL,
	"kind" text NOT NULL,
	"row_count" integer,
	"outside_assignment" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_access_events" ADD CONSTRAINT "staff_access_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_access_household_idx" ON "staff_access_events" USING btree ("tenant_id","household_id","occurred_at");--> statement-breakpoint
CREATE INDEX "staff_access_recent_idx" ON "staff_access_events" USING btree ("tenant_id","actor_id","view","occurred_at");--> statement-breakpoint
ALTER TABLE "staff_access_events" ADD CONSTRAINT "staff_access_kind_chk" CHECK (("kind" = 'record' AND "household_id" IS NOT NULL) OR ("kind" = 'list' AND "household_id" IS NULL));--> statement-breakpoint
CREATE OR REPLACE FUNCTION staff_access_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'staff_access_events is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;--> statement-breakpoint
CREATE TRIGGER staff_access_events_no_update BEFORE UPDATE OR DELETE ON staff_access_events FOR EACH ROW EXECUTE FUNCTION staff_access_events_append_only();--> statement-breakpoint
CREATE TRIGGER staff_access_events_no_truncate BEFORE TRUNCATE ON staff_access_events FOR EACH STATEMENT EXECUTE FUNCTION staff_access_events_append_only();
