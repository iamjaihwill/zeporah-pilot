# Residual logging review (threat T19), 2026-10-29

**Scope.** A bounded review after corrections L1–L3, which are implemented in `1eb6e86` (see
[logging-paths](logging-paths-2026-10-29.md) §7). It checks that the evidence for L1–L3 belongs to
that commit, then looks for what still leaks. Inspection and local verification only, all data
synthetic. No application file changed. The test and check additions are in this note's commit.

**T19 stays partial.** All existing readiness restrictions stay in force: synthetic data only, no
hosting or deployment, real email disabled, every Stage 1 gate still open. Nothing here is a
readiness or compliance claim.

**Status of L1–L3: implemented** in `1eb6e86` under the founder's lift, and verified on that exact
commit (§1). Two parts of what was built differ from the approved L1 wording (§3), and the logger
has gaps the review found (§4–§5). Closing them needs a further lift (L6, §10).

## 1. The evidence maps to commit 1eb6e86

**How the earlier evidence was produced.** The results reported for L1–L3 came from the working
copy before the commit:

- The code and test files were last written between 09:33 and 09:35 (local time).
- The output check ran between 09:40 and 09:41.
- Only documentation files changed after that, up to the commit at 09:58 (`1eb6e86`, tree
  `9b8320f9`).

So the code that was tested is the code that was committed. But no tree hash was recorded at test
time, so the full regression was run again.

**Re-run on a clean checkout of `1eb6e86`.**

- **Checkout:** a detached worktree, tree `9b8320f95cc753bb7d9bc08175ec84268ecba550`, with no
  local changes.
