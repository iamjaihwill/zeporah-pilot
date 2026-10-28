# Manual accessibility review protocol

For an internal reviewer checking the synthetic Zeporah prototype with a keyboard, VoiceOver on Safari, browser zoom, and phone-width layouts. Record results in a copy of [manual-accessibility-observation-log-template.md](manual-accessibility-observation-log-template.md).

## Review purpose and boundaries

**This is** a manual check of the interactions most likely to fail automated testing — focus, announcements, dialogs, dense tables and responsive layouts — focused on the coordination queue, consent and correction, routine-message wording, bereavement continuity, and status feedback.

**This is not** a user study, a clinical validation, a certification against WCAG or any other standard, or a production accessibility audit. Automated axe checks already run on these screens; this covers what they can't. Use only synthetic personas and data. Findings feed a later fix increment; nothing is fixed during the review.

## Commitment and Stage 1 threshold (decision 73)

- **Standard:** WCAG 2.2 Level AA, for the family app and the staff workspace.
- **Critical workflows:** sign-in and invitation acceptance (Slice A, Slice K); household setup,
  including a patient alone (Slice L); "Get help" and the emergency notice (matrix rows and Slice N);
  messages and support requests, including the send states (matrix rows and Slice M); tasks;
  consent confirmation and correction (matrix rows); for staff, the exception queue, the household
  record, enrollment and the first invitation (Slice K), consent activation, and the 24-hour line card
  (Slice N).
- **Before Stage 1, on every critical workflow:**
  1. this protocol completed by **two** internal reviewers, each with their own log;
  2. 5–8 sessions with people who use assistive technology and with family caregivers, using
     synthetic data and the critical workflows only, with informed consent;
  3. a desk review by an independent accessibility specialist;

  then fixes, and a re-run, until no Blocker or High finding remains on a critical workflow.

- **What Zeporah may say:** no conformance or compliance claim. After all three, only a dated
  statement of what was reviewed and how, with known gaps listed. Never "accessible", "ADA compliant"
  or "WCAG compliant" as a blanket claim. A full third-party audit with a conformance report is a
  Stage 2 option.
- **Pending review:** counsel confirms whether the HHS Section 504 rule (WCAG 2.1 AA for recipients'
  web content and apps) applies to Zeporah through the hospice.

## Setup

**Synthetic only.** Every person and record in Zeporah is made up. Do not type real names, health details or contact information into any field, even as test text. Use the clearly synthetic test strings given below.

**Machine and browser**

- macOS: System Settings → Keyboard → turn on **Keyboard navigation** (so Tab reaches every control).
- Safari: Settings → Advanced → turn on **Press Tab to highlight each item on a webpage** (without it, Safari skips links when you press Tab), and **Show features for web developers** (for Responsive Design Mode).
- VoiceOver: Cmd+F5 to toggle. VO = Ctrl+Option. Set verbosity to Medium. Turn on VoiceOver → Visuals → caption panel so you can read what was announced.
- **200% zoom:** Safari's page zoom (Cmd+= to 200%; Cmd+0 resets).
- **Narrow viewport / reflow check:** Use Responsive Design Mode at 320 × 256 CSS px. This is a narrow-viewport reflow check, not a substitute for testing browser zoom at 400%. Record the exact browser, viewport, and zoom method used.
- **Phone width:** Responsive Design Mode at 375 × 812.

**Data state**

- Start the app with the development gate on: `bun run dev`, or the preview configuration `zeporah-pilot-dev-personas`. Without it there are no persona buttons and no reset control.
- Open `http://localhost:3000` and press **Reset synthetic data…** (then confirm) on the start page before you begin; the local development database may hold an older seed, so this is required.
- **Reset synthetic data resets the local development database to the current synthetic seed. Do not use it against any non-synthetic environment.**
- Some checks below create live changes (corrections, releases, bereavement, wording). Do the bereavement section **last**, and press **Reset synthetic data** again whenever a step says to, and at the end.

