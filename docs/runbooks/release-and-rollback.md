# Release and rollback runbook

**Applies to:** staging now; the pilot only after the Stage 1 gate. Owner: engineering lead.
Approver of each release: as set by D-13 (open).

## Before a release

1. `main` is green in CI for the commit to be released.
2. The changelog's "Unreleased" section describes it. If it changes the database, the migration was
   reviewed, and its rollback path (a downgrade fixture, or a written forward-fix plan) is named.
3. Pick the rollback target: the last release that ran cleanly in the same environment.

## Release

1. Tag the commit: `git tag -a v0.X.Y -m "Release v0.X.Y"` and push the tag.
2. Deploy the tag to staging (the deployment mechanism is set in W3).
3. Check staging: health check, sign-in, one read and one change per experience, the audit chain
   verification on System status. Synthetic data only.
4. Record the release: tag, CI run, approver, environments reached, rollback target.

## Rollback

Use when a release misbehaves and a forward fix isn't quicker and safer.

1. **Freeze changes:** set `ZEPORAH_READ_ONLY=1` in the affected environment (every change is
   refused, with a banner), so nothing is written while you decide.
2. **Redeploy the rollback target's tag.**
3. **Database:** if the bad release ran a migration, either apply its downgrade fixture (only if
   it's been tested against that release's data shape) or restore from backup
   (`runbooks/backup-restore.md`) to just before the release. Never improvise schema changes on the
   pilot database.
4. **Verify:** health check, sign-in, audit chain verified, the checks in step 3 of Release.
5. **Unfreeze:** remove `ZEPORAH_READ_ONLY`.
6. **Record:** what happened, when, the versions involved and follow-up. If any PHI may have been
   exposed, start the incident and breach runbook (W7) at once.

## Drill record

| Date       | Where                                     | What was drilled                                                                            | Result                                                             | Evidence  |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------- |
| 2026-10-22 | A throwaway clone of the local repository | Release a change on top of `demo-baseline-2026-10-22`, then roll back to the tag and verify | See [evidence](../readiness/evidence/rollback-drill-2026-10-22.md) | Drill log |
