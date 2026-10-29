# Evidence: cross-site refusal and header baseline in the browser suite (PB-06, PB-05), 2026-10-29

**Status: verified in synthetic testing on the development server. Neither item is closed.** Both
still need the check repeated on staging (PB-02) and the privacy and security officer's approval.
This was the next increment recommended in
[stage1-closure-2026-10-29.md §8](../../stage1-closure-2026-10-29.md#8-dependency-ordered-closure-plan).
It adds two browser specs and changes no application file and no frozen file.

## What the specs check

**`e2e/cross-site.spec.ts` (PB-06).**

- **Every function that changes data refuses other sites.** The list comes from the source: each
  `export const X = createServerFn({ method: "POST" })` in `src/functions`, 124 on 2026-10-29. A
  new one is covered without editing the spec, and the test fails if one has no address on the
  development server. Each function is sent five cross-site variants with a signed-in operations
  session:
  - a foreign `Origin`;
  - the opaque `null` Origin;
  - a sibling subdomain;
  - `Sec-Fetch-Site: cross-site` with no Origin;
  - `Sec-Fetch-Site: same-site` with no Origin.

  All 620 requests got 403 with the fixed refusal text.

- **Control:** the same address with this server's own Origin gets past the check.
- **A real send:** the page's own "Send message" call, with its real payload and session, re-sent
  as if from another site, gets 403. The message never reaches the care guide's view of the thread.
- **Reads:** a cross-site navigation to a page is allowed; only changes are refused, as designed.

**`e2e/security-headers.spec.ts` (PB-05).**

- **Every header on every response type:** each header of the baseline (`src/domain/security-headers.ts`)
  has its exact value on:
  - the family and staff sign-in pages;
  - a signed-out redirect and an unknown page (404);
  - a static image and a client module;
  - the cross-site refusal (403);
  - a family page, a staff page and a server function response.
- **HSTS:** absent over http, and present when the request arrived over https (`X-Forwarded-Proto`),
  including on a refusal.

## Results

| Command                                                                    | Result                                                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bunx playwright test e2e/cross-site.spec.ts e2e/security-headers.spec.ts` | 7 passed (after the fix in finding 1, all as normal tests)                                                                                                   |
| `bunx playwright test` (whole browser suite, with the two new specs)       | 208 passed before the fix (201 as before plus the 7 new tests); after the fix: 208 passed, 2 skipped, 0 failed, 2 skipped (the same two as before), 0 failed |

After the `src/start.ts` fix, every suite was run again: quick CI (types, formatting, links,
tracker, baseline, migrations, advisories) passed; unit and integration 622 of 622; browser suite
208 passed, 2 skipped; read-only 2 passed; upgrade and downgrade 10 passed; verify 22 passed, 12
skipped (the screenshot-capture specs, run on request only).

## Findings

1. **Framework errors before any handler had no security headers (low). Fixed the same day.** A
   request to an unknown server function address got the framework's own 500 reply without any
   baseline header, because the error escaped `next()` in the header middleware (`src/start.ts`).
   The reply is a short JSON error with no household data, but PB-05's closure criterion is "every
   response carries the policy". With the founder's approval (a freeze lift for `src/start.ts` only),
   the middleware now catches that error and sends the same reply (same status and body) with the
   baseline; a thrown `Response` keeps its own status and body. The spec's test for it, first
   marked "expected to fail", is now a normal test covering POST, GET and https.
2. **A refused send surfaces as an uncaught page error (low).** When the page's own send is
   refused, the client throws the refusal as an uncaught error instead of showing the composer's
   error state. A real person only meets this if their address configuration is wrong (an Origin
   the server doesn't trust). The fix would be in `src/lib/client.ts` (frozen) and needs a lift.
   The spec's own console guard allows that one error line only.
3. **Test-method note.** Playwright's `route.continue()` can't replace a browser's `Origin` header;
   a first draft that used it let the message through, which looked like a failure of the check and
   wasn't. The spec re-sends the request with `route.fetch()`, which does replace it, and asserts the
   403 before checking the thread.

## Limits

- Development server only. In production, static files get their headers from the edge, and the
  Origin check runs behind a load balancer; neither exists yet (PB-02).
- The cross-site test proves the refusal happens before any handler, not what each handler would
  do with a valid payload; only the message send is exercised with a real payload.
- The script policy still allows inline scripts (`'unsafe-inline'`, recorded in the header module);
  a nonce needs a production build.
