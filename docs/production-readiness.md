# Zeporah production-readiness program

**Status (2026-10-22): not production-ready. Not approved for real PHI or real users.** Zeporah is a
synthetic pre-pilot baseline. Nothing in this repository may hold real patient or family
information, be deployed for real use, or be described as production-ready, HIPAA compliant,
certified or accessibility-conformant until the Stage 1 gate below is passed and signed.

This document is the program's home. It supersedes
[production-readiness-gates.md](production-readiness-gates.md) (kept for history) and builds on
[pre-pilot-plan.md](pre-pilot-plan.md).

| Companion                                        | What it holds                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| [pilot-evidence-plan.md](pilot-evidence-plan.md) | One row per pilot blocker: artifact, test or drill, evidence, approver   |
| [readiness/tracker.json](readiness/tracker.json) | The machine-readable tracker; `bun scripts/readiness-check.ts` checks it |
| [decision-register/](decision-register/)         | Decision briefs, only where a founder or outside choice is required      |
| `architecture/`, `runbooks/`                     | Created as each workstream produces them (not yet started)               |

## How to read the labels

Every statement about the system carries one of these:

- **[Code]** verified directly in code or configuration in this repository, with the file named.
- **[Test]** shown by a test in this repository that passed at the 2026-10-22 freeze.
- **[Doc]** stated in an existing document and not re-verified.
- **[Assumption]** believed true but not verified.
- **[Policy]** depends on a founder decision.
- **[Pending review]** depends on legal, compliance, clinical or hospice-partner review.

## 1. Inventory: what exists today

### Application

| Area               | Fact                                                                                                                                                                                                                                                                                        | Label                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack              | TanStack Start 1.168 (React 19), Vite 8, Drizzle ORM 0.45 on PGlite 0.5 (embedded, single process), zod, Tailwind 4; Bun runtime                                                                                                                                                            | [Code] `package.json`                                                                                                                                                                        |
| Database           | 25 migrations (`0000_init` to `0024_audit_chain_link`) with a downgrade path for the last 11                                                                                                                                                                                                | [Code] `src/server/db/migrations`, [Test] upgrade suite                                                                                                                                      |
| Experiences        | Separate family (`/family`, `/helper`, `/recipient`) and care-team (`/staff`) shells and sign-in pages; no role switcher                                                                                                                                                                    | [Code] `src/routes`                                                                                                                                                                          |
| Request path       | Every server function goes through one wrapper, `run`, which rebuilds the caller from the session, refuses changes in read-only mode, maps refusals to HTTP status and logs unexpected errors with a reference only                                                                         | [Code] `src/server/rpc.ts`                                                                                                                                                                   |
| Reads and writes   | Reads are GET, changes are POST                                                                                                                                                                                                                                                             | [Code] `src/server/rpc.ts` (`refusedAsReadOnly`)                                                                                                                                             |
| Authorization      | Default deny: a permission matrix per role and lifecycle stage; household, tenant and organization scoping in services; composite foreign keys across tenant boundaries                                                                                                                     | [Code] `src/domain/permissions.ts`, `src/server/context.ts`; [Test] integration suites, including a second hospice                                                                           |
| Passwords          | scrypt (N=2¹⁷, r=8, p=1), constant-time compare, 12–200 characters                                                                                                                                                                                                                          | [Code] `src/server/auth/crypto.ts`                                                                                                                                                           |
| Sign-in throttling | Lock after 10 consecutive failures for 15 minutes, per account only; uniform refusal message                                                                                                                                                                                                | [Doc] `authentication-and-access.md`; [Assumption] no per-IP limit (none found in code)                                                                                                      |
| Sessions           | Random 32-byte token in an HTTP-only, SameSite=Lax cookie (Secure in production); only its SHA-256 stored; 12 hours, or 30 days with "Remember me" (decision 53)                                                                                                                            | [Code] `src/server/session.ts`                                                                                                                                                               |
| CSRF               | Same-origin check on every request that can change something: `Origin` must name this server or a configured address, else `Sec-Fetch-Site` must be same-origin (2026-10-27). No CSRF token                                                                                                 | [Code] `src/domain/same-origin.ts`, `src/start.ts`; [Test] `tests/unit/same-origin.test.ts`, replay in `readiness/evidence/csrf-origin-check-2026-10-27.md`                                  |
| Security headers   | None set (no CSP, HSTS, frame, referrer or permissions policy)                                                                                                                                                                                                                              | [Code] none found in `src`                                                                                                                                                                   |
| Development gate   | Persona sign-in and data reset need `ZEPORAH_DEV_SIGN_IN=1` and are always off when `NODE_ENV=production`                                                                                                                                                                                   | [Code] `src/server/auth/dev-gate.ts`                                                                                                                                                         |
| Environment guard  | Refuses `NODE_ENV=production` without `ZEPORAH_ENVIRONMENT`                                                                                                                                                                                                                                 | [Code] `src/server/environment.ts`                                                                                                                                                           |
| Incident control   | Read-only mode (`ZEPORAH_READ_ONLY=1`) refuses every change, with a banner                                                                                                                                                                                                                  | [Code] `src/server/rpc.ts`, `environment.ts`                                                                                                                                                 |
| Error logging      | One JSON line per unexpected error to stdout: reference, type, message with query parameters removed, short stack; no request data                                                                                                                                                          | [Code] `src/server/observability.ts`                                                                                                                                                         |
| Audit              | Append-only (database trigger) and hash-chained per tenant; appends serialized by an advisory lock and forks refused by the database (2026-10-27); verification reports findings, not a pass mark; role at the time, source, approvals, "prepared" flags; visibility classes; export logged | [Code] migrations `0001`, `0024`, `src/server/audit.ts`; [Test] audit suites, `tests/integration/audit-chain.test.ts`; [Assumption] the lock under real concurrency, untested until Postgres |
| Read access        | Reading household information isn't audited (a prototype design choice)                                                                                                                                                                                                                     | [Code] no read events; [Policy] decision brief needed                                                                                                                                        |
| Integrations       | Every adapter refuses calls; email only to a development mail sink                                                                                                                                                                                                                          | [Code] `src/server/integrations`; [Test] `tests/unit/integrations.test.ts`                                                                                                                   |
| Data at rest       | Plaintext PGlite files in `.data/`                                                                                                                                                                                                                                                          | [Code] `ZEPORAH_DATA_DIR`                                                                                                                                                                    |

