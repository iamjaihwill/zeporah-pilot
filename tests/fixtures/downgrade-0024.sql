-- Undo migration 0024_audit_chain_link. Only indexes were added; no data changes.
DROP INDEX "audit_events_one_genesis";
DROP INDEX "audit_events_one_successor";
