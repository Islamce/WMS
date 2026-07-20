#!/usr/bin/env node
/**
 * Backup verification + restore drill (DB-2 / OPS-2).
 *
 *   node scripts/verify-backup.js [backupDir]        # verify latest set
 *   npm run verify-backup
 *
 * Exits 0 only when every check passes; exits 1 (with a clear reason) when:
 *   - no manifest / backup file is found
 *   - the DB file is missing
 *   - the DB SHA-256 does not match the manifest (tamper/corruption on disk)
 *   - SQLite PRAGMA integrity_check is not 'ok' (database corrupt)
 *   - archived attachments are missing or their combined checksum mismatches
 *   - the restore drill fails to open/read the restored copy
 *
 * The restore drill copies the backup DB to a scratch directory and opens it
 * there — it NEVER touches the production database (DB_PATH).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const { sha256File } = require('./backup');

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }
function ok(msg) { console.log(`PASS: ${msg}`); }

function latestManifest(dir) {
  if (!fs.existsSync(dir)) fail(`backup directory not found: ${dir}`);
  const manifests = fs.readdirSync(dir)
    .filter((f) => /^wms-\d+\.manifest\.json$/.test(f))
    .sort();
  if (!manifests.length) fail(`no backup manifest found in ${dir}`);
  return path.join(dir, manifests[manifests.length - 1]);
}

function verify(dir) {
  const manifestPath = latestManifest(dir);
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  ok(`manifest loaded: ${path.basename(manifestPath)} (created ${m.created_at}, app v${m.app_version})`);

  // --- DB file present + checksum matches ---
  const dbFile = path.join(dir, m.db_file);
  if (!fs.existsSync(dbFile)) fail(`backup DB missing: ${m.db_file}`);
  if (sha256File(dbFile) !== m.db_sha256) fail(`DB SHA-256 mismatch for ${m.db_file}`);
  ok(`DB present and checksum matches (${m.db_bytes} bytes)`);

  // --- Attachments present + combined checksum matches ---
  if (m.attachment_count > 0) {
    const attachDir = path.join(dir, m.attachments_dir);
    if (!fs.existsSync(attachDir)) fail(`attachments archive missing: ${m.attachments_dir}`);
    const files = [];
    (function walk(d, rel = '') {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name), path.join(rel, e.name));
        else files.push(path.join(rel, e.name));
      }
    })(attachDir);
    if (files.length !== m.attachment_count) fail(`attachment count mismatch: ${files.length} vs ${m.attachment_count}`);
    const h = crypto.createHash('sha256');
    for (const rel of files.sort()) { h.update(rel); h.update(sha256File(path.join(attachDir, rel))); }
    if (h.digest('hex') !== m.attachments_sha256) fail('attachments checksum mismatch');
    ok(`attachments present and checksum matches (${m.attachment_count} file(s))`);
  } else {
    ok('no attachments in this backup set (nothing to verify)');
  }

  // --- Restore drill in a scratch dir (never touches production) ---
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-restore-'));
  try {
    const restored = path.join(scratch, 'restored.db');
    fs.copyFileSync(dbFile, restored);
    const db = new Database(restored, { readonly: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') fail(`PRAGMA integrity_check returned '${integrity}'`);
    // Prove the restored copy is queryable and holds real data.
    const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const audit = db.prepare('SELECT COUNT(*) AS n FROM audit_trail').get().n;
    db.close();
    ok(`restore drill: integrity_check=ok, users=${users}, audit_rows=${audit}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  console.log('\n✅ Backup verified and restore drill passed.');
}

if (require.main === module) {
  const dir = process.argv[2] || process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
  verify(dir);
}

module.exports = { verify };
