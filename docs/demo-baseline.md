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

**Freeze lifted and re-frozen on 2026-10-26** for two changes only, with the founder's explicit
approval: the development-only demo launcher (`/demo`, plus one link from the sign-in page's
development shortcuts) and address awareness (`ZEPORAH_APP_URL` and `ZEPORAH_CARE_URL`;
[environments.md](architecture/environments.md#addresses)). The manifest entries for the 12 frozen
files they touch were refreshed: `src/components/forms.tsx`, `src/components/staff/staff-invites.tsx`,
`src/functions/session.ts`, `src/routeTree.gen.ts`, `src/routes/__root.tsx`,
`src/routes/family/people.tsx`, `src/routes/family/tasks.tsx`, `src/routes/index.tsx`,
`src/server/environment.ts`, `src/server/mail.ts`, `src/server/services/auth.ts` and
`src/server/services/family.ts`. The new files (`src/domain/addresses.ts`, `src/start.ts`,
`tests/unit/addresses.test.ts`, `src/routes/demo.tsx`) aren't in the manifest. With the addresses
unset, as in the demo, every page behaves as before; the sign-in page shows one more development
link. Unit and integration tests passed (500 of 500); the end-to-end suites, including the pixel
baselines, weren't re-run for this change. Decision 63 still waits for its own lift.

**Freeze lifted and re-frozen again on 2026-10-26** for a dependency security fix only, with the
founder's explicit approval: zod upgraded from 3.25.76 to 4.6.6 for GHSA-mrhx-c7xc-m3w5 (high;
an oversized list in a request could exhaust memory during validation), and a length cap added to
the four sharing-category lists in `src/functions/staff.ts` that had none. The manifest entries
for `package.json`, `bun.lock` and `src/functions/staff.ts` were refreshed. No screen, copy, seed or
workflow changed; a sharing request with more categories than exist is now refused.

**Freeze lifted and re-frozen on 2026-10-27** for one synthetic persona, with the founder's
explicit approval: Rehanna Wells (`fm-rehanna`), a patient in a new household (`hh-wells`) enrolled
the same day, with Sofia Reyes as care guide and nothing added, so the demo can show a first-time
patient. She's featured on the demo launcher and listed with the other personas on the sign-in
page. The manifest entries for `src/fixtures/synthetic.ts` and three tests whose counts include the
new household (`tests/integration/assignment.test.ts`, `reports.test.ts`, `roster.test.ts`) were
refreshed. No rule, screen or copy changed. Unit and integration tests passed (500 of 500); the
end-to-end suites, including the pixel baselines, weren't run (the test browser isn't installed
on this computer).

## What's frozen

- **The build:** 403 files covering the application code (including migrations through
  `0023_cover_notice` and seed fixtures), the tests, the configuration, the decision log and
  register, the presentation documents and the 22 run-through screenshots. Each file's SHA-256
  is in [demo-baseline-2026-10-22.sha256](demo-baseline-2026-10-22.sha256), and the manifest's
  own SHA-256 is `31209f3d7248472eb6b64adfd60d6d9793e1f828862b7043c0ad401b03badbdc`. To check
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
