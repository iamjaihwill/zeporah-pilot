# Test artifact handling (threat T19, correction L5)

**Status: proposed, 2026-10-29. Not adopted.** Adopting it, and any change it would need in a
frozen file, is the founder's decision. Until then the rules that already apply stay in force:
synthetic data only, no real PHI anywhere, no hosted environment, real email disabled.

This is the policy for everything the test suites and checks write down besides their pass or fail
result: traces, screenshots, videos, captured requests and replies, captured server output, and
uploads. It answers who may see each artifact, where it's kept, for how long, and how it's deleted.
What the artifacts can hold is in [the logging-path evidence](../readiness/evidence/logging-paths-2026-10-29.md)
(E7–E9) and [the residual review](../readiness/evidence/residual-logging-2026-10-29.md).

## The standing condition

Every artifact below can hold whatever the test typed, saw or was sent. That's safe only because
every test runs on synthetic data against a server it started itself. So the first rule, and the
one the others depend on:

1. **No suite, check or script in this repository is ever pointed at an environment, database,
   mailbox or account holding real data.** That includes staging copies, "anonymised" extracts and
   a hosted pilot. A test that needs real-shaped data uses the synthetic fixtures
   (`src/fixtures/`). If that ever has to change, this policy is rewritten and approved first
   (register item D-14).

## What's produced today

| Artifact                        | Produced by                                                                                                             | Can hold                                                                                                                                                                 | Where                                                                 | Kept                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------ |
| Playwright traces               | All four configs, `trace: "retain-on-failure"`                                                                          | Every request and reply body, cookies (session tokens), page snapshots, console, typed text, screenshots of each step                                                    | `test-results/` (git-ignored)                                         | Until the next run of that config clears it      |
| Failure screenshots             | Inside traces only (no `screenshot:` setting)                                                                           | The page at the failing step                                                                                                                                             | Same                                                                  | Same                                             |
| Videos                          | None (no `video:` setting)                                                                                              | —                                                                                                                                                                        | —                                                                     | —                                                |
| Review and baseline screenshots | `e2e-verify/*-shots.spec.ts`, `sweep.spec.ts`, pixel baselines                                                          | Synthetic people, households and messages as rendered                                                                                                                    | `docs/review-screenshots/` (committed, about 56 MB), snapshot folders | In git history for good                          |
| Marketing screenshots           | `e2e-verify/marketing-shots.spec.ts` (only with `MARKETING_SHOTS=1`)                                                    | Synthetic product views                                                                                                                                                  | `../zeporah-website/assets-src/app/` (another repository)             | That repository's history                        |
| Output-check captures           | `scripts/check-output-redaction.ts`                                                                                     | Complete server stdout and stderr, browser console, every server-function reply, generated passwords' effects (never the passwords themselves, which the check fails on) | `.data/redaction-*-output/` (git-ignored)                             | Until the next run of that variant overwrites it |
| Output-check failure dump       | Same, when a scenario fails                                                                                             | The server's complete output                                                                                                                                             | `.data/redaction-*-failed.txt` (git-ignored)                          | Until deleted                                    |
| Test databases                  | Every suite and check                                                                                                   | The synthetic seed plus whatever the tests wrote                                                                                                                         | `.data/*-pglite/` (git-ignored)                                       | Until the next run resets them                   |
| Runner output                   | Vitest and Playwright                                                                                                   | Truncated actual and expected values on a failure                                                                                                                        | The terminal, and CI job logs                                         | The terminal's scrollback; CI per its settings   |
| Hosted CI artifacts             | `.gitlab-ci.yml` (`test-results`, `when: on_failure`, `expire_in: 7 days`)                                              | Traces, as above                                                                                                                                                         | The CI service, if one ever runs it                                   | 7 days                                           |
| Uploads                         | None. The app takes no files: a household document is recorded by its label only ("never upload or paste the document") | —                                                                                                                                                                        | —                                                                     | —                                                |

Two facts behind the table: no hosted CI runs today (the remote is GitHub and `.gitlab-ci.yml` has
no runner; register finding on decision 64), and `.gitlab-ci.yml` doesn't run the output check,
which only `scripts/ci.sh` does.

## The rules

2. **Traces stay `retain-on-failure`, locally.** They're the best debugging tool there is and,
   with rule 1, hold nothing private. No config turns on `trace: "on"`, `video` or full-page
   `screenshot` by default; one-off use for a single local run is fine.
3. **Hosted CI keeps failure artifacts for 7 days at most and only for people with access to the
   repository.** If hosted CI is ever pointed at anything other than a server it started itself,
   traces go to `"off"` there first (`playwright.config.ts` and the other configs are frozen, so
   that's a lift).
4. **Committed screenshots show synthetic data only, and say so.** The app shows a development
   banner, and the fixtures mark many names "(synthetic)". Marketing captures hide both at capture
   time, so they are only ever made from the synthetic seed and reviewed before they leave this
   repository.
5. **Captured output and failure dumps stay under `.data/`**, which is git-ignored, and are never
   attached to a ticket, chat or email in full. To share a finding, quote the lines needed, after
   checking they hold no marker, password or token (the check already fails if they do).
6. **Generated secrets never outlive the run.** The output check makes its passwords and reads its
   session tokens at run time, in its own throwaway database, and fails if any of them appears in
   any output, reply or table. No test prints a secret on purpose.
7. **No uploads.** If a feature ever takes files, its tests use generated synthetic files only, and
   this policy gains a row for them before the feature lands.

## Access

- Local artifacts: whoever has the working copy. That's the founder's machine today.
- Committed screenshots: everyone with repository access, for as long as the history exists.
- Hosted CI artifacts: repository members, for 7 days.

## Retention and deletion

- **Locally, routine:** each run replaces its own `test-results/`, `.data/redaction-*-output/` and
  test database. Nothing builds up except `.data/redaction-*-failed.txt` and old test databases.
- **Locally, on demand:** `rm -rf test-results playwright-report .data/redaction-*` removes every
  trace and capture. `.data/pglite` (the development database) is separate and is reset with
  `bun run db:reset`.
- **Hosted CI:** artifacts expire after 7 days; delete a job's artifacts sooner from the CI service
  if one ever shows something it shouldn't.
- **Committed screenshots:** deleting a file doesn't remove it from history. If a committed image
  ever showed real data, that's an incident (rewrite history, rotate anything exposed), not a
  routine deletion; rule 1 and rule 4 are what prevent it.

## What would make this wrong

Any of these means stop and revisit this policy before going on: a real person's data in any
environment a test can reach; hosted CI running against anything but its own server; a feature
that accepts files; a new artifact type (video, HAR capture, network recording) turned on by
default.
