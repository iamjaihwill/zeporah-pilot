# Evidence: logging-path assessment for threat T19, 2026-10-29

**Status: an assessment with local, synthetic evidence. T19 stays partial. Nothing here closes T19
or shows the application is ready for hosting.** No frozen file was changed; the corrections that
need a lift are proposed in §5. Revision: `main` after `5b1cabb`, plus the files this note
introduces. Threat model: [threat-model.md](../../architecture/threat-model.md) (T19).

## 1. The emission that printed the refused-send text

The line seen in browser-test output on 2026-10-29,

```text
[WebServer] … [vite] (client) [Unhandled rejection] Unknown Error: This change has to come from Zeporah itself. Nothing was changed.
```

comes from **Vite 8's `server.forwardConsole`**, which copies the browser's uncaught errors and
`console.error` and `console.warn` calls into the development server's terminal
(`vite:forward-console` plugin, `apply: "serve"`). Its default is **on only when Vite detects an AI
coding agent**: `determineAgent()` checks `AI_AGENT`, `CLAUDECODE`, `CLAUDE_CODE`, `CURSOR_*`,
`CODEX_*`, `GEMINI_CLI`, `COPILOT_*` and a few others (`node_modules/vite/dist/node/chunks/node.js`).
This session sets several of them, so the e2e and development servers it starts forward; a person
running `bun run dev` in an ordinary terminal doesn't. `vite.config.ts` (frozen) doesn't set it.

**What it carried:** the fixed refusal wording the server sent, not anything typed. The browser spec
that triggers it (`e2e/cross-site.spec.ts`, "a real message …") was run with the agent variables
present and removed; the typed text ("Cross-site test message that must never arrive") appeared in
neither run's output, and the forwarded lines appeared only with the variables present.

**What it could carry:** anything the page writes with `console.error` or `console.warn`, or any
uncaught error's message. The client builds no error message from what people type (one `throw` in
`src/lib`, `src/components` and `src/routes`, with fixed text), and server error bodies are fixed
wording or zod issues, which name the rule and not the value. React's development warnings are the
open case: a hydration-mismatch warning quotes the differing page text, which can be household
content. The harness's self-test (§4) proves the path: a marker logged with `console.error` in the
page appeared in the development server's stderr with the agent variables present, and not without
them, and never on the production build.

## 2. Coverage of the error logger (`reportError`, `src/server/observability.ts`)

Every case confirms first that the private text is in the thrown value. Tests:
`tests/unit/errors.test.ts` (existing, frozen) and `tests/integration/error-redaction.test.ts`.

| Shape                                                                                     | Logged?                     | Test                               |
| ----------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------- |
| Query parameters in the message (`params: …`)                                             | No                          | Both files; real insert and update |
| Query parameters in a stack line                                                          | No                          | `error-redaction`                  |
| Database detail fields (`detail`, `hint`, `where`, `params` on the cause)                 | No (never read)             | `error-redaction`, real failure    |
| A cause two levels down                                                                   | No (only one level is read) | `error-redaction`                  |
| A plain object                                                                            | No (`[object Object]`)      | `error-redaction`                  |
| A circular structure                                                                      | No (not walked)             | `error-redaction`                  |
| An `AggregateError`'s inner errors                                                        | No                          | `error-redaction`                  |
| **A database cause that quotes the value** (`invalid input syntax for type integer: "…"`) | **Yes**                     | `error-redaction`, `it.fails`      |
| **A thrown string**                                                                       | **Yes** (as the message)    | `error-redaction`, `it.fails`      |
| **An error message that quotes a value**                                                  | **Yes**                     | `error-redaction`, `it.fails`      |
| **A cause's message that quotes a value**                                                 | **Yes**                     | `error-redaction`, `it.fails`      |

The four leaks are kept as expected failures (`it.fails`), each checked to fail on the leak itself
and not on its precondition. Reachability today: the app's own thrown messages quote configuration
only (`src/domain/addresses.ts`, `src/domain/record-classes.ts`, `src/fixtures/demo-week.ts`), and
zod validates types before a query runs, so no route found reaches a quoting database cause with
typed input. That's an observation, not a guarantee.

The first version of `error-redaction.test.ts` required the database's own wording to survive. It
no longer does: what must survive is the safe diagnostic event (level, reference, error type).

## 3. Other channels

