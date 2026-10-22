-- Bereavement check-ins (custom; drizzle-kit can't express CHECK constraints here).
ALTER TABLE bereavement_contacts ADD CONSTRAINT bereavement_contact_step_valid
  CHECK (step IN ('first_weeks', 'one_month', 'three_months', 'six_months', 'nine_months', 'anniversary', 'closing'));--> statement-breakpoint
ALTER TABLE bereavement_contacts ADD CONSTRAINT bereavement_contact_status_valid
  CHECK (status IN ('planned', 'done'));--> statement-breakpoint
ALTER TABLE bereavement_contacts ADD CONSTRAINT bereavement_contact_outcome_valid
  CHECK (outcome IS NULL OR outcome IN ('reached', 'message_left', 'declined', 'not_needed'));--> statement-breakpoint
-- A recorded check-in always says what happened, when and by whom; a planned one says none of that.
ALTER TABLE bereavement_contacts ADD CONSTRAINT bereavement_contact_done_consistent CHECK (
  (status = 'planned' AND outcome IS NULL AND completed_at IS NULL AND completed_by_actor_id IS NULL)
  OR (status = 'done' AND outcome IS NOT NULL AND completed_at IS NOT NULL AND completed_by_actor_id IS NOT NULL)
);
