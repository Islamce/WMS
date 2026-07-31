# Hostinger native-addon recovery

This procedure repairs `better-sqlite3 11.10.0` on the current Hostinger
shared host (`Node 20.19.4`, ABI 115, Linux x64, glibc 2.28). It changes only
the installed native addon under `node_modules`. It does not seed, migrate,
initialize, reset, replace, or write to the production database.

Passenger restart is forbidden until every gate in this document passes, the
evidence is reviewed, and restart approval is explicit. This procedure never
touches `tmp/restart.txt` or invokes an hPanel restart.

## Build artifact and provenance

Run `.github/workflows/build-hostinger-native.yml` from the exact full
application commit SHA. For a manual run, enter that 40-character SHA as the
required `source_sha` input. Download the artifact named:

```text
better-sqlite3-11.10.0-node20-abi115-el8-x64-<SOURCE_SHA>
```

The artifact must contain all four files:

- `better_sqlite3.node`
- `better_sqlite3.node.sha256`
- `native-addon-manifest.json`
- `glibc-symbols.txt`

The workflow builds on Rocky Linux 8, checks Node ABI 115, rejects GLIBC
requirements newer than 2.28, loads the module, runs an in-memory query, and
records build provenance. Never use the upstream Linux prebuild on this host:
the observed `better-sqlite3 11.10.0` prebuild requires GLIBC 2.29.

## Gate 1 - deployed identity and effective Passenger environment

Run this while the existing WMS Passenger worker is still available. An
interactive SSH shell is not evidence of Passenger's effective environment.
If there is no readable WMS Passenger process, stop: restart remains forbidden
until an approved host-specific method captures the effective values.

Set every `REPLACE_...` value from reviewed evidence before executing:

```bash
export PATH=/opt/alt/alt-nodejs20/root/usr/bin:$PATH
cd /home/u716763642/domains/wms.kynox.io/nodejs
set -Eeuo pipefail

APP_ROOT=/home/u716763642/domains/wms.kynox.io/nodejs
EXPECTED_BRANCH=REPLACE_WITH_DEPLOYED_BRANCH
EXPECTED_SOURCE_SHA=REPLACE_WITH_FULL_40_CHARACTER_SHA
PASSENGER_PID=REPLACE_WITH_WMS_PASSENGER_PID
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
EVIDENCE_DIR="$APP_ROOT/backups/emergency/native-recovery-evidence-$STAMP"

case "$EXPECTED_BRANCH" in REPLACE_*|'') echo 'ABORT: expected branch not set'; exit 1;; esac
case "$EXPECTED_SOURCE_SHA" in REPLACE_*|'') echo 'ABORT: expected SHA not set'; exit 1;; esac
[[ "$EXPECTED_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$PASSENGER_PID" =~ ^[0-9]+$ ]]

test "$(pwd -P)" = "$APP_ROOT"
test "$(git branch --show-current)" = "$EXPECTED_BRANCH"
test "$(git rev-parse HEAD)" = "$EXPECTED_SOURCE_SHA"
test -z "$(git status --porcelain)"
test "$(readlink -f "/proc/$PASSENGER_PID/cwd")" = "$APP_ROOT"
test -r "/proc/$PASSENGER_PID/environ"

mkdir -p -m 700 "$EVIDENCE_DIR"
printf 'branch=%s\nsource_sha=%s\n' \
  "$(git branch --show-current)" "$(git rev-parse HEAD)" \
  | tee "$EVIDENCE_DIR/deployed-source.txt"

tr '\0' '\n' < "/proc/$PASSENGER_PID/environ" \
  | grep -E '^(NODE_ENV|SKIP_AUTO_SEED|ALLOW_AUTO_SEED|PRODUCTION_INITIALIZATION_ENABLED|DB_PATH)=' \
  | LC_ALL=C sort \
  | tee "$EVIDENCE_DIR/passenger-environment.txt"

test "$(wc -l < "$EVIDENCE_DIR/passenger-environment.txt")" -eq 5
grep -qx 'NODE_ENV=production' "$EVIDENCE_DIR/passenger-environment.txt"
grep -qx 'SKIP_AUTO_SEED=1' "$EVIDENCE_DIR/passenger-environment.txt"
grep -qx 'ALLOW_AUTO_SEED=0' "$EVIDENCE_DIR/passenger-environment.txt"
grep -qx 'PRODUCTION_INITIALIZATION_ENABLED=false' "$EVIDENCE_DIR/passenger-environment.txt"

EFFECTIVE_DB_PATH=$(sed -n 's/^DB_PATH=//p' "$EVIDENCE_DIR/passenger-environment.txt")
test "$EFFECTIVE_DB_PATH" = "$APP_ROOT/data/wms.db"
test "$(readlink -f "$EFFECTIVE_DB_PATH")" = "$APP_ROOT/data/wms.db"

echo SOURCE_IDENTITY_GATE=PASS
echo PASSENGER_ENVIRONMENT_GATE=PASS
echo PASSENGER_RESTARTED=NO
```