### Delivery and operations

| Area             | Fact                                                                                                                                                                                                         | Label                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Source control   | Git initialized 2026-10-22 (decision 64); initial commit tagged `demo-baseline-2026-10-22`; code host GitLab (`twgi-group/zephora`), first push pending the founder's sign-in                                | [Code]                                           |
| CI and lint      | `.gitlab-ci.yml` and `scripts/ci.sh` (type-check, formatting, links, tracker, baseline, migrations, advisories, every test suite, secret scan); run locally; not yet run on GitLab. Prettier only, no linter | [Code], [Test] local run                         |
| Hosting          | None; development and isolated test servers only                                                                                                                                                             | [Code] `.claude/launch.json`, Playwright configs |
| Secrets          | None exist                                                                                                                                                                                                   | [Code]                                           |
| Backups          | A documented local copy; the development reset deletes data by design                                                                                                                                        | [Doc] `operations-runbook.md`                    |
| Baseline control | The frozen demo baseline is a SHA-256 manifest of 403 files                                                                                                                                                  | [Code] `docs/demo-baseline-2026-10-22.sha256`    |

### Tests at the freeze

493 unit and integration, 187 end-to-end (1 skipped), 22 verify, 10 upgrade: all passing on
2026-10-22. **[Test]** They prove the access rules and workflows on tested paths with synthetic
data on the embedded database. They don't prove security against an attacker, behaviour on a real
Postgres server under concurrency or load, usability for real families or assistive-technology
users, legal or clinical soundness, or that the system can be operated and recovered.

## 2. Gaps mapped to workstreams

Pilot blockers (PB) must be closed with evidence before Stage 1. Pilot conditions (PC) may be
accepted for Stage 1 only with a written compensating control and signed approval. Scale blockers
(SB) must close before Stage 2.