| Channel                                   | Checked how                                                 | Result                                                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server stdout and stderr                  | The harness (§4), four variants                             | No marker, password or session token                                                                                                                           |
| Browser console and page errors           | The harness                                                 | No marker; only fixed wording (a 403 resource line, development notices)                                                                                       |
| Browser responses                         | The harness keeps every server-function response            | Only the sent message, in the thread returned to its own household; validation replies name the rule, not the value                                            |
| Database tables, including the access log | The harness reads every table after the run                 | Markers only in `messages` (the sent one); no marker, password or token anywhere else, `audit_events` and `staff_access_events` included                       |
| Driver debug output                       | `src/server/db/client.ts`                                   | Drizzle's query logger isn't turned on; PGlite's debug level isn't set                                                                                         |
| Framework errors                          | The harness's malformed-body and unknown-function scenarios | The framework prints "Server Fn Error!" with raw stacks and code excerpts to stderr, outside the app's logger. No marker in it                                 |
| Startup                                   | Captured output                                             | A TanStack Start notice about its own CSRF middleware (the app has its own check); no data                                                                     |
| Playwright traces (test artifacts)        | One spec run with `--trace on`, trace unzipped and searched | **The typed text (request body, page snapshots) and the session cookie are in the trace.** CI uploads `test-results/` on failure for 7 days (`.gitlab-ci.yml`) |
| Test runner output                        | Vitest's failure output                                     | A failing `not.toContain` prints the start of both strings (truncated); with synthetic data only                                                               |
| Harness output                            | `.data/redaction-*-output/` (git-ignored)                   | Complete captured output kept locally for review                                                                                                               |

**Not covered:** staff-side scenarios in the harness (only a family session), real network and
load-balancer logs (none exist), and a production server behind anything but `vite preview`.

## 4. The complete-output regression check

`scripts/check-output-redaction.ts`, added to the full CI run (`sh scripts/ci.sh`, after verify) for
the development server and a local production build. It starts its own server with its own
database, signs in with a generated password, and runs seven scenarios, each with its own marker:

- a wrong sign-in;
- a real message;
- an over-long message (refused by validation);
- a send re-sent as if from another site (403);
- a request to no server function (500);
- a malformed request body (500);
- a marker in a page address.

It fails if a scenario's failure path wasn't seen, if the safe diagnostic event (one structured error
line with a reference) is missing, or if a marker, the password or the session token appears in
server stdout, server stderr, the browser console or page errors, or (except for the sent message)
any table. `--self-test` plants a marker in the browser console and passes only if the check catches it.

| Run                                                                          | Agent variables | Result                                        |
| ---------------------------------------------------------------------------- | --------------- | --------------------------------------------- |
| Development server                                                           | Present         | Passed, no problems                           |
| Development server                                                           | Removed         | Passed, no problems                           |
| Local production build (`vite build`, `vite preview`, `NODE_ENV=production`) | Present         | Passed, no problems                           |
| Local production build                                                       | Removed         | Passed, no problems                           |
| Self-test, development, agent present                                        | Present         | Caught: browser console **and server stderr** |
| Self-test, development, agent removed                                        | Removed         | Caught: browser console only                  |
| Self-test, production build                                                  | Present         | Caught: browser console only                  |

A local production build is not a deployment: nothing left this computer.

## 5. Emission-path inventory

