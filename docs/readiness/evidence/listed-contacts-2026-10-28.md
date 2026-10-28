# Evidence: listed contacts (increment 7, decisions 74–78), 2026-10-28

**Status: verified in synthetic testing.** Resolves the Stage 1 care-network scope (conflict 5 in
[product-assessment-2026-10-27.md](../../product-assessment-2026-10-27.md)): Zeporah stays
hospice-configured, and households can list their other supporters.

## What was built

| Decision | Behaviour                                                                                                                                                                                                                                                          | Where                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 74       | Households list supporters as contacts (death doula, private caregiver, outside clinician, faith or spiritual leader, friend or neighbor, service provider, other). A listing creates no account, invitation or notification and shows the person nothing.         | `household_contacts` (migration `0030_household_contacts`); `src/server/services/contacts.ts` |
| 75       | The patient, the coordinator, care guides and operations add, edit and remove; household members (`people.view`) and the care team see the list.                                                                                                                   | `contacts.manage`, `staff.contacts.manage`                                                    |
| 76       | The patient can mark a contact private: only the patient and the care team see it, and only the patient changes it. To anyone else it looks the same as one that doesn't exist. Its audit entries are staff-only, so it never appears in the household's activity. | `listContacts`, `editableRow`                                                                 |
| 77       | Name, relationship, organization, phone, email and a short note ("please don't include health details"). Phone and email are checked; the relationship list is enforced in the database too. Removing marks a row removed; nothing is deleted.                     | `src/domain/contacts.ts`                                                                      |
| 78       | "Invite them to help…" on the People page pre-fills the existing invitation form (task-only helper or collaboration, decision 42) with the contact's name and email; nothing is sent until the coordinator completes it. Private contacts don't offer it.          | `InviteForm` `initial`                                                                        |

Screens: "Other people who help" on the family People page; "Listed contacts" on the staff household
overview. The staff read is recorded in the access log ("Listed contacts", decision 71).

## Tests

`tests/integration/contacts.test.ts`: 9 of 9.

- A listing is seen by every household member and by the care guide, operations and the reviewer,
  and adds no membership, invitation or notification.
- Each household and hospice sees only its own list; an unassigned care guide and another hospice are
  refused.
- The patient, coordinator, care guide and operations can add; another family member, a proxy and a
  reviewer can't. Update and remove work; a removed row stays, marked removed.
- A private contact is seen by the patient and the care team only; the coordinator can't find it; the
  care guide sees it but can't change it; the patient can remove it. Only the patient can make one
  private.
- Private contacts' audit entries are staff-only; shared ones are family-visible; no summary names the
  person; the audit chain checks clean.
- An empty name, an unknown relationship, a bad phone number or email is refused.

Unit and integration suites: 589 of 589. End-to-end suites: not run (the test browser isn't
installed on this computer).

**In the browser** (development server, synthetic data): Daniel added "Sam Rivers (synthetic)" as a
death doula (no private option offered to him); "Invite them to help…" pre-filled the invitation form
with the name and email. Grace added "Pastor Lee (synthetic)" as a faith leader, private, shown with
"Only you and the care team". Daniel's People page then showed Sam but not Pastor Lee; Maya's household
record showed both under "Listed contacts", with Pastor Lee marked "Private to the patient".

## Limits

- **Contact details are personal data** about people who haven't agreed to be listed. The record
  class marks this for counsel review (who may see them, for how long).
- **No reminder or outreach** reaches a listed contact, by design; anything the household wants from
  them still happens outside Zeporah or through an invitation.
- **The "how they help" note** asks for no health details but can't enforce it.
