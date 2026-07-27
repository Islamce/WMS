# WMS Current Status

Last updated: 2026-07-27

## Executive status

- Repository: `Islamce/WMS`
- Production URL: `https://wms.kynox.io`
- Production platform: Hostinger managed Node.js / Passenger
- Production app path: `~/domains/wms.kynox.io/nodejs`
- Production database: SQLite at `data/wms.db` using WAL mode
- Production runtime: Node `v20.19.4`, npm `10.8.2`
- Current deployed commit (last confirmed on production, 2026-07-25): `579b5091cf99ea3c4dfa3f5531202eab546b3a88`
- `main` branch head (verified 2026-07-27, **not** confirmed deployed): `b9ec782dddfd3e57dbb3448f9906b340427bb2f4`
- Production is therefore **behind `main` by three merges** (PR #41 → PR #43 → PR #44) and is **not** known to contain the PR #43 opening-stock idempotency fix.
- Health endpoint: healthy, returning `{"status":"ok","service":"wms"}` (as of the 2026-07-25 recovery check; not re-verified since)
- Database migrations: 12 recorded in production as of the 2026-07-25 check; 12 defined in code on `main` (latest `012_opening_stock_batch_registry`)
- Latest offsite backup: GitHub Actions `production-backup.yml` run #11, `2026-07-27T06:03:54Z`, scheduled, conclusion **success**
- Latest CI on `main`: run #155 on `b9ec782`, conclusion **success**

### Evidence classification

Facts in this document are labelled as follows and must not be silently upgraded:

- **Verified (repo):** confirmed directly against Git/GitHub in the stated session.
- **Reported (production):** observed by the operator during a production session and recorded here. Trustworthy as a record, but re-verify before relying on it for a risky operation.
- **Unverified:** believed but not currently evidenced. Must be re-checked before use.

## Current production data state after recovery

Database record counts (**Reported (production)**, 2026-07-25, post-restore):

- Users: 9
- Roles: 11
- Permissions: 35
- Materials: 9,746
- Warehouses: 1
- Schema migrations: 12
- Database integrity: `ok`

Dashboard values (**Reported (production)**, 2026-07-25):

- Materials: 9,746
- Empty bins: 1,245
- Occupied bins: 0
- Stock: 0

The zero stock figure is **expected and consistent**, not evidence of further loss: the validated recovery source itself contained zero `batches` and zero `stock_transactions`. Material-master count alone cannot establish what operational stock existed at the recovery point. These values do not represent intended final operational stock, which still requires controlled Opening Stock loading and reconciliation.

## Administrator authentication — RESOLVED (2026-07-25)

Earlier revisions of this document stated that administrator login was an open blocking issue. **That statement was stale and is superseded by this section.**

The login failure was **not** a credential problem. It was traced to the active production database being structurally valid but functionally empty (`users = 0`, `roles = 0`, `materials = 0`). Restoring a validated recovery copy resolved it, and the operator confirmed a successful login with the existing administrator account. No seed and no `reset-admin` were used.

See `WMS-INCIDENT-LOG.md` → `INC-2026-07-25-01` for the full evidence chain, selected-source checksum, and rollback directory.

## Open risk — auto-seed can fire on an empty database if runtime env is not set

**Status: hypothesis, code-verified, production-unverified. Directly relevant to Issue #40.**

Reading `server/index.js` against `server/config.js` on `main`:

1. If `SKIP_AUTO_SEED` is not `1`, the first-run auto-seed block executes.
2. If the active database has `users = 0`, it reaches the production guard.
3. The guard is `NODE_ENV === 'production' && ALLOW_AUTO_SEED !== '1'`. If **`NODE_ENV` is not exactly `production`**, the guard does not trigger and control falls through to `require('./db/seed').seed()`.

Consequence: on an empty database with an unset or non-`production` `NODE_ENV`, the application will **create demo data and the default administrator automatically**, with `must_change_password = 1`.

This single mechanism is consistent with **both** symptoms reported in Issue #40 — an unexpectedly empty database and an administrator password that appears to revert to the default — without anyone ever invoking `reset-admin`.

The 2026-07-25 recovery session reported that `NODE_ENV`, `SKIP_AUTO_SEED`, `ALLOW_AUTO_SEED`, and `DB_PATH` printed **empty** in an interactive SSH shell. An interactive shell does not necessarily share the Passenger runtime environment, so this is **not yet proof**. It must be resolved by reading the environment as the application process actually sees it, before any deployment or restart.

Related: `server/services/reset.js` derives the production-initialization lock from the application directory (`<app>/data/production-initialization.lock.json`), **not** from `DB_PATH`. If `DB_PATH` were ever repointed outside the app directory, the lock and the database would decouple.

## Recently completed work

### Production recovery

- Accidental deletion of `data/wms.db`, `data/wms.db-wal`, and `data/wms.db-shm` occurred.
- An initial recovery was taken from an open process descriptor under `/proc/<pid>/fd`, which restored availability.
- Subsequent verification found the **active** production database had become functionally empty (`users = 0`), which is what caused the administrator login failure.
- A validated final live copy was then restored through a controlled, rollback-safe procedure.
- `PRAGMA integrity_check` passed before and after restoration.
- Passenger was restarted.
- Health endpoint, record counts, and administrator login were verified.

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

Ordered by priority. Item 1 gates the rest.

1. **Resolve the auto-seed / runtime-environment question above.** Read `NODE_ENV`, `SKIP_AUTO_SEED`, `ALLOW_AUTO_SEED`, `PRODUCTION_INITIALIZATION_ENABLED`, and `DB_PATH` as the **Passenger process** sees them, not as an interactive SSH shell reports them. Until this is settled, any restart or deployment carries a residual risk of auto-seeding if the database is ever observed empty.
2. **Verify production's deployed commit read-only** and reconcile it to `main`. Production is behind by three merges and is not known to contain PR #43.
   - **Open advisory (2026-07-27):** production may have been operated against an isolated database copy on the `hotfix/opening-stock-idempotency` branch during PR #43 verification. Confirm the checked-out branch and commit before deploying; do not assume production reflects PR #43 or any later merge.
3. **Verify the production-initialization lock**, including whether any lock file exists outside the code-expected `<app>/data/` path. A lock in the wrong location does not prove the application is locked.
4. Deploy PR #43 (opening-stock import idempotency) through `WMS-PRODUCTION-RUNBOOK.md` once items 1–3 are settled. Do **not** re-import Opening Stock into production before this fix is confirmed deployed.
5. Run opening-stock date reconciliation in **dry-run mode only** (`apply: false`) and review the output; apply only after explicit review and approval.
6. Complete the cross-table stock consistency audit required by Issue #40.
7. Complete and validate web/mobile parity gaps where still outstanding.
8. Ensure every future deployment and incident updates the project memory files required by `CLAUDE.md`.

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