Save the evidence directory path. Stop only the WMS application through the
existing Hostinger/hPanel control. Do not continue until the identified PID is
gone and no replacement WMS Node/Passenger worker is using the application
root.

```bash
test ! -e "/proc/$PASSENGER_PID"

for proc_dir in /proc/[0-9]*; do
  proc_cwd=$(readlink -f "$proc_dir/cwd" 2>/dev/null || true)
  proc_cmd=$(tr '\0' ' ' < "$proc_dir/cmdline" 2>/dev/null || true)
  if test "$proc_cwd" = "$APP_ROOT" && [[ "$proc_cmd" =~ (node|Passenger) ]]; then
    echo "ABORT: WMS application process still detected: $proc_dir $proc_cmd"
    exit 1
  fi
done

echo PASSENGER_STOP_GATE=PASS
echo PASSENGER_RESTARTED=NO
```

## Gate 2 - production database identity, counts, and initialization lock

Fill the expected counts from the reviewed recovery evidence. A difference is
an incident to investigate; it is not permission to seed, reset, initialize,
or replace the database.

```bash
EXPECTED_USERS=REPLACE_WITH_REVIEWED_COUNT
EXPECTED_ROLES=REPLACE_WITH_REVIEWED_COUNT
EXPECTED_PERMISSIONS=REPLACE_WITH_REVIEWED_COUNT
EXPECTED_MATERIALS=REPLACE_WITH_REVIEWED_COUNT
EXPECTED_WAREHOUSES=REPLACE_WITH_REVIEWED_COUNT
EXPECTED_MIGRATIONS=REPLACE_WITH_REVIEWED_COUNT
EXPECTED_BATCHES=REPLACE_WITH_REVIEWED_COUNT
EXPECTED_STOCK_TRANSACTIONS=REPLACE_WITH_REVIEWED_COUNT
EXPECTED_LOCK_STATE=REPLACE_WITH_present_OR_absent
EXPECTED_LOCK="$APP_ROOT/data/production-initialization.lock.json"

for name in \
  EXPECTED_USERS EXPECTED_ROLES EXPECTED_PERMISSIONS EXPECTED_MATERIALS \
  EXPECTED_WAREHOUSES EXPECTED_MIGRATIONS EXPECTED_BATCHES \
  EXPECTED_STOCK_TRANSACTIONS; do
  value=${!name}
  [[ "$value" =~ ^[0-9]+$ ]] || { echo "ABORT: $name is not a reviewed count"; exit 1; }
done
case "$EXPECTED_LOCK_STATE" in present|absent) ;; *) echo 'ABORT: lock expectation not set'; exit 1;; esac

test -f "$EFFECTIVE_DB_PATH"
DB_INTEGRITY=$(sqlite3 -readonly "$EFFECTIVE_DB_PATH" 'PRAGMA integrity_check;')
test "$DB_INTEGRITY" = "ok"

DB_COUNTS=$(sqlite3 -readonly -separator '|' "$EFFECTIVE_DB_PATH" \
  "SELECT
    (SELECT COUNT(*) FROM users),
    (SELECT COUNT(*) FROM roles),
    (SELECT COUNT(*) FROM permissions),
    (SELECT COUNT(*) FROM materials),
    (SELECT COUNT(*) FROM warehouses),
    (SELECT COUNT(*) FROM schema_migrations),
    (SELECT COUNT(*) FROM batches),
    (SELECT COUNT(*) FROM stock_transactions);")
EXPECTED_COUNTS="$EXPECTED_USERS|$EXPECTED_ROLES|$EXPECTED_PERMISSIONS|$EXPECTED_MATERIALS|$EXPECTED_WAREHOUSES|$EXPECTED_MIGRATIONS|$EXPECTED_BATCHES|$EXPECTED_STOCK_TRANSACTIONS"
test "$DB_COUNTS" = "$EXPECTED_COUNTS"

{
  printf 'path=%s\n' "$(readlink -f "$EFFECTIVE_DB_PATH")"
  printf 'size=%s\n' "$(stat -c %s "$EFFECTIVE_DB_PATH")"
  printf 'sha256=%s\n' "$(sha256sum "$EFFECTIVE_DB_PATH" | awk '{print $1}')"
  printf 'integrity_check=%s\n' "$DB_INTEGRITY"
  printf 'counts=%s\n' "$DB_COUNTS"
  for file in "$EFFECTIVE_DB_PATH" "$EFFECTIVE_DB_PATH-wal" "$EFFECTIVE_DB_PATH-shm"; do
    if test -e "$file"; then stat -c 'sqlite_file=%n size=%s' "$file"; fi
  done
} | tee "$EVIDENCE_DIR/production-database-identity.txt"

mapfile -t LOCK_FILES < <(
  find "$APP_ROOT" -path "$APP_ROOT/backups" -prune -o \
    -type f -name 'production-initialization.lock.json' -print | LC_ALL=C sort
)
printf '%s\n' "${LOCK_FILES[@]}" | sed '/^$/d' \
  | tee "$EVIDENCE_DIR/initialization-lock-files.txt"

if test "$EXPECTED_LOCK_STATE" = "present"; then
  test "${#LOCK_FILES[@]}" -eq 1
  test "${LOCK_FILES[0]}" = "$EXPECTED_LOCK"
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$EXPECTED_LOCK"
  sha256sum "$EXPECTED_LOCK" | tee "$EVIDENCE_DIR/initialization-lock.sha256"
else
  test "${#LOCK_FILES[@]}" -eq 0
fi

echo DATABASE_IDENTITY_GATE=PASS
echo DATABASE_COUNTS_GATE=PASS
echo INITIALIZATION_LOCK_GATE=PASS
echo DATABASE_WRITTEN=NO
echo PASSENGER_RESTARTED=NO
```

