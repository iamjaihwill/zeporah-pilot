-- Audit events are append-only. The database refuses any change or removal, whoever asks.
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
--> statement-breakpoint
CREATE UNIQUE INDEX audit_events_seq_idx ON audit_events (seq);
--> statement-breakpoint
CREATE INDEX audit_events_household_idx ON audit_events (tenant_id, household_id, seq);
--> statement-breakpoint
CREATE INDEX notifications_recipient_idx ON notifications (tenant_id, recipient_actor_id, created_at);
--> statement-breakpoint
CREATE INDEX memberships_actor_idx ON memberships (tenant_id, actor_id, status);
--> statement-breakpoint
-- Only valid workflow states can be stored. These mirror src/domain/model.ts.
ALTER TABLE households ADD CONSTRAINT households_lifecycle_chk CHECK (lifecycle_state IN ('enrolled','active_hospice','bereavement','closed'));
--> statement-breakpoint
ALTER TABLE memberships ADD CONSTRAINT memberships_scope_chk CHECK ((household_id IS NULL) <> (organization_id IS NULL));
--> statement-breakpoint
ALTER TABLE vault_items ADD CONSTRAINT vault_status_chk CHECK (status IN ('needs_review','reviewed','not_available','not_applicable'));
--> statement-breakpoint
ALTER TABLE authority_evidence ADD CONSTRAINT authority_state_chk CHECK (state IN ('not_submitted','review_pending','workflow_active','conflict','superseded','withdrawn'));
--> statement-breakpoint
ALTER TABLE authority_evidence ADD CONSTRAINT authority_type_chk CHECK (authority_type IN ('healthcare_agent','guardian','personal_representative','patient_designated_proxy'));
--> statement-breakpoint
ALTER TABLE consents ADD CONSTRAINT consent_state_chk CHECK (state IN ('draft','active','revoked','expired'));
--> statement-breakpoint
ALTER TABLE consents ADD CONSTRAINT consent_window_chk CHECK (expires_at > starts_at);
--> statement-breakpoint
ALTER TABLE consents ADD CONSTRAINT consent_named_chk CHECK (length(trim(purpose)) > 0 AND length(trim(recipient_name)) > 0 AND length(trim(revocation_path)) > 0);
--> statement-breakpoint
ALTER TABLE packets ADD CONSTRAINT packet_state_chk CHECK (state IN ('draft','held','released','denied','revoked'));
--> statement-breakpoint
ALTER TABLE packet_manifest_items ADD CONSTRAINT manifest_category_chk CHECK (category IN ('contact_details','care_coordination_summary','visit_schedule','vault_status','authority_status','bereavement_contact'));
--> statement-breakpoint
ALTER TABLE audit_events ADD CONSTRAINT audit_decision_chk CHECK (decision IS NULL OR decision IN ('allow','hold','deny'));
