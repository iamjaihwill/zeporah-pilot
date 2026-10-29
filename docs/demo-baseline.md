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

**Freeze lifted and re-frozen on 2026-10-27** for increment 1 of the brief reconciliation
([brief-reconciliation-2026-10-27.md](brief-reconciliation-2026-10-27.md)) only, with the founder's
explicit approval: a same-origin check that refuses a change sent from another site (PB-06;
[evidence](readiness/evidence/csrf-origin-check-2026-10-27.md)). It lives in files outside the
manifest (`src/start.ts`, `src/domain/same-origin.ts`, `tests/unit/same-origin.test.ts`), so no
manifest entry changed; it's recorded because the demo build's behaviour changed. Pages and
same-origin changes behave as before.

**Freeze lifted and re-frozen on 2026-10-27** for increment 2 of the brief reconciliation only,
with the founder's explicit approval: audit appends serialized per tenant, a database guard against
a forked chain (migration `0024_audit_chain_link`), and verification that reports findings
([evidence](readiness/evidence/audit-chain-integrity-2026-10-27.md)). The manifest entries for
`src/server/audit.ts`, `src/server/db/schema.ts`, `src/server/db/migrations/meta/_journal.json`,
`src/server/services/system.ts`, `src/routes/staff/status.tsx`, `scripts/db-seed-previous.ts` and
`tests/integration/schema-upgrade.test.ts` were refreshed. System status now reads "No findings"
instead of "Verified"; nothing else on screen changed.

**Freeze lifted and re-frozen on 2026-10-27** for increment 3 of the brief reconciliation only,
with the founder's explicit approval: family and staff messages and family support requests send
once (migration `0025_submission_ids`), and their composers say a send couldn't be confirmed,
rather than "nothing was changed", when no reply comes back
([evidence](readiness/evidence/send-once-2026-10-27.md)). The manifest entries for the 14 frozen
files it touches were refreshed: `src/server/db/schema.ts`,
`src/server/db/migrations/meta/_journal.json`, `src/server/services/family.ts`,
`src/server/services/staff.ts`, `src/functions/family.ts`, `src/functions/staff.ts`,
`src/lib/client.ts`, the five composers (`src/routes/family/messages.tsx`,
`src/routes/family/support.tsx`, `src/routes/family/me.tsx`,
`src/routes/staff/households/$householdId.tsx`, `src/components/staff/queue-detail.tsx`),
`scripts/db-seed-previous.ts` and `tests/integration/schema-upgrade.test.ts`. The only wording that
changed is that one failure message on those five composers.

**Freeze lifted and re-frozen on 2026-10-27** for increment 4 of the brief reconciliation only,
with the founder's explicit approval: the security-header baseline on every response (PB-05;
[evidence](readiness/evidence/security-headers-2026-10-27.md)). The only frozen file it touches is
`vite.config.ts` (security headers on static files in the development server); its manifest entry
was refreshed. No screen or wording changed.

**Freeze lifted and re-frozen on 2026-10-27** for increment 5 of the brief reconciliation only,
with the founder's explicit approval: proposed record classes, retention holds (migration
`0026_retention_holds`) and a removal guard consulted by every path that removes a record, with no
deletion path and no retention periods ([evidence](readiness/evidence/retention-guard-2026-10-27.md)).
The manifest entries for the 8 frozen files it touches were refreshed: `src/server/db/schema.ts`,
`src/server/db/migrations/meta/_journal.json`, `src/server/services/family.ts`,
`src/server/services/tasks.ts`, `src/server/services/sharing.ts`, `src/domain/labels.ts`,
`scripts/db-seed-previous.ts` and `tests/integration/schema-upgrade.test.ts`. With no hold in place,
as in the demo, nothing on screen behaves differently.

