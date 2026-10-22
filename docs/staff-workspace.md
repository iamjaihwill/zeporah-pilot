# Staff workspace

How the hospice staff workspace (`/staff/*`) is built: a work tool for people who use it all day,
alongside a clinical record system. The family app (`/family/*`) has its own, deliberately calmer
design and is not affected by anything here.

## Design system (scoped)

- Everything staff-specific applies only inside `[data-surface="staff"]`, which only the staff
  layout sets (`src/components/staff/shell.tsx`). Shared components carry `data-ui` hooks
  (`button`, `card`, `badge`) so the staff surface can restyle them; on family pages nothing
  matches, so they look exactly as before. `e2e-verify/family-unchanged.spec.ts` compares three
  family pages, desktop and phone, pixel by pixel against baselines.
- Type: the sans face throughout, scale 20/16/14/13/12. The serif stays in the wordmark only.
- Spacing: 4px base; panels 12–16px.
- Density: Comfortable (40px rows) or Compact (32px rows), each person's own setting, in the
  account menu (`preferences.density`). On touch screens (`pointer: coarse`) the controls people
  tap stay at least 44px tall.
- Components (`src/components/staff/`): `StaffPageHeader`, `Panel`, `DataTable` (sticky header,
  sortable columns, selection, row hover actions, empty and loading states), `StatusChip`,
  `ViewTabs`, `SplitPane` (detail panel; a drawer below 1200px), `Popover`, `Kbd`, `Skeleton`,
  `OneLineNote`, charts (`charts.tsx`). Toast with Undo is shared with the family app.

## One status vocabulary

`src/domain/status.ts` maps every status enum (escalations, consents, authority records,
packets, tasks, households, invitations, transitions, check-ins, corrections, memberships, vault,
decisions) to a label, a tone and an icon. Each domain is typed against its source enum, and
`tests/unit/status-map.test.ts` checks every value. Screens render statuses only through
`StatusChip`; the stored code is in its tooltip, never the visible text.

## Frame

- Top bar: ⌘K / Ctrl+K search, notifications, Help (`/staff/help`) and the account menu (name,
  role, hospice, density, keyboard shortcuts, sign out).
- Sidebar: Work / Households / Oversight / Admin, with counts on Work items; collapses to icons
  (remembered in the browser only). Policy scenarios shows only with development tools on.
- Search (`staffSearch`) looks only inside the households the person can already see, and never
  matches what a family wrote. Tested for Jordan (Cedar Valley) never seeing Willow Creek.

## Role homes

My work (`/staff`) is each role's home (decision 58, workstream 4; `services/command-center.ts`).
Every widget is one number that opens the list behind it, and the three oldest items, each opening
that item in Exceptions. Read-only: nothing is taken, assigned or resolved from the home.

- **Care guide:** Needs you now, Due or overdue, Waiting on family, Waiting on partners, Access
  ending, Changed in the last day.
- **Operations:** No owner, Needs you now, Coverage (gaps and stalled handoffs, and who's away),
  Releases in progress, Waiting on partners, Access ending.
- **Reviewer:** Review backlog (with its oldest wait), Needs you now, Consent & access ending,
  Releases in progress.
- **Administrator** (`/staff/admin`): team by role, invitations waiting, settings, coverage as
  counts (no household named), audit integrity, and recent changes to people, access and settings.

Handoffs offered to the person and the getting-started guide sit above the widgets.

## Exceptions

`/staff/exceptions` (decision 58) replaces the coordination queue and the escalations page; their
old addresses redirect with the view mapped, so notification links and bookmarks keep working.

- **Rows are computed** from the records they're about (`coordinationQueue` in
  `services/staff.ts`), so a row can't say something that's no longer true. Each has a category,
  urgency (Now / Today / This week; not clinical triage), owner, age, due-by, next step, source and
  "Why this is here". Deterministic rules with the hospice's thresholds (Hospice settings ›
  Workflow › Exception thresholds): missing consent (a logged partner request with no active
  consent), access ending, recipient hasn't opened, stalled handoff, coverage gap, bereavement
  check-in due, unread critical update, and coordination risk (named operational signals only).
- **People's part** is in `exception_claims` (`services/exceptions.ts`): take, mark waiting,
  release, assign (operations), and dismiss with a reason. Consent and authority work, tasks,
  escalations, coverage and handoffs can't be dismissed; the server refuses. Escalations and tasks
  keep their own owners. Every action is audit-logged. "Reached by phone" records a call that
  clears an unread critical update.
- **Views:** All, Needs you now, No owner, Waiting on family, Waiting on partner, Releases in
  flight, Consent & access, Handoffs, Bereavement, Due, Resolved (14 days). Views a role can't act
  on are left out. Filters (category, owner, household, urgency), sort and the selected item live
  in the URL; search words never do.
- **Where work is waiting** (operations, All view): a collapsed table of open items by category and
  age (under 1 day, 1–3 days, over 3 days). Counts only, from the rows already on the page; each
  count opens that part of the list (`category` and `age` in the URL).
- **Detail panel:** Why this is here (with **Based on**: the consent version and its state, or the
  authority record, that a sharing row rests on; and **Closes when**), the actions, the last 5
  recorded actions, and the item's own detail (escalation, consent, message) as before. Bulk Take ownership and Assign… (with a
  required reason) confirm with the list of items; nothing is resolved, dismissed, activated or
  released in bulk. Keyboard: J/K or arrows, Enter, Esc, T, A, R, ?; never while typing.

## Household record

