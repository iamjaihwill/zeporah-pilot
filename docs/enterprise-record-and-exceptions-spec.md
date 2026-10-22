# Coordination Record v2 and Exceptions: screen specification

Status: **specification for review, 2026-10-21.** Nothing here is built yet. It applies the
enterprise blueprint the founder approved on 2026-10-21 (decision 58) to two screens: the household
coordination record and the exceptions queue. Together they prove the enterprise thesis: a team
can understand a household quickly, see what is stuck, know who owns it, and show exactly what
happened.

Companion documents: [enterprise-implementation-plan.md](enterprise-implementation-plan.md),
[enterprise-decision-register.md](enterprise-decision-register.md),
[enterprise-demo-map.md](enterprise-demo-map.md).

Every story below carries a **status**:

- **Existing**: already in the pilot.
- **Approved—build**: approved on 2026-10-21.
- **Founder decision required**: see the decision register.
- **Future**: not part of this release.

## 0. Ground rules for both screens

- **Separate shell.** The work lives only inside the staff workspace (`[data-surface="staff"]`). The
  family app gets no new screens, and staff are never offered a switch into family views.
- **Same checks as today.** Every action goes through the server functions and policy checks used
  by the item's own screen; nothing gets a privileged shortcut (the queue already works this way:
  `queue-detail.ts`).
- **Access decisions:** the policy functions in `src/domain/` and `src/server/services/` stay the
  only source of truth. The "Who can see what" view is generated from those same functions, never
  hand-written, and a test checks the grid against real access decisions for every seeded persona.
- **Times:** exact timestamps with timezone, plus durations ("open 3 d"). Never relative
  ("2 hours ago"): this is the architecture rule.
- **Statuses:** rendered only through `StatusChip` and `src/domain/status.ts`.
- **No PHI** in URLs, toasts, notifications or exports:
  - URLs carry opaque IDs and view names only.
  - Toasts say what happened ("Exception assigned.") without content.
  - The seeded IDs are readable (`cs-okafor-equipment`) for the synthetic demo only. Real IDs are
    opaque.
- **No clinical interpretation.** Care-plan context is the household's own non-clinical
  coordination information (`care_coordination_records`: visit rhythm, after-hours route, family
  priorities) and a pointer to the EHR, with no clinical content.
- **Not built in this release:**
  - full-record export;
  - live AI;
  - automatic matching of partner events;
  - family notice of cover;
  - any change to the four decision-1 confirmation messages.

## 1. Data objects

### 1.1 Existing objects these screens read

| Object                       | Table                                                                                                         | Used for                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Household, members, roles    | `households`, `memberships`, `actors`                                                                         | Header, participants, Who can see what                                    |
| Coordination context         | `care_coordination_records`                                                                                   | Care-plan context (non-clinical)                                          |
| Tasks                        | `tasks`                                                                                                       | Timeline, Overdue task                                                    |
| Updates, acknowledgements    | `family_updates`, `acknowledgements`                                                                          | Timeline, Unread critical update                                          |
| Messages                     | `message_threads`, `messages`, `thread_visits`                                                                | Timeline, Family contact unresolved                                       |
| Authority                    | `authority_evidence*`, `authority_reviews`                                                                    | Timeline, Who can see what, Consent held                                  |
| Consents                     | `consents`, `consent_confirmations`, `consent_correction_requests`                                            | Timeline, organizations, Access ending, Missing consent, Consent held     |
| Packets and recipient access | `packets`, `packet_manifest_items`, `packet_release_receipts`, `packet_recipient_access`, `packet_access_log` | Timeline, Release incomplete, Waiting on partner, Access ending           |
| Escalations                  | `escalations`                                                                                                 | Family requests and staff-raised items, as exceptions with a stored owner |
| Bereavement                  | `bereavement_transitions`, `bereavement_contacts`                                                             | Lifecycle, Bereavement contact due                                        |
| Audit                        | `audit_events` (append-only, hash chain)                                                                      | Timeline source of truth; actor and role; integrity                       |
| Settings                     | `organizations.settings` (`domain/org-settings.ts`)                                                           | Thresholds                                                                |

### 1.2 New objects (one migration, `0021_enterprise_record`)

