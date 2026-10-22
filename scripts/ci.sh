#!/usr/bin/env sh
# Runs every CI check locally, in the same order as .github/workflows/ci.yml. Synthetic data only:
# the end-to-end suites start their own isolated servers and databases (never .data/pglite).
#
#   sh scripts/ci.sh          # everything
#   sh scripts/ci.sh quick    # static checks and unit/integration tests only
set -eu

step() { printf '\n== %s\n' "$1"; }

step "Type-check"; bunx tsc --noEmit
step "Formatting"; bun scripts/check-format.ts
step "Documentation links"; bun scripts/check-doc-links.ts
step "Readiness tracker"; bun scripts/readiness-check.ts
step "Frozen baseline"; bun scripts/check-baseline.ts
step "Migrations"; bunx drizzle-kit check
step "Dependency advisories"; bun scripts/check-audit.ts
step "Unit and integration tests"; bunx vitest run

if [ "${1:-}" = "quick" ]; then exit 0; fi

step "End-to-end"; bunx playwright test
step "Read-only mode"; bunx playwright test --config playwright.readonly.config.ts
step "Upgrade and downgrade"; bunx playwright test --config playwright.upgrade.config.ts
step "Verify (includes macOS pixel baselines)"; bunx playwright test --config playwright.verify.config.ts
printf '\nAll checks passed.\n'