## Gate 3 - artifact provenance and staged-addon preflight

Upload the four artifact files into a new timestamped directory under
`backups/emergency/`. Set `ARTIFACT_DIR` and `BACKUP_DB` explicitly. The backup
database must be a previously created, SQLite-consistent backup; this procedure
opens it read-only.

```bash
ARTIFACT_DIR="$APP_ROOT/backups/emergency/REPLACE_WITH_ARTIFACT_FOLDER"
BACKUP_DB="$APP_ROOT/backups/emergency/REPLACE_WITH_VERIFIED_BACKUP/wms-consistent.db"
STAGED_ADDON="$ARTIFACT_DIR/better_sqlite3.node"
MANIFEST="$ARTIFACT_DIR/native-addon-manifest.json"
GLIBC_EVIDENCE="$ARTIFACT_DIR/glibc-symbols.txt"

case "$(basename "$ARTIFACT_DIR")" in *"$EXPECTED_SOURCE_SHA"*) ;; *) echo 'ABORT: artifact folder does not identify source SHA'; exit 1;; esac
test -s "$STAGED_ADDON"
test -s "$ARTIFACT_DIR/better_sqlite3.node.sha256"
test -s "$MANIFEST"
test -s "$GLIBC_EVIDENCE"
test -f "$BACKUP_DB"

test "$(node --version)" = "v20.19.4"
test "$(node -p 'process.versions.modules')" = "115"
test "$(getconf GNU_LIBC_VERSION)" = "glibc 2.28"
test "$(sqlite3 -readonly "$BACKUP_DB" 'PRAGMA integrity_check;')" = "ok"

(cd "$ARTIFACT_DIR" && sha256sum -c better_sqlite3.node.sha256)

export EXPECTED_SOURCE_SHA MANIFEST GLIBC_EVIDENCE APP_ROOT
node - <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST, 'utf8'));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const expected = {
  source_sha: process.env.EXPECTED_SOURCE_SHA,
  better_sqlite3_version: '11.10.0',
  package_lock_sha256: sha256(path.join(process.env.APP_ROOT, 'package-lock.json')),
  node_version: 'v20.19.4',
  node_abi: '115',
  os: 'linux',
  architecture: 'x64',
  glibc_runtime: 'glibc 2.28',
  glibc_evidence_file: 'glibc-symbols.txt',
  glibc_evidence_sha256: sha256(process.env.GLIBC_EVIDENCE),
};

for (const [key, value] of Object.entries(expected)) {
  if (manifest[key] !== value) throw new Error(`manifest mismatch: ${key}`);
}
if (!/^\d+$/.test(manifest.workflow_run_id)) throw new Error('invalid workflow_run_id');
if (!manifest.compiler) throw new Error('compiler evidence missing');
NODE

ldd "$STAGED_ADDON" | tee "$EVIDENCE_DIR/staged-addon-ldd.txt"
if grep -E 'not found|GLIBC_[0-9.]+.*not found|GLIBCXX_[0-9.]+.*not found|CXXABI_[0-9.]+.*not found' \
  "$EVIDENCE_DIR/staged-addon-ldd.txt"; then
  echo 'ABORT: staged addon has an unresolved native dependency'
  exit 1
fi

STAGED_ADDON="$STAGED_ADDON" BACKUP_DB="$BACKUP_DB" node <<'NODE'
const Database = require('better-sqlite3');

const memory = new Database(':memory:', { nativeBinding: process.env.STAGED_ADDON });
if (memory.prepare('SELECT 1 AS ok').get().ok !== 1) process.exit(1);
memory.close();

const backup = new Database(process.env.BACKUP_DB, {
  readonly: true,
  fileMustExist: true,
  nativeBinding: process.env.STAGED_ADDON,
});
const integrity = backup.pragma('integrity_check', { simple: true });
backup.close();
if (integrity !== 'ok') process.exit(1);
NODE

echo ARTIFACT_PROVENANCE_GATE=PASS
echo STAGED_ADDON_PREFLIGHT_GATE=PASS
echo DATABASE_WRITTEN=NO
echo PASSENGER_RESTARTED=NO
```