| Object                                                   | Purpose                                                                                                                                                                                            | Key fields                                                                                                                                                                                                                                | Status                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `exception_claims`                                       | Human state for rule-derived exceptions. The exception itself is computed from its source records, so it can't drift from them; this table only holds who owns it and what a person said about it. | `key` (`category:subjectType:subjectId`), `owner_actor_id`, `state` (`owned` \| `waiting`), `waiting_on` (`family` \| `partner` \| `staff`), `dismissed_reason`, `dismissed_by`, `dismissed_at`, `updated_at`                             | Approved—build                     |
| `staff_absences`                                         | Planned absence                                                                                                                                                                                    | `actor_id`, `starts_at`, `ends_at`, `reason`, `created_by`, `cancelled_at`                                                                                                                                                                | Approved—build (workstream 3)      |
| `handoffs`                                               | Offer and acceptance of a household between care guides                                                                                                                                            | `household_id`, `from_actor_id`, `to_actor_id`, `absence_id?`, `kind` (`cover` \| `transfer`), `note`, `state` (`offered` \| `accepted` \| `declined` \| `withdrawn`), `accept_by`, `responded_at`, `decline_reason`                      | Approved—build (workstream 3)      |
| `memberships` gains `cover_for_actor_id`, `grant_reason` | A cover grant is an ordinary care-guide membership with an end date (the existing `expires_at`), so every existing access check applies unchanged.                                                 | —                                                                                                                                                                                                                                         | Approved—build; scope: decision 59 |
| `partner_events`                                         | Staff-entered outside status changes, labelled simulated                                                                                                                                           | `household_id`, `organization_label`, `kind` (`status` \| `request` \| `acknowledgement`), `summary`, `occurred_at`, `entered_by`, `source` (`staff_entered` \| `recipient_portal`), `packet_id?`, `simulated` (always true in the pilot) | Approved—build (demo-safe)         |
| `care_coordination_records` gains `ehr_reference`        | A pointer only ("Record ref 000-SYN-4411"), never clinical content                                                                                                                                 | —                                                                                                                                                                                                                                         | Approved—build                     |
| Settings `queue` group gains thresholds                  | `handoffAcceptHours` (default 24), `recipientUnopenedHours` (48), `accessEndingDays` (7), `ackOverdueHours` (24), `noTeamContactDays` (5), `coordinationRiskOpenCount` (3)                         | Operations' existing workflow settings (decision 39)                                                                                                                                                                                      | Approved—build                     |

**Why derive exceptions instead of storing them?**

- The pilot's queue already derives its rows (`domain/queue.ts`). A stored exception could say
  "consent missing" after the consent was confirmed.
- Deriving keeps the list true by construction. Only the human parts (owner, waiting-on,
  dismissal) are stored.
- An exception resolves when its cause clears. Its "Resolved by" line comes from the audit event
  that cleared it.

### 1.3 The exception object (as screens receive it)

`QueueRow` (`domain/queue.ts`) grows into `ExceptionRow`. Existing fields keep their meaning.

| Field                                 | Meaning                                                                                                      | Source                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `id`                                  | `category:subjectType:subjectId`, stable                                                                     | Rule                             |
| `category`                            | One of the categories in 1.4                                                                                 | Rule                             |
| `household`, `householdId`, `subject` | What it's about. The subject is named only if the viewer could open it; otherwise "a protected item".        | Rule and policy                  |
| `status`                              | Needs an owner / Owned / Waiting on family / Waiting on partner / Resolved / Dismissed                       | Claim, escalation or rule        |
| `urgency`                             | **Now / Today / This week**. Replaces High/Normal/Routine one-for-one. Orders the work; not clinical triage. | Rule and thresholds              |
| `urgencyReason`                       | One sentence, always shown ("Waiting 26 h; the hospice's threshold is 24 h")                                 | Rule                             |
| `owner`                               | A person, or "No owner"                                                                                      | Claim, escalation, task assignee |
| `openedAt`, `age`                     | Exact time and duration, from the triggering state change                                                    | Rule                             |
| `dueBy`                               | When it crosses the next urgency threshold, or the task's due time                                           | Thresholds                       |
| `nextStep`                            | One verb phrase and one action                                                                               | Rule                             |
| `why`                                 | The rule in plain words, plus evidence links (timeline anchors)                                              | Rule                             |
| `source`                              | Rule / Family / Partner (simulated) / Staff                                                                  | Rule                             |
| `link`                                | Deep link to the exact place in the record (`#task-…`, `#consent-…`)                                         | Rule                             |
| `dismissable`                         | False for consent and authority categories                                                                   | Category                         |

