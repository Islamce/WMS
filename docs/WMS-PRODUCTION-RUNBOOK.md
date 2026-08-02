# WMS Production Runbook

## Hostinger managed-build layout (verified 2026-08-01)

Passenger reads `public_html/.htaccess`, whose app root is
`~/domains/wms.kynox.io/.builds/current/nodejs`. The `current` symlink selects
an immutable release under `.builds/versions/`. The persistent production
database remains outside the release tree at
`~/domains/wms.kynox.io/nodejs/data/wms.db`, selected by `DB_PATH` in
`.builds/config/.env`.

Do not infer deployed source or addon identity from the persistent `nodejs/`
directory. Verify the resolved `.builds/current/nodejs` path, Git SHA, native
addon, and effective Passenger environment. Preserve the prior release target
and use an atomic symlink rename. Recovery evidence and rollback from 2026-08-01
are retained under
`nodejs/backups/emergency/production-recovery-20260801T202313Z/`.

Last updated: 2026-08-01

## Environment

- Host: Hostinger managed Node.js / Passenger
- Application: `~/domains/wms.kynox.io/nodejs`
- Database: `~/domains/wms.kynox.io/nodejs/data/wms.db`
- Node binary path: `/opt/alt/alt-nodejs20/root/usr/bin`
- Health endpoint: `https://wms.kynox.io/healthz`

## Non-negotiable safeguards

1. Confirm the current directory before every command.
2. Export the Node 20 path before npm or node commands.
3. Never seed production.
4. Never delete or casually copy over SQLite database, WAL, or SHM files.
5. Back up the database before any mutation or deployment that includes migrations.
6. Prefer read-only inspection and dry-run endpoints before any corrective operation.
7. Capture command output in `docs/WMS-SESSION-LOG.md`.
8. Record any unexpected behavior in `docs/WMS-INCIDENT-LOG.md`.

## Standard pre-deployment checks

```bash
cd ~/domains/wms.kynox.io/nodejs
pwd
git status --short
git branch --show-current
git rev-parse HEAD
```

Confirm no unexplained local changes before pulling or deploying.

## Runtime setup

```bash
export PATH=/opt/alt/alt-nodejs20/root/usr/bin:$PATH
node -v
npm -v
```

Expected known-good versions:

```text
v20.19.4
10.8.2
```

## Production configuration check

Verify without printing secrets:

```bash
grep -E '^(NODE_ENV|SKIP_AUTO_SEED|ALLOW_AUTO_SEED|PRODUCTION_INITIALIZATION_ENABLED|DB_PATH)=' .env
```

Expected:

```text
NODE_ENV=production
SKIP_AUTO_SEED=1
ALLOW_AUTO_SEED=0
PRODUCTION_INITIALIZATION_ENABLED=false
DB_PATH=/home/u716763642/domains/wms.kynox.io/nodejs/data/wms.db
```

## Database backup before mutation

Use an SQLite-consistent backup method. Do not copy only `wms.db` while the application is actively writing without validating consistency.

Example using SQLite backup through Node and `better-sqlite3`:

```bash
cd ~/domains/wms.kynox.io/nodejs
mkdir -p backups/manual
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
node - <<'NODE'
const Database = require('better-sqlite3');
const path = require('path');
const stamp = process.env.STAMP;
const source = new Database('data/wms.db', { readonly: true });
const destination = path.join('backups/manual', `wms-${stamp}.db`);
source.backup(destination)
  .then(() => console.log(destination))
  .finally(() => source.close());
NODE
```

Set/export `STAMP` for the Node process if using the example exactly, then validate the produced backup with integrity checks before relying on it.

## Standard deployment

```bash
cd ~/domains/wms.kynox.io/nodejs
export PATH=/opt/alt/alt-nodejs20/root/usr/bin:$PATH

git fetch origin
git pull --ff-only origin main
npm ci --omit=dev
npm run migrate
mkdir -p tmp
touch tmp/restart.txt
sleep 8
curl -sS https://wms.kynox.io/healthz
```

Then verify:

```bash
git rev-parse HEAD
```

Do not declare success from the health endpoint alone. Also verify login, critical dashboards, and the changed feature.

## Migration verification

Expected current baseline:

```text
Migrations: up to date (12 recorded).
```

A higher count may be valid after future merges, but must correspond to reviewed migration files and a documented deployment.

## Authentication incident procedure

When a known login fails:

1. Do not seed or reset immediately.
2. Read the users schema and non-secret account fields from the production database.
3. Inspect authentication and password-verification code at the deployed commit.
4. Compare the account record with known historical setup.
5. Back up the database before any account mutation.
6. Use the smallest targeted correction, with an audit entry where supported.
7. Verify login and document the exact outcome.