Coordination Record v2 (decision 58; `src/components/staff/record.tsx`, `services/record.ts`).
A pinned header (patient, stage, care team with any cover and its end time, offered handoffs,
enrolment date, 24-hour line, open-item count) and tabs: Overview, Messages, Updates, Tasks,
Vault, Authority & consent, Packets, Internal notes, Lifecycle, Audit.

- **Overview** is the unified timeline beside a fixed context column. Each timeline row has the
  exact time, who and their role at the time, a source badge (Family, Partner · simulated,
  System, Prepared with Copilot), one line and a link to the record. Filters by kind; 50 at a
  time.
- **Context column**, grouped by the questions the record answers: What's waiting and who owns it
  (the household's open exceptions, each with its owner, and Take ownership), Who is involved
  (household members and how to reach them, then the care team with cover and assignment history),
  What has been agreed (consents by organization, and authority workflows), What has been shared
  (outside access with its end time and whether it was opened), and care-plan context with the EHR
  pointer (text only). Below 1024px it stacks under the timeline, with what's waiting first.
- **Log a partner event** (decision 60): assigned or covering care guides and operations
  (`partner_event.log`). Staff-entered, labelled simulated, on this timeline only.
- **Who can see what** (`/staff/households/:id/access`, `services/access-map.ts`): generated from
  the permission matrix, the protected-access rule, item audiences, cover end times and recipient
  access. Each cell opens to say why. Administrators can't open it.

Consents are cards. `/staff/households/:id/consents/:consentId` opens the right tab and highlights
the consent; access is decided by the household's own checks.

## Prepared content (no AI)

Decision 58, workstream 5 (`services/prepared.ts`). No model is connected.

- **Catch me up** (household header): a short summary assembled by fixed rules from what the
  person can already open: stage and latest care-team change, what's open and waiting, the last
  contact each way, the latest outside news (simulated), and what's shared outside. Every line
  links to the recorded events it comes from, and says when it was prepared. It never uses
  message, note or private-note text, and administrators can't open it. Opening it is recorded
  (`summary.prepared`, with the source event IDs).
- **Prepared drafts** are synthetic examples for named demo moments, offered only while a demo
  snapshot is loaded: a reply to the Okafor household, a handoff note for cover, and a minimal
  packet manifest. Each is labelled "Prepared with Copilot · synthetic example"; a person chooses
  to use it, edits it, and sends it. The audit event keeps the person as the actor and adds
  "Prepared with Copilot".
- **The same three lines on every prepared item:** Used (for drafts: "Nothing from the record",
  since they're fixed examples; for Catch me up: how many recorded events it cites), Suggests, and
  You approve (what using it commits you to, and what it doesn't).

## Coverage and handoffs

Decisions 58–61 (`services/coverage.ts`, `components/staff/coverage.tsx`). On Team & coverage,
operations record a care guide's planned absence (dates and a reason without health details) and
offer cover for each of their households to another guide, or hand a household over permanently
from its care team card. Nothing changes until the receiving guide accepts on My work, where they
see only the household's name, the dates, who offered it and the note. Accepted cover is a
care-guide membership with exact start and end times, shown as Temporary in "Who can see what",
and it ends by itself. A guide may decline with a reason; operations see it on the board and as a
Stalled handoff exception. When cover becomes active, and not before, the system posts one update
to the household's coordinator, proxies with an active authority workflow and the patient, and
their Home names the covering guide until the end (decision 62). It's posted on the first load
after the start, once per cover, and recorded as "Cover notice posted to the household" (System).

## Operations

Hospice settings (reply time and wording, 24-hour line, email sender name; code defaults shown
read-only; every change audit-logged with before and after), Team & coverage (caseload bars,
households without a guide, reassign, invitations and deactivation), Reports (date range, tiles
against the previous period, single-series charts with a table view; counts only, including
prepared work: Catch me up opened and prepared drafts used, each linking to Audit review filtered
to Prepared), Audit review
(who, kind, household, source, period, free-text search; CSV export honours all of them). Source
covers staff, family, recipient, simulated partner, system and rule, plus "Prepared with Copilot"
and "Two-person approvals"; an event's detail shows its role at the time, its source and, for
two-person actions, who requested and who approved. Each item in Exceptions › Resolved links to
the event that closed it, open in Audit review. Access that ends by time (cover, recipient
access) is recorded by the system on the first workspace load after it ends.

Screenshots of the enterprise demo week (`e2e-verify/enterprise-shots.spec.ts`,
`ENTERPRISE_SHOTS=1`) are in `docs/review-screenshots/enterprise/`.

## Interaction standards

Taking ownership is optimistic and rolls back on refusal; consequential actions (activate,
release, resolve, revoke) wait for the server and confirm first, restating what they act on.
Skeletons while a page first loads. Focus moves to the updated row, the panel or the toast's Undo,
never to the page body. Reduced motion is respected.

## Measurements (synthetic data, Dana Brooks, `e2e-verify/staff-shots.spec.ts`)

| Measure                                                                        | Before  | After           |
| ------------------------------------------------------------------------------ | ------- | --------------- |
| Queue rows fully visible at 1338×788, Comfortable                              | 2 of 17 | 11 of 17        |
| Queue rows fully visible at 1338×788, Compact (target 12+)                     | —       | 15 of 17        |
| Clicks from My work to own and resolve an escalation (target ≤3 plus the note) | —       | 3 plus the note |

## Not done as written

- **`staffShellV2` flag:** the brief asked for each step behind a flag, removed once verification
  passed. The rework replaced the old screens directly; before/after screenshots
  (`docs/review-screenshots/staff-before|after`) are the comparison instead.
