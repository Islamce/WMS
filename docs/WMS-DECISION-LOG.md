# WMS Decision Log

This document records durable product, architecture, data, security, deployment, and operating decisions. New entries must state context, decision, consequences, and status.

## DEC-001 — Production data must survive application updates

**Status:** Accepted.

**Decision:**

Application deployments, dependency installs, migrations, restarts, and code updates must not delete, recreate, seed over, or replace production data. Production database handling is a separate controlled operation with backup and validation requirements.

**Consequences:**

- Deployment procedures must preserve `data/wms.db` and its WAL state.
- Data initialization must never run implicitly in production.
- Database changes require reviewed migrations.

---

## DEC-002 — Automatic/demo seeding is disabled in production

**Status:** Accepted.

**Decision:**

Production uses:

```text
SKIP_AUTO_SEED=1
ALLOW_AUTO_SEED=0
PRODUCTION_INITIALIZATION_ENABLED=false
```

`npm run seed` and `reset-admin` are prohibited as routine production fixes.

**Reason:**

Demo seeding or broad reset procedures can overwrite, duplicate, or invalidate real data and accounts.

---

## DEC-003 — Durable AI context is stored in Git

**Status:** Accepted on 2026-07-25.

**Decision:**

`CLAUDE.md` plus the WMS status, runbook, incident, decision, and session logs are the durable shared memory for Claude, ChatGPT, Copilot, Codex, and human maintainers.

**Consequences:**

- AI agents must read the files before work.
- Every meaningful future session must update the records.
- Git stores structured summaries and evidence, not raw secrets or necessarily complete verbatim chat transcripts.
- Pull requests and commits remain the authoritative record of code changes.

---

## DEC-004 — Diagnose production problems read-only first

**Status:** Accepted.

**Decision:**

For authentication, data inconsistency, reconciliation, migration, or stock problems, start with read-only inspection and evidence gathering. Mutations follow only after scope, backup, rollback, and approval are established.

**Consequences:**

- Account failures do not automatically justify reset-admin or seed.
- Reconciliation starts with `apply: false`.
- Database schema and relevant rows are inspected without exposing password hashes or secrets.

---

## DEC-005 — Opening-stock receipt dates are explicit and FIFO-safe

**Status:** Implemented via PR #39.

**Decision:**

Opening-stock imports may carry historical receiving dates. The system resolves and persists receipt/FIFO timestamps and tracks their source. Reconciliation is constrained through an opening-stock batch registry to avoid modifying normal operational goods receipts.

**Consequences:**

- Historical FIFO can be represented correctly.
- Reconciliation must be registry-scoped and dry-run reviewed.
- Operational GR batches must not be changed by opening-stock repair logic.

---

## DEC-006 — Production uses Node 20 on Hostinger

**Status:** Accepted.

**Decision:**

Use `/opt/alt/alt-nodejs20/root/usr/bin` and the verified runtime Node `v20.19.4`, npm `10.8.2` for production commands.

**Reason:**

The application and native dependencies, including `better-sqlite3`, were validated on this runtime. Shell sessions may not include this path automatically.

---

## DEC-007 — Static browser assets require version-aware delivery

**Status:** Accepted.

**Decision:**

Changes to directly referenced JavaScript assets must use cache-busting/versioning or an equivalent controlled asset pipeline.

**Reason:**

A stale `navigation-v2.js` remained cached after deployment until its URL was versioned.

---

## DEC-008 — Offsite production backups use automated S3-compatible storage

**Status:** Implemented.

**Decision:**

Production backups are uploaded through a GitHub Actions workflow to Backblaze B2 S3-compatible storage, with local retention keeping the newest seven sets.

**Consequences:**

- Scheduled and manually dispatched backup runs must be monitored.
- Credentials must be stored as GitHub secrets and never documented in plaintext.
- Restore testing remains necessary; upload success alone does not prove recoverability.

---

## Template

```markdown
## DEC-XXX — Title

**Status:** Proposed | Accepted | Superseded | Rejected
**Date:** YYYY-MM-DD
**Context:**
**Decision:**
**Alternatives considered:**
**Consequences:**
**Evidence/links:**
```
