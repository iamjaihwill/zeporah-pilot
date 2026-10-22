-- Access rules the database enforces even if application code is wrong.
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitation_staff_role"
  CHECK ("role_code" IN ('care_guide', 'hospice_ops', 'privileged_reviewer'));--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitation_status_valid"
  CHECK ("status" IN ('pending', 'accepted', 'cancelled'));--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitation_email_lower"
  CHECK ("invitee_email" = lower("invitee_email") AND position('@' in "invitee_email") > 1);--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_token_needs_email"
  CHECK ("token_hash" IS NULL OR ("invitee_email" IS NOT NULL AND "invitee_email" = lower("invitee_email")));--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_household_role"
  CHECK ("role_code" IN ('family_member', 'proxy'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "user_email_lower"
  CHECK ("email" = lower("email") AND position('@' in "email") > 1);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "user_failed_attempts_nonnegative"
  CHECK ("failed_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "session_method_valid"
  CHECK ("method" IN ('password', 'development_persona'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "session_password_has_user"
  CHECK ("method" <> 'password' OR "user_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id");
