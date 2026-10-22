# Zeporah status — 2026-10-12

Synthetic pre-pilot build. Internal founder review only (v0.1 approval). No real data, no external services, nothing deployed.

## Decided

All 18 founder decisions are applied and recorded in [founder-decision-log.md](founder-decision-log.md). Among them:

- honest product wording replaces "prototype" in confirmations and notifications;
- sensitive staff powers stay with operations;
- no reactivation, read receipts, attachments, self-service recovery or audit export;
- hand-over off by default;
- the seven-step bereavement schedule;
- manual closure, with no automatic family notice;
- every integration stays disconnected.

## Completed code work

- **Accounts and access:** accounts and invitations; care-guide assignment, roster and reassignment.
- **Staff:** lifecycle (role change, deactivation) and work handoffs.
- **Communications:** notification rules.
- **Sharing:** sharing register and consent history.
- **Households:** household member administration; 13-month bereavement follow-up; household closure.
- **Oversight:** audit review; reports; system status.
- **Pilot controls:** read-only incident mode.
- **Integrations:** contracts only, nothing connected.

## Quality fixes validated

- **Intermittent test failure: fixed.** The cause was a test-helper bug: it guessed the tenant from an id's first letter, so 1 in 16 generated ids went to the wrong tenant. It wasn't a product defect. The fix and a regression test are in, and 60 focused runs plus 16 full runs were clean.
- **Current results:**
  - type-check clean;
  - 260/260 unit and integration tests;
  - 71/71 end-to-end tests;
  - 14/14 migrations;
  - audit chain verifies.

## Running locally and ready for you

The preview runs at `http://localhost:3000` (preview configuration `zeporah-pilot-dev-personas`, or `bun run dev`). Synthetic data was reset to the current seed. Open these first:

1. **Dana Brooks** → Team & coverage (Nguyen has no care guide), then Reports and System status.
2. **Priya Raman** → Sharing register → a consent's history.
3. **Tomás Alvarez** → Bereavement follow-up → Lindqvist → record a check-in.
4. **Ingrid Lindqvist** → Continuing support ("What to expect").
5. The full scripted walkthrough: [founder-review-walkthrough.md](founder-review-walkthrough.md) (about 41 minutes, plus about 12 for its **Operational screens** section, which covers the register, follow-up, audit, reports and status pages). Record notes in [founder-review-notes-template.md](founder-review-notes-template.md).

## Needs a person, not code

- **Founder review:** walk the build and record what should change. Changes become new decisions.
- **Manual accessibility (not started for the new screens):** five sessions covering the remaining original matrix plus slices A–J ([pre-pilot-plan.md](pre-pilot-plan.md) §2a). Automated axe checks don't replace this; they now also cover the change-role dialog and the read-only banner, which still need their manual checks. No WCAG claim is made.
- **Partner hospice review:** family-facing wording, the bereavement cadence, and the roles and permissions matrix.
- **Policy still open:** audit export, closure communication, account recovery, retention and deletion, out-of-app notifications, incident and breach response, access reviews, clinical-safety boundaries.
- **Production gaps:**
  - not HIPAA-compliant, no security certification and no penetration test;
  - no production identity (MFA, SSO, recovery);
  - embedded single database with no retention rules;
  - no CI, because there's no Git repository yet;
  - each integration needs vendor, BAA, security review and your approval.
