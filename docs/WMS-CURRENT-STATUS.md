# WMS Current Status

Last updated: 2026-08-04

## Executive status

- Repository: `Islamce/WMS`
- Production URL: `https://wms.kynox.io`
- Production platform: Hostinger managed Node.js / Passenger
- Production app path: `~/domains/wms.kynox.io/nodejs`
- Production database: SQLite at `data/wms.db` using WAL mode
- Production runtime: Node `v20.19.4`, npm `10.8.2`
- Current deployed commit (**Reported (production), 2026-08-01; independently corroborated 2026-08-04** — see the resolved section below): `1bd15f12d70112a977983a96bae63e1b3c441310` (PR #53 merge commit). This commit contains PR #43 (opening-stock idempotency), PR #46 (auto-seed fail-closed), PR #48 (credential hardening), PR #49 (opening-stock validation harness), and PR #53 (Hostinger native-addon recovery).
- `main` branch head (Verified (repo), 2026-08-04): `065736cbda165dfc73478e2f6ce43468a0d63304`. Production is 3 commits behind; the only difference is unrelated `chore(kaaf)` architecture-tooling vendoring, not application code — production is not missing any shipped feature or fix.
- Health endpoint: healthy, returning `{"status":"ok","service":"wms"}` (**Reported (production)** during the 2026-08-01 recovery; **independently re-verified** live by this session on 2026-08-04).
- Database migrations: 12 recorded in production; unchanged by the native-addon recovery, which replaces only the installed `better-sqlite3` binary and never touches the database. 12 defined in code at the deployed commit.
- Latest offsite backup reviewed during PR #53 recovery: GitHub Actions `production-backup.yml` run #15 on 2026-07-31, conclusion **success**. **Verified (repo), 2026-08-10:** every run since (#16–#25, 2026-08-01 through 2026-08-10, 10 consecutive days) has failed — see `INC-2026-08-06-01` in `WMS-INCIDENT-LOG.md`. Run #25 (2026-08-10) shows a new, more serious signature: `Permission denied (publickey,password)` — the backup SSH key is now being rejected outright, not just hitting a broken shell or a timeout. No offsite backup has succeeded since 2026-07-31.
- PR #53 merged 2026-08-01; its CI and native-build checks were green at merge (see `WMS-INCIDENT-LOG.md` → `INC-2026-07-31-01` for the full artifact/inspection history).

### Evidence classification

Facts in this document are labelled as follows and must not be silently upgraded:

- **Verified (repo):** confirmed directly against Git/GitHub in the stated session.
- **Reported (production):** observed by the operator during a production session and recorded here. Trustworthy as a record, but re-verify before relying on it for a risky operation.
- **Unverified:** believed but not currently evidenced. Must be re-checked before use.

## Hostinger native-addon recovery — RESOLVED (2026-08-01)

Earlier revisions of this section stated that the native-addon recovery was open, that PR #53
was in Draft, and that Passenger restart remained forbidden. **That statement is stale and is
superseded by this section.**

**Reported (production), 2026-08-01; independently corroborated 2026-08-04 for the items
marked below:** PR #53 (`agent/hostinger-glibc228-native-recovery`) merged, and the full
`HOSTINGER-NATIVE-RECOVERY.md` gate sequence was executed against the production Hostinger
host and passed:

- Deployed source: `1bd15f12d70112a977983a96bae63e1b3c441310`, matching the expected branch,
  with a clean working tree.
- Effective Passenger environment — read from `/proc/$PID/environ`, not an interactive shell —
  confirmed all five required variables correct: `NODE_ENV=production`, `SKIP_AUTO_SEED=1`,
  `ALLOW_AUTO_SEED=0`, `PRODUCTION_INITIALIZATION_ENABLED=false`, and `DB_PATH` resolving to
  the application's `data/wms.db`. This also closes the outstanding auto-seed
  runtime-environment question carried since `INC-2026-07-25-01` and Issue #40.
- Production database: `PRAGMA integrity_check = ok`; record counts
  `9|11|35|9746|1|12|0|0` (users|roles|permissions|materials|warehouses|migrations|batches|
  stock_transactions), matching the last reviewed baseline exactly.
- No `production-initialization.lock.json` present, as expected.
- **Independently corroborated:** native-addon artifact SHA-256
  `a9c4d701f59a492c538416211cc3e65257f1d74e3e4ce3d8d9862e1981676dc4` — matches the artifact
  already independently inspected and recorded on 2026-08-01 (binary, checksum, manifest, and
  GLIBC evidence all verified then). The staged addon passed `ldd`, in-memory load/query, and a
  read-only backup query before installation.
- The previously installed addon and a consistent database copy were preserved; the new addon
  was installed by same-directory atomic rename. The immediate rollback path is retained at
  `/home/u716763642/domains/wms.kynox.io/nodejs/backups/emergency/production-recovery-20260801T202313Z/rollback-production.sh`.
- No seed, reset, initialization, or database-mutating command was run.
- **Independently corroborated:** Passenger is running the new addon; `https://wms.kynox.io/healthz`
  returns `200 {"status":"ok","service":"wms"}`.

This closes `INC-2026-07-31-01` and satisfies `DEC-013`'s gate requirements in full. See
`WMS-INCIDENT-LOG.md` → `INC-2026-07-31-01` for the complete prior history (the original
GLIBC-2.29-vs-2.28 incompatibility, the artifact-storage-quota saga, and the earlier partial
builds), which is preserved unchanged, and the 2026-08-01 session-log entry for the resolution
evidence.

**Evidence-class note:** the Passenger-environment read-out, database identity/lock check, and
gate-execution sequence above are recorded as reported by the operator (per `DEC-010`, not
silently upgraded to Verified). This session independently corroborated only `/healthz`, the
addon SHA-256, and the database counts.

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

1. ~~Complete PR #53 merge-readiness evidence, then execute recovery gates only in an approved production window.~~ **DONE (2026-08-01).** PR #53 merged; all recovery gates executed and passed; see the resolved section above.
2. ~~Resolve the auto-seed / runtime-environment question.~~ **DONE (2026-08-01).** The Passenger-process environment read-out during the recovery confirmed all five required variables correct. This does not retroactively prove what fired during the original 2026-07-25 incident, but current production is confirmed correctly configured and running the fail-closed code fix.
3. ~~Verify production's deployed commit read-only and reconcile it to `main`.~~ **DONE (2026-08-01).** Production confirmed at `1bd15f1`, which contains PR #43 and all later safety hardening. The `hotfix/opening-stock-idempotency` branch advisory is moot — production is now well past that point in history.
4. ~~Verify the production-initialization lock.~~ **DONE (2026-08-01).** No lock file present, as expected.
5. ~~Complete the reviewed native-addon recovery gates.~~ **DONE (2026-08-01).** See item 1.
6. Deploy the remaining unrelated `chore(kaaf)` commits from `main` is **not required** — they are architecture-diagram tooling with no application impact. Do **not** re-import Opening Stock into production until the item below is complete.
7. Run opening-stock date reconciliation in **dry-run mode only** (`apply: false`) and review the output; apply only after explicit review and approval.
8. Complete the cross-table stock consistency audit required by Issue #40 (batches vs `material_location_stock` vs `stock_transactions` vs dashboard KPIs). Needs real data and production access — **production is now confirmed healthy and reachable**, so this is newly feasible. The **code**-hardening asks in Issue #40 are done: auto-seed fails closed, a database identity line is logged every boot, `reset-admin` refuses default credentials and never seeds, and every credential change is audited (`DEC-011`, `DEC-012`).
9. Complete and validate web/mobile parity gaps where still outstanding.
10. Ensure every future deployment and incident updates the project memory files required by `CLAUDE.md`.
11. **Open, escalated (2026-08-01 → 2026-08-10, 10 consecutive daily failures):** Restore the offsite backup workflow (`INC-2026-08-06-01`). Through 2026-08-09 the dominant cause was `/sbin/nologin` on the backup SSH account (bad remote shell path), with intermittent connection timeouts. On 2026-08-10 the signature changed to `Permission denied (publickey,password)` — the SSH key is now being rejected outright, suggesting the key was removed/rotated on the host or the account was disabled. Requires operator action via Hostinger hPanel (and possibly updating the `SSH_KEY` GitHub secret); no AI agent in this environment has production SSH or GitHub secrets access to fix it directly. Per `DEC-008`, local retention keeps only 7 backup sets — 10 missed cycles already well exceeds that window.

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
