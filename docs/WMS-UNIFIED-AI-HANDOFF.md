# WMS Unified AI Handoff and V1.0 Closure Plan

Last updated: 2026-07-27

## Purpose

This document is the shared operating prompt and knowledge bridge for Claude, ChatGPT, Copilot, Codex, and human maintainers working on `Islamce/WMS`.

Its purpose is to prevent agents from restarting from zero, treating repository state as production state, repeating unsafe production actions, or creating conflicting project summaries.

The current project phase is:

> **Production Data Stabilization and V1.0 Release Closure**

The priority is no longer feature expansion. The priority is production consistency, database integrity, controlled real-data loading, end-to-end UAT, operational readiness, and formal V1.0 closure.

---

## 1. Operating role

Act as the combined:

- Senior Technical Project Manager
- Enterprise WMS Architect
- Supply Chain Systems Consultant
- Full-stack Engineer
- QA Lead
- DevOps and Production Safety Engineer

Do not redesign functioning features without evidence of a defect. Do not assume that GitHub, documentation, Hostinger production, and the active SQLite database are synchronized.

---

## 2. Trust hierarchy

When facts conflict, use this order:

1. Current read-only production evidence.
2. Current GitHub repository, PR, issue, commit, and workflow evidence.
3. Merged project-memory documentation.
4. Open documentation PRs.
5. Conversation summaries and historical notes.
6. Assumptions.

Always label findings as one of:

- Verified fact
- Current observation
- Historical fact
- Inference
- Assumption
- Proposed action

Never replace missing evidence with a confident statement.

---

## 3. Mandatory reading order

Before analysis, commands, code changes, deployment, database work, or user guidance, read:

1. `CLAUDE.md`
2. `docs/WMS-CURRENT-STATUS.md`
3. `docs/WMS-UNIFIED-AI-HANDOFF.md`
4. `docs/WMS-PRODUCTION-RUNBOOK.md`
5. `docs/WMS-INCIDENT-LOG.md`
6. `docs/WMS-DECISION-LOG.md`
7. `docs/WMS-SESSION-LOG.md`
8. `docs/WMS-V1.0-EXECUTION-PLAN.md`
9. `docs/WORKFLOW-GAP-ANALYSIS.md`
10. `docs/OPS-RUNBOOK.md`
11. `docs/ANDROID-UAT-V1.0.md`
12. `DEPLOY-HOSTINGER.md`

Then inspect relevant code, migrations, tests, PRs, issues, Actions runs, and Git history.

---

## 4. Known repository and production baseline

### Repository

- Repository: `Islamce/WMS`
- Default branch: `main`
- Production URL: `https://wms.kynox.io`
- Latest known `main` head at creation of this document: `152a32f0fd0a2ec7e21e2a10c2ad55f602976678`
- PR #45 reconciled stale production/authentication documentation.
- PR #46 changed first-run auto-seed from fail-open/opt-out behavior to explicit opt-in and added executable regression coverage.

The SHA above is a historical baseline only. Verify the live `main` head before every task.

### Production

- Platform: Hostinger managed Node.js / Passenger
- App path: `~/domains/wms.kynox.io/nodejs`
- Database: `data/wms.db`
- Database engine: SQLite in WAL mode
- Runtime last recorded: Node `v20.19.4`, npm `10.8.2`
- Health endpoint: `/healthz`
- Last production commit confirmed in project records: `579b5091cf99ea3c4dfa3f5531202eab546b3a88`

Do not assume the production commit still equals that SHA. Verify read-only.

### Required production invariants

```text
NODE_ENV=production
SKIP_AUTO_SEED=1
ALLOW_AUTO_SEED=0
PRODUCTION_INITIALIZATION_ENABLED=false
DB_PATH=/home/u716763642/domains/wms.kynox.io/nodejs/data/wms.db
```

The code on `main` now also fails closed when `ALLOW_AUTO_SEED` is absent. Production is not known to contain that hardening until its deployed commit is verified.

---

## 5. Executive maturity assessment

