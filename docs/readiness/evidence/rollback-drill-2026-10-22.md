# Rollback drill, 2026-10-22 (non-production)

**Purpose:** show that a bad release is caught by the checks and that redeploying the previous tag
restores a verified state (PB-01; `runbooks/release-and-rollback.md`).

**Where:** a throwaway clone of the local repository in a scratch folder, on synthetic data. No
staging or pilot environment exists yet, so the deployment steps (redeploy, read-only freeze) were
represented by checking out the tag; they must be drilled again on staging once W3 exists.

## Steps and results

| Step         | What was done                                                                                                                      | Result                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1. Release   | A change to `src/domain/claims.ts` (a decision-1 wording) committed and tagged `v0.1.1-drill` on top of `demo-baseline-2026-10-22` | Released                                                                       |
| 2. Detect    | `bun scripts/check-baseline.ts`                                                                                                    | Failed, naming `src/domain/claims.ts` as a changed frozen file                 |
| 2. Detect    | `bunx vitest run tests/unit`                                                                                                       | 1 failed (`ui-claims.test.ts`: "keeps the exact approved wording"), 123 passed |
| 3. Roll back | `git checkout demo-baseline-2026-10-22` (stands in for redeploying the tag)                                                        | At the baseline tag                                                            |
| 4. Verify    | `bun scripts/check-baseline.ts`                                                                                                    | All 403 frozen files match                                                     |
| 4. Verify    | `bunx tsc --noEmit`                                                                                                                | Passes                                                                         |
| 4. Verify    | `bunx vitest run`                                                                                                                  | 65 files, 493 of 493 passed                                                    |

**Time:** 108 seconds from cloning to verified rollback.

**Note on the log:** the line `baseline check exit after bad release: 0` in the raw output is the
exit code of `head`, which the output was piped through, not of the check. The check's own output
shows the failure.

## Not shown by this drill

- Redeploying on a real platform, with read-only mode during the switch (needs staging, W3).
- Rolling back a migration on a managed Postgres database (needs W3; see the backup runbook).