## Gate 4 - preserve, atomically replace, and verify rollback readiness

The existing addon is mandatory rollback evidence. If it is absent, stop and
review a separate procedure rather than manufacturing a rollback claim.

```bash
ADDON="$APP_ROOT/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
ROLLBACK_DIR="$APP_ROOT/backups/emergency/native-addon-rollback-$STAMP"
ROLLBACK_ADDON="$ROLLBACK_DIR/better_sqlite3.node"
NEW_ADDON="$(dirname "$ADDON")/.better_sqlite3.node.new-$STAMP"

test -s "$ADDON"
mkdir -p -m 700 "$ROLLBACK_DIR"
install -m 755 "$ADDON" "$ROLLBACK_ADDON"
sha256sum "$ROLLBACK_ADDON" > "$ROLLBACK_DIR/better_sqlite3.node.sha256"
sha256sum -c "$ROLLBACK_DIR/better_sqlite3.node.sha256"
test "$(sha256sum "$ADDON" | awk '{print $1}')" = \
  "$(sha256sum "$ROLLBACK_ADDON" | awk '{print $1}')"

install -m 755 "$STAGED_ADDON" "$NEW_ADDON"
test "$(sha256sum "$NEW_ADDON" | awk '{print $1}')" = \
  "$(sha256sum "$STAGED_ADDON" | awk '{print $1}')"
mv -f "$NEW_ADDON" "$ADDON"
test "$(sha256sum "$ADDON" | awk '{print $1}')" = \
  "$(sha256sum "$STAGED_ADDON" | awk '{print $1}')"

TEST_DB_PATH="$BACKUP_DB" node <<'NODE'
const Database = require('better-sqlite3');
const db = new Database(process.env.TEST_DB_PATH, {
  readonly: true,
  fileMustExist: true,
});
const integrity = db.pragma('integrity_check', { simple: true });
db.close();
if (integrity !== 'ok') process.exit(1);
NODE

test -s "$ROLLBACK_ADDON"
sha256sum -c "$ROLLBACK_DIR/better_sqlite3.node.sha256"

echo INSTALLED_ADDON_GATE=PASS
echo ROLLBACK_READY_GATE=PASS
echo ROLLBACK_ADDON="$ROLLBACK_ADDON"
echo DATABASE_WRITTEN=NO
echo MIGRATIONS_EXECUTED=NO
echo SEED_EXECUTED=NO
echo INITIALIZATION_EXECUTED=NO
echo PASSENGER_RESTARTED=NO
```

