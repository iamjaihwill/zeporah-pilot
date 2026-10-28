# Authentication, invitations and access boundaries

**Status: local development identity for the synthetic prototype.** This is not production identity. It has no MFA, SSO, device management or external identity provider, and no real email delivery (family password-reset email goes to the development mail sink only). Those remain production gates ([production-readiness-gates.md](production-readiness-gates.md)). All data is synthetic.

## Accounts and sessions

| Piece            | Where                                                         | What it does                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account          | `users`                                                       | One per actor. It holds a lower-case email (unique) and a password hash, plus failed-attempt and lock fields. Staff and family accounts are both `users` rows; the actor's `kind` says which.                                                                                                                                                                             |
| Password hashing | [src/server/auth/crypto.ts](../src/server/auth/crypto.ts)     | scrypt (N=2¹⁷, r=8, p=1, 64-byte key, 16-byte random salt), stored as `scrypt$N$r$p$salt$hash`. Comparison is constant-time. Passwords must be 12–200 characters. Plain-text passwords are never stored or logged.                                                                                                                                                        |
| Sign-in          | `auth.signInWithPassword`                                     | An unknown email, a wrong password and a locked account all return the same message. Unknown emails are checked against a dummy hash, so timing doesn't reveal which emails have accounts. 10 consecutive failures lock the account for 15 minutes; the lock is audited (`auth.locked`).                                                                                  |
| Session          | `sessions`, [src/server/session.ts](../src/server/session.ts) | The browser cookie `zp_session` (HTTP-only, SameSite=Lax, `Secure` in production, 12 hours) carries a random 32-byte token. The database stores only its SHA-256. A password session must still match its account (same actor and tenant) on every request. Each sign-in replaces any earlier session in that browser. Sign-out deletes the row. Both events are audited. |
| Route protection | [src/lib/client.ts](../src/lib/client.ts), `requireActor`     | Every server function rebuilds the actor's context from the session. Nothing in the request identifies the caller. A signed-out visitor is sent to the sign-in page.                                                                                                                                                                                                      |

The structure is ready for magic links: sessions record a `method`, and invitations already use one-time hashed tokens. No magic-link sign-in exists.

## Invitations

|                 | Staff                                                                                                                      | Family                                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who can invite  | People whose role includes `staff.invite` (hospice operations only), from **Hospice settings → Invite a care-team member** | Household coordinators (`people.invite`), from **People** or onboarding; operations or the household's care guide for the patient and one coordinator (decisions 67–68), from **Getting started** |
| Boundary joined | The inviter's own organization                                                                                             | The inviter's own household                                                                                                                                                                       |
| Roles offered   | Care guide, hospice operations, authority/consent reviewer                                                                 | Family member, proxy (by coordinators); patient, coordinator (by staff, with how identity was confirmed)                                                                                          |
| Table           | `staff_invitations`                                                                                                        | `invitations`                                                                                                                                                                                     |

The rules are the same for both kinds:

- **One-time link, shown once.** The prototype sends no email. The inviter sees `/invite/<token>` once and passes it on. Only the token's SHA-256 is stored.
- **Expiry.** A link expires after 7 days and can be cancelled while pending. It is single use: acceptance is a conditional `pending → accepted` update, so two simultaneous acceptances produce one account.
- **No escalation by editing the request.** The accept request carries only `{ token, displayName, password }`. The tenant, organization or household, and the role, all come from the stored invitation. Database CHECK constraints keep staff roles on staff invitations and household roles on household invitations.
- **One generic refusal.** An unknown, used, expired or cancelled link shows the same page and message, so link validity isn't revealed.
- **Before joining**, the page shows the hospice name, the role, the inviter's first name and the invited email. The household's name is shown only after joining.
- **Account handling on accept:**
  - _No account for that email_ → create one: a name, then a password entered twice.
  - _Existing account_ → that account's own password is required, under the normal lockout rules.
  - The account must be in the same tenant and of the same kind (staff or family).
  - In this pilot, a family account belongs to one household.
- **Atomic and audited.** Account creation, invitation use and membership succeed or fail together. The acceptance is audited (`invitation.accepted`, with the role and whether an existing account was linked) in the tenant's hash-chained audit log, as is invitation creation and cancellation.

## Access boundaries after joining

Authorization is unchanged and is enforced in services ([authorization-and-packet-policy.md](authorization-and-packet-policy.md)):

