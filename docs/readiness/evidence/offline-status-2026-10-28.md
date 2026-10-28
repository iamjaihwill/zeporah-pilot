# Evidence: offline status (increment 9, decisions 84–87), 2026-10-28

**Status: verified in synthetic testing.** Covers the "when disconnected" and "uncertain
submission" parts of brief §14 ([brief-reconciliation-2026-10-27.md](../../brief-reconciliation-2026-10-27.md)).
Zeporah stays offline-tolerant, not offline-first. Fallback channels, an outbox and bounded retries
(the rest of §14) are not part of this increment.

## What was built

| Decision | Behaviour                                                                                                                                                                                                                                                                                                                                                                                           | Where                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 84       | While the browser says it's offline, every change through `useAction` is refused before anything is sent, with "You're offline, so this wasn't sent or saved…"; buttons that follow `pending` are unavailable, while "Sending…" labels follow `sending`. Staff-queue actions that call the server directly use `pausedOffline()`. Nothing is queued.                                                | `src/lib/client.ts`, `src/lib/connection.ts`                                                    |
| 85       | One banner in both workspaces: "You're offline", when what's on screen was loaded, that changes are paused, and the hospice's 24-hour line from data already loaded. On reconnect the banner clears and the page reloads its data.                                                                                                                                                                  | `ConnectionStatus` in `src/components/offline.tsx`; the family and staff layouts                |
| 86       | A send with no reply keeps only `{ id, kind, at }` in this tab's session storage, never the words. On reconnect, reload, focus, or 5 seconds after the failure, the page asks the server (`checkSubmissions`) about the person's own message or request with that ID and says "arrived" or "didn't arrive, and it wasn't sent again". Any later answer to a retry with the same ID also settles it. | `rememberUncertain`, `UncertainSends`; `submissionStatus` in `src/server/services/send-once.ts` |
| 87       | Family and staff: the five composers that send with a submission ID (family messages, family support requests, the patient's concern, staff replies on the household record and in the exception detail).                                                                                                                                                                                           | `unconfirmedSend(kind, submissionId)` at each                                                   |

## Tests

- `tests/unit/connection.test.ts` (5): the browser's online state; only the ID, kind and time are
  stored, once each; settled sends are forgotten and storage cleared; stored sends survive a reload,
  malformed entries are dropped, at most 20 are kept; blocked storage doesn't break the page; no
  composer passes the unconfirmed-send wording without its ID.
- `tests/integration/submission-status.test.ts` (3): a person's own message and request are found
  with their time, and nothing about their content is returned; someone else's send isn't found;
  staff sends work; at most 20 IDs are checked.

Unit and integration suites: 608 of 610, run at 8:39 AM Eastern. The two failures are the
`direction-refinements` fixture-timing tests recorded in
[request-lifecycle-2026-10-28.md](request-lifecycle-2026-10-28.md), which fail on unchanged `main`
between 8 and 9 AM. End-to-end suites: not run (the test browser isn't installed on this computer).

**In the browser** (development server, synthetic data; the pane can't cut its own network, so the
browser's offline state was set from the page's console):

- As Daniel on Updates & messages, offline: the banner read "You're offline. What you see was loaded
  at Oct 28, 8:37 AM…" with "555-0100 (synthetic 24-hour line)", and "Send message" was unavailable.
  Back online, the banner cleared.
- A lost reply, simulated by letting one send reach the server and then dropping its answer: the
  composer said it couldn't confirm the send, session storage held only the ID, kind and time, and
  about 5 seconds later the page said "Your message from Oct 28, 8:38 AM arrived." The thread showed
  the message once.
- After a reload with an ID that was never sent: "Your request … didn't arrive, and it wasn't sent
  again."
- As Maya, the staff workspace showed the same banner with the hospice's line.

## Limits

- **"Offline" is the browser's view.** A connection that's up but not reaching Zeporah (a captive
  portal, a server outage) shows no banner; sends then fail with the unconfirmed-send wording and
  are settled as above.
- **Navigating while offline** still tries to load the next page and shows the app's error page;
  only the page already open is kept on screen.
- **Buttons that don't follow `pending`** stay enabled while offline; pressing them is refused with
  the offline message and nothing is sent.
- **After "arrived"**, the composer's own error and text stay until the person clears them; sending
  again is safe (the server returns the first copy).
- **Sign-in, password and invitation pages** are outside the workspaces and have no banner.