**Decision record updated and freeze lifted on 2026-10-27** for increment 6 only, with the founder's
explicit approval: decisions 66–70 (enrollment and activation) were added to
`founder-decision-log.md`, and built ([evidence](readiness/evidence/enrollment-2026-10-27.md)):
enrollment by operations and administrators, staff invitations for the patient and one
coordinator, patient setup with no coordinator, the enforced pilot cap, and a Getting started
checklist (migration `0027_enrollment`). The manifest entries for the 19 frozen files it touches were
refreshed. **What a demo now shows differently:** Households offers "Enroll a household" to Dana and
Lena; household overviews that aren't fully started show a Getting started card; Hospice settings
has an Enrollment card; and Rehanna (alone in the Wells household) can now start setup.

**Decision record updated and freeze lifted on 2026-10-27** for the D-04 build only, with the
founder's explicit approval: decision 71 (staff read-access logging) was added to
`founder-decision-log.md` and built ([evidence](readiness/evidence/staff-read-logging-2026-10-27.md)):
an append-only access log of staff record opens and list views (migration `0028_access_log`) and a
"Who opened records" page for reviewers and administrators. The manifest entries for the 12 frozen
files it touches were refreshed. **What a demo now shows differently:** Audit review links to "Who
opened records" for Priya and Lena; nothing else on screen changes.

**Decision record updated and freeze lifted on 2026-10-28** for the D-15 build only, with the
founder's explicit approval: decision 72 (a verified 24-hour line) was added to
`founder-decision-log.md` and built ([evidence](readiness/evidence/verified-line-2026-10-28.md)):
two-person changes with a recorded call, 90-day re-confirmation, an optional backup line, a format
check and one source of truth (migration `0029_contact_line`). The manifest entries for the 20 frozen
files it touches were refreshed. **What a demo now shows differently:** Hospice settings has a "24-hour
line" card in place of the line field; System status has a "24-hour line" row; the staff record's
"After hours" line reads the live number.

**Decision record updated on 2026-10-28 (no product change):** decision 73 (accessibility commitment,
D-12) was added to `founder-decision-log.md`, and its manifest entry was refreshed. Every code, test,
seed and configuration file still matches.

**Decision record updated and freeze lifted on 2026-10-28** for increment 7 only, with the
founder's explicit approval: decisions 74–78 (the care network) were added to
`founder-decision-log.md` and built ([evidence](readiness/evidence/listed-contacts-2026-10-28.md)):
listed contacts, patient-private contacts and invitations from a contact (migration
`0030_household_contacts`). The manifest entries for the frozen files it touches were refreshed.
**What a demo now shows differently:** the family People page has "Other people who help"; the
staff household overview has "Listed contacts".

**Decision record updated and freeze lifted on 2026-10-28** for increment 8 only, with the
founder's explicit approval: decisions 79–83 (the request lifecycle) were added to
`founder-decision-log.md` and built ([evidence](readiness/evidence/request-lifecycle-2026-10-28.md)):
shared request states, withdraw and reopen, a next-update time with an Update overdue exception, and
escalation offers that need accepting (migration `0031_request_lifecycle`). The manifest entries for
the frozen files it touches were refreshed. **What a demo now shows differently:** "Your requests" on
the family Support page shows each request's state, owner's first name and next update, with
Withdraw… and Reopen…; the staff exception detail has "Where it stands" and "Offer to…" in place of
"Assign to…".

**Decision record updated and freeze lifted on 2026-10-28** for increment 9 only, with the
founder's explicit approval: decisions 84–87 (offline status) were added to
`founder-decision-log.md` and built ([evidence](readiness/evidence/offline-status-2026-10-28.md)):
an offline banner, changes paused while offline, and unconfirmed sends settled by submission ID. No
migration. The manifest entries for the frozen files it touches were refreshed. **What a demo now
shows differently:** nothing while online; offline, the banner appears above every page in both
workspaces and buttons that save or send are unavailable.

