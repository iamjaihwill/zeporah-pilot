# D-16 · Delivery, retries and fallback (brief §14)

**Status:** brief, for the founder's decision. Related: D-06 (whether Stage 1 includes email at all),
D-02 (a hosting and email vendor with a BAA), decisions 23 and 47 (email nudges), increment 9
(offline status, decisions 84–87).

## Decision to make

How Zeporah sends anything that leaves the app (today, email only), what it does when a send fails,
and which fallbacks are allowed when the usual route doesn't work. Brief §14 asks for bounded
retries, permanent failures that become owned work, checks before every dispatch, and fallbacks
that never switch silently.

## Why it matters now

Nothing here sends to real people yet: the only channel is the development mailbox, which keeps
each email in a table (`dev_mailbox`) instead of delivering it, and only where development sign-in
is on. But the shape of sending is decided now, before a real channel exists, because a real one
fails in ways the mailbox never does, and the brief's rules ("a failed external alert does not make
the underlying message unsent", §12) are about that.

## What exists today

[Code]

- **Five places send email directly** through `mailChannel()`: notification nudges
  (`email-notices.ts`), password resets, a recipient's access alert (`recipient.ts`), packet and
  sharing emails (`sharing.ts`) and system messages (`system.ts`).
- **Nudges run on a timer in the server's memory** (`startEmailNoticeTimer`). A notification is
  marked emailed in the same transaction as the send.
- **A failed send isn't counted.** The transaction rolls back, the error is reported, and the next
  tick tries again: retries are unbounded, and no person is told.
- **Some sends sit inside the change they report.** In `recipient.ts` and `password-reset.ts` the
  email is sent in the same transaction as the change, so with a real channel a failed email would
  undo the change itself, the opposite of §12. The development mailbox can't fail, so this has
  never shown.
- **Content is already minimal:** nudges never include names, health details or message text
  (decision 23); links go to sign-in.
- **Fallback types in place:** contact presentation (the verified 24-hour line, decision 72, shown
  on every family page and in the offline banner); live handoff by people (staff record "reached by
  phone" on an unread critical update). No SMS, no automatic switching.

## Question 1: an outbox

| Option                                  | What it is                                                                                                                                                                                                                                   | For                                                                                                                              | Against                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **A. One durable outbox (recommended)** | Every outgoing email is written as a row in the same transaction as the change it reports, then a separate dispatcher sends it. The change never depends on the send. Built now against the development mailbox; no real channel until D-06. | Matches §11–12 ("commit … outbox consistently", "dispatch notifications separately"); one place for retries, checks and failures | A migration and a dispatcher; touches five senders           |
| B. Keep direct sending, add retries     | Each sender retries on its own                                                                                                                                                                                                               | Less change                                                                                                                      | Five sets of rules; a failed send still undoes a change      |
| C. Wait for D-06                        | Change nothing until email is approved                                                                                                                                                                                                       | No work now                                                                                                                      | The transaction problem is built into the first real channel |

## Question 2: retries and expiry

**Recommended:** at most **5 attempts** with growing gaps (1 min, 5 min, 30 min, 2 h, 8 h, so about
10 hours in all), then the send is a permanent failure. Each kind also has an **expiry**, after which
it isn't sent at all: a password reset when its link expires; a nudge or digest after 24 hours (the
in-app notification still holds it); an access alert never expires but is re-checked (question 4).
Alternatives: fewer attempts (3 over an hour), or retry until expiry with no count.

## Question 3: when a send fails for good

| Option                                                 | For                                                                                                                                                        | Against                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **A. An owned exception for operations (recommended)** | "Email not delivered": who it was for and what kind, never the content; operations decides what to do (call, check the address). Uses decision 58's model. | One more exception kind                     |
| B. Tell the person in the app only                     | No staff work                                                                                                                                              | They may never sign in; nobody owns it      |
| C. Record it in the audit log only                     | Least work                                                                                                                                                 | §14: "permanent failures become owned work" |

## Question 4: checks before every send

**Recommended, all of them, at send time rather than when queued:**

- **Still relevant:** a nudge whose notification was already read isn't sent.
- **Recipient still has access:** the same rule as in-app notifications; ended access drops it.
- **Channel allowed:** the person's own settings (opt-in, quiet hours, daily summary, decision 47).
- **Payload allowed:** subject and body from fixed wording only; a check refuses anything else.
- **Not expired, not a duplicate:** one send per outbox row, by its ID.

A dropped send is recorded (why, never the content), not retried.

## Question 5: fallbacks

The brief's four fallback types, and what Stage 1 allows:

| Type                                | Recommended for Stage 1                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Contact presentation                | **Yes**, as now: the verified 24-hour line on family pages, offline, and on the "Couldn't reach" page's wording |
| Minimal notification                | **Yes, email only, if D-06 allows email**: content-free, as decision 23. No SMS                                 |
| Approved protected-content transfer | **No**: no fallback ever carries protected content; packets stay in-app (decision 45)                           |
| Live handoff                        | **Yes, by people**: a staff member calls, prompted by the exception in question 3                               |

**Switching between them only by a person, never automatically.** If email fails, nothing tries
SMS or another address on its own.

## Impact

- **People:** no change while only the development mailbox exists, except that a failed send now
  reaches a person instead of looping.
- **Schema:** an `outbox` table (kind, recipient, fixed-wording reference, attempts, next attempt,
  expiry, state, reason) and a migration; `dev_mailbox` stays as the development channel.
- **Code:** the five senders write to the outbox; one dispatcher replaces the timer's direct sends.
  The server-memory timer is still the dispatcher's clock until hosting (increment 10) gives a
  scheduler; the rows survive a restart either way.
- **Frozen files:** most of the senders are frozen, so building needs a freeze lift.

## Default if no decision is made

Sending stays as it is: unbounded silent retries, and sends inside the changes they report. That's
harmless only while the development mailbox is the only channel, and must change before any real
one (D-06).

## Exactly what the choice unlocks

An increment: the outbox table and migration, the dispatcher with bounded retries and expiry, the
pre-send checks, the "Email not delivered" exception, the five senders moved over, and tests
(including a channel that fails on purpose).
