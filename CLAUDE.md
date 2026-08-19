# WMS AI Operating Instructions

This file is the mandatory starting point for Claude, ChatGPT, Copilot, Codex, and any other AI agent working on this repository.

## Operating objective

Deliver the real task with the minimum sufficient authoritative context. Do not bulk-load project memory by default, do not create new governance layers, and do not update multiple documents merely to keep copies of the same fact synchronized.

The task-scoped reading policy below supersedes the older blanket mandatory-reading list in `docs/WMS-UNIFIED-AI-HANDOFF.md` §3. That older section remains historical context until a real task demonstrates that it must be changed; do not treat it as a reason to read every listed file before every task.

## Authority by fact type

Use the authority that matches the fact being asserted:

- **Current production/deployed behavior:** current read-only runtime evidence. Never infer production state from Git or documentation.
- **Implemented behavior:** current Git code, migrations, tests, commits, PRs, issues, and workflow evidence.
- **Architecture, safety and execution governance:** this file plus the applicable rules/decisions in `docs/WMS-UNIFIED-AI-HANDOFF.md` and `docs/WMS-DECISION-LOG.md`.
- **Historical incidents and prior evidence:** `docs/WMS-INCIDENT-LOG.md`, relevant session-log entries, PRs, issues, and commits.
- **Product/workflow intent:** the current task plus the most recent applicable specification/decision. If intent and implementation differ, record the gap; do not silently choose one as if both describe current state.
- **Conversation text:** context only; never authoritative over runtime, Git, or recorded decisions.

When evidence conflicts, prefer the most recent directly verified evidence for that fact type. Label important findings as verified fact, current observation, historical fact, inference, assumption, or proposed action. Never replace missing evidence with a confident statement.

## Task-scoped context loading

Start from the requested task, inspect relevant Git/code/test evidence, then load only the documents needed to answer or implement that task.

Use this map instead of reading the whole documentation set:

- **Production, deployment, database, backup or recovery work:** read `docs/WMS-CURRENT-STATUS.md`, the relevant section of `docs/WMS-PRODUCTION-RUNBOOK.md`, applicable incidents/decisions, and `DEPLOY-HOSTINGER.md` only when deployment/Hostinger details are involved.
- **Workflow, reservation, allocation, picking, issue/receipt, analytics or mobile work:** read the relevant code/tests first, then the applicable parts of `docs/WORKFLOW-GAP-ANALYSIS.md`, `docs/WMS-V1.0-EXECUTION-PLAN.md`, `docs/OPS-RUNBOOK.md`, or `docs/ANDROID-UAT-V1.0.md` only as needed.
- **Architecture, security, governance or a disputed prior decision:** read the applicable portions of `docs/WMS-UNIFIED-AI-HANDOFF.md` and `docs/WMS-DECISION-LOG.md`.
- **Known/repeated incident:** search `docs/WMS-INCIDENT-LOG.md`, relevant PRs/issues/commits, and only the relevant session-log entries.
- **Simple isolated code/test fix:** do not read unrelated operational or historical documents.

Never restart reasoning from zero when relevant evidence exists, but never preload unrelated project history merely because it exists.

## Minimal drift handling

Do not stop a real task to design a new governance system.

If a task exposes a documentation/context conflict, stale instruction, duplicated fact, or unclear authority:

1. Resolve the task using the applicable authority and direct evidence.
2. If the conflict is material, record one concise `DRIFT:` note in the active PR/task record or the session record already being used. Do not create a new drift framework or file for a single observation.
3. Do not perform a repository-wide documentation cleanup as a side effect.
4. Build a new validator/process rule only when the same failure pattern has repeated in real work and the smallest deterministic control is clearly cheaper than continued rework.

Be liberal about logging a one-line drift note when friction is real, but keep the note small. The value is in recurring patterns, not in creating another documentation workload.

## Documentation update rule

Documentation updates are **event-driven, not session-driven**.

- Update a document only when a fact owned by that document materially changed or when the current task directly exposes a material stale statement that affects safe execution.
- Do not update `docs/WMS-CURRENT-STATUS.md` or `docs/WMS-SESSION-LOG.md` merely because a work session occurred.
- Do not copy the same current-state statement into several files for completeness.
- Prefer references to existing decisions/incidents/evidence over rewriting the same history.
- Preserve historical records; mark or explain supersession when needed rather than silently rewriting history.
- Never store passwords, private keys, tokens, service-account JSON, password hashes, personal database rows, or other secrets.

A task is complete when the requested behavior/evidence and its directly affected authoritative record are correct. Documentation volume is not a completion criterion.

## Role routing

Use the smallest role set needed for the task:

- **Codex:** primary code implementation, refactoring, tests, deterministic validators, and engineering fixes.
- **Claude:** semantic/specification reconciliation, evidence synthesis, complex cross-component integration review, and contradiction analysis when a real conflict appears.
- **ChatGPT:** program orchestration, scope/architecture review, prioritization, and pattern review across tasks; do not create new governance architecture without repeated evidence.
- **Founder:** product/business/design decisions that cannot be resolved from existing evidence. Do not escalate routine documentation reconciliation.

Do not require multiple AI agents to review every normal task. Use deterministic tests/gates first; add a second agent only for material architecture, security, production-risk, or unresolved semantic conflicts.

## Production safety invariants

Production app path: `~/domains/wms.kynox.io/nodejs`

Production database: `data/wms.db`

Host runtime path: `/opt/alt/alt-nodejs20/root/usr/bin`

Required production flags:

- `NODE_ENV=production`
- `SKIP_AUTO_SEED=1`
- `ALLOW_AUTO_SEED=0`
- `PRODUCTION_INITIALIZATION_ENABLED=false`

Forbidden in production unless a separately reviewed emergency procedure explicitly replaces this rule:

- `npm run seed`
- `npm run fresh-start`
- `npm run reset-admin`
- `node scripts/reset-admin.js`
- deleting or replacing `data/wms.db`, `data/wms.db-wal`, or `data/wms.db-shm`
- applying reconciliation or initialization before reviewing its dry-run output
- running tests against the production database
- changing `DB_PATH` without a reviewed migration plan

Before any destructive or data-changing production operation, require an explicit backup, dry run where available, rollback plan, and user approval. Never assume a merge has been deployed.

## Current critical context

Production database files were accidentally deleted on 2026-07-25. Recovery ultimately used a validated final live copy with integrity checks, rollback preservation, migration-only recovery, Passenger restart, health verification, and restored administrator login.

The old first-run auto-seed behavior and an independent `reset-admin` hidden-seed path were hardened in later PRs. Current production state must still be verified from runtime evidence before relying on repository history for a risky operation.

Opening Stock re-import and reconciliation remain safety-sensitive. Verify deployed code and use dry-run/review gates before any production apply.

The offsite backup workflow has had consecutive failures recorded in `docs/WMS-CURRENT-STATUS.md` / `docs/WMS-INCIDENT-LOG.md`; production or backup work must re-check the latest run rather than relying on the summary here.
