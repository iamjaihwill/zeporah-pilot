# Domain model

All entities live in one Postgres schema ([src/server/db/schema.ts](../src/server/db/schema.ts)); the vocabulary (roles, states, categories) lives in [src/domain/model.ts](../src/domain/model.ts). Every tenant-owned table has `tenant_id`, and references between tenant-owned rows include it.

```text
Tenant ─┬─ Organization (hospice) ──┬── Household ──┬── Membership (household role) ── Actor
        │                           │               ├── Invitation
        │                           │               ├── Onboarding step ×4
        │                           │               ├── Support preference
        │                           │               ├── Care coordination record (non-clinical)
        │                           │               ├── Task ── Acknowledgement
        │                           │               ├── Family-visible update ── Acknowledgement
        │                           │               ├── Internal staff note
        │                           │               ├── Message thread ── Message
        │                           │               ├── Vault item (metadata + status only)
        │                           │               ├── Authority evidence ── Version (lineage) ── Review
        │                           │               ├── Consent ── Consent confirmation (per version)
        │                           │               ├── Packet ── Manifest item; Release receipt
        │                           │               ├── Bereavement transition
        │                           │               └── Escalation
        │                           └── Membership (staff role) ── Actor
        ├── Notification (per recipient actor)
        ├── Audit event (append-only, hash-chained)
        ├── Staff invitation (to an organization, in a staff role)
        ├── User account (one per actor: email + password hash)
        └── Session (password, or development persona behind the gate)
Role (reference table)
```

