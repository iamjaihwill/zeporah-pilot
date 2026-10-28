# Evidence: end-to-end suites, 2026-10-28

**Status: run on this computer, synthetic data only.** The first run of the browser suites since the
2026-10-22 freeze. The test browser (Playwright 1.64.0's Chrome for Testing 156.0.8078.4, headless
shell and ffmpeg, about 286 MB from `cdn.playwright.dev`) was installed with the founder's approval
into `~/Library/Caches/ms-playwright`, outside the repository.

## Results

| Suite                                       | First run (at `1b09428`)        | After fixes           |
| ------------------------------------------- | ------------------------------- | --------------------- |
| End-to-end (desktop, plus phone for family) | 181 passed, 6 failed, 1 skipped | 187 passed, 1 skipped |
| Read-only mode                              | 2 passed                        | not re-run            |
| Upgrade and downgrade                       | 10 passed                       | not re-run            |
| Verify (with pixel baselines)               | 21 passed, 1 failed, 12 skipped | 22 passed, 12 skipped |

The 12 skipped verify tests are screenshot-capture runs that only run when asked for
(`SHOT_SET`, `STAFF_SHOTS`, `ENTERPRISE_SHOTS`, `MARKETING_SHOTS`), by design.

The end-to-end suite includes the axe-core accessibility checks (WCAG 2.0/2.1/2.2 A and AA) on the
pages, dialogs and phone layouts it opens, and they passed. It has **no browser tests yet** for
several things built since 2026-10-22: listed contacts, enrollment, the staff access log and offline
status (the request lifecycle is covered only through the offer test). Those are checked by unit and
integration tests and by hand in the preview, not by axe. All of this is automated checking, not a
manual review (D-12).

## What failed, and what was done

- **A real fault:** with no addresses set, `getAddresses` returned a bare null, which the framework
  can't send to a caller other than the app's own client; replaying it gave a 500. Fixed in
  `05dc8f0` (with the freeze lifted for it).
- **Five specs expecting earlier behaviour,** each changed by an approved decision: "Received"
  (decision 80), offering an escalation (83), eight households (the Rehanna persona), the 24-hour
  line's "What you reached" field (72), "No findings" (increment 2). Updated in `05dc8f0`; the offer
  test now also signs in as the offered person and accepts.
- **Verify, `family-sharing` at phone size:** 3,029 pixels (1%) differed, all in the dates on the
  page: the demo data is seeded relative to today, and the test masked times but not dates without
  a time. The test now masks those too, and the two Sharing baselines were retaken (with the freeze
  lifted); the family home and messages baselines were unchanged and still pass.

## Notes

- **"Failed to fetch" in the browser console,** only in passing tests that switch between people: a
  page request is cut off by the full-page change. The app used to show and log its "Something went
  wrong on our side" page for a moment. It now shows "Couldn't reach Zeporah … try again" for a
  lost request and logs nothing (`ConnectionLost` in `src/routes/__root.tsx`); the remaining
  console lines (5 and 10 in the reruns) are the framework's own.
- Each suite starts its own server with freshly reset data; the preview server wasn't used.
- The verify run rewrites `docs/review-screenshots/after` (a known side effect); those files were
  restored, as CI does.
