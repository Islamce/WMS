# WMS Incident Log

This log records production failures, data-risk events, deployment failures, recoveries, and important near misses. Do not include secrets.

## INC-2026-07-25-01 — Production SQLite files deleted and empty database activated

**Status:** Resolved and validated on 2026-07-25.

**Environment:** Production — Hostinger managed Node.js / Passenger.

**Impact:**

- `data/wms.db`, `data/wms.db-wal`, and `data/wms.db-shm` were accidentally deleted.
- Production inventory and authentication data were at risk.
- A later active production database was structurally valid but functionally empty.
- Administrator login failed with `Invalid email or password` because the active `users` table contained zero rows.

**Detection and evidence:**

- Initial database recovery was performed from an open `/proc/<pid>/fd` descriptor.
- Dashboard later showed 9,746 materials, 1,245 empty bins, zero occupied bins, and zero stock.
- Read-only inspection of the active production database subsequently showed:
  - users: 0
  - roles: 0
  - materials: 0
  - warehouses: 0
- Filesystem-wide read-only inspection found valid recovery databases with:
  - users: 9
  - roles: 11
  - permissions: 35
  - materials: 9,746
  - warehouses: 1
  - schema migrations: 10
- All candidate recovery databases passed `PRAGMA integrity_check`.

**Selected recovery source:**

`/home/u716763642/wms-final-live-copy-20260725-090240/wms.db`

- Size: 32,628,736 bytes
- SHA-256: `02745ba0c34386f7aaab23538dda9ab4ec5b947c9e64f1a1b50b9fb9224c2df4`
- Integrity: `ok`

**Recovery actions:**

1. Created protected safety directory:
   `/home/u716763642/wms-pre-auth-restore-20260725-112132`
2. Created SQLite backup of the empty active production database.
3. Copied the selected recovery source into the safety directory.
4. Verified both safety copies with integrity checks and SHA-256 checksums.
5. Identified and stopped only the WMS Passenger process.
6. Moved the active empty DB/WAL/SHM files into the safety directory; no files were destroyed.
7. Restored the selected database to `data/wms.db`.
8. Set restrictive permissions on the restored database.
9. Revalidated integrity and counts.
10. Ran `npm run migrate` only.
11. Confirmed `Migrations: up to date (12 recorded)`.
12. Restarted Passenger via `tmp/restart.txt`.

**Validation:**

- Restored database checksum matched the selected recovery source.
- `PRAGMA integrity_check`: `ok`.
- Users: 9.
- Roles: 11.
- Materials: 9,746.
- Warehouses: 1.
- Schema migrations after migration: 12.
- `/healthz`: HTTP 200 with `{"status":"ok","service":"wms"}`.
- User confirmed successful administrator login using the existing account.

**Data-loss assessment:**

- The selected recovered state contains the confirmed users, roles, permissions, warehouse, and 9,746 material records.
- Batches and stock transactions were zero in the validated recovery source.
- The recovered dashboard state therefore does not prove that intended operational stock existed at the recovery point.
- Opening-stock reconciliation was not applied during this incident.

**Root cause / contributing factors:**

- Production SQLite DB/WAL/SHM files were handled directly.
- Recovery copies and active database state were not clearly distinguished during the earlier restoration sequence.
- The project did not yet have a mandatory durable runbook and AI continuity record when the deletion occurred.
- Interactive SSH environment variables appeared empty, creating additional operational ambiguity, although migrations and Passenger execution succeeded.

**Corrective and preventive actions:**

- Added `CLAUDE.md` and durable project-memory documents.
- Explicitly prohibited direct deletion of SQLite DB/WAL/SHM files.
- Required read-only discovery before account resets or seeding.
- Required backup, checksum, integrity, process isolation, rollback, and post-restore validation for database recovery.
- Retained the safety directory pending reviewed retention approval.
- Continue to prohibit `npm run seed` and `reset-admin` in production.
- Add a tested restore drill and verify Passenger runtime environment configuration.

**Owner / next step:**

- Owner: project owner / production maintainer.
- Next safe functional step: opening-stock date reconciliation dry-run only (`apply: false`), followed by explicit review.

---

## INC-2026-07-23-01 — Stale browser navigation JavaScript

**Status:** Resolved.

**Symptoms:**

- New navigation behavior was deployed but the browser continued using stale JavaScript.
- No useful console errors appeared.

**Resolution:**

- Versioned the navigation script URL in `public/index.html`:
  `navigation-v2.js?v=69c3de1a`
- Restarted the application.
- User confirmed the navigation worked.

**Lesson:**

- Static asset changes require cache-busting or a controlled asset versioning strategy.

---

## INC-2026-07-20-01 — Offsite backup upload rejected

**Status:** Resolved.

**Symptoms:**

- GitHub Actions offsite backup failed with `InvalidAccessKeyId` / malformed access-key configuration.

**Resolution:**

- Corrected Backblaze B2 S3-compatible credentials/configuration.
- Re-ran the workflow successfully.
- Confirmed production offsite backup summary and retention behavior.

**Lesson:**

- Validate credential format and endpoint configuration with a manual workflow run before relying on scheduled backups.

---

## INC-2026-07-14-01 — Node process port already in use

**Status:** Resolved historically.

**Symptoms:**

- Application start failed with `EADDRINUSE` on port 3000.

**Lesson:**

- Inspect the active process and hosting runtime before starting a second Node process manually under Passenger-managed hosting.

---

## Required format for future incidents

For every incident record:

- ID and title
- Date/time and environment
- Status
- User-visible and technical impact
- Detection
- Evidence
- Timeline
- Root cause or current hypothesis
- Recovery actions
- Validation
- Data-loss assessment
- Corrective/preventive actions
- Owner and next step
- Related PR, issue, commit, workflow run, or session-log entry