### 1.4 Exception categories in this release

All rules are deterministic, with thresholds from settings and nothing scored.

| Category                             | Status                                                           | Fires when                                                                                                                                                | Clears when                                                 | Default owner       | Next step                                                      | Dismissable            |
| ------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------- | -------------------------------------------------------------- | ---------------------- |
| Missing consent                      | Approved—build                                                   | A packet draft names a recipient and purpose with no active or confirmed consent covering them, or a partner `request` event is logged with none          | A matching consent is active                                | Assigned care guide | "Ask the household to confirm sharing with {recipient}"        | No                     |
| Consent held or correction requested | Existing (`correction`, `consent`, `authority` kinds), regrouped | A correction is open, a consent needs review, or an authority conflict is detected                                                                        | The reviewer workflow resolves it                           | Reviewer pool       | "Review the correction" / "Review the conflict"                | No                     |
| Release incomplete                   | Existing (`packet`), extended                                    | A draft has a failing release check, or the last request was Held or Denied                                                                               | Released, or the draft is withdrawn                         | Operations          | Names the failing check                                        | Yes, with a reason     |
| Family contact unresolved            | Existing (`message`), extended                                   | A household message is unanswered past `messageHighAfterHours`, an invitation is unaccepted after 7 d, or a notice email bounced                          | Staff reply, invitation accepted, or contact corrected      | Assigned care guide | "Reply to {name}"                                              | Yes, with a reason     |
| Stalled handoff                      | Approved—build                                                   | A handoff is `offered` past `accept_by`                                                                                                                   | Accepted, withdrawn or reassigned                           | Operations          | "Reassign" / "Ask {guide} to accept"                           | No (resolve by acting) |
| Unread critical update               | Existing (`acknowledgement`), extended                           | An update with `requires_ack` is unacknowledged by the named person after `ackOverdueHours`                                                               | Acknowledged, or staff record "Reached by phone" (audited)  | Assigned care guide | "Call {name}; mark as reached"                                 | Yes, with a reason     |
| Overdue task                         | Existing (`task`)                                                | A care-team task is past `due_at`                                                                                                                         | Done, closed with a reason, or rescheduled with a reason    | Assignee            | Complete / Reschedule / Reassign                               | No (resolve by acting) |
| Access ending                        | Approved—build                                                   | A consent `expires_at`, recipient access `expires_at` or helper membership `expires_at` falls within `accessEndingDays`                                   | It ends, or is renewed through the household's confirmation | Assigned care guide | "Ask the household whether to renew" / "Let it end" (recorded) | Yes, as "Let it end"   |
| Coverage gap                         | Approved—build                                                   | A household has no active care guide, or its only guide is absent with no accepted cover                                                                  | Cover accepted or a guide assigned                          | Operations          | "Assign cover"                                                 | No                     |
| Bereavement contact due              | Existing (bereavement follow-up), joined in                      | A planned check-in date has arrived and contact isn't paused                                                                                              | Logged or rescheduled                                       | Assigned care guide | "Log the check-in"                                             | No                     |
| Coordination risk                    | Approved—build                                                   | Open exceptions on one household ≥ `coordinationRiskOpenCount`, **or** no staff-to-household contact for `noTeamContactDays` while receiving hospice care | Signals drop below the thresholds                           | Operations          | "Open the record"                                              | Yes, with a reason     |

**Rule for Coordination risk:**

- It always lists the signals that tripped it ("3 open exceptions: …; last team contact Oct 15").
- It never computes anything about the patient's condition or the family's behaviour.
- It is a composite of operational signals, not a risk score.

**Kept as they are:**

- _Family request_ (escalations raised by a family).
- _Setup_.
- _Transition_.

These keep their stored ownership and appear in the same list under their existing labels.

## 2. Coordination Record v2: `/staff/households/:id`

**Status:** Approved—build. It replaces the current header and Overview tab. The other tabs stay
(Messages, Updates, Tasks, Vault, Authority & consent, Packets, Internal notes, Lifecycle, Audit).

