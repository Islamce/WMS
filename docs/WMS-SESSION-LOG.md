# WMS Session Log

This is the chronological operational memory for the project. It records durable summaries of conversations and work, not secrets or necessarily verbatim transcripts.

## 2026-07-25 — Production database and authentication recovery completed

**Objective:**

Restore the correct production database and administrator access without seeding, resetting accounts, or risking the recovered data.

**Starting state:**

- `/healthz` was healthy.
- Administrator login failed with `Invalid email or password`.
- The active production `users` table contained zero rows.
- Production commands `npm run seed` and `reset-admin` remained prohibited.

**Conversation/request summary:**

- Performed read-only inspection of the users schema and safe account fields.
- Determined that the active production database was empty, not that the password was incorrect.
- Searched all SQLite files under the account for candidate recovery copies.
- Compared candidate databases for integrity, users, roles, permissions, materials, warehouses, migrations, and timestamps.
- Selected a validated final live copy and executed a rollback-safe restoration.
- User confirmed successful login after restart.

**Evidence/results:**

Active empty database before restoration:

- integrity: `ok`
- users: 0
- roles: 0
- materials: 0
- warehouses: 0

Selected source:

`/home/u716763642/wms-final-live-copy-20260725-090240/wms.db`

- SHA-256: `02745ba0c34386f7aaab23538dda9ab4ec5b947c9e64f1a1b50b9fb9224c2df4`
- integrity: `ok`
- users: 9
- roles: 11
- permissions: 35
- materials: 9,746
- warehouses: 1
- migrations before restore: 10

Safety directory:

`/home/u716763642/wms-pre-auth-restore-20260725-112132`

Safety files included:

- `current-empty-production.db`
- `production-empty-before-restore.db`
- `production-empty-before-restore.db-wal`
- `production-empty-before-restore.db-shm`
- `selected-recovery-source.db`

**Commands/actions:**

- Used read-only SQLite/Node inspection only during diagnosis.
- Created SQLite and file-level safety copies.
- Verified integrity and checksums.
- Stopped only the WMS Passenger process.
- Moved the empty active DB/WAL/SHM files into the safety directory.
- Copied the selected source to `data/wms.db` and set mode `600`.
- Ran `npm run migrate`; result: `Migrations: up to date (12 recorded)`.
- Restarted Passenger via `tmp/restart.txt`.
- Confirmed `/healthz` returned HTTP 200 and `{"status":"ok","service":"wms"}`.

**Decisions:**

- Did not run seed or reset-admin.
- Restored the complete validated database rather than copying individual user records.
- Retained all displaced database and WAL files for rollback.
- Kept opening-stock reconciliation unapplied.

**Risks/incidents:**

- Interactive SSH variables `NODE_ENV`, `SKIP_AUTO_SEED`, `ALLOW_AUTO_SEED`, and `DB_PATH` printed empty. This does not prove Passenger lacks them, but Hostinger runtime configuration needs verification.
- The recovered state has zero batches and stock transactions; intended operational stock cannot be inferred from material-master count alone.

**Production state:**

- health: healthy
- database integrity: `ok`
- users: 9
- materials: 9,746
- migrations: 12
- administrator login: user-confirmed successful
- reconciliation: not applied

**Remaining work:**

- Preserve the safety directory until a reviewed retention decision.
- Verify Passenger/runtime environment variables.
- Perform opening-stock reconciliation dry-run only and review the output.
- Establish a repeatable restore drill and stronger DB-file protection.

**Exact next step:**

Run the authenticated opening-stock date reconciliation endpoint with `apply: false`, capture the complete result, and review it before any apply operation.

---

## 2026-07-25 — Project memory system and authentication follow-up

**Objective:**

Prevent repeated loss of context between AI sessions and continue production recovery safely.

**Confirmed starting state:**

- Production commit: `579b5091cf99ea3c4dfa3f5531202eab546b3a88`
- Node: `v20.19.4`
- npm: `10.8.2`
- Migrations: 12 recorded, up to date
- Health endpoint: healthy
- Administrator login: failing with `Invalid email or password`
- Opening-stock reconciliation: not applied

**Actions:**

- User requested a durable reference shared by Claude and ChatGPT.
- Added mandatory AI operating instructions and project-memory documents on branch `docs/project-memory-and-runbook`.
- Recorded production safeguards, incidents, decisions, current status, and future documentation protocol.

**Result:**

- PR #41 merged with durable project-memory files.
- The authentication follow-up was later resolved in the recovery session recorded above.

---

## 2026-07-25 — PR #39 deployment

**Objective:** Deploy FIFO-safe historical opening-stock date support.

**Evidence:**

- PR #39 merged.
- CI Run #145 succeeded.
- Merge/deployed commit: `579b5091cf99ea3c4dfa3f5531202eab546b3a88`
- `npm run migrate` result: `Migrations: up to date (12 recorded).`
- Health response: `{"status":"ok","service":"wms"}`

**Result:** Deployment technically healthy. Reconciliation not applied. Login failure discovered afterward and later resolved.

---

## 2026-07-25 — Production database recovery

**Objective:** Recover production after accidental deletion of SQLite database files.

**Actions and evidence:**

- Recovered database from an open `/proc/<pid>/fd` descriptor.
- Validation copy: `/home/u716763642/wms-recovery-validation-20260725-085901/wms.db`
- Integrity and quick checks passed.
- Restored to the production path and restarted Passenger.
- Health check passed.
- Dashboard showed 9,746 materials, 1,245 empty bins, zero occupied bins, and zero stock.

**Result:** Initial recovery restored application availability. A later empty active database and authentication failure required the controlled restoration documented above.

---

## 2026-07-23 to 2026-07-24 — Workflow, reallocation, import, and cache work

**Highlights:**

- PR #33 delivered workflow replay/recovery hardening, mobile approval parity, batch/QR traceability, migration 009, governed stock reallocation, segregation of duties, audit, notifications, replay safety, and stock/freeze revalidation.
- Production navigation initially appeared unchanged because of a stale browser asset.
- Added cache-busting query parameter to `navigation-v2.js`; user confirmed the fix worked.
- New requirements captured around durable test/real data, issue-transaction uploads, analytics inputs, and a controlled Start Fresh capability.
- Opening-stock import and historical FIFO concerns led to the later PR #39 work.

---

## 2026-07-20 — Notifications and offsite backup

**Highlights:**

- PR #25 notification/mobile UAT work merged.
- Firebase service account path configured with restrictive permissions.
- Android device token present for the system administrator.
- PR #26 added offsite backup automation.
- Initial Backblaze upload failed because of malformed access-key configuration.
- Credentials were corrected and a manually triggered production offsite backup completed successfully.
- Local retention decision: keep newest seven backup sets.

---

## 2026-07-18 and earlier — Deployment foundation

**Highlights:**

- Hostinger production established under Passenger with `app.js` leading to `server/index.js`.
- `/healthz` used for availability checks.
- Node 20 selected for compatibility with native dependencies.
- Git remote switched to SSH and authenticated successfully.
- APK build and checksum workflows established.
- Migration and deployment sequence standardized around fast-forward pull, dependency install, migrate, Passenger restart, and health validation.

---

## Future entry template

```markdown
## YYYY-MM-DD — Session title

**Objective:**
**Starting state:**
**Conversation/request summary:**
**Files/code inspected:**
**Commands/actions:**
**Evidence/results:**
**Decisions:**
**Risks/incidents:**
**Files/PRs/commits changed:**
**Production state:**
**Remaining work:**
**Exact next step:**
```

Every future AI or human session that changes understanding, code, data, configuration, deployment, or plans must append an entry before completion.