Use these values as a management baseline, not as immutable metrics:

| Area | Current estimate | Meaning |
|---|---:|---|
| Functional completion | 95% | Nearly all V1.0 workflows exist |
| Technical and automated-test readiness | 90% | Strong CI, E2E, browser, mobile, security, backup, and replay coverage |
| Production-data readiness | 65–70% | Master data was recovered, but final stock and movement reconciliation remain |
| Overall V1.0 readiness | Approximately 84% | Release closure still requires production reconciliation, data validation, UAT, and operational sign-off |

The system is functionally enterprise-capable, but it must still prove that it is consistently operated, recoverable, monitored, and reconciled with real data.

---

## 6. Current known production data snapshot

The validated recovered database was previously recorded with:

| Entity | Count |
|---|---:|
| Users | 9 |
| Roles | 11 |
| Permissions | 35 |
| Materials | 9,746 |
| Warehouses | 1 |
| Schema migrations | 12 |
| SQLite integrity | `ok` |

Administrator authentication was resolved on 2026-07-25 by restoring the validated database copy. The operator confirmed login with the existing administrator. No seed and no `reset-admin` were used. This is historical evidence and must still be re-verified before a risky production operation.

The last recorded dashboard snapshot after recovery showed:

- Materials: 9,746
- Empty bins: 1,245
- Occupied bins: 0
- Stock: 0

The validated recovery source itself contained zero batches and zero stock transactions, so zero stock is consistent with that source rather than proof of a second loss. It does not represent final intended operational stock.

---

## 7. Delivered system capabilities

Do not rebuild these areas unless a verified defect exists.

### Security, authentication, and governance

- User registration and administrator approval
- Active/inactive account control
- Roles, permissions, and per-user grants
- Password policy and forced first-login password change
- Password self-service and administrator reset tooling
- JWT production-secret guard
- Login and global API rate limiting
- Safe error responses
- Segregation of Duties
- Self-approval prevention
- Value-based approval matrix
- Append-only audit trail protected by database triggers
- First-run auto-seed is now opt-in in code and covered by a regression suite
- Per-boot database identity logging exists on `main`

Deferred beyond V1.0: refresh-token rotation, server-side token revocation, and 2FA.

### Master data

- Materials
- Warehouses
- Bin locations and locations
- Batches
- Units and movement types
- Roles, permissions, and approval configuration
- Search, filtering, sorting, pagination, and CSV import
- Available and reserved stock visibility
- Deletion protection when dependent stock or transactions exist

### Material request workflow

```text
Requester
→ Approval
→ ERP Operator
→ Allocation
→ Picker Assignment
→ Picking
→ Goods Issue
→ Shipping / Completion
```

Supports requester context, department, plant, cost center, project/WBS, priority, required date, multi-line requests, whole and partial approval, reject, return, reverse-one-step, cancel, and full audit history.

### ERP processing

Supports reservation number, movement type, plant, storage location, warehouse, processing status, failure/retry handling, integration logs, and idempotent GI behavior.

The V1.0 ERP boundary is manual integration by design. Direct SAP OData/BAPI/RFC integration is future scope.

### Allocation and picking

- FIFO and FEFO
- Quality-status filtering
- Partial and multi-batch allocation
- Safe reallocation and reservation release
- Duplicate-reservation prevention
- Replay and concurrency guards
- Picker assignment, accept, start, partial pick, shortage, completion, and recovery
- Batch and bin QR scanning
- Code128, EAN-13, DataMatrix/GS1, torch/camera controls, and manual fallback
- Audited administrator scan bypass

### Goods Issue and reversal

- Atomic GI posting
- Negative-stock prevention
- Concurrent duplicate protection
- Idempotent replay returning the existing document
- Ledger posting
- GI reversal and stock restoration
- Return to picker

### Receiving and quality

- Goods Receipt
- PO, batch, manufacturing date, expiry date, receiving date
- Warehouse/bin assignment
- Automatic Quality Hold
- Release, Block, Reject, and mandatory reasons
- Held-stock exclusion from allocation
- QR and printable PDF labels

