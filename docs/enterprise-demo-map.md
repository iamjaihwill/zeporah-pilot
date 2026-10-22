# Zeporah Enterprise: demo map (the Okafor household, one simulated week)

Status: **map for founder review, 2026-10-21.** It uses the existing synthetic Okafor household and
the stories in [enterprise-implementation-plan.md](enterprise-implementation-plan.md). Everything
is synthetic. Outside organizations are simulated, and every partner event is labelled
"simulated".

The run-through as screenshots: `docs/review-screenshots/enterprise/`
(`e2e-verify/enterprise-shots.spec.ts`, run with `ENTERPRISE_SHOTS=1`).

## Cast

| Person                      | Role                                                      | Signs in on                               | Device in the demo  |
| --------------------------- | --------------------------------------------------------- | ----------------------------------------- | ------------------- |
| Grace Okafor                | Patient                                                   | Family sign-in                            | Tablet (family app) |
| Daniel Okafor               | Household coordinator                                     | Family sign-in                            | Phone (family app)  |
| Ada Okafor                  | Proxy (active healthcare-agent workflow)                  | Family sign-in                            | Phone (family app)  |
| Maya Chen                   | Care guide, assigned                                      | Care-team sign-in                         | Laptop              |
| Sofia Reyes                 | Care guide, covers Okafor on Days 5–6                     | Care-team sign-in                         | iPad                |
| Dana Brooks                 | Hospice operations                                        | Care-team sign-in                         | Laptop              |
| Priya Raman                 | Authority and consent reviewer                            | Care-team sign-in                         | Laptop              |
| Lena Hoffman                | Hospice administrator                                     | Care-team sign-in                         | Laptop              |
| Rosa Lin                    | Intake coordinator, Brightwater Respite House (simulated) | Family sign-in, then the recipient portal | Laptop              |
| Oakwood Home Medical Supply | Equipment supplier (simulated)                            | — (calls only)                            | —                   |

## The thesis, in four questions the week answers

1. **Understand the situation quickly:** Catch me up, the unified timeline and the context column.
2. **See what's stuck:** exceptions, each with a reason.
3. **Know who owns it:** owners, handoffs and temporary cover, all visible.
4. **Show exactly what happened:** the audit log, with role at the time, source, approvals,
   "prepared" flags and the integrity line.

## The week

Times are wall-clock Eastern. The days count back from the day you run the demo: in the
mid-week snapshot today is Day 4; in the end-of-week snapshot today is Day 7. Each row lists what
is raised (▲) or cleared (▼).

### Day 1: a reply that was waiting, and a release

| Time  | Who  | Screen                                      | What happens                                                                                                                                                                                                                    | Exception                                     | Approval gate                             | Audit events                                                                                                  | Family sees                                          |
| ----- | ---- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 9:00  | Maya | Care-team sign-in, then the care guide home | Needs you now: 4. The oldest is "Family contact unresolved · Okafor · Ada's message, 26 h".                                                                                                                                     | ▲ already open                                | —                                         | `session.started`                                                                                             | —                                                    |
| 9:02  | Maya | Okafor record, then **Catch me up**         | A 7-line summary, each line linked to its source; "as of {date}, 9:02 AM ET".                                                                                                                                                   | —                                             | —                                         | `summary.prepared` (11 sources)                                                                               | —                                                    |
| 9:05  | Maya | Exception detail panel                      | A prepared draft reply, labelled "Prepared with Copilot · synthetic example". Maya edits it and sends.                                                                                                                          | ▼ Family contact unresolved                   | The send confirmation names the recipient | `message.sent` (prepared: true, actor: Maya)                                                                  | Ada gets the reply from Maya                         |
| 11:00 | Dana | Exceptions › Releases in flight             | "Release incomplete · Okafor · respite packet: recipient contact not verified". Dana verifies Rosa's contact, then requests release. The dialog restates the recipient, contents and access until Day 5, 6 PM. All checks pass. | ▼ Release incomplete. ▲ Access ending (Day 5) | Release confirmation (existing wording)   | `packet.recipient_contact_set`, `packet.released` (Allowed, checks listed), `packet.recipient_access_granted` | The Sharing page shows "Recorded as released 1 time" |

