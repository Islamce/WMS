# WMS Incident Log

This log records production failures, data-risk events, deployment failures, recoveries, and important near misses. Do not include secrets.

## INC-2026-07-25-01 — Production SQLite files deleted

**Status:** Recovered; follow-up authentication issue remains open.

**Impact:**

- `data/wms.db`, `data/wms.db-wal`, and `data/wms.db-shm` were accidentally deleted.
- Production inventory data and authentication data were at risk.

**Recovery:**

- Located a still-open database file descriptor under `/proc/<pid>/fd`.
- Recovered the database to:
  `/home/u716763642/wms-recovery-validation-20260725-085901/wms.db`
- Ran SQLite integrity validation.
- `PRAGMA integrity_check`: OK.
- `PRAGMA quick_check`: OK.
- Restored the recovered database to the production database path.
- Restarted Passenger.
- Verified `/healthz` returned healthy.
- Verified dashboard counts:
  - Materials: 9,746
  - Empty bins: 1,245
  - Occupied bins: 0
  - Stock: 0

**Contributing factors:**

- Production database files were handled directly.
- The project did not yet have a mandatory, durable production runbook and AI continuity file.

**Corrective actions:**

- Added `CLAUDE.md` and durable project-memory documents.
- Explicitly prohibited direct deletion of SQLite database/WAL/SHM files.
- Required consistent database backup and integrity validation before mutations.
- Required read-only diagnosis before account resets or seeding.

**Open follow-up:**

- Previously used administrator credentials now fail with `Invalid email or password`.
- Investigate the recovered `users` records and authentication code read-only before any change.

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
