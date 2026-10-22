-- Membership lifecycle consistency (custom; drizzle-kit can't express CHECK constraints here).
-- An active row has no end; an ended row records when and why — including ended care-guide
-- assignments (services/assignments.ts) and memberships ended at a bereavement transition.
ALTER TABLE memberships ADD CONSTRAINT membership_status_valid CHECK (status IN ('active', 'ended'));--> statement-breakpoint
ALTER TABLE memberships ADD CONSTRAINT membership_end_consistent CHECK (
  (status = 'active' AND ended_at IS NULL AND end_reason IS NULL)
  OR (status = 'ended' AND ended_at IS NOT NULL AND end_reason IS NOT NULL AND length(trim(end_reason)) > 0)
);