### Day 2: a supplier asks

| Time  | Who  | Screen                                  | What happens                                                                       | Exception                                                                | Approval gate                | Audit events                                         | Family sees |
| ----- | ---- | --------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------- | ----------- |
| 10:15 | Maya | Okafor record › **Log a partner event** | Oakwood called to ask for the delivery contact. Kind: Request. Labelled simulated. | ▲ Missing consent (Oakwood version 2 isn't active yet; it waits for Ada) | Confirm: "Not sent anywhere" | `partner_event.logged` (source: Partner · simulated) | —           |

### Day 3: next steps, and a bed

| Time  | Who    | Screen                  | What happens                                                                                                                                                     | Exception            | Approval gate              | Audit events                           | Family sees                                           |
| ----- | ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------- | -------------------------------------- | ----------------------------------------------------- |
| 8:45  | Maya   | Okafor record › Updates | Posts "Respite stay: next steps" with **Needs acknowledgement**.                                                                                                 | —                    | The update form (existing) | `update.posted`                        | Daniel sees the update and its acknowledgement button |
| 11:00 | System | —                       | 48 h since release, and Brightwater hasn't opened the packet.                                                                                                    | ▲ Waiting on partner | —                          | (rule; nothing written)                | —                                                     |
| 15:00 | Maya   | Okafor record           | Logs a partner event: "Brightwater: a bed is available on Tuesday next week". Creates a care-team task "Book transport for the respite stay", due Day 5 at noon. | —                    | The task form (existing)   | `partner_event.logged`, `task.created` | —                                                     |

### Day 4: confirmation, the respite house, and planning Maya's absence (the live demo starts here)

The **mid-week snapshot** stops at 9:00 on Day 4. Everything below happens live; the
**end-of-week snapshot** has it all recorded (except Rosa's question, which is live only).

| Time  | Who   | Screen                        | What happens                                                                                                                                                                                                                              | Exception                                   | Approval gate                                | Audit events                                                                                      | Family sees                  |
| ----- | ----- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------- |
| 9:00  | Dana  | Operations home               | Needs you now and No owner. **Coverage** shows Maya out Days 5–6 (recorded on Day 1). Coverage gap ×3: Okafor, Bennett and Rivera (Hart is already shared with Sofia, so it doesn't count). Daniel hasn't acknowledged the update (24 h). | ▲ Coverage gap ×3, ▲ Unread critical update | —                                            | (rules)                                                                                           | —                            |
| 9:05  | Dana  | Team & coverage › Offer cover | Okafor → Sofia, with a handoff note (prepared, synthetic, edited by Dana). Bennett and Rivera → Tomás. The dialog restates the households, the covering guide, the start (Day 5, 8 AM) and the end (Day 6, 6 PM).                         | —                                           | Confirm                                      | `handoff.offered` ×3                                                                              | —                            |
| 10:00 | Maya  | Exceptions                    | Calls Daniel and records **Reached by phone**. The call counts for Daniel only; the update still lists the others who haven't acknowledged it.                                                                                            | Daniel leaves the unread update             | Confirm naming Daniel                        | `update.reached_by_phone`                                                                         | Nothing changes for Daniel   |
| 10:20 | Ada   | Family app › Sharing (phone)  | Ada confirms Oakwood version 2. The decision-1 wording is unchanged.                                                                                                                                                                      | —                                           | The household's own confirmation             | `consent.confirmed`                                                                               | Her confirmation             |
| 13:30 | Rosa  | Recipient portal              | Opens the respite packet read-only and acknowledges it. Live only: asks "Which entrance should the family use?"                                                                                                                           | ▼ Waiting on partner                        | —                                            | `packet.recipient_viewed`, `packet.recipient_acknowledged` (and `packet.recipient_question` live) | —                            |
| 14:00 | Sofia | Handoffs (iPad)               | Reads the note and accepts cover for Okafor.                                                                                                                                                                                              | —                                           | Confirm restating the household and end time | `handoff.accepted`, `coverage.granted` (decision 59)                                              | —                            |
| 14:05 | Sofia | Okafor › **Who can see what** | Her row: "Sofia Reyes · covering · Temporary until Day 6, 6:00 PM ET".                                                                                                                                                                    | —                                           | —                                            | —                                                                                                 | —                            |
| 14:30 | Priya | Exceptions › Consent & access | Activates Oakwood version 2. She is a different person from whoever recorded it.                                                                                                                                                          | ▼ Missing consent                           | Activation confirmation (existing)           | `consent.activated` (approval: recorded by Maya, activated by Priya)                              | "Active" on the Sharing page |

### Day 5: cover in action, and access that ends

| Time  | Who    | Screen                        | What happens                                                                                                                  | Exception                        | Approval gate       | Audit events                                                 | Family sees         |
| ----- | ------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------- | ------------------------------------------------------------ | ------------------- |
| 9:00  | Dana   | Exceptions › Handoffs         | Tomás hasn't accepted Bennett and Rivera (24 h).                                                                              | ▲ Stalled handoff ×2             | —                   | (rule)                                                       | —                   |
| 9:10  | Dana   | —                             | Re-routes Rivera to herself for the day, and asks Tomás to accept Bennett.                                                    | ▼ for Rivera                     | Assign confirmation | `exception.assigned`, `handoff.withdrawn`, `handoff.offered` | —                   |
| 10:00 | Sofia  | Care guide home (iPad)        | "Book transport for the respite stay" is due today. She completes it.                                                         | ▼ (would have been Overdue task) | —                   | `task.completed`                                             | —                   |
| 17:00 | Sofia  | Exceptions › Consent & access | The respite access ends at 6 PM. Rosa has acknowledged it, and the stay is booked. She chooses **Let it end**, with a reason. | ▼ Access ending                  | Reason required     | `exception.dismissed` ("let it end: stay booked")            | —                   |
| 18:00 | System | —                             | Brightwater's access ends.                                                                                                    | —                                | —                   | `packet.recipient_access_ended` (new; plan A-1)              | Sharing page: Ended |

### Day 6: cover ends by itself

| Time  | Who    | Screen | What happens                                                                                       | Exception | Approval gate | Audit events                     | Family sees |
| ----- | ------ | ------ | -------------------------------------------------------------------------------------------------- | --------- | ------------- | -------------------------------- | ----------- |
| 18:00 | System | —      | Sofia's cover ends at the exact time. Her next attempt to open Okafor says "This isn't available". | —         | —             | `coverage.ended` (actor: System) | —           |

### Day 7: Maya returns, and the week is shown

| Time | Who  | Screen                            | What happens                                                                                                                                                                                                     | Exception | Approval gate                  | Audit events       | Family sees |
| ---- | ---- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------ | ------------------ | ----------- |
| 9:00 | Maya | Care guide home                   | "Changed since you last looked: 9 events in Okafor".                                                                                                                                                             | —         | —                              | —                  | —           |
| 9:02 | Maya | **Catch me up**                   | Cites Sofia's task, the access ending and the update reached by phone.                                                                                                                                           | —         | —                              | `summary.prepared` | —           |
| 9:10 | Dana | Audit review › Okafor › this week | Every event with role at the time, source (Staff / Family / Partner · simulated / System / prepared), approvals ("recorded by Maya, activated by Priya") and integrity: "All entries are intact". Export to CSV. | —         | Export confirmation (existing) | `audit.exported`   | —           |
| 9:20 | Lena | Administrator home                | Governance: the week's settings and role changes, and coverage counts with **no household names**. Opening an Okafor link says "Not available for your role".                                                    | —         | —                              | —                  | —           |

## Presenting it in about 15 minutes

Use the **mid-week snapshot** for beats 1–8 and the **end-of-week snapshot** for beats 9–11. Both
come from the development-only Reset (plan story F-5).

**Before you start** (demo rehearsal, 2026-10-22): reset to the mid-week snapshot in a separate tab,
so the "Synthetic data was reset." notice isn't on the first screen. To switch persona, use the
"jump to synthetic personas" links at the top of the family sign-in (Household, Care team,
Recipients), or the persona link under the care-team sign-in; both work while signed in. Keep
`/staff/households/hh-okafor` ready to paste for beat 11.

1. **Two front doors (30 s):** the family sign-in on a phone next to the care-team sign-in on a
   laptop. From the care-team sign-in, its persona link takes you to Maya.
2. **Maya's home (1 min):** Needs you now, oldest first. Open any row to see why it's there; access
   that's ending says when it ends.
3. **The Okafor record (2 min 30 s):**
   - Catch me up, with its citations and its "Used / Suggests / You approve" lines;
   - the timeline with its source badges;
   - the context column, by question: what's waiting and who owns it, who is involved, what has
     been agreed, what has been shared;
   - Exceptions › Consent & access: the Oakwood request logged on Day 2 (labelled simulated) shows
     as Missing consent, open 2 days, "Based on" its version 2 waiting for the household;
   - log a second partner event live, to show the form.
4. **Who can see what (1 min):**
   - Ada via the workflow;
   - Chidi with limited access;
   - Brightwater bound to one packet, until a date;
   - administrators: no.
5. **A reply, and a confirmation, on Ada's phone (1 min 30 s):** the prepared draft is labelled
   synthetic and says what it used; Maya uses it and sends. On Ada's phone, her home shows the new
   reply and the consent waiting for her; she reads the reply, then confirms Oakwood (the
   decision-1 wording, unchanged).
6. **Activation (1 min):** as Priya, go straight to Exceptions › Consent & access. Oakwood is "Confirmed —
   ready to activate"; Activate restates the recipient, purpose, contents and dates. Both Oakwood
   rows clear.
7. **Recipient portal (1 min):** Rosa opens "Coordinate a short respite stay" (the second of her two
   packets), reads it read-only, acknowledges, and asks a question.
8. **Planned absence (2 min):**
   - Dana's Coverage widget: "Maya Chen will be away soon; no cover accepted";
   - offer cover to Sofia, using the prepared note;
   - Sofia accepts on the iPad;
   - back as Dana, Okafor › Who can see what shows Sofia "Temporary from … until …", with
     nothing visible to her until it starts (decision 59). Sofia herself can't open the household
     until then.
   - the household isn't told yet: Daniel's phone hears about it only when cover starts (decision
     62). The end-of-week snapshot has that update, posted on Day 5 (beat 9).
9. **End-of-week snapshot (1 min):** in Resolved, "Stalled handoff rerouted" (Rivera) and the
   Dismissed "Let it end", each with who and when, and a link to its record.
   Optional (30 s): on Daniel's phone, the Day 5 update "Sofia Reyes is your care guide until
   Oct …, 6:00 PM", and Home naming Maya again now that cover has ended.
10. **Audit (2 min):** the week, filtered to Okafor: role at the time, source, and with Source set to
    Two-person approvals, "Requested by Maya Chen, Approved by Priya Raman". The chain line counts
    the whole hospice's events; the list counts Okafor's. Then the export, which is itself logged.
11. **Governance (1 min):** Lena's home has no household names. Paste the Okafor address: "Administrators
    don't open household records (decision 39)", with a way back to Administration.

**Not shown:**

- billing, claims or payers;
- clinical charting;
- risk scores;
- any live AI or live feed;
- funeral-home sharing;

## Decisions the demo needs

All three are decided (2026-10-21): cover access (decision 59), who logs partner events
(decision 60: Maya can log them as the assigned guide), and declining a handoff (decision 61; not
used in the script).

## Seed additions (all synthetic, plan story F-5)

- **Partner events** (simulated): Oakwood request (Day 2) and Brightwater bed availability
  (Day 3).
- **Packet:** the respite packet in draft with recipient contact unverified (Day 1). Released in
  the end-of-week snapshot, ending Day 5, 6 PM.
- **Absence:** Maya's, Days 5–6, recorded Day 1.
- **Handoffs:** Okafor → Sofia (accepted in the end-of-week snapshot); Bennett and Rivera → Tomás
  (stalled).
- **Update:** "Respite stay: next steps", needing Daniel's acknowledgement.
- **Task:** "Book transport for the respite stay", due Day 5.
- **EHR pointer:** `ehr_reference` "000-SYN-4411" for Okafor.
- **Prepared drafts** (synthetic): the reply to Ada and the handoff note for Sofia.
- **Background exceptions** elsewhere so the homes aren't empty: Bereavement contact due
  (Lindqvist) and Coordination risk (Bennett: 3 open).
