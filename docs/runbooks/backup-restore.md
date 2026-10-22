# Backup and restore runbook (pilot, planned)

**Status: a plan until the hosting provider is final (decision 65) and backups are configured
(PB-03). For the local synthetic database, see [operations-runbook.md](../operations-runbook.md).**
Design: [architecture/backup-recovery.md](../architecture/backup-recovery.md).

## Restore (two people: engineering and operations)

1. **Decide and record:** why a restore is needed, the point in time to restore to, who approved.
   If PHI may have been lost or exposed, start the incident and breach runbook first.
2. **Freeze writes:** `ZEPORAH_READ_ONLY=1` on the pilot.
3. **Restore to a new database** at the chosen point in time, in the same region and account.
   Never over the live database.
4. **Check the restored copy:**
   - the schema version matches the running release (else deploy the matching release first);
   - row counts against the last known baseline;
   - the audit hash chain verifies end to end;
   - deletions made since the restore point are re-applied (D-05).
5. **Switch the app** to the restored database; check sign-in and one read per role.
6. **Unfreeze** and record: times, recovery point achieved, data checked, who did what.
7. Keep the old database, read-only and access-restricted, until the incident is closed; then delete
   it under D-05.

## Drill (before Stage 1, then quarterly)

Run steps 3–5 against **staging** (synthetic data), timing each step. Record the recovery time, the
recovery point and the checks in the drill log below.

| Date | Environment | Recovery time | Recovery point | Checks passed | People | Evidence |
| ---- | ----------- | ------------- | -------------- | ------------- | ------ | -------- |
| —    | —           | —             | —              | —             | —      | —        |