| #   | Component                                                  | Trigger                                                                  | Emitted fields                                                          | Redaction boundary                           | Environment                        | Test evidence                                                       | Residual risk                                                                                   | Proposed correction                     |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| E1  | App error logger (`reportError`)                           | Unexpected error in a server function, a timer, or the header middleware | Level, time, reference, type, message, one cause message, 6 stack lines | Drops `params:` lines; reads one cause level | All                                | `errors.test.ts`, `error-redaction.test.ts`, harness                | Messages and cause messages logged as they are (four `it.fails` cases)                          | L1                                      |
| E2  | Sign-in handler (`signInWithPassword`)                     | Any non-access error during sign-in                                      | Nothing                                                                 | n/a                                          | All                                | Found by the harness (production run without `ZEPORAH_ENVIRONMENT`) | **No diagnostic at all:** a refused database looks like a wrong password, and nothing is logged | L2                                      |
| E3  | Vite console forwarding                                    | Browser `console.error`/`warn`, uncaught errors                          | The browser's message and stack                                         | None                                         | Development server, agent detected | Harness self-test; e2e run with and without agent variables         | Development warnings (hydration mismatches) can quote page content                              | L3                                      |
| E4  | Framework server-function errors (TanStack Start, seroval) | Malformed body, unknown function                                         | "Server Fn Error!", error message, raw stacks, code excerpts            | None (outside the app)                       | All                                | Harness malformed-body and unknown-function scenarios               | Framework and serializer messages aren't under the app's control                                | L4                                      |
| E5  | Database migration notice                                  | Schema upgraded at start                                                 | `{"level":"info","event":"database.migrated","to":…}`                   | Fixed fields                                 | All                                | —                                                                   | None found                                                                                      | —                                       |
| E6  | Root error page (`src/routes/__root.tsx`)                  | A page fails to render                                                   | Browser `console.error` (development)                                   | Browser only (E3 forwards it in development) | Browser                            | `e2e/offline.spec.ts` guard                                         | Through E3 only                                                                                 | L3                                      |
| E7  | Playwright traces and CI artifacts                         | Any traced or failed browser test                                        | Request bodies, page snapshots, cookies, console                        | None by design                               | Tests and CI                       | Trace searched                                                      | **Safe only while every test runs on synthetic data**                                           | L5                                      |
| E8  | Test runner failure output                                 | A failed assertion                                                       | Truncated actual and expected values                                    | Truncation only                              | Tests and CI                       | Observed                                                            | Same as E7                                                                                      | L5                                      |
| E9  | Harness output files                                       | `scripts/check-output-redaction.ts`                                      | Complete captured output                                                | Git-ignored `.data/`                         | Local                              | —                                                                   | Synthetic only                                                                                  | —                                       |
| E10 | TanStack Start startup notice                              | Server start                                                             | Fixed text about its CSRF middleware                                    | Fixed                                        | Development and production         | Captured                                                            | None (noise)                                                                                    | Optional: silence it in the lift for L3 |

## 6. Proposed corrections (each needs the founder's lift; none is made)

**L1. Log approved diagnostic categories only** (`src/server/observability.ts`, frozen).

- **Change:** keep level, time, reference and type. Replace `message` and `cause` with approved
  fields only:
  - for a database error, the SQLSTATE `code` and the schema names in `constraint`, `table` and
    `column`, which are identifiers, never values;
  - for any other error, a fixed category (`"app"`, `"framework"`, `"non-error"`).
  - Keep stack frames as file and line only, without the first line, which repeats the message.
- **Also changes** `tests/unit/errors.test.ts` (frozen), which today expects the database's wording
  in `cause`. The four `it.fails` cases become normal tests.
- **Regression plan:** unit and integration suites, `error-redaction.test.ts` with all cases
  passing, and the harness in all four variants.
- **Trade-off:** less help reading a failure; the reference still ties the person's report to the
  line, and the code and constraint still say what kind of failure it was.
- **Rollback:** revert the commit; no data or schema change.

**L2. Report unexpected sign-in errors** (`src/functions/session.ts`, frozen).

- **Change:** in the sign-in handler's catch, call `reportError(e, newReference())` before returning
  the generic message, for anything that isn't an `AccessError`. The person still sees the same
  words.
- **Regression plan:** an integration test where the database can't open: same message, one
  structured line. Plus the auth unit, integration and browser suites.
- **Rollback:** revert.

**L3. Turn console forwarding off explicitly** (`vite.config.ts`, frozen).

- **Change:** `server: { …, forwardConsole: false }`, so the development terminal never receives
  browser output, whatever the environment says.
- **Regression plan:** the harness self-test with the agent variables present must then catch the
  marker in the browser console only; the browser suites keep their own console guards.
- **Rollback:** revert.

**L4. Framework error output** (no app file).

- These lines are printed by TanStack Start and Bun before the app can see them.
- **Proposal:** before hosting, route process stderr through the log pipeline's own filter (PB-02,
  H6), and raise the framework's raw printing upstream.
- Until then the harness watches for markers in it.

**L5. Test artifacts** (`playwright.config.ts`, frozen; `.gitlab-ci.yml`).

- No change while all data is synthetic.
- **Proposal:** record as a standing condition that test suites never run against an environment
  with real data (D-14). Consider `trace: "off"` in CI if hosted CI is ever pointed at anything
  else.

## Limits

Synthetic data only. Local machine only. The production run used `vite preview`, not the planned
hosted runtime. Nothing here was reviewed by the privacy and security officer.
