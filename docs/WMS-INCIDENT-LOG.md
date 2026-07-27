# WMS Incident Log

This log records production failures, data-risk events, deployment failures, recoveries, and important near misses. Do not include secrets.

## INC-2026-07-25-01 — Production SQLite files deleted, then an empty database activated

**Status:** Resolved and validated on 2026-07-25. One preventive follow-up remains open (see "Open preventive follow-up").

**Environment:** Production — Hostinger managed Node.js / Passenger.

**Impact:**

- `data/wms.db`, `data/wms.db-wal`, and `data/wms.db-shm` were accidentally deleted.
- Production inventory and authentication data were at risk.
- A later active production database was structurally valid but functionally empty.
- Administrator login failed with `Invalid email or password` because the active `users` table contained zero rows — **not** because the password was wrong.

**Detection and evidence:**

- Initial recovery was taken from an open `/proc/<pid>/fd` descriptor, restoring availability.
- Dashboard later showed 9,746 materials, 1,245 empty bins, zero occupied bins, zero stock.
- Read-only inspection of the active production database then showed: users 0, roles 0, materials 0, warehouses 0.
- Read-only filesystem search found valid recovery databases with: users 9, roles 11, permissions 35, materials 9,746, warehouses 1, schema migrations 10.
- All candidate recovery databases passed `PRAGMA integrity_check`.

**Selected recovery source:**

`/home/u716763642/wms-final-live-copy-20260725-090240/wms.db`

- Size: 32,628,736 bytes
- SHA-256: `02745ba0c34386f7aaab23538dda9ab4ec5b947c9e64f1a1b50b9fb9224c2df4`
- Integrity: `ok`

**Recovery actions:**

1. Created protected safety directory `/home/u716763642/wms-pre-auth-restore-20260725-112132`.
2. Created a SQLite backup of the empty active production database.
3. Copied the selected recovery source into the safety directory.
4. Verified both safety copies with integrity checks and SHA-256 checksums.
5. Identified and stopped only the WMS Passenger process.
6. **Moved** the active empty DB/WAL/SHM files into the safety directory; no files were destroyed.
7. Restored the selected database to `data/wms.db` with restrictive permissions.
8. Revalidated integrity and record counts.
9. Ran `npm run migrate` only — no seed, no account reset.
10. Confirmed `Migrations: up to date (12 recorded)` (source had 10 before restore).
11. Restarted Passenger via `tmp/restart.txt`.

**Validation:**

- Restored database checksum matched the selected recovery source.
- `PRAGMA integrity_check`: `ok`.
- Users 9, roles 11, materials 9,746, warehouses 1, schema migrations 12.
- `/healthz`: HTTP 200 with `{"status":"ok","service":"wms"}`.
- Operator confirmed successful administrator login using the existing account.

**Data-loss assessment:**

- The recovered state contains the confirmed users, roles, permissions, warehouse, and 9,746 material records.
- `batches` and `stock_transactions` were **zero in the validated recovery source**. Zero stock on the dashboard is therefore consistent with the restored data, and material-master count alone does not prove what operational stock existed at the recovery point.
- Opening-stock reconciliation was not applied during this incident.

**Root cause / contributing factors:**

- Production SQLite DB/WAL/SHM files were handled directly.
- Recovery copies and active database state were not clearly distinguished during the earlier restoration sequence.
- The project had no mandatory durable runbook or AI continuity record when the deletion occurred.
- Interactive SSH environment variables printed empty, creating operational ambiguity — see the open follow-up below.

**Corrective and preventive actions:**

- Added `CLAUDE.md` and durable project-memory documents.
- Explicitly prohibited direct deletion of SQLite DB/WAL/SHM files.
- Required read-only discovery before account resets or seeding.
- Required backup, checksum, integrity, process isolation, rollback, and post-restore validation for any database recovery (recorded as `DEC-009`).
- Retained the safety directory pending a reviewed retention decision.
- Continued prohibition of `npm run seed` and `reset-admin` in production.

**Open preventive follow-up (carried to Issue #40):**

- Verify the Passenger **runtime** environment for `NODE_ENV`, `SKIP_AUTO_SEED`, `ALLOW_AUTO_SEED`, `PRODUCTION_INITIALIZATION_ENABLED`, and `DB_PATH`. Code review of `server/index.js` and `server/config.js` shows that an empty database combined with a `NODE_ENV` that is not exactly `production` would cause the application to **auto-seed demo data and a default administrator** rather than refuse to start. This is a plausible mechanism for both this incident and the recurring default-admin symptom in Issue #40, and is not yet confirmed or excluded against the live runtime.
- Establish a tested restore drill and stronger database-file protection controls.

**Owner / next step:** project owner / production maintainer. Next safe step is read-only runtime-environment verification, before any restart or deployment.

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
