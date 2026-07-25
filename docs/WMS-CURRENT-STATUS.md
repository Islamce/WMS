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

## Current production data state after recovery

Latest confirmed dashboard values:

- Materials: 9,746
- Empty bins: 1,245
- Occupied bins: 0
- Stock: 0

The values above reflect the recovered database state and must not be assumed to represent intended final operational stock.

## Current blocking issue

Administrator login currently fails with `Invalid email or password` after the database recovery and deployment verification.

Required approach:

1. Read-only inspection of the `users` table schema and non-secret account fields.
2. Confirm which administrator account records exist and whether they are active.
3. Inspect authentication code and historical account setup before proposing any mutation.
4. Do not run seed or reset-admin commands.

## Recently completed work

### Production recovery

- Accidental deletion of `data/wms.db`, `data/wms.db-wal`, and `data/wms.db-shm` occurred.
- Database recovered from an open process descriptor under `/proc/<pid>/fd`.
- `PRAGMA integrity_check` passed.
- `PRAGMA quick_check` passed.
- Recovered database was restored to the production path.
- Passenger was restarted.
- Health endpoint and application availability were verified.

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

- Resolve administrator authentication safely.
- Run and review opening-stock date reconciliation in dry-run mode only after authentication is restored.
- Apply reconciliation only after explicit review and approval.
- Complete and validate web/mobile parity gaps where still outstanding.
- Ensure every future deployment and incident updates the project memory files required by `CLAUDE.md`.

## Production configuration invariants

```text
NODE_ENV=production
SKIP_AUTO_SEED=1
ALLOW_AUTO_SEED=0
PRODUCTION_INITIALIZATION_ENABLED=false
DB_PATH=/home/u716763642/domains/wms.kynox.io/nodejs/data/wms.db
```

## Commands forbidden in production

```bash
npm run seed
reset-admin
```

Do not delete, replace, truncate, or recreate the SQLite database or WAL files outside an approved and documented recovery procedure.
