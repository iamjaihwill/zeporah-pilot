# Zeporah: Durable Product Context and the Hospice-First Pivot

> Source: product owner, 2026-10-11. This is the standing product context for all Zeporah work unless a later, explicit instruction overrides it. The founder retains product-policy approval.

## What Zeporah is

Zeporah is a hospice-first family coordination platform.

Its purpose is to give patients, families, and hospice care teams one calm, role-aware workspace for understanding what is next, coordinating approved tasks and updates, reducing repeated history-taking, and maintaining continuity through serious illness, death, and the first year of bereavement.

Shorthand product vision: **“An understandable coordination layer for the end-of-life journey.”**

Do not position Zeporah as merely a document vault, a funeral-planning product, or a generic family messaging application. The product is a coordinated experience that helps a household and care team move through a difficult, time-sensitive life transition with less fragmentation.

## Product journey

Zeporah supports an individual and their household across six connected phases:

1. Family onboarding, household roles, consent, preferences, and permissions
2. Serious illness and hospice-care preparation
3. Family coordination, updates, tasks, documents, and care-team communication
4. Caregiver overwhelm, compassionate pause, and human-support escalation
5. Immediate post-death guidance and funeral-period coordination
6. First-year bereavement, practical administration, benefits, estate-related tasks, and life continuity

The product should feel continuous across these phases. It must not behave like six disconnected tools.

## The pivot

Zeporah pivoted from a broad, “build every capability at once” end-of-life platform concept to a deliberately narrow, hospice-led coordination pilot.

The first product is **not**: a universal death-planning platform; a full EHR replacement; a clinical documentation system; a legal-tech product that determines authority; a broad consumer marketplace; a funeral-home automation platform; an estate-administration system; a generic chatbot; or a product that tries to solve every end-of-life problem in version one.

The first product **is**:

- A hospice-configured household coordination workspace
- A family-facing experience for understanding next steps, assigned tasks, approved updates, and available support
- A staff-facing care-guide workspace for reducing repeated calls and fragmented information
- A controlled workflow for authority evidence, consent state, and minimum-necessary information sharing
- A bridge between family coordination and hospice operations, without taking ownership of clinical or legal decisions

Pilot message: **“Zeporah helps hospice teams and families coordinate approved next steps, tasks, and updates in one clear place.”**

## Approved initial market

A tightly constrained paid pilot: one U.S. state; one Medicare-certified hospice organization; one hospice executive sponsor; 10–25 enrolled households; 90-day paid design-partner pilot; the hospice organization is the customer; family access is free; family coordination is the central value proposition. The pilot validates operational value, usability, trust, and workflow fit before expansion.

Do not design the initial build around national rollout, multi-state policy variation, multiple hospice organizations, hospital integration, or high-volume consumer acquisition.

## Core users

- **Patient** — a calm, understandable view of household support, preferences, next steps, and approved communication.
- **Household coordinator** — the primary family organizer: clear tasks, updates, invited support people, and a safe way to communicate with the care guide.
- **Family member or proxy** — may assist with tasks and view only what their approved role and consent permit. A family role never automatically grants sensitive access.
- **Hospice care guide** — a desktop/tablet coordination view: assigned households, open tasks, acknowledgement states, family-visible communication tools, clear escalation paths.
- **Hospice operations user** — a limited operational view of queues, enrollment status, workflow issues, and pilot performance.
- **Authority/consent reviewer** — a designated human reviewer who manages workflow status for authority evidence and consent, and does not make legal determinations through Zeporah.

## First pilot workflows (in priority order)

1. **Household onboarding** — preferences; accessible communication settings; trusted contacts; invitations; household roles; clear explanations of each role's limits.
2. **Household dashboard** — what needs attention today; assigned coordination tasks; approved family-visible updates; support and next-step guidance; relevant notifications; a clear route to the care-guide message thread.
3. **Staff coordination workspace** — household queue; assigned tasks; outstanding acknowledgements; family-visible updates; internal staff notes kept separate; escalation flags; clear ownership.
4. **Messaging and notifications** — routine, non-emergency care coordination; family-visible messages; separate internal staff-only notes; shared unread state; notification events tied to meaningful workflow actions; no reliance on this feature for emergency communication or clinical triage.
5. **Vault and document-state workflow** — a household-visible, plain-language place for permitted coordination documents and statuses (metadata, status, review state). Not a repository for clinical charts or legal originals. Vault changes appear on the dashboard and in notifications.
6. **Authority, consent, and controlled packet sharing** — workflow status only, not legal determination; authority evidence metadata, version history, reviewer state, conflict handling; purpose-specific consent; named recipient; minimum-necessary manifest; expiry, revocation, release receipt, audit event; human review for conflicts and exceptions.
7. **Bereavement transition** — confirm surviving contact; continue practical support and coordination; narrow access to sensitive information according to policy; preserve continuity rather than treating bereavement as a separate product.

