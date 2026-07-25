# WMS AI Operating Instructions

This file is the mandatory starting point for Claude, ChatGPT, Copilot, Codex, and any other AI agent working on this repository.

## Required reading order

Before analysis, commands, code changes, deployment, database work, or user guidance, read:

1. `docs/WMS-CURRENT-STATUS.md`
2. `docs/WMS-PRODUCTION-RUNBOOK.md`
3. `docs/WMS-INCIDENT-LOG.md`
4. `docs/WMS-DECISION-LOG.md`
5. `docs/WMS-SESSION-LOG.md`

Then inspect the relevant code, migrations, tests, PRs, and Git history. Never restart reasoning from zero when these records contain prior context.

## Mandatory continuity rules

- Treat the files above as the durable project memory and operational source of truth.
- Before proposing a fix, check whether the same incident, decision, workaround, deployment step, or rejected approach is already recorded.
- Distinguish clearly between confirmed facts, current observations, hypotheses, and proposed actions.
- Never assume production state from repository state alone.
- Never run destructive or data-changing production commands without an explicit backup, dry run where available, and user approval.
- Never run demo or automatic seed commands in production.
- Record every meaningful session, code change, deployment, incident, command, result, unresolved issue, and decision in the appropriate documentation before considering work complete.
- Do not record passwords, private keys, tokens, service-account JSON, database contents containing personal data, or other secrets.
- Conversation transcripts do not belong verbatim in Git. Record durable summaries, exact commands where operationally important, outcomes, decisions, evidence, and links to PRs/commits.

## Required close-out for every future work session

Update at least:

- `docs/WMS-CURRENT-STATUS.md` for the latest operational and delivery state.
- `docs/WMS-SESSION-LOG.md` with date, objective, actions, evidence, result, and next step.

Also update when applicable:

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
  - `reset-admin`
  - deleting or replacing `data/wms.db`, `data/wms.db-wal`, or `data/wms.db-shm`
  - applying a reconciliation or initialization operation before reviewing its dry-run output

## Current critical context

Production database files were accidentally deleted on 2026-07-25 and recovered from an open process file descriptor under `/proc/<pid>/fd`. Integrity checks passed and the application returned healthy afterward. Authentication currently rejects the previously used administrator credentials. This must be investigated read-only first; do not seed or reset accounts as a first response.
