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

## DEC-009 — SQLite production recovery requires an isolated, rollback-safe procedure

**Status:** Accepted on 2026-07-25.

**Context:**

A production deletion incident and a subsequent empty active database caused authentication failure. Multiple database copies existed, and choosing or replacing one without evidence could have caused further loss.

**Decision:**

Any production SQLite restoration must use the following controlled sequence:

1. Diagnose candidates read-only.
2. Record source path, size, checksum, integrity, schema/migration state, and key record counts.
3. Create independent safety copies of both the active database and the selected source.
4. Stop only the WMS application process; do not touch unrelated services.
5. Preserve the active DB/WAL/SHM files by **moving** them into a protected rollback directory; never delete them.
6. Restore the selected source with restrictive permissions.
7. Validate checksum, integrity, and key counts before application startup.
8. Run reviewed migrations only; never seed or reset accounts as part of restoration.
9. Restart Passenger and validate health, authentication, migrations, and business counts.
10. Retain the rollback directory until an explicit reviewed retention decision.

**Alternatives considered:**

- Resetting only the administrator account: rejected — the active database was missing far more than credentials, so a reset would have masked the real fault.
- Seeding production: rejected — it would create demo data and obscure the recovery state.
- Copying individual user rows: rejected — the complete validated database was the safer, internally consistent recovery unit.

**Consequences:**

- Recovery takes longer but has a clear rollback path and evidence trail.
- WAL/SHM handling is treated as part of database state, not incidental files.
- Candidate database filenames alone are insufficient; integrity and business counts must be checked.
- Restore drills and runtime-environment verification become required follow-up controls.

**Evidence/links:**

- Incident `INC-2026-07-25-01`.
- Selected source SHA-256: `02745ba0c34386f7aaab23538dda9ab4ec5b947c9e64f1a1b50b9fb9224c2df4`.
- Final validation: 9 users, 9,746 materials, 12 migrations, HTTP 200 health, successful administrator login.

---

## DEC-010 — Project-memory facts must be labelled by evidence class

**Status:** Accepted on 2026-07-27.

**Context:**

`docs/WMS-CURRENT-STATUS.md` on `main` continued to state that administrator login was an open blocking issue for two days after it had been resolved, because the correcting change sat in an unmerged PR that had gone stale and conflicted. A later session then re-copied the stale claim forward into a new merged commit, compounding it. Documentation drift of this kind directly threatens production safety, because operators and AI agents use these files as the basis for risky decisions.

**Decision:**

- Every durable status fact is labelled **Verified (repo)**, **Reported (production)**, or **Unverified**, and a fact may not be silently promoted to a stronger class.
- A session must reconcile against **open** pull requests before restating a status fact, not only against `main`.
- Documentation PRs that record production evidence are merged promptly or closed and superseded; they must not be left open to drift out of mergeability.
- When a merged document is found to be wrong, the correction states plainly that the earlier statement was stale rather than quietly editing it away.

**Alternatives considered:**

- Relying on reviewer vigilance alone: rejected — it already failed twice in this project.
- Treating `main` as automatically authoritative: rejected — this is exactly what produced the error, since the newer truth was in an open PR.

**Consequences:**

- Status documents become slightly more verbose but far less dangerous to act on.
- Unverified claims are visibly unverified, so a reader can tell what still needs checking before a deployment.

**Evidence/links:**

- PR #42 (closed, superseded), PR #44 (propagated the stale claim), this reconciliation PR.

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