- **Ignored files present:** `node_modules` (an APFS clone of the working copy's) and
  `.claude/launch.json`.
- **Command:** `sh scripts/ci.sh`, every stage.

| Stage (`scripts/ci.sh`, 16:01–16:28 UTC) | Result on `1eb6e86`                                     |
| ---------------------------------------- | ------------------------------------------------------- |
| Type-check, formatting, links, tracker   | Pass (tracker: "Stage 1 gate: NOT passed", as expected) |
| Frozen baseline                          | All 403 files match                                     |
| Migrations, dependency advisories        | Pass                                                    |
| Unit and integration                     | 634 of 634                                              |
| End-to-end                               | 208 passed, 2 skipped                                   |
| Read-only mode                           | 2 passed                                                |
| Upgrade and downgrade                    | 10 passed                                               |
| Verify (macOS pixel baselines)           | 22 passed, 12 skipped                                   |
| Output check, development server         | No problems                                             |
| Output check, local production build     | No problems                                             |
| No changes to tracked files              | Pass                                                    |

These match the figures reported for L1–L3, so that evidence stands for `1eb6e86`.

**Finding: a clean clone fails CI.** The documentation-link stage needs `.claude/launch.json`, which
is git-ignored (`.gitignore` line 14). It's referenced from `README.md` and
`docs/founder-decision-log.md`. The first re-run on the clean checkout stopped there. The second
had the file copied in, as every earlier local run had it.

- **Impact:** none on L1–L3. It does mean the hosted CI job (if one ever runs) and any fresh clone
  fail before the tests.
- **Fix:** the check could skip git-ignored targets, or the two links could become plain text.
  `docs/founder-decision-log.md` is frozen (`README.md` isn't), so changing the links is a lift;
  changing the check isn't. Proposed as R1 (§10).

**Differences between the tested tree and the commit:** none in tracked files. The ignored files
that took part are named above, and the databases (`.data/`) are created fresh by each stage.

## 2. Skipped browser and screenshot tests

Every skip in the three browser configurations that run, from the 1eb6e86 re-run:

| #     | Test                                                                                 | Config     | Why it's skipped                                                                                               | Owner            | Readiness impact                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `e2e/staff-workspace.spec.ts:80` Priya activates a consent from Exceptions           | End-to-end | **Conditional:** it skips itself when the Exceptions list has no consent waiting, and in this seed it has none | Engineering lead | **Consent activation from Exceptions isn't tested end to end at all.** The skip fired in this run; earlier runs today also reported 2 end-to-end skips, consistent with the same two. Consent release is a privacy control, so this is a real gap, not a design limit |
| 2     | `e2e/family-contacts.spec.ts:53` the care team sees the household's contacts (phone) | End-to-end | The staff household record is a desktop and tablet page; the phone project runs family specs only              | Engineering lead | None: the same test runs and passes on desktop                                                                                                                                                                                                                        |
| 3–4   | `e2e-verify/enterprise-shots.spec.ts` mid-week (Day 4), end of week (Day 7)          | Verify     | Capture run, only with `ENTERPRISE_SHOTS=1`                                                                    | Design lead      | The 22 enterprise screenshots are still not retaken after the freeze lifts (closure plan §5); the run-through itself is covered by the sweep                                                                                                                          |
| 5     | `e2e-verify/marketing-shots.spec.ts` family app and coordination desk                | Verify     | Capture run, only with `MARKETING_SHOTS=1`; writes into another repository                                     | Design lead      | None for the pilot                                                                                                                                                                                                                                                    |
| 6–11  | `e2e-verify/shots.spec.ts` reset first; items 1 and 3, 7, 15, 18, 19                 | Verify     | Capture run for the 2026-10-13 review, only with `SHOT_SET`                                                    | Design lead      | None: review screenshots of a closed review                                                                                                                                                                                                                           |
| 12–14 | `e2e-verify/staff-shots.spec.ts` reset; screens; clicks to take ownership            | Verify     | Capture and measurement run, only with `STAFF_SHOTS`; the last also only for `after`                           | Design lead      | Low: the click-count measurement isn't repeated on each run                                                                                                                                                                                                           |

Thirteen of the fourteen skips are by design. The twelve verify skips are capture runs, off by
default so the ordinary run doesn't rewrite committed screenshots. The phone skip is a layout limit
covered on desktop.

**The first one isn't by design.** The test is written to skip rather than fail when the seed has no
consent waiting, and the seed has none. So the test has been silently skipping. Fixing it means
seeding a pending consent, or making the test create one; `e2e/staff-workspace.spec.ts` is frozen,
so either is a lift. Proposed as R2 (§10).

## 3. The five frozen files, their approvals and the manifest

| File                             | Changed for | Approval                                                   | Manifest entry after the refresh (= the file in `1eb6e86`) |
| -------------------------------- | ----------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| `src/server/observability.ts`    | L1          | "Lift L1–L3" (founder, 2026-10-29)                         | `111a0d30…2e27a7` ✓                                        |
| `tests/unit/errors.test.ts`      | L1          | Same; named in the L1 proposal ("Also changes …")          | `14012982…03088a` ✓                                        |
| `src/functions/session.ts`       | L2          | Same                                                       | `90f77def…2ccb05` ✓                                        |
| `vite.config.ts`                 | L3          | Same                                                       | `06243888…e07db5` ✓                                        |
| `tests/unit/environment.test.ts` | L1          | Approved separately when found: "Include it (Recommended)" | `4bef1dab…81bae2` ✓                                        |

- **Manifest:** exactly those five entries changed in `1eb6e86` (ten lines of the diff). The
  manifest's own SHA-256 is `c96ca89e0407079eef45f6e92573fc87eaf1837d3200c9ab65c597c2432d06c6`,
  which matches `docs/demo-baseline.md`.
- **Verification after the refresh:** `bun scripts/check-baseline.ts` reports all 403 files
  matching. This was run in the working copy and again in the clean re-run.
- **Also changed in that commit, not frozen:** `docs/readiness/format-exceptions.txt` (the
  `errors.test.ts` exception removed), the harness, the integration test and the documentation.

**Where what was built differs from the approved L1 wording:**

- **Category values.** The proposal named `"app"`, `"framework"` and `"non-error"`. The logger
  writes `"database"`, `"error"` and `"non-error"`. It can't tell an app error from a framework
  error, so `"error"` covers both, and `"database"` was added for errors that carry a database
  code.
- **Stack frames.** The proposal said "file and line only". The logger keeps whole `at …` lines,
  so function names are kept too. §5 shows how a message can forge such a line.

Neither difference was raised when the change was made. The founder should either accept the
change as built or have it brought into line; L6 (§10) does the second.

## 4. The retained fields

| Field                           | How it's derived                                                       | Allowlist or controlled?                                                                                                      | Length limit                   | Safe to serialize?                                                                          | Result                                               |
| ------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `ref`                           | `newReference()`: 4 random bytes, hex, upper case                      | Controlled at every call site (`rpc.ts`, `start.ts`, `session.ts`, `email-notices.ts`); `reportError` itself doesn't check it | 8 by construction              | Yes                                                                                         | Pass; no check inside the logger                     |
| `type`                          | `err.name` for an `Error`, else `typeof`                               | **No.** The name is whatever the thrower set                                                                                  | **None**                       | **No:** a non-string name is serialized as it is, and a BigInt makes `JSON.stringify` throw | **Gap** (§5)                                         |
| `category`                      | Fixed: `database`, `error` or `non-error`                              | Yes                                                                                                                           | Fixed                          | Yes                                                                                         | Pass; misclassifies `EPERM`-style errors as database |
| `code`                          | `code` on the error or its cause, if `/^[0-9A-Z]{5}$/`                 | By shape only. `EPERM`, `EBUSY` and `EBADF` pass                                                                              | 5                              | Yes                                                                                         | **Gap** (minor)                                      |
| `table`, `column`, `constraint` | Same object, if `/^[a-z_][a-z0-9_]{0,62}$/`                            | By shape only. Any lower-case token passes                                                                                    | 63                             | Yes                                                                                         | **Gap** for `table`; residual for the other two (§5) |
| `stack`                         | `err.stack` split into lines; lines matching `^\s+at ` kept; at most 6 | **No.** Lines of the message that look like frames pass                                                                       | 6 lines; **no per-line limit** | **No:** a non-string `stack` throws                                                         | **Gap** (§5)                                         |

- **No raw-stack fallback: confirmed.** When no frame survives, the `stack` field is left out. The
  raw stack is never written in its place, which a test now shows.
- **The message and cause message** are never read into the line, as L1 intended.

## 5. Spoofed and malformed thrown values

Code that throws controls every property of what it throws. Each retained field was tried with
private synthetic text, and each malformed shape was checked for whether it makes the logger
itself throw. The cases are in `tests/integration/error-redaction.test.ts`, in two new groups.
Known gaps run as `it.fails`, and each was checked to fail for the gap it names.

**Pass (normal tests):**

- An object shaped like an error (`name`, `message`, `stack` holding private text) is logged as
  `object`, `non-error`, and nothing else.
- A null-prototype object, a symbol and an error with a `toJSON` method change nothing.
- A stack with no frames leaves the field out (no raw-stack fallback).
- Database fields that aren't code- or name-shaped are dropped.

**Gaps (expected failures until L6):**

| #   | Input                                                                                      | What happens now                                                                         |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| G1  | `error.name` set to private text                                                           | Written as `type`, word for word                                                         |
| G2  | `error.name` set to an object                                                              | The object is serialized into `type`                                                     |
| G3  | A message with a line shaped like `    at <text> (file.ts:1:1)`                            | Kept as a call frame                                                                     |
| G4  | `table` set to a lower-case token                                                          | Written                                                                                  |
| G5  | `code: "EPERM"` on an ordinary error                                                       | Categorized as a database error                                                          |
| G6  | A 100,000-character name                                                                   | A 100,828-character line                                                                 |
| G7  | A 100,000-character frame                                                                  | A 100,130-character line                                                                 |
| G8  | A BigInt `name`; a non-string `stack`                                                      | **The logger throws** (`TypeError`)                                                      |
| G9  | A throwing getter on `name`, `stack`, `cause` or `code`; a Proxy that throws on every read | **The logger throws** the getter's own error, here one whose message is the private text |

**Residual, accepted until reviewed:** an identifier-shaped `column` or `constraint` is kept.

- An undefined-column error (42703) names a column the schema doesn't have, so these two can only
  be checked by shape.
- Postgres sets these fields itself, from object names, so a real database error can't carry a
  value there.
- Only code that builds its own error object could, and the app has none that does.

**Why G8–G9 matter beyond the line itself.** When `reportError` throws inside `run()`'s catch
(`src/server/rpc.ts`):

- No line is written.
- The thrown error leaves the handler and is serialized back to the browser, message included.

The same path was seen for a handler error that isn't wrapped (§7, observation O1). So the logger
can be made to lose the diagnostic, but in no case seen does it print the raw object to the
server's output.

## 6. The output check's negative controls

The check (`scripts/check-output-redaction.ts`) had one negative control: `--self-test` plants a
marker in the browser console, and the check must catch it there. It now has a second, for server
output:

- `--self-test server` preloads `scripts/redaction-self-test-preload.ts` into the server process.
- That process writes one marker to its stdout as it starts, and another to its stderr five seconds
  later, while the scenarios run.
- The run passes only if both are found, each in its own channel, and nothing else is.

**Result (working copy after `1eb6e86`, 2026-10-29):**

| Run                     | What it must find                                                  | Found                                                                                          | Exit |
| ----------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---- |
| `--self-test` (browser) | The planted marker in the browser console only                     | `"query" marker in browser console and page errors`, nothing else                              | 0    |
| `--self-test server`    | One marker in server stdout and one in server stderr, nothing else | `"selfTestOut" marker in server stdout`, `"selfTestErr" marker in server stderr`, nothing else | 0    |

In both, the planted markers are reported as problems, the ones that fail an ordinary run. The
self-test mode then passes only because exactly those problems appeared. The server control is now
a step of `scripts/ci.sh` (full mode).

## 7. L4: the framework's own error output

| Aspect                | Finding                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Emitter               | `console.error("Server Fn Error!", error)` in `handleServerAction`, `node_modules/@tanstack/start-server-core/dist/esm/server-functions-handler.js` line 92 |
| Versions              | `@tanstack/start-server-core` 1.169.39 (under `@tanstack/react-start` 1.168.60), `seroval` 1.6.11, Bun 1.4.4, Vite 8.1.5                                    |
| Formatting            | Bun's `console.error` prints the error with a source excerpt (library code), its stack and its own enumerable properties                                    |
| Also                  | Development only: `console.warn("Failed to parse FormData context:", e)` at line 60                                                                         |
| Affected environments | Every environment that runs the server: the development server, the local production build, and any future host. Not the browser                            |

**Trigger.** The emitter runs for an error thrown inside `handleServerAction` but outside the
function's own handler:

- the body is read and parsed (`request.json()`, `JSON.parse` of the GET `payload`);
- seroval decodes it;
- the form-data-on-GET invariant;
- "Payload too large";
- the result is serialized.

Not every error reaches it:

- **Validation failures and errors thrown by a handler don't.** The framework returns them to the
  browser (HTTP 200 with a serialized error), and nothing is printed.
- **An unknown function address doesn't.** It fails earlier, in `getServerFnById`, and reaches the
  app's own catch in `src/start.ts`, which logs one L1 line.

**Each input tried, with a marker, on an isolated development server (port 3230, its own
database):**

| Input                                                            | Printed                                                                                            | Marker printed?                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| A body that isn't JSON, starting with a bare word                | `Server Fn Error! SyntaxError: JSON Parse error: Unexpected identifier "<word>"`                   | **Yes: the first bare word, verbatim** |
| A bare word after a comma inside otherwise valid JSON            | Same                                                                                               | **Yes**                                |
| A truncated string, a missing brace, a bad escape, trailing text | `Unterminated string`, `Expected '}'`, `Invalid escape character q`, `Unable to parse JSON string` | No (one character of an escape)        |
| Valid JSON that seroval can't decode, marker inside a string     | `Seroval Error (step: 3)`, then the cause's engine message and stack                               | No                                     |
| An unknown seroval node                                          | `Seroval Error (specific: 2)`                                                                      | No                                     |
| GET with an unparseable `payload`                                | `JSON Parse error: Expected '}'`                                                                   | No                                     |
| Form data on a GET                                               | `Invariant failed: GET requests with FormData payloads are not supported`                          | No                                     |
| Invalid enum value; wrong type; unknown persona (handler error)  | Nothing (returned to the browser)                                                                  | No                                     |

**Latent, by code reading.** seroval's `SerovalUnsupportedTypeError` and
`SerovalMissingReferenceError` keep the offending value as an enumerable `value` property:

- If a handler ever returned a type seroval can't serialize, line 92 would print that value. A
  class instance would be printed with its fields.
- A direct check confirmed the printing: a function value inside a result was printed as
  `value: [Function: fn]`.
- No handler returns such a value today; the browser suites would fail if one did.

**On Node instead of Bun.** V8's `JSON.parse` messages quote a stretch of the input around the
error, so the first case would quote more there. The production runtime isn't decided.

**What the app can and can't do.**

- **Can't:** line 92 has no option. TanStack Start offers global function middleware
  (`createStart({ functionMiddleware })`), but that runs inside the handler, after decoding, so it
  never sees these errors.
- **Can:** catch the confirmed case before the framework does. `src/start.ts`'s request
  middleware runs first, so it could:
  - check that a server-function JSON body (and a GET `payload`) parses;
  - if it doesn't, answer 400 itself;
  - log one L1 line (type `SyntaxError`, a reference), so the diagnostic signal is kept.

  That replaces the framework's line for one class of input. It's not a blanket suppression:
  every other error still reaches line 92 and prints.

- **Elsewhere:**
  - raise the raw printing upstream (an outside contact, so the founder decides);
  - filter process stderr in the hosted log pipeline (PB-02, H6) as a second layer.

**Diagnostic signal kept today:** the framework's line says it was a server-function error and
gives the error class and stack. With the proposal, the 400 reply and the L1 line (type and
reference) stand in for it, for that one class.

**Observation O1 (not logging).** A handler that isn't wrapped in `run()` or a `try` sends a thrown
error's message back to the browser:

- **Affected handlers:** `whoAmI`, `signOut`, `signIn`, `listPersonas`, `getAuthOptions`,
  `getSystemNotice`, `getAddresses`, `resetSyntheticData`, `listDevMail` and `sendDueNoticesNow`.
- **Risk:** a database error in one of them could carry query parameters back to the browser.
  That's the same person's own browser, but it's outside L1's redaction.
- **Status:** recorded for the threat model (T19, client side), not part of L4.

## 8. Care-team sessions in the output check

The check now signs in as a care-team member (Maya, a care guide, with a generated password in
the throwaway database). It covers every care-team path that's implemented, each with its own
marker:

| Path                  | Scenario                                                                                                        | Expected                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Authentication        | A wrong email and password on `/staff-sign-in`                                                                  | The generic sign-in message                                                                   |
| Authentication        | Maya on the family page; Daniel on the care-team page                                                           | Each sent to the right page                                                                   |
| Authentication        | Maya signs in on `/staff-sign-in`                                                                               | The staff workspace; her session token is then a checked secret                               |
| Authorization failure | Maya enrolls a household with a patient name she typed (a care guide hasn't `household.enroll`)                 | `NOT_PERMITTED`                                                                               |
| Recovery              | A reset request, a check of a link never issued, and a completion with that link and a new password             | Refused quietly (no mail channel here; care-team accounts are never eligible for email reset) |
| Expiry                | A care-team session that ended an hour ago (planted in the throwaway database), then a call with a patient name | Sent to sign in; the call refused `NOT_AUTHENTICATED`                                         |
| Unexpected error      | A second server whose database won't open, Maya's session in the cookie, a call with a patient name             | The reference reply, and the same reference in a structured line                              |

The second server is also where the L2 check now runs in both modes:

- **Development server:** the data folder is a file.
- **Production build:** the environment isn't named.

**Not covered:**

- **Unexpected errors after authentication.** On the second server the database can't open, so the
  failure comes before Maya's session is read. Nothing that can be done from outside makes a
  signed-in care-team call fail on the server.
- **Multi-factor and administrative recovery.** Neither is built; both are production identity
  gates.

**Result: all four variants passed** (working copy after `1eb6e86`, 2026-10-29). Each ran all 16
scenarios, the 7 above included, with no problems.

| Variant                | Agent variables | Problems | Known gaps                      | Structured lines on the second server |
| ---------------------- | --------------- | -------- | ------------------------------- | ------------------------------------- |
| Development server     | Present         | None     | `badJson` in server stderr (L4) | 2 (sign-in, care-team call)           |
| Development server     | Removed         | None     | Same                            | 2                                     |
| Local production build | Present         | None     | Same                            | 2                                     |
| Local production build | Removed         | None     | Same                            | 2                                     |

**Across all four variants:**

- None of the eight care-team markers appeared in any channel or table.
- None of the five secrets appeared in any output, reply or table: the two generated passwords and
  the three session tokens.
- The reference shown for the unexpected error was the one logged.

**The L4 quoting path reproduces on the production build as well as the development server.** For
the record, an earlier attempt in this review got the "body that isn't JSON" scenario wrong:
Playwright sends a string body that isn't valid JSON as a quoted JSON string, so the request
reached seroval instead of the JSON parser. The scenario now sends raw bytes. Scenario 6 still
sends a string, so it exercises seroval's decoder as before.

## 9. L5: test artifacts

The policy is [test-artifact-policy.md](../../architecture/test-artifact-policy.md). Its status is
**proposed, not adopted**. It covers:

- traces, screenshots, videos, captured requests and output, and uploads (there are none);
- who can see each, where it's kept, for how long, and how it's deleted;
- the standing condition that no suite ever points at real data.

It changes no file. Two of its rules would need a lift if they were ever triggered:

- turning traces off in a frozen config;
- making the CI job run the output check.

## 10. Proposed further corrections (none made)

Each needs the founder's explicit approval. None is covered by the L1–L3 lift.

**L6. Harden the logger** (`src/server/observability.ts`, frozen).

- **Change:**
  1. Wrap the whole of `diagnostic()` and the `JSON.stringify`. On any failure write a fixed line,
     `{level, at, ref, type: "Unknown", category: "unloggable"}`. Never throw, never print the value.
  2. `type`: only from a fixed list of names (the built-in error classes, `AccessError`,
     `IntegrationNotConnected`, `DrizzleError`, `DrizzleQueryError`). Any other `Error` is written
     as `"Error"`. Names are read through a guard, so a throwing getter can't escape.
  3. Frames:
     - drop exactly the `name: message` header;
     - if the stack doesn't start with it, keep no frames;
     - keep only `file:line:column` locations, as the approved L1 wording said;
     - at most 6 frames, at most 300 characters each.
  4. `code`: a Postgres SQLSTATE class only (`00`–`HV`, `P0`, `XX`), so `EPERM` is an ordinary
     error.
  5. `table`: only a table the schema defines. `column` and `constraint` keep the shape check (the
     residual in §5).
  6. `ref`: checked as eight hex capitals. Anything else is written as `"INVALID"`.
- **Bring the record into line:** keep `database`, `error`, `non-error` and add `unloggable`, or
  rename to the approved `app`, `framework`, `non-error`. That's the founder's choice. Renaming
  changes `tests/unit/errors.test.ts` (frozen) too.
- **Tests:** the 14 `it.fails` cases in `error-redaction.test.ts` become normal tests. The unit
  and integration suites run, and the output check runs in all four variants plus both
  self-tests.
- **Risks:**
  - less detail in a frame (no function names);
  - an unknown error class shows as `Error`;
  - schema import into the logger (server-only).
- **Rollback:** revert the commit. There's no data or schema change.

**L4-a. Refuse an unreadable server-function body before the framework does** (`src/start.ts`,
not in the manifest, recorded as a lift).

- **Change:** in the request middleware, for `/_serverFn/` requests:
  - a JSON body that doesn't parse, or a GET `payload` that doesn't, gets a 400 reply with the
    security headers;
  - the error goes to `reportError` with a reference.

  Everything else is unchanged.

- **Tests:**
  - the `badJson` known gap in the output check must then stop reproducing, and the check will say
    so; its entry is removed;
  - `e2e/cross-site.spec.ts` and `e2e/security-headers.spec.ts` must still pass;
  - all browser suites.
- **Risks:**
  - each server-function body is parsed twice (the framework reads it whole anyway);
  - a 400 in place of the framework's 500 for that input; the app's own client never sends it.
- **Rollback:** revert.

**L4-b. Upstream and hosting** (no file here).

- Ask TanStack Start for a way to report server-function errors without printing the raw object.
  This contacts an outside project, so the founder decides.
- Filter process stderr in the hosted log pipeline (PB-02, H6) before anything is stored.

**R1. Let a clean clone pass CI** (`scripts/check-doc-links.ts`, not frozen; the alternative,
editing the link in `docs/founder-decision-log.md`, is frozen).

- **Smallest change:** the link check treats a git-ignored target as a local note, not a broken
  link.
- **Tests:** the check on a clean clone, and on the working copy.
- **Rollback:** revert.

**R2. Make the consent-activation test run** (`e2e/staff-workspace.spec.ts`, frozen).

- **Smallest change:** the test creates its own pending consent (through the same staff calls a
  care team would use), or fails instead of skipping when there's none.
- **Tests:** the end-to-end suite, with that test passing, not skipped.
- **Rollback:** revert.

## 11. What T19 still lacks

- The logger gaps G1–G9 (L6).
- The framework's raw printing, with one confirmed quoting path (L4-a and L4-b).
- Handler errors returned to the browser unredacted (O1).
- Test artifacts: the policy isn't adopted yet (L5).
- Unexpected care-team errors after authentication aren't exercised.
- There's no hosted log pipeline to check.
- The production runtime isn't chosen (Node would quote more of a bad body than Bun).
