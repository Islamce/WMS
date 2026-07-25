# WMS Current Status

Last updated: 2026-07-25

## Executive status

- Repository: `Islamce/WMS`
- Production URL: `https://wms.kynox.io`
- Production platform: Hostinger managed Node.js / Passenger
- Production app path: `~/domains/wms.kynox.io/nodejs`
- Production database: SQLite at `data/wms.db` using WAL mode
- Production runtime: Node `v20.19.4`, npm `10.8.2`
- Current deployed commit: `579b5091cf99ea3c4dfa3f5531202eab546b3a88`
- Health endpoint: healthy, returning `{"status":"ok","service":"wms"}`
- Database migrations: up to date, 12 recorded
- Administrator authentication: restored and user-confirmed successful

## Current production data state after recovery

Latest confirmed database values:

- Users: 9
- Roles: 11
- Permissions: 35
- Materials: 9,746
- Warehouses: 1
- Migrations: 12 recorded
- Database integrity: `ok`

Latest confirmed dashboard values before the final authentication recovery:

- Materials: 9,746
- Empty bins: 1,245
- Occupied bins: 0
- Stock: 0

The values above reflect the recovered database state and must not be assumed to represent intended final operational stock.

## Authentication recovery completed

The login failure was traced to the active production database being structurally valid but functionally empty:

- `users = 0`
- `roles = 0`
- `materials = 0`
- several expected operational tables were absent

Read-only discovery found multiple valid recovery copies. The selected source was:

`/home/u716763642/wms-final-live-copy-20260725-090240/wms.db`

Selected-source evidence:

- SHA-256: `02745ba0c34386f7aaab23538dda9ab4ec5b947c9e64f1a1b50b9fb9224c2df4`
- SQLite integrity check: `ok`
- Users: 9
- Roles: 11
- Permissions: 35
- Materials: 9,746
- Warehouses: 1
- Schema migrations before restore: 10

Recovery procedure completed:

1. Created protected rollback copies.
2. Stopped only the WMS Passenger process.
3. Moved the empty production DB/WAL/SHM files into the safety directory.
4. Restored the selected recovery source to `data/wms.db`.
5. Validated checksum, integrity, and record counts.
6. Ran `npm run migrate` only; no seed or reset command was used.
7. Confirmed `Migrations: up to date (12 recorded)`.
8. Restarted Passenger.
9. Confirmed `/healthz` returned HTTP 200.
10. User confirmed successful login with the existing administrator account.

Safety/rollback directory retained:

`/home/u716763642/wms-pre-auth-restore-20260725-112132`

Do not delete this directory until a later reviewed retention decision.

## Recently completed work

### Production recovery

- Accidental deletion of `data/wms.db`, `data/wms.db-wal`, and `data/wms.db-shm` occurred.
- Database recovered from an open process descriptor under `/proc/<pid>/fd`.
- Subsequent verification found the active production database had become empty.
- A validated final live copy was restored through a controlled rollback-safe procedure.
- `PRAGMA integrity_check` passed before and after restoration.
- Passenger was restarted.
- Health endpoint and administrator login were verified.

### Opening stock historical-date hardening

Merged PR #39 introduced:

- explicit `receiving_date` support for opening stock imports;
- historical receipt-date resolution;
- FIFO date preservation;
- receipt timestamps in stock transactions;
- `receiving_date_source` storage;
- opening-stock batch registry migration;
- safe, registry-scoped reconciliation support;
- protection against touching normal operational goods-receipt batches.

CI Run #145 succeeded before merge.

### Deployment

- PR #39 merged to `main`.
- Merge commit: `579b5091cf99ea3c4dfa3f5531202eab546b3a88`
- Production repository confirmed at that commit.
- Migration completed successfully with 12 migrations recorded.
- Application restart and health check completed successfully.
- Reconciliation has not been applied.

## Important prior milestones

- PR #25: notification improvements and mobile UAT; merged.
- PR #26: production offsite backup automation; configured and tested successfully after correcting credentials.
- PR #33: workflow replay/recovery hardening, mobile approval parity, batch/QR traceability, and governed stock reallocation.
- Static navigation cache mismatch was resolved by versioning `navigation-v2.js` in `public/index.html`.
- Firebase service account configuration and Android device token registration were previously established.

## Known remaining work

- Run and review opening-stock date reconciliation in dry-run mode only.
- Apply reconciliation only after explicit review and approval.
- Complete and validate web/mobile parity gaps where still outstanding.
- Verify production environment variables through the Hostinger runtime configuration; SSH shell variables appeared empty during the recovery session even though migrations and Passenger startup succeeded.
- Establish a tested automated restore drill and clearer database-file protection controls.
- Ensure every future deployment and incident updates the project memory files required by `CLAUDE.md`.

## Production configuration invariants

```text
NODE_ENV=production
SKIP_AUTO_SEED=1
ALLOW_AUTO_SEED=0
PRODUCTION_INITIALIZATION_ENABLED=false
DB_PATH=/home/u716763642/domains/wms.kynox.io/nodejs/data/wms.db
```

The variables above are required runtime invariants. Their absence in an interactive SSH shell does not by itself prove they are absent from Passenger, but the hosting configuration must be verified before future risky operations.

## Commands forbidden in production

```bash
npm run seed
reset-admin
```

Do not delete, replace, truncate, or recreate the SQLite database or WAL files outside an approved and documented recovery procedure.