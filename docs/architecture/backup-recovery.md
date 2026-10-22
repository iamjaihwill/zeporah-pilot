# Backup and recovery design (planned)

**Status: a plan (PB-03, W7). Nothing is configured.** Targets are proposals for the founder and
hospice sponsor to confirm.

## Proposed targets for the pilot

| Measure                              | Proposal                                                                                         | Reasoning                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Recovery point (data you could lose) | At most 15 minutes                                                                               | Point-in-time recovery from the managed database's continuous log                                    |
| Recovery time (until usable again)   | At most 4 hours                                                                                  | Zeporah isn't for emergencies (the 24-hour line is), but families and staff rely on it daily         |
| Backup retention                     | 35 days of point-in-time recovery, plus monthly snapshots kept per the retention decision (D-05) | Retention must match what's approved for deletion: a deleted household can't live forever in backups |

## Design

- **Automated backups and point-in-time recovery** on the managed Postgres, encrypted with the same
  key policy as the database, in the same region (cross-region copies only if the BAA and D-05
  allow).
- **Access:** restoring needs two people (engineering and operations) and is logged by the
  provider; no individual can restore or download a backup alone.
- **Restores go to a new, isolated database first**, never over the live one, then switch over
  after checks.
- **What a restore must prove:** the schema version matches the running release; row counts
  against the pre-incident baseline; the audit hash chain verifies end to end
  (System status → audit integrity); sign-in and one read per role work.
- **Deletion and backups:** when a household is deleted under D-05, it remains in backups until
  they age out; the policy must say so plainly, and a restore must re-apply deletions made since
  the backup.
- **Drills:** one before Stage 1 (PB-03); two consecutive before Stage 2 (SB-03); then quarterly.

## Open questions

- Confirm the targets above with the founder and hospice sponsor.
- Confirm backups are within the provider's BAA (decision 65, question 1 in
  [deployment.md](deployment.md)).
- D-05 sets how long monthly snapshots are kept.
