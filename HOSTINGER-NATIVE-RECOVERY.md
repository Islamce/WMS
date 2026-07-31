# Hostinger native-addon recovery

This procedure repairs `better-sqlite3 11.10.0` on the current Hostinger
shared host (`Node 20.19.4`, ABI 115, Linux x64, glibc 2.28). It does not seed,
migrate, replace, or write to the production database.

## Build artifact

Run `.github/workflows/build-hostinger-native.yml` from the exact application
commit. Download the artifact named
`better-sqlite3-11.10.0-node20-abi115-el8-x64`.

The workflow builds on Rocky Linux 8 and fails if the resulting addon references
a GLIBC version newer than 2.28. Never use the upstream Linux prebuild for this
host: the observed `better-sqlite3 11.10.0` prebuild requires GLIBC 2.29.

## Server installation and verification

Upload `better_sqlite3.node` and its checksum file to a new timestamped folder
under `backups/emergency/`. Stop the application before continuing. Define
`ARTIFACT_DIR` and `BACKUP_DB` explicitly, then run:

```bash
export PATH=/opt/alt/alt-nodejs20/root/usr/bin:$PATH
cd /home/u716763642/domains/wms.kynox.io/nodejs
set -Eeuo pipefail

APP_ROOT=/home/u716763642/domains/wms.kynox.io/nodejs
ADDON="$APP_ROOT/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
ARTIFACT_DIR="$APP_ROOT/backups/emergency/REPLACE_WITH_ARTIFACT_FOLDER"
BACKUP_DB="$APP_ROOT/backups/emergency/20260731T193518Z/wms-consistent.db"

test "$(node --version)" = "v20.19.4"
test "$(node -p 'process.versions.modules')" = "115"
test "$(getconf GNU_LIBC_VERSION)" = "glibc 2.28"
test "$(sqlite3 -readonly "$BACKUP_DB" 'PRAGMA integrity_check;')" = "ok"

if ps -eo args | grep -E 'node .*server/index\.js|node .*app\.js|Passenger' | grep -v grep; then
  echo 'ABORT: application process detected'
  exit 1
fi

(cd "$ARTIFACT_DIR" && sha256sum -c better_sqlite3.node.sha256)
mkdir -p "$(dirname "$ADDON")"
install -m 755 "$ARTIFACT_DIR/better_sqlite3.node" "$ADDON"

if ldd "$ADDON" 2>&1 | grep -E 'not found|GLIBC_[0-9.]+.*not found'; then
  echo 'ABORT: native dependency mismatch'
  exit 1
fi

TEST_DB_PATH="$BACKUP_DB" node <<'NODE'
const Database = require('better-sqlite3');
const db = new Database(process.env.TEST_DB_PATH, {
  readonly: true,
  fileMustExist: true,
});
const integrity = db.pragma('integrity_check', { simple: true });
console.log(`integrity_check=${integrity}`);
db.close();
if (integrity !== 'ok') process.exit(1);
NODE

echo BETTER_SQLITE3_STATUS=VERIFIED
echo DATABASE_WRITTEN=NO
echo MIGRATIONS_EXECUTED=NO
echo SEED_EXECUTED=NO
echo APPLICATION_RESTARTED=NO
```

Only after `BETTER_SQLITE3_STATUS=VERIFIED` may Passenger be restarted. Then
verify `/healthz`, inspect startup logs, and confirm the database identity and
record counts. Do not run `npm install`, `npm ci`, `npm rebuild`, migrations,
seed, initialization, or reset commands during this recovery.