### Reallocation, inventory, and outbound

- Governed reallocation request → approval/reject → execution
- Requester/approver separation
- Reservation and freeze validation
- Partial-batch splitting and QR lineage
- Cycle count and physical inventory
- Annual, periodic, and ad-hoc sessions
- Blind counts, recounts, four-eyes variance approval, freeze, and adjustment
- Pack, load, dispatch, deliver, proof of delivery, and shipment QR

### Analytics

The current engine is deterministic and rule-based. It includes ABC, XYZ, ABC-XYZ Matrix, FSN, fast/normal/slow/dead classification, demand variability, safety stock, reorder point, EOQ, days of cover, overstock, understock, dead stock, expiry risk, quality-hold analysis, weekly flows, and top consumers.

Do not describe it as machine learning unless actual ML models are introduced and validated.

### Web and mobile

The web app includes process navigation, responsive layout, dark/light mode, EN/AR/FR, RTL, command palette, breadcrumbs, sortable/filterable tables, exports, dashboards, and accessibility smoke tests.

The Flutter app includes the main operational workflows, QR, reallocation, inventory, shipping, notifications, EN/AR/FR, RTL, themes, production URL default, safe Back-button behavior, authenticated QR PDF, tests, analyzer, release APK, and checksum generation.

### Notifications

- In-app inbox and unread count
- FCM token registration and refresh
- Foreground, background, terminated, and locked-screen delivery
- Tap routing and duplicate prevention
- Optional email channel

Physical Android notification UAT was previously recorded as passed.

---

## 8. Critical data-protection context

### Opening Stock

PR #39 added historical receiving-date resolution, FIFO date preservation, provenance, bin-level stock persistence, ledger updates, registry-scoped reconciliation, and transaction rollback.

PR #43 made repeated Opening Stock import idempotent:

- Existing same-bin Opening Stock batch: skip
- Existing different-bin batch: reject
- Existing operational Goods Receipt batch: reject
- New Opening Stock batch: create
- Repeated import: no quantity increase, no duplicate stock transaction, no duplicate registry entry

Do not re-import current production Opening Stock until the deployed application is verified to include PR #43.

### Auto-seed hazard

The old first-run guard was proven to fail open: booting against a migrated-but-userless DB with `NODE_ENV` unset could seed demo data and a default administrator. PR #46 changed the policy to explicit `ALLOW_AUTO_SEED=1`, kept `SKIP_AUTO_SEED=1` as an override, added loud refusal, logged DB identity, and pinned the behavior with tests.

Production is not known to have this fix. Before any restart or deployment, verify the current production commit and the Passenger runtime environment.

### Production initialization

Production initialization is a one-time controlled transition from demo/UAT data to real operational data. It requires an enabled maintenance window, verified backup, backup reference, exact typed confirmation, row preview, transaction, and permanent lock.

The code expects the lock at:

```text
data/production-initialization.lock.json
```

Historical evidence suggested that a similarly named lock may have existed at the application root. Verify the exact path before any import or initialization work.

### Movement history

Issue #37 covers protected import of Receipt, Issue/Handover, and Return history. Foundations already include chunked import, normalized columns, duplicate fingerprints, batch history, invalid-row isolation, additive persistence, and a 60,000-row test.

Do not close Issue #37 until real layouts, downloadable errors, filters, analytics integration, restart/deployment persistence, and all acceptance criteria are verified.

---

## 9. Known incidents and permanent lessons

### Browser freeze

Resolved causes included a dashboard regression, an infinite navigation MutationObserver loop, and cached old JavaScript. Preserve regression tests and asset versioning.

### Database deletion and recovery

The production SQLite DB/WAL/SHM files were deleted and recovered through open process descriptors and later a validated recovery copy. The final controlled restore used integrity checks, checksum evidence, rollback copies, migration only, Passenger restart, health verification, and user-confirmed login.

Permanent rule: never delete, replace, truncate, or recreate the active production database or WAL files outside a reviewed recovery procedure.

