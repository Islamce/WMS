# WMS Decision Log

This document records durable product, architecture, data, security, deployment, and operating decisions. New entries must state context, decision, consequences, and status.

## DEC-014 — Analytical movement history is append-only and coverage-gated

**Status:** Proposed on the corrective branch on 2026-08-03; Draft PR
publication pending.

**Context:** Live inventory establishes current on-hand state, while historical
issues/receipts/returns are required to infer movement velocity. Replaying old
transactions into live balances would corrupt stock. Conversely, absence of
rows cannot prove non-movement when the historical window is incomplete.

**Decision:**

- Keep imported analytical movements in `stock_movement_history`; imports must
  never mutate batches, reservations, location stock, or the operational ledger.
- Preserve original ERP movement types and normalize ERP-agnostic categories:
  receipt, issue, return, transfer in/out, adjustment in/out, and reversal.
- Demand includes issues net of returns and issue reversals. Transfers,
  adjustments, receipts, and opening balances do not become consumption.
- A material with stock and no observed issue is `DEAD` only when issue-history
  coverage spans the full configured analysis window. Otherwise it is
  `UNKNOWN`, and the UI must disclose incomplete evidence.
- Existing velocity thresholds and planning formulas remain authoritative; this
  correction changes evidence semantics, not business thresholds.

**Consequences:** Imports require traceable batches, validation, idempotency,
preview/dry-run, reconciliation, rejected rows, and audit evidence. Operational
ledger and completed analytical-import intervals jointly establish coverage,
with the continuity assumption disclosed by the API/UI. Duplicate suppression
across sources requires a strong matching reference; ambiguous rows are not
silently discarded.

**Evidence/links:** `server/services/analytics.js`, migration
`013_canonical_analytical_movements`, Import Center routes/UI, and
`tests/e2e/corrective_integrity_test.py`.

---

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

## DEC-011 — Destructive-by-omission operations must be opt-in and fail closed

**Status:** Accepted on 2026-07-27.

**Context:**

The first-run auto-seed writes a demo dataset *and* a default administrator. Its guard was opt-out and keyed on `NODE_ENV`:

```js
if (NODE_ENV === 'production' && ALLOW_AUTO_SEED !== '1') refuse; else seed;
```

This fails **open**. A deployment whose runtime does not export `NODE_ENV` — easy under managed Node.js/Passenger, and consistent with this project's own observations — falls through to the seed branch. Reproduced on 2026-07-27: booting the real server against a migrated-but-userless database with `NODE_ENV` unset seeded demo data and a default administrator. The result is indistinguishable from "the admin password reset itself", and it masks data loss behind a healthy health check.

**Decision:**

- An operation that destroys or fabricates data as a side effect of *absent* configuration must be **opt-in**: it runs only when a variable is explicitly set to enable it. Absence means refuse.
- Safety must never depend on a variable being *present* to trigger a guard. Guards depend on a variable being present to *unlock* the dangerous path.
- Such a guard requires an executable regression test that fails against the unsafe version.
- Refusal must be loud, name the data-loss possibility, and state what not to do first.

**Alternatives considered:**

- Keep opt-out but check more environment signals: rejected — it multiplies the ways a missing variable produces the unsafe outcome.
- Infer "this is production" from data already in the database: rejected — the incident database was completely empty, indistinguishable from a fresh install, so no data-based signal discriminates.
- Remove auto-seed entirely: rejected — genuine first installs on shell-less platforms rely on it. Opt-in preserves that path while making it deliberate.

**Consequences:**

- A genuine first deploy must start once with `ALLOW_AUTO_SEED=1`, or run `npm run seed`.
- Nothing in CI, Docker, or the devcontainer depended on the implicit path; all already seed explicitly.
- The application logs its database identity every boot, so the "which file is it actually using?" question is answered before it becomes an incident.

**Evidence/links:**

- `INC-2026-07-25-01`, issue #40.
- `server/services/firstRunSeed.js`, `tests/e2e/autoseed_guard_test.py`.
- Test fails against the previous guard (2 end-to-end cases) and passes against the new one (19/19).

---

## DEC-012 — Credential lifecycle and audit rules

**Status:** Accepted on 2026-07-27.

**Context:**

Issue #40 reported that the administrator password "returns to the default" with `must_change_password` set. Investigating the credential paths found three concrete weaknesses, independent of whether that specific report is explained by the auto-seed hazard in `DEC-011`:

