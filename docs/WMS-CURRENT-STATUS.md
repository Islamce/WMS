# WMS Current Status

Last updated: 2026-08-01

## Executive status

- Repository: `Islamce/WMS`
- Production URL: `https://wms.kynox.io`
- Production platform: Hostinger managed Node.js / Passenger
- Production app path: `~/domains/wms.kynox.io/nodejs`
- Production database: SQLite at `data/wms.db` using WAL mode
- Production runtime: Node `v20.19.4`, npm `10.8.2`
- Current deployed commit (Verified (production), 2026-08-01): `1bd15f12d70112a977983a96bae63e1b3c441310`
- Active Passenger release: `.builds/versions/manual-20260801T202313Z-1bd15f12/nodejs`
- Health endpoint: healthy, returning `{"status":"ok","service":"wms"}` on 2026-08-01.
- Database migrations: 12 recorded in production as of the 2026-07-25 check; 12 defined in code on `main` (latest `012_opening_stock_batch_registry`)
- Latest offsite backup reviewed during PR #53 recovery: GitHub Actions `production-backup.yml` run #15 on 2026-07-31, conclusion **success**
- Latest CI reviewed for Draft PR #53: run #174, conclusion **success**

### Evidence classification

### Production recovery update (supersedes the open native-recovery section below)

The Hostinger native recovery completed on 2026-08-01 in an explicitly
approved production window. Artifact `8823437402` from workflow run
`30716270013` passed checksum, provenance, Node 20 / ABI 115, GLIBC 2.28,
dependency, module-load, query, and read-only database preflight gates. The
active addon SHA-256 is
`a9c4d701f59a492c538416211cc3e65257f1d74e3e4ce3d8d9862e1981676dc4`.

Passenger's effective root is `.builds/current/nodejs`. An isolated release at
source `1bd15f12...` was prepared with install scripts disabled, then the
verified addon was installed. The selected recovery source `02745ba0...` was
copied to an isolated candidate, migrated from 10 to 12 without seed or
initialization, validated, and atomically installed at the persistent DB path.
Post-start counts are `9|11|35|9746|1|12|0|0`; integrity is `ok`.

The effective Passenger process has all five required values, no initialization
lock exists, and `/healthz` returns HTTP 200. Rollback evidence is retained at
`backups/emergency/production-recovery-20260801T202313Z/`. Remaining closure is
operator login confirmation and read-only application smoke checks.

Facts in this document are labelled as follows and must not be silently upgraded:

- **Verified (repo):** confirmed directly against Git/GitHub in the stated session.
- **Reported (production):** observed by the operator during a production session and recorded here. Trustworthy as a record, but re-verify before relying on it for a risky operation.
- **Unverified:** believed but not currently evidenced. Must be re-checked before use.

## Hostinger native-addon recovery — OPEN, restart forbidden

**Verified (repo/GitHub), 2026-07-31 to 2026-08-01:** Draft PR #53
(`agent/hostinger-glibc228-native-recovery`) adds a controlled build and recovery
path for `better-sqlite3 11.10.0` on the Hostinger shared host's Node 20 / ABI
115 / glibc 2.28 runtime.

The PR #53 native workflow successfully reached and passed the Rocky Linux 8
source build, Node ABI check, GLIBC 2.28 symbol ceiling, module load, and
in-memory SQLite query. The job then failed at `actions/upload-artifact` because
GitHub Actions artifact storage quota was full. **No downloadable recovery
artifact was retained.** This is an operational blocker, not evidence that the
binary failed compatibility checks.

The merge-readiness correction now requires:

- exact deployed branch/SHA and artifact-source SHA agreement;
- the five required variables read from the effective WMS Passenger process,
  not inferred from an interactive shell;
- the active production DB path, integrity, reviewed record counts, SQLite file
  state, and initialization-lock state before restart;
- manifest-bound artifact provenance, staged-addon host preflight, preservation
  of the installed addon, atomic replacement, and a validated immediate rollback
  path.

Passenger restart remains forbidden until every gate passes and the evidence is
reviewed. No production access, database operation, Passenger restart, artifact
deletion, or PR merge occurred while making this correction.