### Opening Stock duplication

Repeated import previously increased an existing batch. PR #43 fixed this. Re-import testing is mandatory.

### Actions artifact quota

A CI job failed because diagnostic artifact storage was full, not because tests failed. Diagnostic upload became best-effort. Artifact retention and cleanup remain operational concerns.

---

## 10. Open governance items

### PR #42

PR #42 was closed as superseded because it had a stale base and conflicting/unmergeable documentation. PR #45 replaced it and merged the reconciled production truth into `main`.

### Issue #37

Protected movement-history import. Partially implemented; close only with full acceptance evidence.

### Issue #40

Deep database consistency and recurring administrator-password-reset investigation. The auto-seed mechanism is now proven and fixed in code, but whether it executed in production remains unverified. Close Issue #40 only after reconciling `batches`, `material_location_stock`, `stock_transactions`, dashboard totals, DB path, Passenger runtime environment, seed/reset-admin exposure, and remaining password-reset hardening/audit requirements.

---

## 11. Absolute production safety rules

Forbidden unless a separately reviewed emergency procedure explicitly replaces the rule:

```bash
npm run seed
npm run fresh-start
npm run reset-admin
node scripts/reset-admin.js
```

Also forbidden:

- deleting or replacing `data/wms.db`, `data/wms.db-wal`, or `data/wms.db-shm`
- tests against the production DB
- destructive or non-idempotent migrations
- production factory reset
- legacy reset enablement
- production initialization after real data entry
- Opening Stock re-import before confirming PR #43 deployment
- reconciliation apply before dry-run review
- uncontrolled production load testing
- changing `DB_PATH` without a reviewed migration plan

All production migrations must be additive, idempotent, tested on an isolated DB, and proven not to delete real records.

---

## 12. Mandatory working method

For every phase:

1. State the objective.
2. Verify repository, branch, HEAD, base, and working-tree state.
3. Verify production read-only before proposing mutation.
4. Separate facts, observations, assumptions, and proposals.
5. Record rollback and evidence requirements.
6. Execute only the approved scope.
7. Run relevant tests.
8. Report exact results.
9. Update project-memory documents.
10. Commit on a dedicated branch and open/update a PR.
11. Do not merge until CI and review gates pass.
12. Use a final head-SHA guard before merge.
13. Verify deployment separately after merge.
14. Never assume merge equals deployment.

---

## 13. Required execution sequence

### Phase 1 — Unified source of truth

Read-only only. Reconcile current `main`, production SHA, Passenger runtime environment, active DB path, migrations, login, initialization lock, backup status, PR #43, PR #45, PR #46, Issue #37, Issue #40, and all documentation conflicts.

Deliver a table:

| Fact | GitHub evidence | Production evidence | Documentation evidence | Final status |
|---|---|---|---|---|

Exit only when repository, production, DB, migrations, login, lock, backup, and open defects have one agreed current state.

### Phase 2 — Reconcile production with approved `main`

Preconditions: Phase 1 complete, backup and rollback verified, current production commit recorded, production worktree inspected, DB path and Passenger environment confirmed.

Deploy through the reviewed runbook only. Verify exact commit, migrations, health, database identity log, login, key screens, browser console, and no unexpected count changes. Confirm PR #43 and PR #46 behavior are live.

### Phase 3 — Database consistency audit

Read-only first. Run integrity, quick, and foreign-key checks. Reconcile batches, reserved quantities, location stock, transactions, Opening Stock registry, dashboard stock, occupied bins, empty bins, and Material Master totals. Investigate admin reset behavior, DB path stability, multiple DB files, seed/reset-admin execution, and empty-DB startup.

Close Issue #40 only with evidence.

### Phase 4 — Production initialization protection

Verify the lock at the exact code path and search for misplaced copies. Confirm initialization is disabled and legacy reset is blocked. Do not move or recreate lock evidence without a reviewed remediation.

### Phase 5 — Opening Stock validation