## Immediate rollback command

Keep Passenger stopped. This rollback uses another same-directory atomic rename
and validates both the saved source and the restored target. It succeeds only
when it prints `ROLLBACK_STATUS=VERIFIED`.

```bash
set -Eeuo pipefail
test -s "$ROLLBACK_ADDON"
sha256sum -c "$ROLLBACK_DIR/better_sqlite3.node.sha256"
ROLLBACK_STAGE="$(dirname "$ADDON")/.better_sqlite3.node.rollback-$STAMP"
install -m 755 "$ROLLBACK_ADDON" "$ROLLBACK_STAGE"
test "$(sha256sum "$ROLLBACK_STAGE" | awk '{print $1}')" = \
  "$(sha256sum "$ROLLBACK_ADDON" | awk '{print $1}')"
mv -f "$ROLLBACK_STAGE" "$ADDON"
test "$(sha256sum "$ADDON" | awk '{print $1}')" = \
  "$(sha256sum "$ROLLBACK_ADDON" | awk '{print $1}')"
echo ROLLBACK_STATUS=VERIFIED
echo PASSENGER_RESTARTED=NO
```

## Restart authorization gate

Passenger remains stopped after this runbook. A restart may be requested only
after the operator reviews and retains all of the following `PASS` evidence:

- deployed branch and exact source SHA;
- Passenger's effective five safety variables;
- Passenger stopped with no replacement WMS worker;
- production database path, integrity, reviewed counts, and SQLite file state;
- initialization-lock state and absence of misplaced live copies;
- artifact checksum, manifest, lockfile match, GLIBC evidence, and workflow run;
- staged-addon host preflight and read-only backup query;
- timestamped previous-addon backup, atomic installed-addon swap, and validated
  immediate rollback path.

Any missing or mismatched gate keeps restart forbidden. Do not run `npm install`,
`npm ci`, `npm rebuild`, migrations, seed, initialization, reset, tests against
the production database, or any command that replaces the production DB/WAL/SHM
during this recovery.
