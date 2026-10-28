# Evidence: enrollment and activation (increment 6), 2026-10-27

**Status: verified in synthetic testing.** Builds founder decisions 66–70
([founder-decision-log.md](../../founder-decision-log.md)). Not live: invitations are passed by hand
(PC-02), and real enrollment needs the Stage 1 gate.

## What was built

| Decision | Behaviour                                                                                                                                                                                                                                                                                              | Where                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 66       | Operations and administrators enroll a household with just the patient's name and the care guide who owns activation. The household gets its message thread, care record (with the 24-hour line), the six starter vault items and that care guide's assignment. Administrators then see the name only. | `enrollHousehold` in `src/server/services/enrollment.ts`; "Enroll a household" on Households |
| 67       | Operations or the household's care guide create a one-time invitation after recording how they confirmed the person's identity and role. The person sets their own password. Administrators can't invite (they don't open households).                                                                 | `inviteFirstMember`; "Getting started" on the household overview                             |
| 68       | Staff may invite the patient and one coordinator; a second one, or a second waiting invitation, is refused. The database refuses a patient or coordinator invitation without an identity note.                                                                                                         | Migration `0027_enrollment`                                                                  |
| 69       | The patient may complete setup while the household has no active coordinator.                                                                                                                                                                                                                          | `maySetUp` in `familyScope` (`src/server/context.ts`), used by every setup check             |
| 70       | Enrollment is refused at the hospice's cap (25 by default); closed and bereaved households don't count. Only administrators change the cap (Hospice settings → Enrollment), audited. Enrollments are serialized per hospice so two can't take the last place.                                          | `enrollment.cap` in `src/domain/org-settings.ts`; `enrollHousehold`                          |
| —        | Activation is a tracked checklist on the household overview: an account exists; a care guide and the 24-hour line are set; communication settings are chosen; the household sent a message or asked for help; the care team replied or took the request. It gates nothing.                             | `activationStatus`                                                                           |

The starter vault list moved from the synthetic fixtures to `src/domain/starter-vault.ts`, so
enrollment and the demo data share one copy.

## Tests

`tests/integration/enrollment.test.ts`: 11 of 11.

- Enrollment creates a working household (thread, care record, 6 starter items, assignment, audit
  event; the chain still checks clean); only operations and administrators may enroll; an outside
  care guide or an empty name is refused.
- The cap counts 7 seeded households (not the bereaved Lindqvist household), refuses past a lowered
  cap with the plain message, and only an administrator can change it (audited).
- The care guide invites the patient once; a second is refused; no identity note, another role, a
  household outside the guide's assignment, or an administrator are refused; the database refuses a
  patient invitation with no identity note.
- A patient with no coordinator can set up until a coordinator joins, then can't. Rehanna (alone)
  can; Ravi (whose household has a coordinator) can't.
- The checklist ticks each step from real records, through to activated.

Unit and integration suites: 560 of 560. End-to-end suites: not run (the test browser isn't
installed on this computer).

## In the browser

On the development server with synthetic data:

1. As Dana (operations), Households showed "7 of 25 households in the pilot". Enrolling "Amara
   Synthetic" with Maya Chen opened "The Synthetic household" with its Getting started card.
2. Inviting the patient, with an identity note, showed the one-time link once and "Waiting: Amara
   Synthetic (patient, until Nov 3, 2026)".
3. Opening the link showed "Dana invited you to join as a patient in a household"; creating the
   account (a throwaway synthetic test password, not recorded) landed on "Hello, Amara" with
   **Start setup** available, where a patient alone used to be told a coordinator would do it.
4. As Lena (administrator), Hospice settings showed "Enrollment stops at 25 households in the
   pilot", and Households offered "Enroll a household".

Also seen in the console of an older tab: a worker created from a `blob:` address blocked by the
content security policy. Nothing in the app or its bundled libraries creates workers, so it came
from outside the app (most likely the preview browser's own tooling); the policy blocked it as
designed. Repeated "reading 'devSignIn'" errors in the same tab came from the temporary port-3300
server used for increment 1, since stopped; a fresh load of the staff sign-in showed none.

## Not built (open)

- Declined or deferred enrollment, assisted use without email, wrong-recipient correction and death
  before activation (brief §7). Declining Zeporah already changes nothing about care, because
  enrollment creates nothing in the hospice's own systems.
- Cancelling a staff-issued first invitation from the Getting started card (a second can't be sent
  while one waits; it expires after 7 days).
- The household's display name is taken from the patient's last name ("The Wells household").