**Freeze lifted on 2026-10-28** for `src/fixtures/demo-week.ts` only, with the founder's explicit
approval, to fix a timing fault: seeded between 8 and 9 AM Eastern, the midweek story's "tomorrow
at 8 AM" leave for Maya had already started (the story's "now" is yesterday at 9 until 9 AM), so two
`direction-refinements` tests failed and a demo reset in that hour showed her away. Midweek, the
leave now starts at Day 5, 8 AM, or an hour after seeding if that has passed; the end-of-week story
is unchanged. Checked by seeding at ten times from 12:30 AM to 11:59 PM. The manifest entry was
refreshed. **What a demo now shows differently:** only when reset between 8 and 9 AM, where Maya's
leave starts an hour later than 8 AM.

**Freeze lifted on 2026-10-28** for `src/functions/session.ts`, `src/routes/__root.tsx` and five
end-to-end specs, with the founder's explicit approval, after the end-to-end suites ran for the first
time since 2026-10-22 (the test browser was installed that day). **A fix:** with no addresses set,
`getAddresses` returned a bare null, which the framework can't send to a caller other than the app's
own client, so replaying it gave a 500 where `boundaries.spec.ts` expects 200 or 403; it now returns
`{ app: null, care: null }`, and the security-headers middleware in `src/start.ts` (not frozen) no
longer throws when a result has no response. **Specs brought up to date** with approved changes:
`boundaries.spec.ts` ("Received", decision 80), `handoff.spec.ts` (Offer, then Maya accepts,
decision 83), `households-review.spec.ts` (8 households, with Rehanna's), `settings-review.spec.ts`
(the "What you reached" field, decision 72) and `status.spec.ts` ("No findings", increment 2). The
manifest entries were refreshed. **What a demo now shows differently:** nothing.

**Freeze lifted on 2026-10-28** for `e2e-verify/family-unchanged.spec.ts`, its two `family-sharing`
baselines and `src/routes/__root.tsx`, with the founder's explicit approval. The screenshot test
now masks dates without a time as well as times, since they move with the seed day; the two Sharing
baselines were retaken and the other four are unchanged. A page whose data never arrived (a dropped
connection, or a request cut off by a change of page) now says "Couldn't reach Zeporah" with Try
again, instead of "Something went wrong on our side", and isn't logged as an error. End-to-end 187
passed with 1 skipped; verify 22 passed with 12 skipped. The manifest entries were refreshed. **What
a demo now shows differently:** only when a page can't load.

**Decision record updated and freeze lifted on 2026-10-28** for the D-16 increment only, with the
founder's explicit approval: decisions 88–91 (delivery, retries and fallback) were added to
`founder-decision-log.md` and built ([evidence](readiness/evidence/outbox-2026-10-28.md)): one outbox
for every email, checks at send time, at most 5 attempts, and "Email not delivered" for operations
(migration `0032_outbox`). The manifest entries for the frozen files it touches were refreshed.
**What a demo now shows differently:** nothing, unless an email can't be delivered, which the
development mailbox never causes.

**Freeze lifted and re-frozen on 2026-10-28** for a dependency security fix only, with the
founder's explicit approval: seroval and seroval-plugins updated from 1.6.9 to 1.6.11 in `bun.lock`
for GHSA-f86p-h4j2-7qgj and GHSA-9wx9-5pv9-3349 (both moderate). Both are TanStack Start's own
dependencies and 1.6.11 is within the `^1.6.7` range it asks for, so `package.json` is unchanged.
The manifest entry for `bun.lock` was refreshed. **What a demo now shows differently:** nothing.

## What's frozen

- **The build:** 403 files covering the application code (including migrations through
  `0023_cover_notice` and seed fixtures), the tests, the configuration, the decision log and
  register, the presentation documents and the 22 run-through screenshots. Each file's SHA-256
  is in [demo-baseline-2026-10-22.sha256](demo-baseline-2026-10-22.sha256), and the manifest's
  own SHA-256 is `aef6d4bae57f8a39aee6a8ea17bdeee6a68b96ad8ecbdf0c790d4fc517217c40`. To check
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
