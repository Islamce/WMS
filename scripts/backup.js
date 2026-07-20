#!/usr/bin/env node
/**
 * Point-in-time WMS backup. Uses better-sqlite3's online .backup(), which is
 * safe to run against a live database (consistent snapshot, no downtime), then
 * archives uploaded attachments and writes a manifest (timestamp + SHA-256
 * checksums) so the set can be integrity-verified and restored later.
 *
 *   node scripts/backup.js [destinationDir]
 *   npm run backup                       # dir from BACKUP_DIR or ./backups
 *
 * Produces, per run (stamp = YYYYMMDDHHmmss):
 *   <dir>/wms-<stamp>.db                 SQLite snapshot
 *   <dir>/attachments-<stamp>/           copy of data/attachments (if any)
 *   <dir>/wms-<stamp>.manifest.json      timestamp, checksums, file inventory
 *
 * Prunes backup sets older than BACKUP_RETENTION_DAYS (default 14). Verify a
 * set with `npm run verify-backup`; see docs/OPS-RUNBOOK.md for offsite copy
 * and restore procedures (RPO 24h / RTO 4h).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const config = require('../server/config');

const ATTACH_SRC = path.join(__dirname, '..', 'data', 'attachments');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Recursively copy a directory, returning the list of relative file paths. */
function copyDir(src, dest, rel = '', acc = []) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d, path.join(rel, entry.name), acc);
    else { fs.copyFileSync(s, d); acc.push(path.join(rel, entry.name)); }
  }
  return acc;
}

async function backup(destDir) {
  const dir = destDir || process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHmmss
  const dbDest = path.join(dir, `wms-${stamp}.db`);

  // 1) Consistent online snapshot of the live database.
  const db = new Database(config.dbPath, { readonly: true });
  await db.backup(dbDest);
  db.close();

  // 2) Archive uploaded attachments (best-effort; may not exist yet).
  let attachments = [];
  const attachDest = path.join(dir, `attachments-${stamp}`);
  if (fs.existsSync(ATTACH_SRC)) attachments = copyDir(ATTACH_SRC, attachDest);

  // 3) Manifest with checksums for integrity verification and restore.
  const attachHash = crypto.createHash('sha256');
  for (const rel of attachments.sort()) {
    attachHash.update(rel);
    attachHash.update(sha256File(path.join(attachDest, rel)));
  }
  const manifest = {
    created_at: new Date().toISOString(),
    app_version: require('../package.json').version,
    db_file: path.basename(dbDest),
    db_bytes: fs.statSync(dbDest).size,
    db_sha256: sha256File(dbDest),
    attachments_dir: attachments.length ? path.basename(attachDest) : null,
    attachment_count: attachments.length,
    attachments_sha256: attachments.length ? attachHash.digest('hex') : null,
  };
  const manifestPath = path.join(dir, `wms-${stamp}.manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  pruneOld(dir);
  return { db: dbDest, manifest: manifestPath, ...manifest };
}

function pruneOld(dir) {
  const days = Number(process.env.BACKUP_RETENTION_DAYS) || 14;
  const cutoff = Date.now() - days * 86400e3;
  for (const f of fs.readdirSync(dir)) {
    if (!/^wms-\d+\.(db|manifest\.json)$/.test(f) && !/^attachments-\d+$/.test(f)) continue;
    const p = path.join(dir, f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

module.exports = { backup, sha256File };

// Run directly: node scripts/backup.js [dir]
if (require.main === module) {
  backup(process.argv[2])
    .then((r) => { console.log(`Backup written: ${r.db}\nManifest: ${r.manifest}`); process.exit(0); })
    .catch((err) => { console.error('Backup failed:', err.message); process.exit(1); });
}
