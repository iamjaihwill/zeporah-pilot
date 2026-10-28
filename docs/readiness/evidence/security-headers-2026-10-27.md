# Evidence: security-header baseline (PB-05), 2026-10-27

**Status: verified in synthetic testing. Not closed.** PB-05 also asks for a scan of staging, and
static files in production get their headers from the edge, which doesn't exist yet (PB-02).

## What was built

| Header                         | Value                                                                                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`      | `default-src 'self'`; scripts and styles `'self' 'unsafe-inline'`; images `'self' data: blob:`; fonts and connections `'self'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'` |
| `Strict-Transport-Security`    | `max-age=31536000; includeSubDomains`, only on requests that arrived over https                                                                                                                                        |
| `X-Content-Type-Options`       | `nosniff`                                                                                                                                                                                                              |
| `Referrer-Policy`              | `same-origin`                                                                                                                                                                                                          |
| `X-Frame-Options`              | `DENY`                                                                                                                                                                                                                 |
| `Permissions-Policy`           | camera, microphone, geolocation, payment, USB and interest cohorts all off                                                                                                                                             |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                                                                                                                                                                                          |
| `Cross-Origin-Resource-Policy` | `same-origin`                                                                                                                                                                                                          |

Defined once in `src/domain/security-headers.ts`. Added to every app response by the first request
middleware in `src/start.ts` (pages, redirects, 404s, server functions, and the cross-site refusal),
and to static files by the development server (`server.headers` in `vite.config.ts`). No value
depends on the hosting choice: the app loads nothing from another site.

## Tests

- `tests/unit/security-headers.test.ts`: 4 of 4 (every required header named; HSTS only over https;
  nothing from another site in the policy; the inline-script weakness recorded as a test).
- Unit and integration suites: 531 of 531.
- End-to-end suites: not run (the test browser isn't installed on this computer).

### Against the running development server

| Response                                     | HTTP | Headers present (of 7, plus HSTS)      |
| -------------------------------------------- | ---- | -------------------------------------- |
| Sign-in page `/`                             | 200  | 7, no duplicates                       |
| Protected page `/family`, signed out         | 307  | 7                                      |
| Unknown page                                 | 404  | 7                                      |
| Static image `/images/sign-in-couple.jpg`    | 200  | 7 (none before the dev-server setting) |
| Server function (GET)                        | 200  | 7                                      |
| Cross-site POST, refused                     | 403  | 7                                      |
| Sign-in page with `X-Forwarded-Proto: https` | 200  | 7 plus HSTS                            |

### In the browser

The browser console tool doesn't show the browser's own policy messages, so violations were
counted with a `securitypolicyviolation` listener (checked first: a deliberate outside `fetch`
was blocked and reported as `connect-src`).

- **Staff workspace, as Dana:** 12 pages through in-app navigation (My work, Exceptions, Packets,
  Households, Sharing, Bereavement, Audit, Reports, Team, Settings, System status, Policy):
  **0 violations**, every page rendered.
- **Family app, as Daniel:** 9 pages (Home, Tasks, Messages, Vault, People, Sharing, Support,
  Notifications, Settings): **0 violations**, every page rendered.
- **Enforced:** an outside `fetch` was refused, and the app couldn't be framed, even by itself.
- The persona sign-in (a POST) and the reports charts (inline styles) worked under the policy.

## Limits

- **Inline scripts are allowed.** Server rendering writes its hydration data as inline scripts and
  the development server adds its own, so `script-src` includes `'unsafe-inline'`. That weakens the
  policy against injected script. The router can stamp a per-request nonce (`ssr.nonce`); moving
  to it needs a production build to test against.
- **First page loads weren't watched for violations** (a listener can't be installed before the
  page loads); they were checked by the page rendering and its scripts running.
- **Production static files** get their headers from the edge (PB-02), and staging must be scanned
  before PB-05 can close.
