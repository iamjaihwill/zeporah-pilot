-- Enrollment and activation (founder decisions 66-70): who enrolled a household and who owns getting
-- it started; staff may invite the patient or coordinator (decision 68) and must record how they
-- confirmed who the person is (decision 67).
ALTER TABLE "households" ADD COLUMN "enrolled_by_actor_id" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "activation_owner_actor_id" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "identity_confirmation" text;--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitation_household_role";--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_household_role" CHECK ("role_code" IN ('patient', 'coordinator', 'family_member', 'proxy', 'helper'));--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_first_member_confirmed" CHECK ("role_code" NOT IN ('patient', 'coordinator') OR length(trim(coalesce("identity_confirmation", ''))) > 0);
