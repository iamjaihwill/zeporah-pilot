-- Identity links must state their basis; a confirmation must name its method and statement.
ALTER TABLE authority_identity_links ADD CONSTRAINT identity_link_basis_chk CHECK (basis IN ('submitted_evidence','household_confirmation','reviewer_documented'));
--> statement-breakpoint
ALTER TABLE authority_identity_links ADD CONSTRAINT identity_link_note_chk CHECK (basis <> 'reviewer_documented' OR length(trim(note)) > 0);
--> statement-breakpoint
ALTER TABLE consent_confirmations ADD CONSTRAINT confirmation_text_chk CHECK (length(trim(method)) > 0 AND length(trim(statement)) > 0);
--> statement-breakpoint
ALTER TABLE consents ADD CONSTRAINT consent_version_chk CHECK (version >= 1 AND (activated_version IS NULL OR activated_version <= version));
