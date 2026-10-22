# Synthetic data and scenarios

Everything here is invented. Source: [src/fixtures/synthetic.ts](../src/fixtures/synthetic.ts). Times are relative to when the data is seeded, so “expired” stays expired and “active” stays active. Reset any time with **Reset synthetic data** on the start page, or `bun run db:reset` with the server stopped.

## Organizations

| Tenant     | Organization                         | Purpose                                               |
| ---------- | ------------------------------------ | ----------------------------------------------------- |
| `t-willow` | Willow Creek Hospice (synthetic), GA | The pilot hospice                                     |
| `t-cedar`  | Cedar Valley Hospice (synthetic), GA | A second hospice, used only to prove tenant isolation |

## Personas on the sign-in page

| Persona          | Role                                           | Use them to see                                                                                                                             |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Marisol Rivera   | Coordinator, Rivera household                  | Onboarding from the start, and the dashboard reacting to it                                                                                 |
| Daniel Okafor    | Coordinator, Okafor household                  | A household in progress: tasks, updates, thread, vault (standard items only)                                                                |
| Grace Okafor     | Patient, Okafor household                      | Confirming a consent that names her; withdrawing one she gave                                                                               |
| Ada Okafor       | Proxy with an active healthcare-agent workflow | Protected vault items — and losing them at bereavement                                                                                      |
| Chidi Okafor     | Family member                                  | What a family member doesn't see (vault, thread, consents); a named grantor who can't confirm in the app, so the consent is held for review |
| Ingrid Lindqvist | Coordinator, Lindqvist household (bereavement) | Continuity after a death                                                                                                                    |
| Claire Bennett   | Coordinator, Bennett household                 | A household whose healthcare-agent records conflict (sharing held); asking a helper to do one task                                          |
| Ravi Patel       | Patient, Patel household                       | Asking for a consent correction, and nothing being shared under it meanwhile                                                                |
| Jamie Park       | Helper (task-only), Bennett household          | A neighbor who sees one task and nothing else in the household (decision 42)                                                                |
| Maya Chen        | Care guide (Rivera, Okafor, Bennett, Hart)     | Queue, family-visible updates vs internal notes, insufficient role at release                                                               |
| Tomás Alvarez    | Care guide (Patel, Lindqvist)                  | Authority evidence versions                                                                                                                 |
| Sofia Reyes      | Care guide (Hart, shared with Maya)            | Care-team tasks handed between two guides on one household (decision 40)                                                                    |
| Dana Brooks      | Hospice operations                             | Releasing packets; confirming bereavement; the pilot operations view                                                                        |
| Priya Raman      | Authority/consent reviewer                     | Reviewing authority evidence and conflicts; linking record holders to household people; activating consent recorded by someone else         |
| Lena Hoffman     | Hospice administrator                          | Roles, organization controls and coverage, without opening household records (decision 39)                                                  |
| Rosa Lin         | Packet recipient at Brightwater                | Reading a released packet (`pk-okafor-intake`), acknowledging it or asking a question; the respite packet stays a draft until released      |
| Jordan Ellis     | Operations at Cedar Valley                     | Wrong-tenant denial                                                                                                                         |

Seeded times fall on the quarter hour (past times round down, future times up), so they read like a real schedule. The Rivera household has a welcome message from Maya it can read before setup; replying waits for the communication step.

## Consent and identity data

Every seeded consent is version 1, was recorded by the household's care guide (Maya for Okafor, Bennett and Hart; Tomás for Patel, Nguyen and Lindqvist), confirmed in the app by its named grantor an hour before it started, and — unless it's a draft — activated by Priya, a different person. Every seeded authority record is linked to the household person it names, with the basis "named in the submitted evidence". No seeded consent or record starts out unconfirmed or unlinked; the tests create those situations.

**Care-guide assignments.** Maya and Tomás's household assignments are seeded as active care-guide memberships with matching `assignment.created` audit events. **Nguyen has no care guide:** Tomás's assignment there ended two days ago ("Caseload rebalanced…"), so the households list shows "Not assigned" and operations can demonstrate assigning one. His earlier records on Nguyen stay attributed to him.

## Demo states for review workflows

These are seeded so each workflow can be seen without setting it up first. None of them changes a release scenario below: each sits behind a gate that's already decided earlier, or in a household with no packets.