| Entity                     | Table                         | Notes                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant                     | `tenants`                     | One per hospice customer. The pilot has one real tenant; the second exists only to prove isolation.                                                                                                                                                                                                                    |
| Organization/hospice       | `organizations`               | Name, state, after-hours line (synthetic).                                                                                                                                                                                                                                                                             |
| Household                  | `households`                  | Display name, patient name, **lifecycle state**.                                                                                                                                                                                                                                                                       |
| Household lifecycle state  | `households.lifecycle_state`  | `enrolled` → `active_hospice` → `bereavement` → `closed`. `enrolled → active_hospice` happens when setup completes; `→ bereavement` only through a proposed-and-confirmed transition. See [lifecycle.ts](../src/domain/lifecycle.ts).                                                                                  |
| Actor/user                 | `actors`                      | A person, `family` or `staff`. Synthetic emails use `@example.invalid`. Staff can be deactivated (`deactivated_at`, staff only by CHECK): no sign-in, no session, no access; their history stays.                                                                                                                      |
| Membership                 | `memberships`                 | Actor ↔ household (household role) or actor ↔ organization (staff role). A staff actor's active `care_guide` household memberships are their assignments (written only by `services/assignments.ts`). At most one active row per person, household and role. Ended rows must have `ended_at` and `end_reason` (CHECK). |
| Role                       | `roles`                       | Reference table: code, scope, label, plain-language explanation.                                                                                                                                                                                                                                                       |
| Invitation                 | `invitations`                 | Household invitation: name, email, offered household role, relationship, status, hashed one-time token, expiry (7 days), who accepted. Not delivered; the inviter shares the link.                                                                                                                                     |
| Preferences                | `preferences`                 | Per actor: language, text size, simpler explanations, contact method, notification cadence, quiet hours.                                                                                                                                                                                                               |
| Onboarding                 | `onboarding_steps`            | `preferences`, `trusted_contacts`, `communication`, `vault_review` — one row each when done.                                                                                                                                                                                                                           |
| Care coordination record   | `care_coordination_records`   | Care guide, visit rhythm, after-hours route, family priorities. **Not** the clinical plan of care. Archived at bereavement.                                                                                                                                                                                            |
| Task                       | `tasks`                       | Audience `family` or `staff`, assignee, owner, status, “when” label (never “overdue”), optional acknowledgement.                                                                                                                                                                                                       |
| Acknowledgement            | `acknowledgements`            | Once per person per task/update.                                                                                                                                                                                                                                                                                       |
| Family-visible update      | `family_updates`              | Written by the care team for the household.                                                                                                                                                                                                                                                                            |
| Internal staff note        | `staff_notes`                 | Read only by staff services. No family query touches this table.                                                                                                                                                                                                                                                       |
| Message thread / message   | `message_threads`, `messages` | One care-guide thread per household; author side `family`/`staff`. Routine coordination only — not for emergencies.                                                                                                                                                                                                    |
| Notification               | `notifications`               | In-app only. Generic titles (no names, contents or diagnoses). Read state is per recipient and shared by every screen.                                                                                                                                                                                                 |
| Vault item                 | `vault_items`                 | Title, category, description, status (`needs_review`, `reviewed`, `not_available`, `not_applicable`), sensitivity (`standard`/`protected`), where it's kept. No files.                                                                                                                                                 |
| Authority evidence         | `authority_evidence`          | Holder, type, workflow state, current version.                                                                                                                                                                                                                                                                         |
| Authority identity link    | `authority_identity_links`    | Which household person a record names, the basis (submitted evidence, household confirmation, or a reviewer's documented basis with a note), who linked it and when; superseded links are kept. A workflow association, not a legal determination.                                                                     |
| Authority evidence version | `authority_evidence_versions` | Version number, previous version (lineage), document label and date (metadata only), submitter.                                                                                                                                                                                                                        |
| Authority review           | `authority_reviews`           | Reviewer, outcome, rationale, the version reviewed.                                                                                                                                                                                                                                                                    |
| Consent                    | `consents`                    | Purpose, named recipient, scope categories, start, expiry, state, revocation path, current `version` and `activated_version`, the named grantor, who recorded/activated/revoked.                                                                                                                                       |
| Consent confirmation       | `consent_confirmations`       | One per consent version: the confirming person, time, method and the statement shown. Kept when a later version supersedes it.                                                                                                                                                                                         |
| Consent correction request | `consent_correction_requests` | A household request to correct a consent (categories, optional words for the care team only), its status (open, cancelled, resolved) and outcome (amended, withdrawn, dismissed with an explanation, closed). At most one open per consent.                                                                            |
| Message expectation        | `message_expectations`        | A hospice's own wording about routine messages, versioned; who changed it and when. No row, or a turned-off latest row, means families see no expectation.                                                                                                                                                             |
| Packet                     | `packets`                     | Purpose, recipient, linked consent and authority, expiry, state (`draft`, `held`, `released`, `denied`, `revoked`), last reason code.                                                                                                                                                                                  |
| Packet manifest            | `packet_manifest_items`       | One row per category of information. The minimum-necessary unit is the category.                                                                                                                                                                                                                                       |
| Packet release receipt     | `packet_release_receipts`     | What was released, to whom, why, until when, by whom, and the audit event id.                                                                                                                                                                                                                                          |
| Audit event                | `audit_events`                | Append-only; see [authorization-and-packet-policy.md](authorization-and-packet-policy.md#audit-events).                                                                                                                                                                                                                |
| Bereavement transition     | `bereavement_transitions`     | Proposed → confirmed (by a different person) or cancelled; surviving contact and their confirmation.                                                                                                                                                                                                                   |
| Support preference         | `support_preferences`         | Per household: categories of support wanted, spiritual care, best contact time, recommendations paused.                                                                                                                                                                                                                |
| Escalation                 | `escalations`                 | Human follow-up: kind, source, summary, owner, status, resolution.                                                                                                                                                                                                                                                     |
| Bereavement check-in       | `bereavement_contacts`        | One per transition and step of the 13-month plan; due date, status, outcome, staff-only note, who recorded it ([bereavement-programme.md](bereavement-programme.md)).                                                                                                                                                  |
| Session                    | `sessions`                    | Hash of the cookie token, actor, account (password sessions), method (`password` or `development_persona`), expiry.                                                                                                                                                                                                    |
| User account               | `users`                       | Email (lower-case, unique), scrypt password hash, failed attempts, lock expiry, last sign-in. One per actor. See [authentication-and-access.md](authentication-and-access.md).                                                                                                                                         |
| Staff invitation           | `staff_invitations`           | Organization, staff role, invitee name and email, hashed one-time token, status, expiry (7 days), who accepted.                                                                                                                                                                                                        |

## Share categories

Consents and packets are built from fixed categories, never from free-form record dumps:

| Category                    | Meaning                                                          | After bereavement |
| --------------------------- | ---------------------------------------------------------------- | ----------------- |
| `contact_details`           | Household contact details                                        | Shareable         |
| `care_coordination_summary` | Non-clinical coordination summary                                | Not shareable     |
| `visit_schedule`            | Visit schedule                                                   | Not shareable     |
| `vault_status`              | Which documents exist and where they're kept (not the documents) | Shareable         |
| `authority_status`          | Authority workflow status (not a legal determination)            | Shareable         |
| `bereavement_contact`       | Bereavement support contact                                      | Shareable         |

## What happens at bereavement

Confirming a transition, in one transaction ([staff.ts → confirmBereavement](../src/server/services/staff.ts)):

- the household becomes `bereavement`, and the patient's membership ends;
- authority that applies only while the patient is living (healthcare agent, patient-designated proxy, guardian) becomes `superseded` — so protected access that depended on it closes;
- active consents that cover care-period categories expire, and open packets are held;
- the care coordination record is archived;
- two gentle, optional practical tasks are added for the surviving contact;
- the household gets a notification with no detail in it, and the surviving contact is asked to confirm.

Messages, updates, tasks, the vault (within the narrowed access) and support continue unchanged.