**Personas used:** Daniel, Grace, Ada, Chidi, Ingrid, Marisol (family); Maya, Tomás, Priya, Dana, Jordan — Cedar Valley (staff); plus an account invited during the session for slices A–C. Switch with **Sign out** (top left), then sign in again from the start page (persona sign-in needs the development gate, which `bun run dev` turns on). The sign-in, invitation and care-guide assignment screens were added after the first manual session; see [Slices not yet reviewed](#slices-not-yet-reviewed).

**Recording findings:** use the observation log in a local document. Refer to people only by persona name and to records by what the screen shows (for example "Maplewood Library consent"). Screenshots and recordings must show synthetic data only; crop out any real notifications on your Mac. Don't paste findings into external services.

## Test matrix

Severity is what applies if the check fails (see [Severity definitions](#severity-definitions)).

| Screen/workflow              | Persona                                                | Interaction                                                                 | Keyboard check                                                                                           | VoiceOver expectation                                                                                                                                                                         | Zoom/responsive check                                                   | Pass condition                                                                          | Severity if it fails                           |
| ---------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Start page                   | —                                                      | Reach and use a persona button                                              | Tab from the top: **Skip to main content** first; Tab reaches each "Sign in as …" button; Enter signs in | Skip link announced as a link; persona buttons as "Sign in as {name}, button"                                                                                                                 | 200%: no sideways scroll                                                | All personas reachable and usable without a mouse                                       | Blocker                                        |
| Navigation after sign-in     | any                                                    | Move between pages                                                          | Enter on a nav link moves focus to the main region of the new page                                       | New page heading reachable immediately (VO+Cmd+H); the active nav link is announced as current page                                                                                           | 320 px: nav scrolls within its own strip; no page-level sideways scroll | Focus never lost to the top of the page                                                 | High                                           |
| Staff queue (desktop)        | Priya                                                  | Read rows; open a row                                                       | Tab reaches filter links, then each row link in order                                                    | Table caption announced; column headers read when moving cells (VO+arrows inside the table); row link reads "{summary}, {household}"; priority reads "High workflow priority" plus its reason | 200%: table scrolls within its frame; page doesn't scroll sideways      | Every column understandable from its header; link purpose clear out of context          | High                                           |
| Staff queue filters          | Priya                                                  | Filter to "Consent correction"                                              | Enter on a filter link; Tab continues into the filtered list                                             | Active filter announced as current page; filter link names include the count                                                                                                                  | 200%: filter chips wrap                                                 | Filtered state is announced, not shown by color alone                                   | Medium                                         |
| Staff queue (phone)          | Priya                                                  | Read cards                                                                  | Tab reaches each card's link                                                                             | The list is announced with its label; each card's fields read label → value                                                                                                                   | 375 px and 320 px: cards stack, no sideways scroll                      | Cards carry the same fields as table rows                                               | High                                           |
| Staff dashboard counts       | Priya, then Dana                                       | Open a count                                                                | Each count is a link; Enter opens the filtered queue                                                     | Link name includes number and label (for example "2 Consent corrections")                                                                                                                     | 200%: counts wrap                                                       | Dana sees no reviewer-only counts; no link leads to a refused page                      | Medium                                         |
| Family Sharing (patient)     | Grace                                                  | Read a consent card; request a correction on Brightwater                    | Tab order follows the card's reading order; Enter opens the dialog; Space toggles a category checkbox    | The three-step list is announced as a list, the current step as "current step", done/next/not yet in words; the "Correction requested" badge is read                                          | 200% and 320 px: card content reflows; buttons wrap                     | Grace understands the stage and what happens next without visuals                       | High                                           |
| Cancel correction            | Grace                                                  | Cancel her own request                                                      | Enter on **Cancel my correction request**                                                                | The result is announced; afterwards focus is somewhere sensible, not the top of the page                                                                                                      | —                                                                       | Focus position recorded; outcome audible                                                | Medium (High if focus is lost to the top)      |
| Non-grantor concern route    | Daniel                                                 | Find what he can do about Grace's consent                                   | **Something not right? Tell your care team** reachable; Enter goes to Support                            | Read as a link, not a button                                                                                                                                                                  | —                                                                       | No "Request a correction" control appears for Daniel                                    | High if a correction control appears; else Low |
| Consents for you             | Chidi                                                  | Read his consent                                                            | Nav item **Consents for you** reachable; card actions reachable                                          | Held reason read in full; no withdraw control; no Brightwater consent on this page                                                                                                            | 320 px: reflows                                                         | Chidi only sees what names him and understands why it's held                            | High                                           |
| Named-grantor confirmation   | Ada                                                    | Confirm the Oakwood version 2                                               | Tab reaches **Confirm this sharing** after the statement                                                 | "What changed in version 2" and the confirmation statement are read before the button                                                                                                         | 200%: statement box reflows                                             | After confirming, focus doesn't jump to the top; outcome announced                      | High                                           |
| Dismissed-correction outcome | Ingrid                                                 | Read the bereavement-circle card                                            | —                                                                                                        | "Reviewed … and made no change" read; no staff wording anywhere on the page                                                                                                                   | —                                                                       | Family-safe outcome only                                                                | Blocker if staff text is exposed               |
| Staff correction panel       | Priya (Patel household → Authority & sharing)          | Read the open correction                                                    | Tab reaches **Dismiss with an explanation**                                                              | "Care team only" is announced **before** the family's words                                                                                                                                   | 200%: panel sits full width under its row                               | Staff-only content is clearly marked                                                    | High                                           |
| Staff dismiss dialog         | Priya                                                  | Open; try to confirm empty; type a reason; **Go back**                      | See [Dialog checklist](#dialog-checklist)                                                                | Field label "Reason (care team only)" and its hint are read                                                                                                                                   | 320 px: dialog fits without sideways scroll                             | Disabled confirm is understandable (see the dialog checklist)                           | Medium                                         |
| Grantor eligibility warning  | Maya (Okafor → Authority & sharing → Record a consent) | Choose Chidi as grantor                                                     | Arrow keys change the select; the warning appears below                                                  | Each option reads "{name} — can/can't confirm in the app"; the warning is announced once, not repeatedly                                                                                      | 320 px: the form is one column                                          | Warning perceivable without sight; it doesn't block recording                           | Medium                                         |
| Family messages              | Daniel                                                 | Read the page; compose                                                      | Tab to the message box and Send                                                                          | "Who can read messages here" read; "About replies to routine messages" heading present; "Not for emergencies" read                                                                            | 200%: no overlap with the bottom note                                   | Audience, wording and emergency boundary all perceivable                                | High                                           |
| Support                      | Daniel                                                 | Read; create a request with `Synthetic test request`                        | Tab through the form; Enter submits                                                                      | The result is announced and also shown in the bottom note                                                                                                                                     | 320 px: reflows                                                         | The note doesn't hide whatever has focus                                                | Medium                                         |
| Hospice settings             | Dana                                                   | Read history; save a new version with `Synthetic test wording`; turn it off | Tab through fields; **Turn it off** opens a dialog                                                       | History entries read in order with "Shown" or "Turned off" as text                                                                                                                            | 200%: history reflows                                                   | Version, state and date perceivable as text. **Reset synthetic data afterwards**        | Medium                                         |
| Cedar Valley history         | Jordan                                                 | Read the settings history                                                   | —                                                                                                        | "No wording is set" heading; version 2 read as "Turned off"                                                                                                                                   | —                                                                       | Unconfigured state is clear                                                             | Low                                            |
| Bereavement proposal         | Maya (Okafor → Lifecycle)                              | Propose; open **Cancel proposal**; **Go back**                              | Select reachable; dialogs per the checklist                                                              | The proposal card heading is announced after proposing                                                                                                                                        | 320 px: reflows                                                         | The two-person step and its consequences are read before confirming                     | High                                           |
| Bereavement confirmation     | Dana                                                   | **Confirm transition**                                                      | Dialog per the checklist                                                                                 | The consequence list is read before the confirm button                                                                                                                                        | —                                                                       | Focus sensible after the dialog closes                                                  | High                                           |
| Post-transition access       | Ada, Grace, Daniel                                     | Ada's Vault; Grace signs in; Daniel confirms                                | —                                                                                                        | Grace hears "You're not part of a household right now" as the page lede; Daniel's confirmation card is read                                                                                   | —                                                                       | Changes are announced plainly and without alarm                                         | High                                           |
| Continuing support           | Ingrid                                                 | Read the page                                                               | Headings navigable                                                                                       | "What stays the same" and "What changed" read as headed sections                                                                                                                              | 200%: reflows                                                           | Tone and structure understandable                                                       | Medium                                         |
| Status note                  | Ada (Updates & messages → Acknowledge)                 | Act, then dismiss the note                                                  | Tab reaches **Dismiss**                                                                                  | The result is announced once via the live region; the visible note isn't announced a second time                                                                                              | 320 px: the note doesn't cover the focused control                      | No double announcement; nothing obscured                                                | Medium                                         |
| Error inside a dialog        | Grace in two Safari windows                            | Withdraw a consent in window A, then try the same in window B               | —                                                                                                        | Window B: the dialog stays open and "This consent was already withdrawn." is announced as an alert                                                                                            | —                                                                       | Error announced and visible inside the open dialog. **Reset synthetic data afterwards** | High                                           |

## Slices not yet reviewed

**Next session order.** (1) Resume the original matrix where the 2026-10-12 session stopped: Family Sharing and the correction dialog, then the rest of the "Not tested" list in [that log](accessibility-sessions/2026-10-12-manual-safari-voiceover.md). (2) Slice A. (3) Slice B. (4) Slice C. (5) Slice D. (6) Slice E. (7) Slice F. (8) Slice G. (9) Slice H. (10) Slice I. (11) Slice J. (12) Slices K to O (built after 2026-10-12; critical workflows first: K, L, M, N). Record each slice in a new dated log from the [template](manual-accessibility-observation-log-template.md). Slices A and B need an invited account: as Dana, invite a care guide with a synthetic address ending `@example.invalid` and open the one-time link in a Safari private window. Choose a password used nowhere else.

**Note on start-page checks.** The original Start page row (persona buttons) still applies when the gate is on. With the gate off, the start page has only the email sign-in form — review that under Slice A.

These were added after the partial manual session of 2026-10-12. **No human has reviewed them.** Automated axe and keyboard checks pass, but they don't replace this review. Use the same severity definitions and log template.

**Rules for these slices**

- **Automated checks are not a substitute.** Passing axe and keyboard tests show only that some failures are absent. Every row below must be checked by a person.
- **Two interactions had no automated coverage until 2026-10-12 and still need particular manual attention.** They now have automated axe checks (`e2e/team.spec.ts`; `e2e-readonly/readonly.spec.ts`), but those don't replace these checks:
  - the **change-role dialog** (Slice C): keyboard operation and focus, and screen-reader announcement of its title, impact list and reason field;
  - the **read-only banner** (Slice J): visual (legible, not color-only, doesn't hide content); screen reader (announced once as a status, not repeatedly); responsive (200% zoom, 375 px and the 320 px reflow width).
- **Every finding is recorded** in a dated log (from the [template](manual-accessibility-observation-log-template.md)) with:
  - the date it was observed;
  - the slice and row it belongs to (for example "C · Change-role dialog");
  - a severity (Blocker, High, Medium, Low);
  - after a fix, a **retest** of that row, with the retest date and result. A finding isn't closed until a person retests it.
- **No conformance claim.** Completing these sessions doesn't support any claim of WCAG conformance or compliance, accessibility certification, or a statement that the product is accessible. It's an internal review. Testing with disabled users and a formal audit remain production gates.

**A. Sign-in and invitations (still outstanding from the authentication increment)**

| Screen/workflow     | How to reach it                                                                                    | Keyboard check                                           | VoiceOver expectation                                                                                   | Zoom/responsive                  | Severity if it fails |
| ------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------- |
| Email sign-in       | Start page, signed out                                                                             | Tab to **Email**, then **Password**; Enter submits       | Fields announced by label; a failed sign-in's message is announced once                                 | 200%, 320 px: no sideways scroll | Blocker              |
| Invitation page     | Dana: **Hospice settings → Invite a care-team member**, open the one-time link in a private window | Tab through name and both password fields; Enter submits | Heading "Join … on Zeporah"; the read-only email is announced; mismatch and policy errors are announced | 200%, 320 px                     | Blocker              |
| Unusable invitation | Open the same link again                                                                           | Tab reaches **Go to sign in**                            | One calm message; nothing about why                                                                     | 200%                             | High                 |

**B. Care-guide assignment (this increment)**

| Screen/workflow                    | How to reach it                                          | Keyboard check                                                                                                                                            | VoiceOver expectation                                                                                                                                           | Zoom/responsive                             | Severity if it fails |
| ---------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------- |
| Households list, care-guide column | Dana: **Households**                                     | Tab to each household link                                                                                                                                | The table caption and the **Care guide** column header are announced; "Not assigned" is read as text                                                            | 200%; tablet width: no sideways page scroll | High                 |
| Care team panel                    | Dana: Nguyen → **Overview**                              | Tab to **Assign a care guide**, choose with arrow keys, Tab to **Assign**, Enter                                                                          | The select is announced with its label and hint; the result ("… was assigned …") is announced                                                                   | 200%; tablet width                          | Blocker              |
| End-assignment dialog              | Dana: **End assignment for {name}**                      | The dialog per the [Dialog checklist](#dialog-checklist); **End assignment** stays unavailable until a reason is typed                                    | The dialog title, consequence text and **Reason** (with "Only staff will see it") are announced; the result is announced after closing                          | 200%                                        | Blocker              |
| Unassigned care guide              | Sign in as a newly invited care guide with no households | Tab through the page                                                                                                                                      | "You aren't assigned to any households yet" is reached and read; no empty counts or tables                                                                      | 200%                                        | High                 |
| Team & coverage page               | Dana: **Team & coverage**                                | Headings in order (h1, then one h2 per section); Tab reaches each household link, each assign select and button, each **Reassign** and **End assignment** | Each control's name says which household and guide it acts on (e.g. "Reassign The Hart household from Maya Chen"); the uncovered count is read with its heading | 200%; tablet width: no sideways scroll      | High                 |
| Reassign dialog                    | Dana: **Reassign** on a household                        | The [Dialog checklist](#dialog-checklist); **Reassign** stays unavailable until a reason is typed                                                         | Title names the household; **New care guide** and **Reason** read with their labels; the result ("… is now with …") is announced                                | 200%                                        | Blocker              |
| Read-only care team                | Maya or Priya: Okafor → **Overview**                     | No assign or end controls are reachable                                                                                                                   | The assigned guides are read as a list                                                                                                                          | —                                           | Medium               |

**J. System status and the read-only banner**

| Screen/workflow  | How to reach it                                         | Keyboard check                                        | VoiceOver expectation                                                                                   | Zoom/responsive                                                                     | Severity if it fails |
| ---------------- | ------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------- |
| System status    | Dana: **System status**                                 | Headings in order                                     | Each setting is read with its label                                                                     | 200%                                                                                | Medium               |
| Read-only banner | Restart with `ZEPORAH_READ_ONLY=1`, then try any change | Tab order isn't disturbed; the banner isn't focusable | The banner is announced as a status message once; a refused change announces the calm read-only message | Visual: legible, not color-only, doesn't cover content. 200%; 375 px; 320 px reflow | High                 |

**I. Reports and closing a household**

| Screen/workflow        | How to reach it                                  | Keyboard check                                                                                          | VoiceOver expectation                                                              | Zoom/responsive    | Severity if it fails |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------ | -------------------- |
| Reports                | Dana: **Reports**                                | Headings per card in order                                                                              | Each count is read with its label (description list)                               | 200%; tablet width | Medium               |
| Close household dialog | Lindqvist → **Lifecycle** → **Close household…** | The [Dialog checklist](#dialog-checklist); the confirm button stays unavailable until a reason is typed | The early-closing warning is read before the reason field; the result is announced | 200%               | Blocker              |

**H. Audit review**

| Screen/workflow     | How to reach it        | Keyboard check                                                   | VoiceOver expectation                                                                                                                        | Zoom/responsive                                        | Severity if it fails |
| ------------------- | ---------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------- |
| Filters and results | Dana: **Audit review** | Tab through the three selects and **Show events**; Enter applies | The form is announced as "Filter the audit log"; the result count is announced after applying; the integrity notice is read before the table | 200%; tablet width: the table scrolls inside its frame | High                 |

**G. Bereavement follow-up**

| Screen/workflow         | How to reach it                       | Keyboard check                                                              | VoiceOver expectation                                                                                        | Zoom/responsive    | Severity if it fails |
| ----------------------- | ------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ | -------------------- |
| Workload                | Tomás: **Bereavement follow-up**      | Headings per due window; Tab reaches each household link                    | Each window heading is read with its count; nothing says "overdue"                                           | 200%; tablet width | High                 |
| Record a check-in       | Lindqvist → **Overview** → **Record** | The [Dialog checklist](#dialog-checklist); arrow keys move between outcomes | The outcome group is read as a group with its legend; the note hint ("Only the care team sees this") is read | 200%               | Blocker              |
| Family "What to expect" | Ingrid: **Continuing support**        | Reading order                                                               | "Done"/"Planned" is read with each step; nothing else about the check-in                                     | 200%; 375 px       | High                 |

**F. Household members (family side; also at phone width)**

| Screen/workflow       | How to reach it                              | Keyboard check                                                                | VoiceOver expectation                                                                                         | Zoom/responsive                  | Severity if it fails |
| --------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------- |
| Role change           | Marisol: **People**, after inviting a member | Tab to "Role for {name}", arrow keys to choose, Tab to **Change role**, Enter | The select is read with the person's name; the result is announced                                            | 200%; 375 px: no sideways scroll | High                 |
| Remove dialog         | **Remove** next to a member                  | The [Dialog checklist](#dialog-checklist)                                     | The consequences ("will no longer see anything… you can invite them again later") are read before the buttons | 200%; 375 px                     | Blocker              |
| Held-back explanation | Daniel: **People**                           | The explanation is reached in reading order under Chidi's role                | Read as plain text, not as an error                                                                           | 200%                             | Medium               |

**E. Sharing register**

| Screen/workflow      | How to reach it             | Keyboard check                                                                           | VoiceOver expectation                                                                                                                             | Zoom/responsive                                                      | Severity if it fails |
| -------------------- | --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------- |
| Register and filters | Priya: **Sharing register** | Tab through the filter links (the current one is marked), then the table's consent links | The filter list is a navigation landmark ("Filter consents"); the current filter is announced as current page; the table caption names the filter | 200%; tablet width: the table scrolls inside its frame, not the page | High                 |
| Consent history      | Open any consent            | Headings in order; the History list is reachable                                         | History steps are read in order, newest first, each with who, what, and when                                                                      | 200%                                                                 | Medium               |

**D. Handoffs**

| Screen/workflow                         | How to reach it                          | Keyboard check                                                             | VoiceOver expectation                                                                                  | Zoom/responsive    | Severity if it fails |
| --------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------ | -------------------- |
| Hand-over choice in the Reassign dialog | Dana: **Team & coverage** → **Reassign** | Space toggles the checkbox; the hint text changes with it                  | The checkbox is read with its full label and the current hint; the change is perceivable without color | 200%               | High                 |
| Give an escalation                      | Dana: **Escalations**                    | Tab to each "Give this escalation for … to" select and its **Give** button | The select's label names the household; the result ("… owns this escalation now") is announced         | 200%; tablet width | High                 |

**C. Staff lifecycle**

| Screen/workflow    | How to reach it                             | Keyboard check                                                                                          | VoiceOver expectation                                                                                                      | Zoom/responsive    | Severity if it fails |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------- |
| Staff detail page  | Dana: **Team & coverage** → a person's name | Headings in order; Tab reaches the household links, **New role**, **Change role…** and **Deactivate…**  | "What they cover" and "Role history" are reachable as regions; the impact is read as plain text                            | 200%; tablet width | High                 |
| Change-role dialog | **Change role…**                            | The [Dialog checklist](#dialog-checklist); the confirm button stays unavailable until a reason is typed | The title names the person and new role; the impact list (assignments ending) is read before the reason field              | 200%               | Blocker              |
| Deactivate dialog  | **Deactivate…**                             | The dialog checklist; Escape returns focus to **Deactivate…**                                           | The impact list, then "Their role ends, their sessions end, and they can't sign in again" is read; the result is announced | 200%               | Blocker              |
| Own account        | Dana opens her own page                     | No manage controls are reachable                                                                        | "You can't change your own role or account" is read                                                                        | —                  | Medium               |

**K. Enrollment, Getting started and the first invitation (decisions 66–70)**

| Screen/workflow       | How to reach it                                                         | Keyboard check                                                                                                                   | VoiceOver expectation                                                                          | Zoom/responsive                                               | Severity if it fails |
| --------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------- |
| Enroll a household    | Dana: **Households** → **Enroll a household**                           | The button opens the form; Tab reaches the name, the care-guide select, **Enroll** and **Close**; Enter submits                  | The pilot count ("7 of 25 households in the pilot") is read; each field has its label and hint | No sideways scroll at 375 px and 320 px; the two fields stack | High                 |
| Pilot full            | Lena: set **Enrollment** to the current count, then Dana opens the form | No form controls remain                                                                                                          | "The pilot is full" is read with the explanation                                               | Readable at 200%                                              | Medium               |
| Getting started card  | The new household's overview                                            | Tab reaches **Invite the patient or coordinator**                                                                                | Each checklist item is read with "Done" or "Not yet" in words, not just a mark                 | The card reflows at 200%                                      | High                 |
| First invitation form | **Invite the patient or coordinator**                                   | Tab order: role, name, email, how identity was confirmed, **Create invitation**, **Cancel**; Escape isn't required (inline form) | Labels and hints read, including "A role organizes access; it isn't legal authority"           | No sideways scroll at 375 px                                  | High                 |
| One-time link         | After creating the invitation                                           | Focus isn't lost to the top of the page                                                                                          | The notice title and its instructions are read; the link is read as text                       | The long link wraps, no sideways scroll                       | High                 |

**L. First-time patient setup (decision 69)**

| Screen/workflow     | How to reach it         | Keyboard check                                      | VoiceOver expectation                                                               | Zoom/responsive | Severity if it fails              |
| ------------------- | ----------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------- | --------------------------------- |
| Patient alone, home | Rehanna (demo launcher) | **Start setup** is reachable early in the Tab order | The setup card says what each step turns on; nothing says a coordinator is doing it | 375 px and 200% | Blocker if setup can't be reached |
| Each setup step     | **Start setup**         | Each step completes by keyboard                     | Each step's result is announced once                                                | 375 px          | High                              |

**M. Send states (increment 3)**

| Screen/workflow    | How to reach it                                     | Keyboard check                                          | VoiceOver expectation                                                | Zoom/responsive | Severity if it fails |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- | --------------- | -------------------- |
| Message sent       | Daniel: **Messages**, send `Synthetic test message` | Ctrl/Cmd+Enter sends; focus stays in the composer       | "Message sent to your care guide." is announced once                 | 375 px          | High                 |
| Send not confirmed | Turn off Wi-Fi, send, turn Wi-Fi back on            | The text stays in the box; **Send message** sends again | "We couldn't confirm this was sent…" is announced as a problem, once | 375 px          | High                 |
| Support request    | Daniel: **Support**, send `Synthetic test request`  | As above                                                | The confirmation names the 24-hour line                              | 375 px          | High                 |

**N. The 24-hour line (decision 72)**

| Screen/workflow   | How to reach it                               | Keyboard check                                                                          | VoiceOver expectation                                                                   | Zoom/responsive | Severity if it fails             |
| ----------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------- | -------------------------------- |
| Line card         | Lena: **Hospice settings** → organization     | Tab reaches **Propose a new line** and the confirm form                                 | "Families see", "Last confirmed" and any "Due" notice are read in order                 | 200%            | Medium                           |
| Propose           | **Propose a new line**, type `(555) 555-0142` | Tab: line, backup, **Propose**, **Cancel**                                              | A format error is read next to the field                                                | 375 px          | High                             |
| Confirm           | Dana, same card                               | The checkbox and note are reachable; the button stays unavailable until both are filled | The checkbox label is read in full; "Waiting for confirmation…" is read before the form | 375 px          | High                             |
| Emergency notice  | Daniel's home                                 | —                                                                                       | The line, and any "if you can't get through" backup, are read as part of the notice     | 320 px          | Blocker if the number isn't read |
| System status row | Dana: **System status**                       | The row's link is reachable                                                             | "24-hour line" with "Confirmed <date>" or "Due" in words                                | 200%            | Medium                           |

**O. Who opened records (decision 71)**

| Screen/workflow | How to reach it                                  | Keyboard check                                     | VoiceOver expectation                                                               | Zoom/responsive                            | Severity if it fails |
| --------------- | ------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------ | -------------------- |
| The log         | Priya: **Audit review** → **Who opened records** | Filters reachable; the checkbox toggles with Space | The table caption and headers are read; "Not assigned or covering" is read as words | The table scrolls in its own box at 375 px | Medium               |

## Dialog checklist

Apply to each dialog: correction request, staff dismiss, consent withdrawal (family and staff), turn off wording, propose and cancel bereavement, confirm transition, and — if visited — review and link authority.

- [ ] **Initial focus:** on opening, focus moves inside the dialog (record where: first control or the dialog itself).
- [ ] **Focus trap:** Tab and Shift+Tab cycle within the dialog; the page behind can't be reached.
- [ ] **Escape:** Esc closes the dialog without acting.
- [ ] **Visible close action:** a **Go back** button is present and reachable (these dialogs have no ✕ icon by design — note whether that's clear).
- [ ] **Return focus:** after closing (Esc, Go back, or a successful action), focus returns to the control that opened it. If that control no longer exists, record where focus went.
- [ ] **Error announcement:** a refusal is announced (alert) and shown inside the still-open dialog.
- [ ] **Consequence before confirm:** the explanation — what happens, what doesn't, what is never recalled — is read before the confirm button.
- [ ] **Disabled-button explanation:** when confirm is disabled (dismiss without a reason, link without a person or basis, staff withdrawal without a reason), can a VoiceOver user tell why? Record whether it's announced as "dimmed" and whether anything explains what's missing.

## Queue checklist

- [ ] **Dense rows stay understandable:** reading one row cell by cell — priority → item → state → owner → last action → next step → waiting — gives a complete picture without visuals.
- [ ] **Table semantics:** the table has a caption, column headers are announced when moving between cells, and the page heading is "What needs a person".
- [ ] **Row link purpose:** each link reads the item plus the household and makes sense in the VO rotor's links list.
- [ ] **Verbosity:** record how long one row takes to hear and whether the priority reason under the badge adds clarity or noise.
- [ ] **Phone-card equivalence:** each card has the same fields as the table row, in the same order, with labels.
- [ ] **Non-color priority:** with color removed (macOS Settings → Accessibility → Display → Color filters → Grayscale), priority is still recognizable by word and shape (▲ ● ○).
- [ ] **Priority is framed as workflow ordering:** the "workflow ordering aid … not clinical urgency" sentence is reachable on the queue page and the dashboard.
- [ ] **Filter and sort comprehension:** the active filter is announced; the order (highest priority, then longest waiting) is stated on the page and matches what you hear.
- [ ] **Missing values:** "No owner assigned" and "No recorded action yet" are read as words, not skipped.

## Consent checklist

- [ ] **Three-step meaning:** a VoiceOver user can tell which step is done, which is current, and that nothing is shared until all three happen.
- [ ] **Restricted grantor scope:** Chidi's "Consents for you" shows only his consent — no Sharing nav item, no withdraw control, no other consents on that page.
- [ ] **Correction-request privacy:** Grace hears her own categories; Daniel, viewing the same consent, hears only that a correction was requested and sharing is held — no categories, no words.
- [ ] **Non-grantor Support route:** Daniel has "Something not right? Tell your care team", which goes to Support, and no correction control.
- [ ] **Family-safe dismissal result:** Ingrid hears only that the care team reviewed it and made no change; the staff reason never appears in her view.
- [ ] **Staff-only content separation:** on the staff consent row, the family's own words are preceded by "Care team only", and the dismiss field is labeled "Reason (care team only)".
- [ ] **No legal-signature implication:** "it isn't a legal signature" is read before **Confirm this sharing**.

## Findings template

```
ID:                      A11Y-___
Date/time:
Reviewer:
Persona/screen:          (persona name · page · section)
Steps to reproduce:      1.
                         2.
Expected behavior:
Actual behavior:
Assistive technology and settings:
                         (keyboard only / VoiceOver + Safari version / zoom % or
                          Responsive Design Mode size / color filter on-off)
Severity:                Blocker / High / Medium / Low / Observation
Screenshot or recording reference, if available:
                         (local file name; synthetic data only)
Recommendation:
Blocker for founder review?   Yes / No
```

## Severity definitions

| Severity        | Meaning                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blocker**     | A keyboard or VoiceOver user can't complete a core walkthrough step at all, or staff-only or private content is exposed to the wrong person.                                                                                             |
| **High**        | A core step can be completed only with significant confusion or workaround: focus lost to the top of the page, a consequence not announced before confirming, a dialog that traps or loses focus, content unreachable at 320 px or 200%. |
| **Medium**      | Understandable but harder than it should be: verbose or repeated announcements, disabled buttons without explanation, unclear filter state, minor focus misplacement after an action.                                                    |
| **Low**         | Polish: wording, order of announcements, small visual overlap that doesn't hide anything.                                                                                                                                                |
| **Observation** | Not a defect; worth noting for future design or research (for example, whether phone cards read better than the table).                                                                                                                  |

## Exit criteria

**Before internal founder review:** no open Blocker. Every walkthrough step can be completed by keyboard alone, and no staff-only content appears in any family view. High findings are recorded and either accepted or scheduled (they need not all be fixed).

**Before a future synthetic walkthrough with others:** no open Blocker or High. Medium findings have an agreed plan. The whole matrix has been re-run after fixes, and 200% zoom and the 320 px narrow-viewport reflow check pass on every screen in the matrix.

**Before any future user or pilot accessibility discussion:** no open Blocker or High; Medium findings are fixed or explicitly accepted; this review has been repeated with a second reviewer; the optional iPhone VoiceOver check below has been done; browser zoom at 400% has been tested directly; and it is explicitly acknowledged that this internal review does not replace testing with disabled users or a formal audit — both remain production-gate items.

**Before Stage 1 (decision 73):** everything above for "any future user or pilot accessibility
discussion", plus, on every critical workflow: two internal reviewers' completed logs, 5–8 sessions
with assistive-technology users and family caregivers, and an independent specialist's desk review,
with no Blocker or High finding left open. Only then may Zeporah make the dated statement described in
[Commitment and Stage 1 threshold](#commitment-and-stage-1-threshold-decision-73).

## Optional iPhone VoiceOver spot check

Optional. Repeat the queue (phone cards), Consents for you, the correction dialog and the status note with VoiceOver on an iPhone.

**Limitation:** the prototype currently serves only on `localhost`, so a phone can't reach it without serving it on the local network, which is a configuration change outside this protocol. If that isn't approved, skip this check and record it as not performed.

## No-change statement

This document describes a review procedure only. Writing it changed no application code, tests, seed data, configuration, migrations, dependencies, servers, databases or Git state, used no external service and no real data. Performing the review changes only the local development database's synthetic data, through **Reset synthetic data** and the live steps listed above.