1. An administrator resetting another user's password did **not** set `must_change_password`. The administrator knows the interim password, so the account was not solely the user's, yet nothing forced a change.
2. Neither the administrator reset nor the self-service change wrote an audit record, so there was no way to answer "who changed this credential, and when" — precisely the question issue #40 needed answered.
3. `scripts/reset-admin.js` defaulted to publicly known credentials (`admin@example.com` / `Admin@123456`) with no arguments, no production guard, and no confirmation. Worse, when the roles table was empty it ran the **full demo seed** — so a command named "reset-admin" could write a demo dataset into an empty production database.

**Decision:**

- An administrator-initiated password reset **must** set `must_change_password = 1`. A self-service change **must** clear it. The flag encodes "someone other than the account holder knows this password".
- Every credential change is recorded in the append-only audit trail. Passwords and hashes are **never** written to logs or audit records.
- `reset-admin` in production requires an explicit email, an explicit password, and an exact typed confirmation phrase. Built-in default credentials are refused outright.
- `reset-admin` never seeds. An empty roles table is a diagnosis trigger, not an invitation to create data.

**Alternatives considered:**

- Leaving the reset flag to administrator discretion: rejected — it makes the security property optional and unauditable.
- Recording the changed hash in the audit trail for forensics: rejected — it stores credential material in a table designed to be widely readable.
- Removing `reset-admin` entirely: rejected — genuine lock-out recovery needs it. Making it loud and deliberate preserves the capability without the footgun.

**Consequences:**

- Operators must pass three arguments to reset an administrator in production; this is intentional friction.
- `reset-admin` remains **forbidden in production** by `CLAUDE.md`. This hardening is defence in depth for when that rule is broken, not permission to break it.
- The audit trail now answers credential questions directly, which is what issue #40 needs in order to be closed on evidence.

**Evidence/links:**

- Issue #40, `INC-2026-07-25-01`, `DEC-011`.
- `scripts/reset-admin.js`, `server/routes/users.js`, `server/routes/auth.js`, `tests/e2e/password_test.py` (25 checks).

---

## DEC-013 — Native production addons require provenance and atomic rollback

**Status:** Accepted on 2026-08-01.

**Context:**

The Hostinger shared host provides Node 20 ABI 115 and glibc 2.28, while the
observed upstream `better-sqlite3 11.10.0` prebuild requires GLIBC 2.29. A
Rocky Linux 8 build passed compatibility and load checks, but GitHub artifact
quota prevented retaining the binary. The initial recovery draft also replaced
the installed addon before completing host-side validation and did not bind the
fixed artifact name to a source commit.

**Decision:**

- A production native addon is deployable only when built from an explicitly
  verified full source SHA and accompanied by a machine-readable manifest that
  binds it to the dependency version, lockfile hash, Node version and ABI,
  OS/architecture, compiler, GLIBC evidence, and workflow run.
- The source SHA is part of the artifact name. Binary, checksum, manifest, and
  compatibility evidence are retained and reviewed as one artifact set.
- Host compatibility is preflighted against the staged addon before the
  installed addon is modified.
- The currently installed addon is preserved in a timestamped directory.
  Replacement and rollback use same-directory atomic renames and verify hashes
  before and after the operation.
- Native-addon success alone does not authorize application restart. Deployed
  source, effective Passenger safeguards, active database identity/counts, and
  initialization-lock state are independent mandatory gates.
- Artifact-quota remediation begins with an exact read-only inventory. No
  artifact may be deleted without approval of specific artifact IDs and scope.

**Alternatives considered:**

- Use the upstream prebuild: rejected because its observed GLIBC requirement
  exceeds the host runtime.
- Run `npm rebuild` on the shared host: rejected because the required compiler
  toolchain is unavailable and the action would broaden an incident recovery.
- Replace the installed addon and test afterward without a saved prior binary:
  rejected because a failed host load would leave no immediate rollback.
- Treat a successful build log as equivalent to a retained artifact: rejected
  because no checksum-verifiable binary exists to install.

**Consequences:**

- Native recovery has more explicit evidence and operator steps, but every
  binary can be traced to source and reversed without touching production data.
- A full artifact quota is a hard operational blocker rather than a reason to
  weaken artifact retention or bypass provenance.
- Passenger remains stopped until all independent source, environment, data,
  lock, artifact, installation, and rollback gates pass.

**Evidence/links:** PR #53 (merged 2026-08-01), `HOSTINGER-NATIVE-RECOVERY.md`, workflow
`build-hostinger-native.yml`, and `INC-2026-07-31-01`. Executed successfully in production on
2026-08-01 — Passenger restarted on the verified addon; see `INC-2026-07-31-01`'s "Resolution"
section and the 2026-08-01 session-log entry for the full gate-by-gate evidence.

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
