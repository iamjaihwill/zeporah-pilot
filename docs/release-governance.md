# Release governance

How a change reaches `main`, staging and (after the Stage 1 gate) the pilot. Decision 64 approved
the foundation; who may approve merges and production releases is decision D-13, still open.

## Source control

- **Repository:** private, on a code host still to be named (decision 64, option B). The workspace
  repository was initialized on 2026-10-22 with the frozen demo baseline as its first commit,
  tagged `demo-baseline-2026-10-22`.
- **No PHI, real credentials or secrets, ever.** `.data/`, `.env*`, keys and local tool settings
  are ignored. The code host's secret scanning and push protection are on, and CI runs gitleaks.
- **Attributable commits.** Every commit carries its author's real company account. Signed commits
  are recommended once the code host is named.

## Branch protection for `main` (set on the code host when it's named)

- No direct pushes; changes arrive by pull request only.
- At least one approving review from someone other than the author.
- Required checks: `static`, `tests`, `e2e`, `verify-macos`, `secret-scan` (`.github/workflows/ci.yml`).
- Branches must be up to date before merging; no force pushes; no deletion.
- Administrators follow the same rules.

## What a pull request needs

The template (`.github/pull_request_template.md`) asks for it: what and why, no PHI or secrets,
synthetic data only, no weakened access rule, policy questions decided first, documentation and
the readiness tracker updated.

## The frozen demo baseline

`docs/demo-baseline-2026-10-22.sha256` lists 403 frozen files, and CI fails if any of them changes.
A frozen file changes only when the founder lifts the freeze for that work. The same pull request
then refreshes the manifest entries and records the lift in `docs/demo-baseline.md`. Decision-record
updates the founder asks for are the one routine exception, recorded the same way.

## Versions and releases

- **Versions:** `0.MINOR.PATCH` until the first pilot release. A tag on `main` (`v0.2.0`) is the
  release; the tag's CI run is its evidence.
- **Changelog:** [CHANGELOG.md](../CHANGELOG.md), written in the pull request that changes behaviour.
- **Release record:** for each release, the tag, the CI run, the approver, the environments it
  reached, and the rollback target (`runbooks/release-and-rollback.md`).

## Environments and promotion

See [architecture/environments.md](architecture/environments.md). A release reaches staging first,
runs there with synthetic data, and is promoted to the pilot only after the Stage 1 gate has
passed and the release's approver signs off (D-13). The demo environment is never a promotion step.

## Rollback

Every release names the release it rolls back to. See
[runbooks/release-and-rollback.md](runbooks/release-and-rollback.md).

## Known issues

- `e2e-verify/sweep.spec.ts` (a frozen file) rewrites the screenshots in
  `docs/review-screenshots/after/` every time the verify suite runs. `scripts/ci.sh` restores them
  and CI ignores them; every other change a test run makes to tracked files fails. Fix the spec to
  write to `test-results/` when the freeze lifts for `e2e-verify`.
