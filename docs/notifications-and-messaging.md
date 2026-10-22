# Notifications and messaging: delivery, routing and visibility rules

How Zeporah tells people that something changed, and how household messages work. All data is synthetic. Nothing leaves the app: the one email channel goes to a development mail sink.

## Channels

| Channel                | Status                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-app notifications   | Built. Each person's list is under **Notifications**, with an unread count in the navigation.                                                                                                                                                                                                  |
| Email (family, opt-in) | **Built against the development mail sink only** (founder decision 23). See [Email nudges](#email-nudges-founder-decision-23). No email provider is connected (decision 18), so outside development the option isn't shown and the settings keep [`OUT_OF_APP_NOTE`](../src/domain/claims.ts). |
| SMS, push, phone       | **Not built**, and SMS is out of the pilot (decision 23). "How should your care guide reach you?" is a contact preference shown to the care guide; Zeporah doesn't call or text.                                                                                                               |

## Email nudges (founder decision 23)

- **Opt-in, off by default.** A family member turns it on under Settings → Notifications ("Email me when there's something new"). It's offered only where a mail channel exists ([mail.ts](../src/server/mail.ts)): today, a development server with development sign-in on.
- **One generic email.** Subject "You have a new update in Zeporah", fixed body, link to `/family/notifications`. It never includes names, health details or message text. The in-app notification is unchanged.
- **Follows the person's settings.** Nothing goes out during their quiet hours (in the pilot's display zone, US Eastern). Equal start and end means no quiet hours. "A daily summary" sends at most one email a day. "Only essentials" sends only for things to act on: consent, acknowledgement, task and authority notifications.
- **Covers each notification once.** Turning email on doesn't email about notifications that already existed. A notification already read in the app isn't emailed. Notifications about households the person can no longer see aren't emailed.
- **Recorded.** Each email writes `notification.emailed` (staff-visible, with no content). Turning it on or off writes `communication.email_on` / `communication.email_off`.
- **Delivery.** In development the server checks once a minute. The development mail page (`/dev/mail`) shows the sink and can send due emails at once.

## Content rule

A notification says only that **something changed** and where to look, for example "A sharing consent names you".

- **Fixed wording.** Titles are fixed text. They never include a person's name, a household name, health details or message text. The notification list states this to people, and `tests/unit/notification-policy.test.ts` checks every `notify(…)` call in the services (no interpolated titles).
- **In-app links only.** Every link is an in-app path under `/family` or `/staff`, checked by the same test. Opening a link runs the page's normal authorization, so a notification never grants access by itself.

## Routing: who is notified

Each service decides recipients from roles and scope at the moment of the change, using the shared helpers ([common.ts](../src/server/services/common.ts) `notify`, `careGuidesFor`, `householdMembers`, `membersWho`, `staffWithRole`). Examples:

| Event                                                   | Recipients                                                |
| ------------------------------------------------------- | --------------------------------------------------------- |
| Family message                                          | The household's current care guides                       |
| Care-team update or message                             | Household members whose role can read updates or messages |
| Consent needing confirmation                            | The named grantor only                                    |
| Consent ready to activate, correction requested         | Authority/consent reviewers                               |
| Bereavement transition to confirm                       | Hospice operations                                        |
| Handoff (reassignment with hand-over, escalation given) | The new owner only                                        |

The person who caused the change isn't notified about it.

## Visibility follows current access

People see notifications only about households they can see **right now**:

- **Staff** follow the shared rule (`staffSeesHousehold`). When a care-guide assignment ends, that household's notifications drop out of their list and their unread count.
- **Family members** follow their current household membership. When a membership ends, that household's notifications drop out too.

Notifications not tied to a household are always shown. Nothing is deleted; access simply decides what's shown. Deactivated staff can't sign in at all. Covered by `tests/integration/notifications.test.ts` and `tests/integration/assignment.test.ts`.

## Read state

- Opening a notification marks it read; **Mark all as read** affects only the caller's own notifications.
- There are no read receipts on messages: families aren't told when a care guide has read a message, and staff aren't told when a family member has. See the founder decision below.

## Messages

- Each household has one care-guide thread. The page says who can read it.
- Internal staff notes are a separate record and are never visible to families.
- Message threads have no personal owner. Unanswered family messages show the household's **current** care guides as owner, so a change of care guide needs no handoff ([authentication-and-access.md](authentication-and-access.md#handoffs-no-hidden-broken-ownership)).
- Messages are for routine coordination. The thread and the start page say Zeporah isn't for emergencies.

## Attachments

**None.** Messages carry text only. The vault stores document **metadata and review status**, never the files themselves. Accepting files would need malware scanning, encrypted storage, retention and deletion rules, and size limits. That is a production gate.

## Founder decisions (approved 2026-10-12; see the [decision log](founder-decision-log.md))

| Decision                         | Approved                                                                                                                                                | Alternatives considered                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read receipts on messages        | None                                                                                                                                                    | Show "seen by the care team" to families, or "seen" to staff. Helpful for reassurance, but it creates expectations of response times and reveals activity patterns. |
| Attachments in messages          | None (text only)                                                                                                                                        | Governed attachments with scanning and retention, or links to the vault. Needs storage, security and retention review first.                                        |
| Applying cadence and quiet hours | Saved, not applied (in-app shows immediately) — **amended by decision 23 (2026-10-13)**: applied to opt-in email nudges; in-app still shows immediately | Apply quiet hours to a future out-of-app channel only. In-app should probably always show immediately.                                                              |

## Expected reply time (founder decision 24)

Each hospice sets its own expected reply time in Hospice settings. It's required whenever the hospice saves wording about routine messages, and it's versioned with that wording. Families see "Your care team usually replies {reply time}." beside the message box and on Support. If a hospice hasn't set one (or has turned its wording off), families see the fixed sentence "Your care team reads messages during business hours. For anything urgent, call {24-hour line}." There's no app-wide reply time. Willow Creek (synthetic) is seeded with "within 1 business day"; Cedar Valley has none. Until a hospice sets one, its operations users see "Required: set your expected reply time" on the staff dashboard and in Hospice settings (decision 29b).

After a support request, families see: "Your request was sent to your care team. A person will decide how to follow up. If it's urgent, call {24-hour line}." The hospice's reply time is added when it's set (decision 26).
