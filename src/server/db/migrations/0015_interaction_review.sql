CREATE TABLE "thread_visits" (
	"tenant_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"household_id" text NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "thread_visits_actor_id_household_id_pk" PRIMARY KEY("actor_id","household_id")
);
--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "raised_by_actor_id" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "state_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_preferences" ADD COLUMN "contact_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "support_preferences" ADD COLUMN "contact_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_preferences" ADD COLUMN "contact_paused_by_actor_id" text;--> statement-breakpoint
ALTER TABLE "thread_visits" ADD CONSTRAINT "thread_visits_tenant_id_actor_id_actors_tenant_id_id_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_visits" ADD CONSTRAINT "thread_visits_tenant_id_household_id_households_tenant_id_id_fk" FOREIGN KEY ("tenant_id","household_id") REFERENCES "public"."households"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Existing rows upgrade in place: an escalation last changed when it was resolved, or else raised.
UPDATE "escalations" SET "state_changed_at" = COALESCE("resolved_at", "created_at") WHERE "state_changed_at" IS NULL;
--> statement-breakpoint
-- "Waiting" counts from the last state change (interaction review, item 17). Every insert and every
-- change of status or owner stamps it, wherever in the code the change happens.
CREATE FUNCTION escalation_state_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.state_changed_at := COALESCE(NEW.state_changed_at, NEW.created_at, now());
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.owner_actor_id IS DISTINCT FROM OLD.owner_actor_id THEN
    NEW.state_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER escalation_state_changed BEFORE INSERT OR UPDATE ON "escalations"
  FOR EACH ROW EXECUTE FUNCTION escalation_state_changed();