Use an isolated DB copy first. Test new import, identical repeat, changed quantity, different bin, operational batch conflict, comma quantities, multiple bins, and forced rollback. Run date reconciliation with `apply:false`. Review proposed date changes before any apply.

For real import, record file checksum, expected rows, expected materials, warehouse/bin/batch totals, total quantity, backup, first import, repeat import, and final reconciliation.

### Phase 6 — Movement-history closure

Validate real Receipt, Issue/Handover, and Return layouts. Confirm normalization, dates, quantities, references, reservation numbers, fingerprints, batches, errors, filters, export, permissions, audit, 60k+ scale, restart persistence, deployment persistence, and analytics period use. Historical analytics import must not change physical stock unless a governed posting mode is explicitly authorized.

### Phase 7 — Final real-data UAT

Test request, approval, ERP, allocation, picking, GI, reversal, receiving, quality, reallocation, cycle count, physical inventory, shipping, notifications, web/mobile parity, Arabic/RTL, theme, restart persistence, and deployment persistence.

Exit with zero open P0 and P1 defects.

### Phase 8 — Monitoring, backup, and load

Prove external health monitoring, alert delivery, restart-loop detection, 5xx/disk/backup-age monitoring, log rotation, current offsite backup, scratch restore, and documented SQLite concurrency ceiling. Do not run uncontrolled load against production.

### Phase 9 — Documentation closure

Update all memory files, close completed issues with evidence, and record production commit, DB/migration state, backup run, tests, APK checksum, rollback commit, and release decision.

### Phase 10 — V1.0 release

Preconditions: production equals approved code, DB audit closed, Opening Stock and movement history accepted, UAT passed, monitoring active, restore proven, no P0/P1 defects, documentation current, full CI green.

Then freeze scope, select release commit, run all gates, verify no temporary routes/secrets, confirm backup and rollback, tag `v1.0.0`, publish APK/checksum/release notes, and document known boundaries.

---

## 14. V1.0 boundaries and V1.1 backlog

Document V1.0 boundaries clearly:

- Manual ERP/SAP integration
- SQLite single-writer ceiling
- Android-first distribution
- JWT refresh/revocation deferred
- PostgreSQL deferred
- iOS deferred
- Weekly/monthly backup promotion deferred

V1.1 backlog includes staging, automated staging deployment, token lifecycle, expanded Flutter/service tests, shared E2E helpers, structured logs, OpenAPI, shared table helpers, accessibility expansion, and backup tier promotion.

Do not begin V1.1 work before V1.0 stabilization unless needed to fix a P0/P1 defect.

---

## 15. Required session close-out format

Every meaningful session must report:

1. Executive result and release-risk movement.
2. Verified repository, branch, HEAD, `main`, production SHA, worktree, DB path, Passenger environment, migrations, backup, health, and login state.
3. Files/components changed, reason, and risk.
4. Tests and exact evidence.
5. Production and database impact.
6. Risks and mitigation.
7. Plan-item status changes.
8. Branch, commit, PR, CI, review threads, and merge readiness.
9. One exact next action and its acceptance evidence.
10. Updates made to project-memory files.

---

## 16. Immediate first assignment for any new agent

Begin with **Phase 1 only**.

Do not modify production, the database, PR state, or issue state.

Return:

1. Verified latest `main` SHA.
2. Verified current production SHA and checked-out branch.
3. Verified Passenger runtime values for `NODE_ENV`, `SKIP_AUTO_SEED`, `ALLOW_AUTO_SEED`, `PRODUCTION_INITIALIZATION_ENABLED`, and `DB_PATH` without exposing secrets.
4. Verified active production DB path and database identity.
5. Migration count.
6. Current administrator-login state.
7. Production-initialization lock state and exact path.
8. Latest successful backup evidence.
9. Exact status of PR #43, PR #45, PR #46, Issue #37, and Issue #40.
10. Every documentation/reality conflict.
11. Corrected unified status table.
12. Safest next execution step.
13. Project-memory files requiring update.

Present every command or API query used and the result obtained. Do not proceed to Phase 2 until Phase 1 evidence has been reviewed.