#!/usr/bin/env node
/**
 * Point-in-time SQLite backup. Uses better-sqlite3's online .backup(), which is
 * safe to run against a live database (consistent snapshot, no downtime).
 *
 *   node scripts/backup.js [destinationDir]
 *   npm run backup                       # dir from BACKUP_DIR or ./backups
 *
 * Writes  <dir>/wms-YYYYMMDD-HHmmss.db  and prunes backups older than
 * BACKUP_RETENTION_DAYS (default 14). Schedule it from cron for automation, or
 * set BACKUP_DIR to enable the in-process daily backup the server runs itself.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../server/config');

function backup(destDir) {
  const dir = destDir || process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15); // YYYYMMDDHHMMSS-ish
  const dest = path.join(dir, `wms-${stamp}.db`);

  const db = new Database(config.dbPath, { readonly: true });
  return db.backup(dest).then(() => {
    db.close();
    pruneOld(dir);
    return dest;
  });
}

function pruneOld(dir) {
  const days = Number(process.env.BACKUP_RETENTION_DAYS) || 14;
  const cutoff = Date.now() - days * 86400e3;
  for (const f of fs.readdirSync(dir)) {
    if (!/^wms-\d+\.db$/.test(f)) continue;
    const p = path.join(dir, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

module.exports = { backup };

// Run directly: node scripts/backup.js [dir]
if (require.main === module) {
  backup(process.argv[2])
    .then((dest) => { console.log(`Backup written: ${dest}`); process.exit(0); })
    .catch((err) => { console.error('Backup failed:', err.message); process.exit(1); });
}