|              |                                                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary role | Care guide (assigned or covering). Operations and reviewers open any household in the hospice.                                                                                           |
| Key decision | "What's the situation, what's stuck, and what do I do next?"                                                                                                                             |
| Objects      | All of 1.1, plus partner events and handoffs                                                                                                                                             |
| Approval     | None to view. Each action keeps its own gate.                                                                                                                                            |
| Audit        | Opening a protected item (existing). Viewing a prepared summary (`summary.prepared`, with the source event IDs). Opening "Who can see what" is not logged (it shows rules, not content). |
| Family app   | Nothing new. Families keep their own household view, written for them. Exceptions, ownership, staff notes, handoffs and partner events never cross over unless staff post an update.     |

### 2.1 Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ HEADER STRIP                                                                 │
│ The Okafor household  [Receiving hospice care]   Patient Grace Okafor        │
│ Care team: Maya Chen (care guide) · Sofia Reyes covering until Oct 30 6 PM ET│
│ 24-hour line 555-0100   ⚑ 3 open exceptions   [Catch me up]  [Reassign]      │
├─────────────────────────────────────────────┬────────────────────────────────┤
│ TABS: Overview · Messages · Updates · …     │ CONTEXT COLUMN (fixed, 340px)  │
│ ─────────────────────────────────────────── │ Open exceptions (3)            │
│ UNIFIED TIMELINE      [All ▾] [Density]     │ Participants                   │
│ Oct 22, 9:14 AM ET  Maya Chen · care guide  │ Care team & assignment history │
│   [Staff] Replied to Daniel Okafor  →       │ Organizations & active access  │
│ Oct 22, 8:02 AM ET  Rosa Lin · Brightwater  │ Care-plan context (non-clinical)│
│   [Partner · simulated] Bed available Tue → │ EHR pointer                    │
│ …                                           │ [Who can see what]             │
└─────────────────────────────────────────────┴────────────────────────────────┘
```

### 2.2 Header strip

- **Household name and stage chip:** Getting started / Receiving hospice care / Bereavement
  support / Closed.
- **Patient** name.
- **Care team:**
  - the assigned guides;
  - a covering guide shows "covering until {exact end}";
  - an offered handoff shows "Handoff offered to Sofia, waiting since {time}".
- **24-hour line**, from the hospice settings.
- **Open exceptions count.** It links to the Exceptions screen filtered to this household. Shown
  as "No open exceptions" when there are none.
- **Catch me up** opens the prepared summary (section 4).
- **Reassign** (existing; operations and administrators).
- **Hidden:**
  - nothing clinical;
  - no diagnosis;
  - the patient's address appears only on the Overview, not in the strip.

### 2.3 Unified timeline (Overview tab)

**Each row shows:**

- **Exact time.**
- **Actor and their role at the time:**
  - from `context.actorRoles` on new events;
  - older events show the current role, marked "(current role)".
- **Source badge:** Staff, Family, Partner · simulated, System, or Prepared with Copilot.
- **One line of description.**
- **Object link.**

**Filters:** All, Messages, Updates, Tasks, Sharing & releases, Consent & authority, Partner
events, Team & assignment, Lifecycle.

**Density:** Comfortable / Compact, using the existing preference.

**Source of truth:**

- Rows come from `audit_events`, filtered by the same visibility rules as today's Audit tab.
- Partner events and handoffs are written to the audit log, so they appear the same way.

**Hidden rows:**

- Events about protected items the viewer can't open show "A protected item was updated" with no
  title.
- Staff notes show "Internal note added" with a link that only staff can follow (staff are the
  only viewers here anyway).
- Patient private notes never appear, not even as a count.

**Paging:** 50 rows, then "Show earlier". The filter and page are in the URL; search words never
are.

**Log a partner event** (a button above the timeline) is described in 2.6.

### 2.4 Context column

Ordered by how often staff need each part.

1. **Open exceptions:**
   - up to 5, urgency first;
   - each shows category, owner, age and next step;
   - "See all {n}" links to Exceptions.
2. **Participants:**
   - household members, each with relationship, household role, and how their access comes about
     ("Proxy, active healthcare-agent workflow", "Helper for one task until Nov 4");
   - ended members are hidden behind "Show former (n)".
3. **Care team and assignment history:**
   - current guides and cover, with exact dates;
   - "History" expands to every assignment with who made it and the reason.
4. **Organizations and active access:**
   - grouped by recipient organization (from consents and packets);
   - for each: purpose, what's included, until when, last opened or acknowledged;
   - ended access is collapsed;
   - no organization directory (not approved).
5. **Care-plan context (non-clinical):**
   - what matters to the household (`family_priorities`);
   - visit rhythm;
   - after-hours route;
   - the best way to reach the coordinator.
   - Label: "Coordination context. Clinical details live in the EHR."
6. **EHR pointer:** "Clinical record: {ehr_reference} in the hospice's EHR." This is text only,
   with no link out and no integration.
7. **Who can see what** opens the view in 2.5.

### 2.5 "Who can see what" (drawer, or a full page at `/staff/households/:id/access`)

This is a grid. The rows are everyone who can see anything about the household; the columns are
item categories.

|                                                          | Updates                                                     | Messages | Tasks     | Vault (household) | Vault (protected)     | Sharing page | Internal notes | Patient's private notes |
| -------------------------------------------------------- | ----------------------------------------------------------- | -------- | --------- | ----------------- | --------------------- | ------------ | -------------- | ----------------------- |
| Grace Okafor (patient)                                   | ✓                                                           | ✓        | ✓         | ✓                 | ✓                     | ✓            | —              | ✓ (her own)             |
| Ada Okafor (proxy)                                       | ✓                                                           | ✓        | ✓         | ✓                 | ✓ via active workflow | ✓            | —              | —                       |
| Chidi Okafor (family member)                             | ✓                                                           | —        | own tasks | ✓                 | —                     | —            | —              | —                       |
| Maya Chen (care guide, assigned)                         | ✓                                                           | ✓        | ✓         | ✓                 | per item audience     | ✓            | ✓              | —                       |
| Sofia Reyes (covering until Oct 30 6 PM ET)              | as Maya, until the end time                                 |          |           |                   |                       |              |                | —                       |
| Hospice operations (by role)                             | ✓                                                           | ✓        | ✓         | ✓                 | per item audience     | ✓            | ✓              | —                       |
| Reviewers (by role, for review)                          | …                                                           |          |           |                   |                       |              |                | —                       |
| Brightwater Respite House: Rosa Lin                      | —                                                           | —        | —         | —                 | —                     | —            | —              | —                       |
| ↳ packet "Coordinate a short respite stay", until Oct 26 | contact details, visit schedule only                        |          |           |                   |                       |              |                |                         |
| Administrators                                           | — Administrators don't open household records (decision 39) |          |           |                   |                       |              |                | —                       |

The ✓ entries above are illustrative. The real grid is computed.

**How cells behave:**

- Every cell has a "why" tooltip, and a sheet on touch screens. Examples: "Proxy: active
  healthcare-agent workflow (reviewed Oct 12)", "No: messages are for the coordinator and
  proxy".
- Time-limited access always shows its exact end.
- Cover access is marked "Temporary".
- A "Generated from the access rules" note sits under the grid.

**Who can open the view:** anyone who can open the household. Administrators can't, and get the
standard "Not available for your role".

**States:** loading (skeleton rows), and error ("Couldn't work out access right now. Nothing was
changed." plus a reference).

**Audit:** none. It reveals no content beyond what the viewer already sees.

### 2.6 Log a partner event (demo-safe)

|              |                                                                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status       | Approved—build, staff-entered only, always labelled simulated                                                                                                                                        |
| Primary role | Care guide or operations, for households they can open (decision 60)                                                                                                                                 |
| Action       | Record what an outside organization said, e.g. "Brightwater: bed available Tuesday"                                                                                                                  |
| Form         | Organization (chosen from the household's active recipients, or typed), kind (Status / Request / Acknowledgement), what they said (short, with the guidance "No clinical details"), when it happened |
| Confirmation | Restates the household, organization and what will appear on the timeline. Not sent anywhere.                                                                                                        |
| Audit        | `partner_event.logged` (visibility: staff), with `source: staff_entered`, `simulated: true`                                                                                                          |
| Follow-on    | A `request` event without a matching consent raises **Missing consent**. Staff may create a task from it, which goes through the usual task form.                                                    |
| Family app   | Nothing, unless staff post an update                                                                                                                                                                 |
| Never        | Automatic matching. Inbound feeds. Partners writing to the record (portal replies stay bound to their packet, as they are today).                                                                    |

### 2.7 States

| State                  | Behaviour                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Loading                | The header and context column show skeletons; the timeline shows 8 skeleton rows. No layout shift when data arrives.     |
| No timeline events     | "Nothing has been recorded for this household yet." (A new household has at least `household.created`, so this is rare.) |
| Filter with no results | "No {filter} events for this household." plus "Show all".                                                                |
| No open exceptions     | "No open exceptions." in the context column. No celebratory copy.                                                        |
| No outside access      | "Nothing is shared outside the household."                                                                               |
| No access              | The existing "This isn't available" page. Its wording never confirms that the household exists.                          |
| Closed household       | A read-only banner: "Closed on {date}. The record is kept; nothing new can be added." Actions are hidden, not disabled.  |
| Bereavement            | The stage chip changes. The context column adds "Surviving contact" and "Check-in plan".                                 |
| Server error           | The existing error page with a reference code; "Nothing was changed."                                                    |
| Stale data             | The page doesn't live-update. After any action the affected zones refresh. A "Refresh" control is in the header.         |

### 2.8 Responsive behaviour

| Width              | Layout                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥ 1280 px          | Three zones: header, timeline, and a fixed 340 px context column                                                                                                                                                            |
| 1024–1279 px       | The context column narrows to 300 px; timeline rows wrap to two lines                                                                                                                                                       |
| 768–1023 px (iPad) | The context column becomes a **Context** drawer (the existing `SplitPane` drawer pattern), opened from the header. Open exceptions stay inline above the timeline.                                                          |
| < 768 px (phone)   | Single column: compact header (name, stage, exception count), then Open exceptions, timeline, and the context sections as collapsible panels. The existing bottom bar and Menu stay. No sideways scroll (tested at 375 px). |

Touch targets are at least 44 px on coarse pointers (existing rule).

## 3. Exceptions: `/staff/exceptions`

**Status:** Approved—build. It merges today's Queue and Escalations; both old URLs redirect, with
their view mapped.

|               |                                                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary roles | Care guide (their own households); operations (unowned work across the hospice); reviewer (consent and authority categories)                                                                                                             |
| Key decision  | Take it, act, reassign, mark as waiting, or dismiss with a reason                                                                                                                                                                        |
| Objects       | `ExceptionRow`; `exception_claims`; `escalations`; the source records                                                                                                                                                                    |
| Hidden        | Care guides see only their own households (including households under accepted cover, until it ends). Administrators don't get this screen: their home shows counts only. Protected subjects are named only to people who can open them. |
| Approval      | Dismissal needs a reason. Consent and authority items can't be dismissed. Bulk Assign uses the existing preview, reason and confirm pattern. Nothing is ever resolved, released or activated in bulk (existing rule).                    |
| Audit         | See 3.6                                                                                                                                                                                                                                  |
| Family app    | Nothing. Only the outcomes of the work (a reply, an update, a confirmation request) reach families.                                                                                                                                      |

### 3.1 Layout

**Desktop (≥ 1200 px)**

```
StaffPageHeader: Exceptions                          [Assign to…] (operations, with selection)
ViewTabs: Needs you now · No owner · Waiting on family · Waiting on partner · Releases in flight
          · Consent & access · Handoffs · Bereavement · Resolved (14 d)