**Historical CI follow-up, 2026-08-01:** CI passed on PR head `41e2cde`, but native-build
run `30667043301` stopped before compilation because Git rejected the
container-owned checkout as a dubious directory. The workflow now scopes each
container-side Git command with `-c safe.directory="$GITHUB_WORKSPACE"`; it does
not add a global or wildcard trust rule. That run never reached upload; later
runs established the current artifact path recorded below.

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

## Auto-seed hazard — DEMONSTRATED, fixed in code, NOT YET DEPLOYED

**Status (2026-07-27): the mechanism is proven by executable test, the fix is merged to `main`, and production is not yet known to have it.**

The behaviour below was confirmed empirically, not merely by reading code. Booting the real server against a migrated-but-userless database with `NODE_ENV` unset caused it to seed demo data and a default administrator. `tests/e2e/autoseed_guard_test.py` fails against the old guard and passes against the new one, so this is now a pinned regression rather than an opinion.

**Fix:** auto-seed is now **opt-in** (`ALLOW_AUTO_SEED=1`). Absence of configuration means refuse. Safety no longer depends on `NODE_ENV` being present. The server also logs a database identity line (`[db] path=… size=… users=… migrations=…`) on every boot, and prints a `[CRITICAL]` warning when it declines to seed an empty database.

**Still open:** whether this ever actually fired in production. That requires the runtime-environment read-out below and is the remaining evidence needed to close Issue #40.

### Original analysis (retained for the record)

**Was: hypothesis, code-verified, production-unverified. Directly relevant to Issue #40.**

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

1. **Complete PR #53 merge-readiness evidence, then execute recovery gates only in an approved production window.** The current PR head must have successful CI and native-build checks plus a retained, SHA-named artifact whose four files were independently inspected for binary checksum, source and lockfile provenance, Node/ABI, ELF architecture, GLIBC evidence checksum, and the GLIBC 2.28 ceiling. Record the exact current head, run, artifact ID, checksum, and expiry in the PR description after the final build rather than committing self-invalidating transient identifiers here. Production access, staged host preflight, database/environment/source gates, addon backup/swap/rollback, and Passenger restart remain separately approval-gated; do not restart Passenger yet.
2. **Resolve the auto-seed / runtime-environment question above.** Read `NODE_ENV`, `SKIP_AUTO_SEED`, `ALLOW_AUTO_SEED`, `PRODUCTION_INITIALIZATION_ENABLED`, and `DB_PATH` as the **Passenger process** sees them, not as an interactive SSH shell reports them. This is also a mandatory pre-restart gate in `HOSTINGER-NATIVE-RECOVERY.md`.
3. **Verify production's deployed commit read-only** and reconcile it to `main`. Production is not known to contain PR #43 or later safety hardening.
   - **Open advisory (2026-07-27):** production may have been operated against an isolated database copy on the `hotfix/opening-stock-idempotency` branch during PR #43 verification. Confirm the checked-out branch and commit before deploying; do not assume production reflects PR #43 or any later merge.
4. **Verify the production-initialization lock**, including whether any lock file exists outside the code-expected `<app>/data/` path. A lock in the wrong location does not prove the application is locked.
5. Complete the reviewed native-addon recovery gates. Keep Passenger stopped until source, environment, database, lock, artifact, preflight, atomic swap, and rollback evidence all pass.
6. Deploy approved `main` through `WMS-PRODUCTION-RUNBOOK.md` once items 1–5 are settled. Do **not** re-import Opening Stock into production before PR #43 is confirmed deployed.
7. Run opening-stock date reconciliation in **dry-run mode only** (`apply: false`) and review the output; apply only after explicit review and approval.
8. Complete the cross-table stock consistency audit required by Issue #40 (batches vs `material_location_stock` vs `stock_transactions` vs dashboard KPIs). Needs real data and production access. The **code**-hardening asks in Issue #40 are done: auto-seed fails closed, a database identity line is logged every boot, `reset-admin` refuses default credentials and never seeds, and every credential change is audited (`DEC-011`, `DEC-012`).
9. Complete and validate web/mobile parity gaps where still outstanding.
10. Ensure every future deployment and incident updates the project memory files required by `CLAUDE.md`.

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
