-- One audit chain per tenant, never a fork (brief reconciliation increment 2): no two events may
-- follow the same event, and only one may start the chain. Fails if a database already holds a fork.
CREATE UNIQUE INDEX "audit_events_one_successor" ON "audit_events" USING btree ("tenant_id","prev_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_one_genesis" ON "audit_events" USING btree ("tenant_id") WHERE "audit_events"."prev_hash" is null;