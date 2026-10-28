-- Undo migration 0027_enrollment. Patient and coordinator invitations can't exist before it.
DELETE FROM "invitations" WHERE "role_code" IN ('patient', 'coordinator');
ALTER TABLE "invitations" DROP CONSTRAINT "invitation_first_member_confirmed";
ALTER TABLE "invitations" DROP CONSTRAINT "invitation_household_role";
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_household_role" CHECK ("role_code" IN ('family_member', 'proxy', 'helper'));
ALTER TABLE "invitations" DROP COLUMN "identity_confirmation";
ALTER TABLE "households" DROP COLUMN "activation_owner_actor_id";
ALTER TABLE "households" DROP COLUMN "enrolled_by_actor_id";