| ID    | Gap                                                                                                               | Workstream | Class     | Depends on                        |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ---------- | --------- | --------------------------------- |
| PB-01 | No git repository, protected source control, CI, release pipeline or controlled deployment                        | W1         | Blocker   | Decision D-01                     |
| PB-02 | No production hosting, managed database, environment isolation, secrets manager, monitoring or release governance | W3         | Blocker   | PB-01; decision D-02              |
| PB-03 | No backup and restore program or restore drills                                                                   | W7         | Blocker   | PB-02                             |
| PB-04 | No threat model                                                                                                   | W2         | Blocker   | PB-01                             |
| PB-05 | No security-header baseline                                                                                       | W2         | Blocker   | PB-02 (headers depend on hosting) |
| PB-06 | No CSRF defence beyond SameSite cookies                                                                           | W2         | Blocker   | PB-01                             |
| PB-07 | Rate limiting is per account only                                                                                 | W2         | Blocker   | PB-02 (shared store)              |
| PB-08 | No staff MFA or identity-provider architecture                                                                    | W4         | Blocker   | PB-02; decision D-03              |
| PB-09 | No tenant and organization boundary validation plan for a real Postgres server                                    | W4         | Blocker   | PB-02                             |
| PB-10 | Plaintext database files; no encryption-at-rest architecture                                                      | W3         | Blocker   | PB-02                             |
| PB-11 | No approved retention, deletion or lifecycle policy (R-10)                                                        | W5         | Blocker   | Decision D-05; counsel            |
| PB-12 | Staff reads of household information aren't audited                                                               | W5         | Blocker   | Decision D-04                     |
| PB-13 | No incident or breach response plan                                                                               | W7         | Blocker   | Decision D-07                     |
| PB-14 | No HIPAA privacy and security program, BAAs, vendor assessments, legal review or clinical-content governance      | W6         | Blocker   | Decisions D-02, D-07; counsel     |
| PB-15 | No support, onboarding, training, escalation or change-management model; pilot cap not enforced                   | W8         | Blocker   | Decisions D-10, D-11              |
| PB-16 | No manual accessibility validation with assistive-technology and stressed users                                   | W10        | Blocker   | Decision D-12                     |
| PB-17 | Documentation drift (readiness documents behind the code)                                                         | W1         | Blocker   | —                                 |
| PC-01 | English only for safety, consent and boundary wording                                                             | W10        | Condition | Hospice population review         |
| PC-02 | Email: none in Stage 1 unless decided (invitations passed by hand)                                                | W9         | Condition | Decision D-06                     |
| PC-03 | One role per staff member; one household per family account                                                       | W4         | Condition | Hospice workflow review           |
| PC-04 | Operations and reviewers see every household in their hospice                                                     | W4         | Condition | Decision D-09                     |
| PC-05 | 30-day "Remember me" family sessions (decision 53) on shared devices                                              | W4         | Condition | Decision D-08                     |
| SB-01 | Independent penetration test                                                                                      | W2         | Scale     | PB-02, PB-04                      |
| SB-02 | Database row-level security as a second wall                                                                      | W4         | Scale     | PB-02                             |
| SB-03 | Two consecutive successful restore drills                                                                         | W7         | Scale     | PB-03                             |
| SB-04 | Audit chain anchored outside the database                                                                         | W5         | Scale     | PB-02                             |

Sequence: W1 first; then W3 and W7; then W2, W4 and W5; W6, W8 and W10 prepared in parallel from
the start; W9 only if decision D-06 includes email.

## 3. Owners

Owners are roles until the founder names people. **No owner is named yet.**

| Role                                           | Owns                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| Founder                                        | Every decision brief; release governance; the Stage 1 sign-off             |
| Engineering lead                               | W1, W2, W3, W4, W5 implementation and evidence                             |
| Operations lead                                | W7, W8                                                                     |
| Privacy and security officer (to be appointed) | W6 with counsel; reviews W2, W5, W7 evidence                               |
| Design lead                                    | W10                                                                        |
| Hospice sponsor                                | Pilot agreement, training, the hospice side of W7 and W8; Stage 1 sign-off |
| Outside counsel and a clinical reviewer        | W6 reviews ([Pending review])                                              |

## 4. Stage 1 go/no-go gate

Real enrollment and real PHI only when every PB is closed with the evidence in
[pilot-evidence-plan.md](pilot-evidence-plan.md); every PC has a signed compensating control; and
the founder, the hospice sponsor and the designated compliance reviewer have signed the Stage 1
evidence pack. Writing a document never closes a gap on its own.
