# Zeporah Enterprise: synthetic full-demo baseline (frozen 2026-10-22)

The founder approved this build for presenting the synthetic full demo (GO, 2026-10-22). It's
frozen: no product, UI, workflow, copy, seed or test change without the founder's explicit
approval.

**Re-frozen the same day** after the founder approved and asked for decision 62 (register R-05,
option C: tell the household when temporary cover becomes active). That is the only change since
the first freeze.

**Decision record updated the same day (no product change):** the founder approved decision 63
(register R-19: how Zeporah attributes what it posts or assembles itself) and its narrow amendment
to decision 62. Only `founder-decision-log.md` and `enterprise-decision-register.md` changed, and
their manifest entries were refreshed; every code, test, seed, configuration and screenshot file
still matches. Decision 63 isn't built yet; it waits for the freeze to be lifted.

**Decision record updated again (no product change):** decisions 64 and 65 (production-readiness
D-01 and D-02, approved in principle) were added to `founder-decision-log.md`, and its manifest
entry was refreshed. On 2026-10-23 decision 64 was updated with the named code host (GitLab), and
the entry refreshed again. From here, git history and `bun scripts/check-baseline.ts` in CI record every
change to a frozen file.

## What's frozen

- **The build:** 403 files covering the application code (including migrations through
  `0023_cover_notice` and seed fixtures), the tests, the configuration, the decision log and
  register, the presentation documents and the 22 run-through screenshots. Each file's SHA-256
  is in [demo-baseline-2026-10-22.sha256](demo-baseline-2026-10-22.sha256), and the manifest's
  own SHA-256 is `363eea659cdac48f5587cab594a8d4bd4a1994e4023df6d7cc27e40ade9eb326`. To check
  for drift, run `shasum -a 256 -c docs/demo-baseline-2026-10-22.sha256 --quiet`.
- **The presentation baseline:** [enterprise-demo-map.md](enterprise-demo-map.md) (the script,
  "Presenting it in about 15 minutes", with beat 8's note on decision 62 and an optional 30 s in
  beat 9) and [enterprise-demo-rehearsal.md](enterprise-demo-rehearsal.md) (both rehearsals;
  about 15:15, all 11 beats demonstrable).
- **Screenshots:** `docs/review-screenshots/enterprise/`, 01–22 (22 is Daniel's phone with the
  cover notice).

## Verification at the freeze

| Check                | Result                                              |
| -------------------- | --------------------------------------------------- |
| Type check           | Passes                                              |
| Unit and integration | 493 of 493 (65 files)                               |
| End-to-end           | 187 passed, 1 skipped                               |
| Verify               | 22 passed, 12 skipped (screenshot runs, on request) |
| Upgrade              | 10 passed (downgrade path now 10 migrations)        |
| Development database | Unchanged: `624f80ac…3703b`                         |

Every test ran against isolated servers and databases. Synthetic data only. No real data, no
external service, no deployment, no live AI model, and no production or certification claim.

## Scope

- **R-05:** decided (decision 62) and built. The household is told when cover becomes active,
  in-app only.
- **R-07** (clinical leadership role): held. Not part of this demo.
- Every other open item in [enterprise-decision-register.md](enterprise-decision-register.md).
