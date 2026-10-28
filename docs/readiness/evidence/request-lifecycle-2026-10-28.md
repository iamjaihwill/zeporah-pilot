# Evidence: request lifecycle (increment 8, decisions 79–83), 2026-10-28

**Status: verified in synthetic testing.** Resolves the request-model question (§3 item 5 in
[brief-reconciliation-2026-10-27.md](../../brief-reconciliation-2026-10-27.md)): tasks, escalations
and exceptions keep their own models, and family support requests gain shared states.

## What was built

| Decision | Behaviour                                                                                                                                                                                                                                                                                        | Where                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 79       | Align, don't merge. A family request stays an escalation; new fields sit alongside its status (`open`, `acknowledged`, `resolved`), so every existing check of that status still holds. A withdrawn request is `resolved` with `closedReason` "withdrawn".                                       | migration `0031_request_lifecycle`; `src/domain/request-lifecycle.ts`                                  |
| 80       | The family sees Received → With <first name> → Waiting on you / Waiting on someone else → Resolved (or Withdrawn), each with a one-line explanation. "Someone else" names only the kind of party ("the benefits office"), which the owner is told never to make a clinical reason.               | `familyRequestState`, `familyRequestLabel`; "Your requests" on the family Support page                 |
| 81       | The sender withdraws while it's open (another household member can't), and whoever owns or was offered it is notified. Within 7 days of a resolution the sender reopens it with a reason, back to the person who resolved it (unowned if they can no longer take it); after that, a new request. | `withdrawRequest`, `reopenRequest` in `src/server/services/requests.ts`                                |
| 82       | The owner sets "the family will next hear by" (required to mark it waiting; in the future, within 14 days). The family sees it with "about the request, not about care". Once it passes, the queue row reads "Update overdue", priority Now, for the owner and operations.                       | `setRequestProgress`, `checkNextUpdate`; the escalation row in `coordinationQueue`                     |
| 83       | "Give" now offers: the current owner keeps it until the offered person accepts or declines (with a reason). Taking or resolving it settles a pending offer. An offer not accepted within the hospice's handoff-accept hours is a "Stalled handoff" exception for operations.                     | `giveEscalation` (staff.ts); `acceptEscalationOffer`, `declineEscalationOffer`; the stalled-offer rule |

Screens: on the staff exception detail, "Where it stands (the family sees this)" for the owner of a
family request, and "This was offered to you" with Accept and Decline; "Offer to…" replaces
"Assign to…". On the family Support page, each request shows its state, its explanation, the
next-update time, and Withdraw… or Reopen… where they apply.

Audit: `request.withdrawn` and `request.reopened` are family-visible; `request.waiting`,
`request.next_update`, `escalation.offered`, `escalation.offer_accepted` and
`escalation.offer_declined` are staff-only (a decline's reason is kept in the entry's context, not
its summary). Notification titles name no person or household.

## Tests

`tests/integration/request-lifecycle.test.ts`: 12 of 12.

- The family's words follow each step, with the owner's first name and the kind of party; the queue
  row says the same; resolving clears waiting and the next update. Only the owner changes them.
- Only the sender withdraws; the owner is notified; the row leaves the queue; a withdrawn request
  can't be withdrawn again or reopened.
- Reopening needs a reason, goes back to the same owner, and is refused after 7 days.
- A next update is required to mark it waiting and must be in the future and within 14 days. Once it
  passes, the owner and operations see "Update overdue" at priority Now; a new time clears it.
- An offer leaves the owner in place until accepted (only the offered person can accept); a decline
  needs a reason and is staff-only; an offer unaccepted after 24 hours is a stalled exception for
  operations and not for care guides; taking the request settles the offer.
- Withdraw is in the household's activity, waiting isn't; the audit chain checks clean.

Updated for the new "Give": `handoff.test.ts`, `notifications.test.ts` and
`staff-workspace.test.ts`.

Unit and integration suites: 599 of 601, run at 8:22 AM Eastern. The two failures are
`direction-refinements` tests about an absence that starts at 8 AM, and they fail on unchanged
`main` too. Until 9 AM the demo-week fixture takes yesterday at 9 AM as "now", so between 8 and 9 AM
that absence has already begun. This is a fixture timing issue, not part of this increment; both
tests passed in the previous increment's run, which was outside that hour. End-to-end
suites: not run (the test browser isn't installed on this computer).

**In the browser** (development server, synthetic data): Daniel sent a paperwork request ("Received",
with Withdraw…). Maya took it, marked it waiting on someone else, "the benefits office", with a next
update the following afternoon; the exception gained that due time and appeared under "Waiting on
partner". Daniel's page then read "Waiting on someone else: the benefits office", "Maya is waiting
to hear back from someone outside your household", and the next-update time. Daniel withdrew it, and
it read "Withdrawn".

## Limits

- **Taking from the queue's inline button** sets no next-update time; the row's next step then reads
  "Say when the family will next hear" until the owner sets one on the detail.
- **"Update overdue" is computed when the queue loads.** Nothing is sent when the time passes; no
  background job runs.
- **The "someone else" label is free text** limited to 60 characters; it can't stop someone from
  typing a clinical detail, only tell them not to.
- **Reopening goes back to the person who resolved it**, which may differ from the earlier owner if
  someone took it over to resolve it.
