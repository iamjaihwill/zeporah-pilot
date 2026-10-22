-- Only staff accounts are deactivated (custom; drizzle-kit can't express CHECK constraints here).
-- Family membership ends through the household lifecycle, not by deactivating the person.
ALTER TABLE actors ADD CONSTRAINT actor_deactivation_staff_only CHECK (deactivated_at IS NULL OR kind = 'staff');
