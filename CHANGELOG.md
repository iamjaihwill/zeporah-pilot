# Changelog

Every change that alters behaviour is recorded here in the pull request that makes it. See
[docs/release-governance.md](docs/release-governance.md).

## Unreleased

- Request lifecycle (decisions 79–83): a family's support request shows where it stands in shared
  words (Received, With <first name>, Waiting on you, Waiting on someone else, Resolved, Withdrawn)
  and when they'll next hear. The sender can withdraw it while it's open, and reopen it with a reason
  within 7 days of its resolution. The owner sets the next-update time; a missed one is an "Update
  overdue" exception. Giving an escalation now offers it: the owner keeps it until the new owner
  accepts, and an unaccepted offer is a stalled exception. Migration `0031_request_lifecycle`.
- Listed contacts (decisions 74–78): households list their other supporters (doula, private
  caregiver, outside clinician, faith leader and others) on the People page, and the care team sees
  them on the household record. A listing grants nothing; the patient can keep a contact private to
  themself and the care team; a coordinator can start an invitation from a contact. Migration
  `0030_household_contacts`.
- The 24-hour line (decision 72): an administrator proposes a change and someone else confirms it by
  calling it before families see it; re-confirmed every 90 days and flagged on System status; an
  optional backup line; a US phone-number check; the staff record shows the live line instead of a
  stored copy. Migration `0029_contact_line`.
- Staff read-access logging (decision 71, PB-12): opening a household's record or a list view is
  recorded in an append-only access log (migration `0028_access_log`), reviewable by privileged
  reviewers and administrators on "Who opened records". A read that can't be recorded is refused.
- Enrollment (decisions 66–70): operations and administrators enroll a household; operations or its
  care guide invite the patient and one coordinator after confirming who they are; a patient with
  no coordinator can complete setup; enrollment stops at the pilot cap (25 by default, set by
  administrators); a Getting started checklist tracks activation. Migration `0027_enrollment`.
- Retention: proposed record classes for every table, retention holds (migration
  `0026_retention_holds`) and a removal guard. Disposal is always refused; undoing an
  acknowledgement, reopening a task or changing a draft packet is refused while a hold covers it.
  No deletion path and no retention periods.
- Security (PB-05): every response carries a content security policy and the nosniff, referrer,
  frame, permissions and cross-origin headers; HSTS over https.
- Messages and support requests send once: a retry after a lost reply returns the first copy
  (migration `0025_submission_ids`). When no reply comes back, the composers say the send couldn't
  be confirmed and that sending again is safe, instead of "nothing was changed".
- Audit: appends to a hospice's chain happen one at a time and the database refuses a fork
  (migration `0024_audit_chain_link`). The chain check reports each finding; System status shows
  "No findings" with its limit instead of "Verified".
- Security (PB-06): a change sent from another site is refused with 403. `Origin` must name this
  server or a configured address; without it, `Sec-Fetch-Site` must be same-origin.
- Synthetic data: Rehanna Wells, a first-time patient in a household enrolled the same day, with
  Sofia Reyes as care guide. Featured on the demo launcher.
- Security: zod 4.6.6 (from 3.25.76) for GHSA-mrhx-c7xc-m3w5, and the four sharing-category lists
  in staff requests are capped at the number of categories.
- Address awareness (docs/architecture/environments.md, "Addresses"): with `ZEPORAH_APP_URL` and
  `ZEPORAH_CARE_URL` set, family pages open on the app address and the staff workspace and
  recipient pages on the care address, whose root is the staff sign-in. Email and invitation links
  name the right address. Nothing changes when they're unset (local, test, demo).
- Development only: a demo launcher at `/demo` puts the consumer family app and the enterprise
  care-team workspace side by side, one click per synthetic persona. `/demo?as=<actorId>` signs
  straight in, so each persona can be bookmarked. Behind the same gate as persona sign-in; linked
  from the sign-in page's development shortcuts.
- Production-readiness workstream W1 (decision 64): git, GitLab CI (`.gitlab-ci.yml`), release governance, rollback
  runbook, and checks for formatting, documentation links, the readiness tracker, the frozen
  baseline, migrations and dependency advisories. No product behaviour changed.
- Planning for W3 and W7 (decision 65): deployment, environments, backup and recovery, and
  monitoring designs, pending vendor and legal confirmation.

## demo-baseline-2026-10-22

The frozen synthetic full-demo baseline (`docs/demo-baseline.md`), including decisions up to 63 as
built or recorded. Not a production release.
