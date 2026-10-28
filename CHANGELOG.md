# Changelog

Every change that alters behaviour is recorded here in the pull request that makes it. See
[docs/release-governance.md](docs/release-governance.md).

## Unreleased

- Audit: appends to a hospice's chain happen one at a time and the database refuses a fork
  (migration `0024_audit_chain_link`). The chain check reports each finding; System status shows
  "No findings" with its limit instead of "Verified".
- Security (PB-06): a change sent from another site is refused with 403. `Origin` must name this
  server or a configured address; without it, `Sec-Fetch-Site` must be same-origin.
- Synthetic data: Rehanna Wells, a first-time patient in a household enrolled the same day, with
  Sofia Reyes as care guide. Featured on the demo launcher.
- Security: zod 4.6.6 (from 3.25.76) for GHSA-mrhx-c7xc-m3w5, and the four sharing-category lists
  in staff requests are capped at the number of categories.
- Address awareness (docs/architecture/environments.md, "Addresses"): with `ZEPORAH_APP_URL` and
  `ZEPORAH_CARE_URL` set, family pages open on the app address and the staff workspace and
  recipient pages on the care address, whose root is the staff sign-in. Email and invitation links
  name the right address. Nothing changes when they're unset (local, test, demo).
- Development only: a demo launcher at `/demo` puts the consumer family app and the enterprise
  care-team workspace side by side, one click per synthetic persona. `/demo?as=<actorId>` signs
  straight in, so each persona can be bookmarked. Behind the same gate as persona sign-in; linked
  from the sign-in page's development shortcuts.
- Production-readiness workstream W1 (decision 64): git, GitLab CI (`.gitlab-ci.yml`), release governance, rollback
  runbook, and checks for formatting, documentation links, the readiness tracker, the frozen
  baseline, migrations and dependency advisories. No product behaviour changed.
- Planning for W3 and W7 (decision 65): deployment, environments, backup and recovery, and
  monitoring designs, pending vendor and legal confirmation.

## demo-baseline-2026-10-22

The frozen synthetic full-demo baseline (`docs/demo-baseline.md`), including decisions up to 63 as
built or recorded. Not a production release.