- **Staff** see only their organization's households, in their own tenant. Care guides see only households assigned to them.
  - A newly invited care guide sees no households, and an explicit "You aren't assigned to any households yet" message, until hospice operations assigns them (see [Care-guide assignment](#care-guide-assignment)).
  - A household outside scope gets the same refusal whether or not it exists. The refusal is audited as `access.denied`.
- **Family members** see only their own household, through their household role. The staff workspace sends them back to the family app.
- **Restricted named-grantor access** (for example Chidi and **Consents for you**) is unchanged. It is granted by being named on a consent, not by any account setting.

## Care-guide assignment

Hospice operations (`staff.assignment.manage`) assigns care guides to households from the household's **Overview → Care team** panel, and can end an assignment there. The households list has a **Care guide** column, so operations can spot "Not assigned". **Team & coverage** (`/staff/team`, operations only) shows:

- every active care guide with their household count and list;
- households with no care guide, each with an assign control;
- staff who see the whole hospice by role;
- assignments still held by someone who is no longer an active care guide, to end or reassign.

**Reassign** ends one assignment and starts another in a single transaction, with a required reason.

| Rule                    | How                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data                    | An assignment is an active `memberships` row with a staff actor, a household and the role `care_guide`. There is no separate table. Only care-guide rows count as assignments (`loadContext`, `careGuidesFor`).                                                                                        |
| Who can be assigned     | Only active care guides of the caller's own organization and tenant. Operations and reviewers already see their whole organization by role, so they are never assigned. A household may have several care guides; there is no "primary".                                                               |
| Where                   | Households in the caller's scope that aren't closed. A household outside scope gets the same refusal as a missing one.                                                                                                                                                                                 |
| One governed write path | [services/assignments.ts](../src/server/services/assignments.ts): `assignCareGuide`, `endAssignment` and `reassignCareGuide`, built from the same shared steps. A duplicate is a calm conflict. A partial unique index on active rows stops two simultaneous requests from creating a second row.      |
| Ending                  | A conditional `active → ended` update records `ended_at` and a required, staff-only `end_reason` (CHECK-enforced). The row is never deleted. Open escalations in that household owned by the departing guide go back to open with no owner (the queue shows "No owner assigned" and "Take ownership"). |
| Effect                  | Immediate. Context is rebuilt on every request, so the guide loses the household, its queue items, packets, escalations and notifications on their next page load. Their past notes and messages stay on the record for others.                                                                        |
| Audit                   | `assignment.created`, `assignment.ended` (with the reason) and `escalation.owner_released`, all staff-visible on the household's timeline in the hash-chained log.                                                                                                                                     |
| Visibility rule         | One helper, `staffSeesHousehold` / `staffVisibleHouseholds` in [context.ts](../src/server/context.ts), used by `staffScope` and every staff list.                                                                                                                                                      |

Families aren't notified when their care guide changes; the care team they see simply follows the current assignment.

## Handoffs: no hidden broken ownership

When someone stops covering a household, nothing they owned there is left pointing at a person who can no longer see it.

| Situation                                  | Escalations they own there                                               | Open care-team tasks assigned to them there     | Message threads                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Assignment ends                            | Released: open, "No owner assigned" (`escalation.owner_released`)        | Unassigned (`task.unassigned`)                  | Threads have no personal owner. Unanswered family messages always show the household's **current** care guides as owner. |
| Reassign, **hand-over unticked** (default) | Released                                                                 | Unassigned                                      | Same                                                                                                                     |
| Reassign, **hand-over ticked**             | Moved to the new care guide (`escalation.owner_transferred`)             | Moved to the new care guide (`task.reassigned`) | Same. The new guide gets an in-app notification.                                                                         |
| Role leaves care guide / deactivation      | Released (deactivation releases every open escalation they own anywhere) | Unassigned                                      | Same                                                                                                                     |

Operations can also **give** any open escalation to a named person from **Escalations** (`escalation.owner_assigned`, with an in-app notification). The list offers only people who:

- are active and not deactivated;
- belong to this hospice;
- can see that household under the usual rule;
- have a role that handles escalations.

Care guides see no give-to control.

## Household members (managed by the household)

On **People**, someone whose role can invite (the coordinator, or the patient) can:

- change another member between **Family member** and **Proxy**;
- **remove** them from the household.

See [services/household-admin.ts](../src/server/services/household-admin.ts).

| Rule        | How                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not covered | Patient and coordinator roles, and changing yourself. Those go through the care team.                                                                                                                                                                                                                                                     |
| Held back   | A change is refused, and the page says why in plain words, while the person is named as giving consent on a live consent or is linked to an authority record. Consent and authority never change as a side effect.                                                                                                                        |
| Removal     | Ends their membership and unassigns their open household tasks. It notifies them ("Your access to a household changed", with no household named) and the care guides. It's audited (`household.member_removed`; no reason is asked or stored). Their account remains; an invitation to the same email links it again with their password. |
| Role change | Ends the old membership row and starts the new one, audited (`household.member_role_changed`), and notifies the person.                                                                                                                                                                                                                   |

**Account recovery (founder decision 9, reopened for family accounts by decision 27, [log](founder-decision-log.md)).**

- **Family accounts** (not proxies) can reset by email from "Forgot password?":
  - a single-use link that expires after 30 minutes; only its SHA-256 is stored, and asking again replaces the earlier link;
  - the same confirmation whether or not the email belongs to an account that can reset;
  - setting the new password signs the person out of every session and clears any sign-in pause;
  - both steps are audit-logged (`auth.reset_requested`, `auth.password_reset`).
  - only accounts whose email was proven by accepting an invitation sent to that exact address (decision 29e);
  - afterwards the account gets a "Your Zeporah password was changed. If this wasn't you, tell your care team." email, and the household's care guides get an in-app notification that names no one (decision 29d).

  Code: [password-reset.ts](../src/server/services/password-reset.ts).

- **Proxies and care-team accounts stay invite-only** (decision 9's reason, conservative identity handling, still applies). Their care team invites them again.
- **Where there's no mail channel** (anywhere but a development server with development sign-in on, until an email provider passes decision 18's gates), "Forgot password?" only explains the invitation path (decision 20).
- **An email link proves control of the inbox, not identity.** Decision 9's revisit condition, a recovery model with identity proofing, still isn't met (see the tensions listed under decision 27).

## Staff lifecycle

From **Team & coverage**, operations opens a person (`/staff/team/<id>`). The page shows:

- what they cover: assigned households, open escalations they own, and open care-team tasks assigned to them;
- their role history.

With `staff.lifecycle.manage` (hospice operations only), operations can do two things. Each change is one audited transaction, needs a staff-only reason, and shows its impact before you confirm. See [services/team.ts](../src/server/services/team.ts).

| Action                                | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Change role** (one role per person) | The old organization role ends and the new one starts (`staff.role_changed`). Leaving the care-guide role ends every household assignment, so no stale assignment is left, and releases escalations owned in those households. Access follows on the person's next request.                                                                                                                                                                                                                   |
| **Deactivate**                        | Done in this order: (1) set `actors.deactivated_at`; (2) end every household assignment, then the organization role; (3) release every open escalation they own to "No owner assigned"; (4) unassign their open care-team tasks (`task.unassigned`); (5) delete their sessions; (6) audit `staff.deactivated`. From then on, `loadContext` refuses them (any session, including a development persona's) and password sign-in returns the usual generic message. Nothing they did is deleted. |

**Guards:**

- No one can change their own role or account.
- The last active hospice-operations lead can't be moved or deactivated.
- A person outside the caller's organization gets the same refusal as one who doesn't exist.
- The database allows deactivation only on staff actors (CHECK).

**Not built:** reactivation; transferring ownership to a named person (it's released for someone to take); family account deactivation.

## Development-only shortcuts (isolated from production paths)

| Shortcut                        | Gate                                                                                                      | Notes                                                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persona sign-in on `/`          | `ZEPORAH_DEV_SIGN_IN=1` **and** `NODE_ENV` ≠ `production` ([dev-gate.ts](../src/server/auth/dev-gate.ts)) | Seeded personas have no passwords. Persona sessions are marked `development_persona` and are refused on every request when the gate is off, including sessions created while it was on. |
| **Reset synthetic data** on `/` | Same gate                                                                                                 | Resets the local development database to the current synthetic seed. Do not use it against any non-synthetic environment.                                                               |

`bun run dev` and the Playwright test server set the gate. A server started without it offers only password sign-in and invitation links.

## Not built (out of scope for this increment)

Recovery for proxies and staff, real email delivery, MFA, SSO or social sign-in, device and session management screens, an admin console, bulk or "primary" care-guide assignment, assignment for roles other than care guide, and moving an account between households or tenants.