| Where         | State                                                                                                                                                                                                                                                                            | Where to see it                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Okafor        | A consent naming **Chidi** for Maplewood Library Homebound Service. Chidi is a family member without an authority workflow, so he can't confirm in the app: it's held for review, with a `consent_review` escalation                                                             | Chidi → **Consents for you**; Maya → Okafor → Authority & sharing (with the staff warning); Grace and Daniel see it on Sharing |
| Patel         | An open **correction request** from Ravi, the consent's named grantor, on the chaplain consent (the dates), with his own words visible to the care team only. Release under that consent is held — though `pk-patel-chaplain` still stops earlier, at `AUTHORITY_REVIEW_PENDING` | Ravi → Sharing; Tomás or Priya → Patel → Authority & sharing; the queue's **Consent correction** filter                        |
| Rivera        | An authority record signed only "E. Rivera" and **not linked** to a household person: identity unresolved, with an `identity_review` escalation                                                                                                                                  | Priya → queue (high priority) → Rivera → Authority & sharing, where it can be linked                                           |
| Willow Creek  | **Routine-message wording**, versions 1 and 2, set by Dana (neutral, with no reply times)                                                                                                                                                                                        | Dana → **Hospice settings** (with history); families → Updates & messages and Support                                          |
| Okafor        | A consent naming **Ada** at **version 2** (the end date changed after she confirmed version 1); it waits for her confirmation                                                                                                                                                    | Ada → Sharing or "Consents for you": "What changed in version 2: the end date"                                                 |
| Lindqvist     | A **dismissed correction request** from Ingrid on the bereavement circle consent; the staff reason is kept with the care team                                                                                                                                                    | Ingrid → Sharing: "reviewed … and made no change"; Tomás → Escalations (resolved list)                                         |
| Hart, Bennett | Audit history for the seeded escalations: June raised the Hart request and Maya took it; the Bennett conflict detection                                                                                                                                                          | The queue's last-action column; each household's audit timeline                                                                |
| Cedar Valley  | Wording set once (version 1), then turned off (version 2), so its families see no response expectation                                                                                                                                                                           | —                                                                                                                              |

| Household           | Set-up                                                                                                                                 | Release check for its packet(s)                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rivera              | Enrolled yesterday; setup not started                                                                                                  | —                                                                                                                                                                                                                                                        |
| Okafor              | Active; healthcare-agent workflow active (Ada); consent active for Brightwater Respite House                                           | `pk-okafor-respite` → **allow** (as operations), **deny `ROLE_NOT_PERMITTED`** (as a care guide), **deny `OUT_OF_SCOPE`** (as Cedar Valley). The policy board also shows an _evaluator-only_ `TENANT_MISMATCH` row, labelled as not what the app returns |
| Bennett             | Two healthcare-agent records naming Claire and Owen                                                                                    | `pk-bennett-equipment` → **hold `AUTHORITY_CONFLICT`**; escalation open                                                                                                                                                                                  |
| Patel               | Proxy designation, version 2 waiting for review (version 1 was illegible)                                                              | `pk-patel-chaplain` → **hold `AUTHORITY_REVIEW_PENDING`**                                                                                                                                                                                                |
| Nguyen              | Meals consent revoked by the patient; transport packet with no manifest                                                                | `pk-nguyen-meals` → **hold `CONSENT_REVOKED`**; `pk-nguyen-transport` → **hold `SCOPE_EMPTY`**                                                                                                                                                           |
| Hart                | Pharmacy packet past its expiry; benefits consent past its expiry                                                                      | `pk-hart-pharmacy` → **hold `PACKET_EXPIRED`**; `pk-hart-benefits` → **hold `CONSENT_EXPIRED`**                                                                                                                                                          |
| Lindqvist           | In bereavement for 12 days; healthcare-agent workflow superseded; personal-representative workflow active; surviving contact confirmed | `pk-lindqvist-circle` → already **released** (receipt on file)                                                                                                                                                                                           |
| Moss (Cedar Valley) | Another hospice's household                                                                                                            | Never visible to Willow Creek staff                                                                                                                                                                                                                      |

## Enterprise demo week (decision 58)

The development-only reset offers two extra snapshots of the Okafor household's week, on top of
the standard seed (`src/fixtures/demo-week.ts`, narrative in
[enterprise-demo-map.md](enterprise-demo-map.md)). The standard seed is unchanged and is what every
test uses. From a script: `ZEPORAH_SEED_SNAPSHOT=demo_midweek bun scripts/db-reset.ts`.

| Snapshot               | Today is                 | What's recorded                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo week: mid-week    | Day 4, from 9 AM Eastern | Maya's reply to Ada (prepared with Copilot, synthetic); the respite packet released to Rosa until Day 5, 6 PM; Maya's absence for Days 5–6; two simulated partner events (Oakwood's request, Brightwater's bed); "Respite stay: next steps" needing acknowledgement; the transport task due Day 5                                                   |
| Demo week: end of week | Day 7, from 9 AM Eastern | All of the above, plus Days 4–6: cover offered to Sofia (accepted) and Tomás (Bennett stalled, Rivera withdrawn); Maya reaching Daniel by phone; Ada confirming and Priya activating Oakwood version 2; Rosa opening and acknowledging; Sofia completing the task and letting the respite access end; the access and the cover ending by themselves |

Sofia's cover is recorded as ended, so she no longer sees the Okafor household in the end-of-week
snapshot. Times are wall-clock times on days counted back from the day you reset (from yesterday, if you reset
before 9 AM, so everything the story says has happened already has).

The Okafor coordination record carries a synthetic EHR pointer (`000-SYN-4411`) in every seed:
text only, never clinical content.

## Bereavement follow-up

Lindqvist's 13-month follow-up plan is seeded from its transition (`bt-lindqvist`, confirmed 12 days ago): the first check-in is due this week, the one-month check-in this month, and none are recorded yet. Any household confirmed into bereavement during a walkthrough gets its own plan. See [bereavement-programme.md](bereavement-programme.md).