## Product design requirements

Zeporah should feel quiet, clear, respectful, warm without being sentimental, competent without being clinical-cold, plain-language and grief-aware, trustworthy and calm.

Avoid gamification, overly cheerful illustrations, dense medical jargon, legalistic language on routine screens, urgent-looking alerts unless genuine human follow-up is required, and features that add notification burden or care-team administrative work.

Use clear hierarchy, short explanations, explicit ownership, meaningful statuses, progressive disclosure, plain-language explanations for blocked actions, responsive family experiences, dense-but-readable desktop/tablet staff workflows, and accessible design (keyboard support, semantic structure, focus states, screen-reader-safe status updates).

## Critical safety boundaries

Zeporah does not: replace the hospice EHR; replace the interdisciplinary plan of care; provide clinical advice, triage, diagnosis, or treatment decisions; receive emergency or urgent-care communications; determine the legal validity of a power of attorney, executor status, guardianship, will, trust, or similar record; grant access simply because someone is a family member; automatically approve policy exceptions; automate sensitive disclosure decisions; store or ingest full clinical charts, legal originals, or live PHI during development; or make production or HIPAA-compliance claims without approved evidence and review.

Every relevant screen preserves these boundaries in appropriate, non-alarming language.

## Authorization principles

Multi-tenant and default-deny. A coordination role is not sufficient to release sensitive information.

Protected sharing requires all of: (1) correct tenant, (2) authenticated actor, (3) explicitly permitted role, (4) named purpose, (5) named recipient, (6) minimum-necessary scope, (7) active authority workflow state, (8) active, unexpired, non-revoked consent, (9) valid future expiry window, (10) immutable audit event.

Policy outcomes are **allow**, **hold**, or **deny**. Every outcome requires a stable internal reason code, a safe plain-language explanation for the household, an immutable audit event, and human escalation where the case is ambiguous, conflicting, or exceptional.

Missing information, conflict, revocation, expiry, error, or an unavailable policy dependency yields hold or deny — never a permissive fallback.

## Data boundaries for development

All development, demos, screenshots, seed data, tests, and scenarios use synthetic data. Do not use real patient or family information; connect to an EHR/FHIR source; use a production identity provider; send real SMS, email, or external notifications; connect to cloud production infrastructure; create external vendor accounts; create payment, claims, or billing functionality; or create production deployment infrastructure unless separately authorized.

## Prototype behavior to preserve

- Onboarding has four progressive steps: (1) confirm preferences, (2) add trusted contacts, (3) choose communication settings, (4) review starter vault items.
- Completing onboarding progressively updates household/dashboard state, unlocks trusted-contact and dashboard behavior, enables messaging and notifications, activates consent-related display states, and links starter-vault review back to dashboard summaries.
- Dashboard actions navigate to the vault, messages and notifications; reflect task state, update activity, vault counts and unread count; and show a clear state when onboarding is incomplete.
- The vault has reviewable synthetic records; review status updates dashboard counters and activity; review events create notifications; navigation back to the dashboard preserves state.
- Messaging supports a household/care-guide thread, keeps staff-only notes separate, and sending a message updates the thread, dashboard activity, and notification feed.
- Notifications draw from onboarding, vault and messaging events; the unread count is shared globally; opening or marking read updates every indicator.

## Required technical direction

A coherent, testable application — not a static mockup or disconnected pages — with: a clean repository; TypeScript throughout; persistent local development storage; synthetic seed data; deterministic reset/seed tooling; a typed domain model; a typed route/API contract; a policy evaluator for authority, consent and packet release; role-aware route and action guards; an append-only audit-event interface; unit, integration and end-to-end coverage of the critical linked flows; and documentation that separates current synthetic pilot behavior from production-readiness requirements.

## Production is deferred

Before real patient data or a live pilot, Zeporah separately requires: a threat model and current data-flow diagram; formal security risk analysis; identity, MFA, session, account recovery and access-review design; encryption, secrets, key management, backups and restore testing; monitoring, logging, incident response and downtime procedures; vendor review and BAAs where applicable; an accessibility assessment; penetration testing; privacy, legal, clinical and hospice-operations review; and pilot training, support, escalation and human-override procedures. These gates must not be bypassed, minimized, or represented as complete.

## Working style

The founder retains product-policy approval. Agents may inspect the codebase, propose plans, build synthetic prototypes, local models and tests, report risks and blockers, and implement explicitly approved bounded work. Agents may not make clinical, legal, authority, consent or sensitive-disclosure decisions; use real PHI or connect production systems; deploy or create external services; merge, push, release or make production claims without explicit authorization; or expand scope beyond the approved one-state, one-hospice, 10–25-household design. If a task conflicts with these boundaries: stop, identify the conflict, and request a decision.