Filters: Category ▾  Household ▾  Owner ▾  Urgency ▾  Age ▾                 "n exceptions"
┌───┬──────────┬──────────────────────┬──────────────────────────┬─────────┬──────┬──────────┬────────────────────┐
│ ☐ │ Urgency  │ Category             │ Household · subject      │ Owner   │ Age  │ Due by   │ Next step          │
├───┼──────────┼──────────────────────┼──────────────────────────┼─────────┼──────┼──────────┼────────────────────┤
│ ☐ │ ● Now    │ Family contact       │ Okafor · Daniel's message│ Maya C. │ 26 h │ passed   │ Reply to Daniel    │
└───┴──────────┴──────────────────────┴──────────────────────────┴─────────┴──────┴──────────┴────────────────────┘
                                                                     DETAIL PANEL (SplitPane) →
```

**Detail panel**

- Title, plus status and urgency chips.
- **Why this is here:** the rule sentence and evidence links.
- **Recommended next step:** the primary button.
- **Other actions:** Take ownership, Assign to…, Mark as waiting on family or partner, Dismiss…
- **Prepared** (section 4): a draft, when one exists for this category.
- **History:** the last 5 actions, from the audit log.
- **Open in record:** a deep link.

### 3.2 Views (queue types) by role

| View               | Care guide        | Operations | Reviewer  | Contents                                                                       |
| ------------------ | ----------------- | ---------- | --------- | ------------------------------------------------------------------------------ |
| Needs you now      | ● default         | ●          | ● default | Owned by me, sorted by urgency, then due-by, then age                          |
| No owner           |                   | ● default  |           | Owner empty; oldest first                                                      |
| Waiting on family  | ●                 | ●          |           | `state = waiting, waiting_on = family`, plus unread critical updates           |
| Waiting on partner | ●                 | ●          | ●         | Recipient unopened past threshold; partner `request` events without a response |
| Releases in flight |                   | ●          | ●         | Release incomplete; drafts with checks running                                 |
| Consent & access   | ●                 | ●          | ●         | Missing consent, Consent held or correction, Access ending                     |
| Handoffs           | ● (offered to me) | ●          |           | Stalled handoff, and handoffs offered to me                                    |
| Bereavement        | ●                 | ●          |           | Bereavement contact due                                                        |
| Resolved (14 d)    | ●                 | ●          | ●         | Each with a "Resolved by {action} · {who} · {time}" line                       |

A view that doesn't apply to a role isn't shown; it is not disabled.

### 3.3 Actions

| Action                               | Who                                                                                                          | Gate                                                                                                                                                                    | Audit event                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Take ownership                       | Anyone who can see it, except categories owned by role (reviewer categories go to reviewers)                 | One click, then the toast "You own this now."                                                                                                                           | `exception.taken` (escalations keep `escalation.owned`)       |
| Assign to…                           | Operations, as today. Care guides keep assigning care-team tasks (decision 40), but don't assign exceptions. | The dialog restates the item(s), the new owner and "They'll see it in Needs you now". Reason optional for single items, **required in bulk** (decision 40 pattern).     | `exception.assigned` {from, to, reason}                       |
| Mark as waiting on family or partner | Owner                                                                                                        | Optional note ("Left a voicemail")                                                                                                                                      | `exception.waiting` {on, note}                                |
| Dismiss…                             | Owner, or operations                                                                                         | Reason required (from a list plus free text). Not offered for consent and authority categories, Overdue task, Coverage gap, Stalled handoff or Bereavement contact due. | `exception.dismissed` {reason}                                |
| Recommended next step                | As the underlying action allows                                                                              | The underlying action's own gate (e.g. the release dialog restates recipient, scope and end date)                                                                       | The underlying action's own event. The exception then clears. |
| Release ownership                    | Owner                                                                                                        | Confirm                                                                                                                                                                 | `exception.owner_released`                                    |

### 3.4 States

| State                         | Copy                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Loading                       | Skeleton rows at the current density                                                                                                       |
| Empty: Needs you now          | "Nothing needs you right now." plus "{n} with no owner" when there are any (operations)                                                    |
| Empty: other views            | One plain sentence, e.g. "Nothing is waiting on a family."                                                                                 |
| Filters remove everything     | "No exceptions match these filters." plus "Clear filters"                                                                                  |
| An item cleared while open    | The panel shows "This was resolved by {action} at {time}." and the row greys out until refresh (rows update in place, as in today's queue) |
| Action refused                | Inline in the panel: "{Reason}. Nothing was changed." For example, "You no longer cover this household."                                   |
| No permission (administrator) | The standard "Not available for your role"                                                                                                 |
| Server error                  | The existing error page and reference                                                                                                      |

### 3.5 Responsive behaviour

| Width       | Layout                                                                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥ 1200 px   | List and detail side by side                                                                                                                                                                    |
| 768–1199 px | The list is full width and the detail opens as a drawer. Columns drop in this order: Due by, then Category, which folds under the subject.                                                      |
| < 768 px    | Cards: urgency, then category, then household · subject, then owner and age, then next step. Detail opens as a full-screen sheet. Bulk actions hidden. Bottom bar and Menu. No sideways scroll. |

Keyboard (existing queue shortcuts): J/K, Enter, Esc, T (take), A (assign), and ? for help. Never
while typing.

### 3.6 Audit events: Exceptions and Record v2

Every new event carries these context fields, in addition to the existing columns (time, actor,
action, subject, household, decision, summary, visibility, hash):

- `actorRoles`: every role the actor held at the time;
- `source`: `staff` \| `family` \| `partner_simulated` \| `system` \| `rule`;
- `reason`, where required;
- `before` and `after`, for sensitive changes;
- `approval`: `{requestedBy, approvedBy}`, where there is a second step;
- `prepared: true`, when a person accepted Copilot-prepared content.

| Event                                                                          | Visibility class | Summary (no content beyond what readers already see)                                                         |
| ------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `exception.taken`                                                              | staff            | "{Name} took ownership of a {category} exception."                                                           |
| `exception.assigned`                                                           | staff            | "{From} assigned a {category} exception to {to}."                                                            |
| `exception.waiting`                                                            | staff            | "Marked as waiting on {family/partner}."                                                                     |
| `exception.dismissed`                                                          | staff            | "{Name} dismissed a {category} exception: {reason}."                                                         |
| `exception.owner_released`                                                     | staff            | "{Name} released ownership."                                                                                 |
| `partner_event.logged`                                                         | staff            | "{Name} logged a simulated {kind} from {organization}."                                                      |
| `summary.prepared`                                                             | staff            | "{Name} viewed a prepared summary ({n} sources)."                                                            |
| `update.reached_by_phone`                                                      | staff            | "{Name} recorded reaching {person} by phone."                                                                |
| `absence.recorded`, `absence.cancelled`                                        | staff            | See the plan, workstream 3                                                                                   |
| `coverage.granted`, `coverage.ended`                                           | staff            | "Sofia Reyes covers until {time}: {reason}." / "Cover ended at its scheduled time." (actor: System)          |
| `handoff.offered`, `handoff.accepted`, `handoff.declined`, `handoff.withdrawn` | staff            | —                                                                                                            |
| `packet.recipient_access_ended`                                                | sharing          | "{Recipient}'s access ended at its scheduled time." (actor: System, written on the first check after expiry) |

The append-only hash chain and the one-line integrity indicator are unchanged. Audit exports stay
logged (`audit.exported`).

## 4. Prepared summaries and suggestions (demo-safe Copilot foundation)

|                   |                                                                                                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status            | Approved—build (deterministic only). Live model: Founder decision required (**R-01**).                                                                                                                                                                                                         |
| Catch me up       | Built from rules, not a model. It takes the viewer's own visible timeline and context and assembles a fixed template: stage; who's involved; open exceptions; what's waiting on whom; the last contact each way; access ending soon. Every line cites its source events. "As of {exact time}". |
| Gap finding       | The exception rules in 1.4                                                                                                                                                                                                                                                                     |
| Next step         | The `nextStep` of each rule                                                                                                                                                                                                                                                                    |
| Prepared drafts   | Synthetic examples only, stored in the seed for specific demo moments (e.g. a reply to Daniel). Labelled **"Prepared with Copilot · synthetic example"**. Editable; sending is the person's own confirmed action.                                                                              |
| Never             | Sends, releases, activates, assigns, grants access, changes settings, deletes, or interprets anything clinical. Never reads patient private notes. Never runs for administrators on household content.                                                                                         |
| Visible vs hidden | It uses only what the viewer can open, through the same queries as the record. A source the viewer can't open is left out, never summarised.                                                                                                                                                   |
| Audit             | `summary.prepared` (the source IDs, not the text). When a draft is sent: `message.sent` with `prepared: true`, and the person as actor.                                                                                                                                                        |
| Family app        | The message arrives from the staff member as today. Whether families see "prepared with Copilot" is **R-02**; for the demo it shows on the staff side only.                                                                                                                                    |

## 5. Acceptance tests for these screens

- **Who can see what:** for every seeded persona and household, each grid cell equals the policy
  function's decision. Includes the cover window before, during and after.
- **Each category:** fires, clears, and records the right audit events. Consent and authority
  categories can't be dismissed (both the server and the UI refuse).
- **Role scoping:**
  - Maya never receives an exception for an unassigned household.
  - Sofia receives Okafor exceptions only during accepted cover.
  - Lena gets "Not available for your role".
- **Prepared summary:**
  - cites only events the viewer can open;
  - a protected item doesn't appear for a viewer without access;
  - "as of" is present.
- **No PHI in URLs:** a crawl of every link on both screens finds only IDs and view names.
- **Layout:**
  - axe has no violations on both screens, at desktop, iPad and phone;
  - no sideways scroll at 375 px;
  - family pages are pixel-unchanged.
- **Old URLs:** `/staff/queue` and `/staff/escalations` redirect with the right view.
