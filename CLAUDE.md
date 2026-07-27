# WMS AI Operating Instructions

This file is the mandatory starting point for Claude, ChatGPT, Copilot, Codex, and any other AI agent working on this repository.

## Required reading order

Before analysis, commands, code changes, deployment, database work, or user guidance, read:

1. `docs/WMS-CURRENT-STATUS.md`
2. `docs/WMS-UNIFIED-AI-HANDOFF.md`
3. `docs/WMS-PRODUCTION-RUNBOOK.md`
4. `docs/WMS-INCIDENT-LOG.md`
5. `docs/WMS-DECISION-LOG.md`
6. `docs/WMS-SESSION-LOG.md`
7. `docs/WMS-V1.0-EXECUTION-PLAN.md`
8. `docs/WORKFLOW-GAP-ANALYSIS.md`
9. `docs/OPS-RUNBOOK.md`
10. `docs/ANDROID-UAT-V1.0.md`
11. `DEPLOY-HOSTINGER.md`

Then inspect the relevant code, migrations, tests, PRs, issues, Actions runs, and Git history. Never restart reasoning from zero when these records contain prior context.

`docs/WMS-UNIFIED-AI-HANDOFF.md` defines the shared management baseline, trust hierarchy, delivered capability map, production-safety rules, and ordered V1.0 closure phases. It does not replace current production verification.

## Mandatory continuity rules

- Treat the files above as the durable project memory, but resolve conflicts using the trust hierarchy in `docs/WMS-UNIFIED-AI-HANDOFF.md`.
- Before proposing a fix, check whether the same incident, decision, workaround, deployment step, or rejected approach is already recorded.
- Distinguish clearly between verified facts, current observations, historical facts, inferences, assumptions, and proposed actions.
- Never assume production state from repository state alone.
- Never assume a merge has been deployed.
- Never run destructive or data-changing production commands without an explicit backup, dry run where available, rollback plan, and user approval.
- Never run demo, reset, or automatic seed commands in production.
- Record every meaningful session, code change, deployment, incident, command, result, unresolved issue, and decision in the appropriate documentation before considering work complete.
- Do not record passwords, private keys, tokens, service-account JSON, password hashes, database rows containing personal data, or other secrets.
- Conversation transcripts do not belong verbatim in Git. Record durable summaries, exact commands where operationally important, outcomes, decisions, evidence, and links to PRs/commits.

## Required close-out for every future work session

Update at least:

- `docs/WMS-CURRENT-STATUS.md` for the latest operational and delivery state.
- `docs/WMS-SESSION-LOG.md` with date, objective, actions, evidence, result, and next step.

Also update when applicable:

- `docs/WMS-UNIFIED-AI-HANDOFF.md` only when the management baseline, trust model, production-safety rules, capability map, or V1.0 execution sequence changes.
- `docs/WMS-INCIDENT-LOG.md` for any failure, outage, data-risk event, recovery, or near miss.
- `docs/WMS-DECISION-LOG.md` for architecture, process, security, data, deployment, or product decisions.
- `docs/WMS-PRODUCTION-RUNBOOK.md` when a production command, validation, recovery, rollback, or deployment process changes.

## Production safety invariants

- Production app path: `~/domains/wms.kynox.io/nodejs`
- Production database: `data/wms.db`
- Host runtime path: `/opt/alt/alt-nodejs20/root/usr/bin`
- Required production flags:
  - `NODE_ENV=production`
  - `SKIP_AUTO_SEED=1`
  - `ALLOW_AUTO_SEED=0`
  - `PRODUCTION_INITIALIZATION_ENABLED=false`
- Forbidden in production unless a separately reviewed emergency procedure explicitly replaces this rule:
  - `npm run seed`
  - `npm run fresh-start`
  - `npm run reset-admin`
  - `node scripts/reset-admin.js`
  - deleting or replacing `data/wms.db`, `data/wms.db-wal`, or `data/wms.db-shm`
  - applying a reconciliation or initialization operation before reviewing its dry-run output
  - running tests against the production database
  - changing `DB_PATH` without a reviewed migration plan

## Current critical context

Production database files were accidentally deleted on 2026-07-25. Recovery involved an open process file descriptor and later a validated final live copy, integrity checks, rollback preservation, migration only, Passenger restart, and health verification.

Administrator authentication was restored after the validated database copy was returned, and the operator confirmed successful login. PR #45 reconciled the stale documentation that had incorrectly left authentication marked as open.

The old first-run auto-seed guard was empirically proven to fail open when `NODE_ENV` was absent. PR #46 changed auto-seed to explicit opt-in (`ALLOW_AUTO_SEED=1`), added database-identity logging, and pinned the rule with an executable regression suite.

PR #48 closed a second, independent path to the same failure: `scripts/reset-admin.js` ran the full demo seed whenever the roles table was empty, and defaulted to the published credentials `admin@example.com` / `Admin@123456` with no guard, no confirmation and no audit record. It now refuses default credentials, requires an explicit email, password and the typed phrase `RESET ADMIN PASSWORD` in production, never seeds, and audits. Administrator resets now set `must_change_password=1`; self-service changes clear it; both are audited without storing passwords or hashes (`DEC-012`).

Production is not known to contain either fix until its deployed commit is verified.

The last production commit recorded in project memory also predates PR #43's Opening Stock idempotency fix. Never re-import production Opening Stock until the deployed commit is verified to contain both PR #43 and the later fail-closed auto-seed hardening.

The first assignment for a new agent is Phase 1 of `docs/WMS-UNIFIED-AI-HANDOFF.md`: establish one unified source of truth without modifying production or the database.
