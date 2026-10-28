# Evidence: cross-site request refusal (PB-06), 2026-10-27

**Status: verified in synthetic testing. Not closed.** PB-06 closes only when the privacy and
security officer approves this evidence and it's repeated on staging behind the real load balancer.

## What was built

- **Rule:** `crossSiteRefusal` in `src/domain/same-origin.ts`. A request that can change something
  (POST, PUT, PATCH, DELETE) is refused unless its `Origin` names this server or a configured
  address (`ZEPORAH_APP_URL`, `ZEPORAH_CARE_URL`). With no `Origin`, `Sec-Fetch-Site` must be
  `same-origin` or `none`; `same-site` is refused, because the app and care addresses share a site
  but a sibling subdomain isn't trusted. A request with neither header (not a browser) is allowed.
- **Where:** the first global request middleware in `src/start.ts`, ahead of the address redirect.
  Every request passes through it, server functions included, so no write path can be missed. A
  refusal returns 403 with a fixed message and logs nothing.
- **Not built:** a CSRF token. The pilot evidence plan asks for "an origin check … plus a token or
  fetch-metadata check"; this uses fetch metadata as the second signal.

## Tests

| Test                                                                                            | Result                                                     |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `tests/unit/same-origin.test.ts` (5 tests: reads, methods, origins, fetch metadata, no headers) | 5 of 5 passed                                              |
| Unit and integration suites (`bunx vitest run`)                                                 | 505 of 505 passed (67 files), 2026-10-27                   |
| End-to-end suites                                                                               | Not run: the test browser isn't installed on this computer |

## Replay against the running development server

A real sign-in request was captured from the browser (`signIn`, a POST server function), then
replayed with curl against `http://localhost:3000` with each header combination. "Session" means
the response set the `zp_session` cookie, the change this request makes.

| Request                                         | HTTP | Session set |
| ----------------------------------------------- | ---- | ----------- |
| `Origin: https://evil.example`                  | 403  | No          |
| `Origin: null`                                  | 403  | No          |
| No Origin, `Sec-Fetch-Site: cross-site`         | 403  | No          |
| No Origin, `Sec-Fetch-Site: same-site`          | 403  | No          |
| `Origin: http://localhost:3000`                 | 200  | Yes         |
| No Origin, `Sec-Fetch-Site: same-origin`        | 200  | Yes         |
| Neither header                                  | 200  | Yes         |
| GET `/demo` with `Origin: https://evil.example` | 200  | —           |

The browser's own sign-in (persona buttons on `/demo`) kept working with the check in place.

## Limits

- **Behind the load balancer** the check trusts `X-Forwarded-Host`, so the edge must set it and strip
  any value a client sends. Unverified until hosting exists (PB-02).
- **Per write path:** the check sits in front of every request, so one replay proves the mechanism,
  not each endpoint's own handling. The closure criterion ("no state change succeeds from a foreign
  origin, by test") still needs an automated end-to-end test across every POST server function.
- **Scripts without browser headers** are allowed by design; they carry no victim's cookie.
