# D-01 · Source control, code hosting and CI

**Status:** approved in principle by the founder on 2026-10-22 (decision 64). Blocks W1 (PB-01, PB-17).

## Decision to make

Whether to initialize git in this workspace now, and where the repository and its CI run.

The session's standing instruction has been "no git install, init, commit or push". The
remediation program asks for git first. These conflict, so nothing has been initialized; this
brief asks for the explicit go-ahead.

## Why it matters now

Every other readiness control needs to be evidenced through reviewed, tested, reversible changes.
Today the frozen baseline is protected by a checksum manifest, which detects drift but can't show
who changed what, review it, or roll it back.

## What the repository contains

Code, tests, synthetic fixtures and documents. No real PHI, credentials or secrets (`.data/` and
`.env*` are already ignored). The synthetic seed data is safe to host but is labelled synthetic
throughout.

## Options

| Option                                                        | What it is                                                                                                           | For                                                                           | Against                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A. Local git only                                             | Initialize here; no remote; checks run locally                                                                       | No outside service                                                            | No protected branches, no independent CI, no review record, one copy                            |
| **B. Hosted private repository with hosted CI (recommended)** | A private repository on an established code host, protected `main`, required review and green CI, secret scanning on | Real branch protection, review record, CI evidence links, backups of the code | An outside service holds the code (no PHI); needs an account owned by the company, not a person |
| C. Self-hosted git and CI                                     | A company-run git server and runners                                                                                 | Full control                                                                  | Another system to secure, patch and back up before the product itself is ready                  |

## Recommendation

**Option B.** The code host never receives PHI: CI uses synthetic data only, `.data/` and `.env*`
stay ignored, and secret scanning is on. Require one approving review and green CI on `main`. Tag
releases; the tag replaces the checksum manifest as the baseline record.

## Impact

- **Security:** branch protection and secret scanning; access through company-owned accounts with
  MFA.
- **Privacy:** none, if the no-PHI rule holds; CI must never connect to staging or pilot data.
- **Operations:** someone administers repository access (fits the W4 access review).
- **Product:** none.
- **Schedule:** about a day to set up; unblocks W1 and everything after it.

## Default if no decision is made

Nothing is initialized. W1 stays blocked, and so does every workstream that needs CI evidence.

## Exactly what the choice unlocks

- Option A: `git init`, an initial commit of the frozen baseline (verified against its manifest
  first), local hooks for type-check and tests.
- Option B: the same, plus pushing to the chosen private repository, branch protection, a CI
  workflow (type-check, format check, unit and integration, end-to-end, migration checks,
  dependency scanning, documentation links, `bun scripts/readiness-check.ts`) and a release
  checklist.
- Option C: as B, after the self-hosted service is itself set up and reviewed.

The founder also names the repository owner account and who may approve merges (with D-13).
