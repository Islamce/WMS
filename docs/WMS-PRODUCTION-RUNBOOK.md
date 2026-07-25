# WMS Production Runbook

Last updated: 2026-07-25

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

## Reconciliation procedure

- Start with dry run only.
- Review counts, proposed rows, scope, and errors.
- Confirm the registry limits the operation to opening-stock batches.
- Create and validate a fresh database backup.
- Obtain explicit approval before setting `apply: true`.
- Re-run reconciliation in dry-run mode afterward to confirm no pending changes.

## Restart

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