## Opening Stock import — pre-flight validation

Opening Stock is the inventory baseline. An error there propagates into every
later FIFO/FEFO calculation and is expensive to unwind, so validate the
behaviour against a copy **before** importing into production.

Never point this at the live database — it writes test data. It refuses the
configured `DB_PATH` and obvious production paths, and it works on its own
scratch copy so the file you pass is never modified.

```bash
# 1. Take a copy (application stopped, or from a verified backup).
cp ~/domains/wms.kynox.io/nodejs/data/wms.db /home/u716763642/openstock-check.db

# 2. Validate against the copy.
export PATH=/opt/alt/alt-nodejs20/root/usr/bin:$PATH
cd ~/domains/wms.kynox.io/nodejs
npm run validate-opening-stock -- /home/u716763642/openstock-check.db

# 3. Remove the copy when finished.
rm -f /home/u716763642/openstock-check.db
```

Exit code `0` means every scenario passed. Any other code means **do not run
the production import** until the failure is understood.

It boots the real server and calls the real import endpoint against the scratch
copy, then asserts:

1. A new opening-stock batch creates exactly one batch and one ledger entry.
2. An identical re-import is skipped — no quantity change, no new transaction.
3. A re-import with a *different* quantity does not overwrite the balance.
4. The same batch number in a different bin is rejected.
5. An existing operational goods-receipt batch is rejected, never increased.
6. Comma-formatted quantities (`1,234.5`) parse correctly.
7. Multiple bins in one import each get their own batch.
8. A forced failure rolls back the **whole** import, leaving no partial rows.
9. Pre-existing data is untouched and `PRAGMA integrity_check` still returns `ok`.

### Then, for the real import

- Record the source-file checksum, row count, and expected totals first.
- Take and verify a backup.
- Import once.
- **Re-import the same file** and confirm it reports only `skipped`, with no
  change to batch quantities, bin balances, or transaction counts. This proves
  idempotency on production itself, not just on a copy.
- Compare totals by material, warehouse, bin, and batch against expectations.

## Reconciliation procedure

- Start with dry run only.
- Review counts, proposed rows, scope, and errors.
- Confirm the registry limits the operation to opening-stock batches.
- Create and validate a fresh database backup.
- Obtain explicit approval before setting `apply: true`.
- Re-run reconciliation in dry-run mode afterward to confirm no pending changes.

## Hostinger shared-host native-addon recovery

Use `HOSTINGER-NATIVE-RECOVERY.md` only for the reviewed
`better-sqlite3 11.10.0` / Node 20 ABI 115 / glibc 2.28 incident path. Native
recovery is not a normal deployment and must not include `npm install`,
`npm ci`, `npm rebuild`, migrations, seed, initialization, reset, production-DB
tests, or DB/WAL/SHM replacement.

Before any Passenger restart, retain evidence that all of these gates passed:

1. The deployed branch and exact 40-character SHA match the reviewed artifact
   source SHA.
2. `NODE_ENV`, `SKIP_AUTO_SEED`, `ALLOW_AUTO_SEED`,
   `PRODUCTION_INITIALIZATION_ENABLED`, and `DB_PATH` were read from the
   effective WMS Passenger process and match the required production values.
3. Passenger is stopped and no replacement WMS worker is using the application
   root.
4. The active database path, integrity, reviewed record counts, SQLite file
   state, and initialization-lock state match the approved evidence.
5. The artifact checksum and provenance manifest match the deployed lockfile,
   source SHA, Node/ABI/OS/architecture, compiler, GLIBC evidence, and workflow
   run ID.
6. The staged addon passes host `ldd`, in-memory load/query, and read-only backup
   integrity checks before the installed addon is touched.
7. The current addon is preserved in a timestamped rollback directory, the new
   addon is installed by a same-directory atomic rename, and the immediate
   rollback block validates both its saved source and restored target.

A missing or mismatched gate is a hard stop. An addon that built successfully
but was not retained as a downloadable GitHub artifact is not deployable.
Artifact deletion to clear quota requires a read-only inventory and explicit
approval of the exact artifact IDs first.

## Restart

The generic restart command below does not override the native-recovery gate.
For a native recovery, do not run it until every item above has passed and the
captured evidence has been reviewed.

```bash
cd ~/domains/wms.kynox.io/nodejs
mkdir -p tmp
touch tmp/restart.txt
```

## Health verification

```bash
curl -sS https://wms.kynox.io/healthz
```

Known expected response:

```json
{"status":"ok","service":"wms"}
```

## Forbidden commands

```bash
npm run seed
reset-admin
rm data/wms.db
rm data/wms.db-wal
rm data/wms.db-shm
```

Any emergency exception requires a verified backup, documented incident plan, explicit approval, and a tested rollback path.
