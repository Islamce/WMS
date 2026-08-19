#!/usr/bin/env node
/**
 * CLI wrapper for the WMS backup service (server/services/backup.js), which
 * owns the actual implementation. Kept thin and dependency-free of the API
 * app so that server/index.js (scheduled backups) and this script (manual /
 * cron-invoked backups) share one implementation instead of two that could
 * silently diverge -- and so the API never has to import through scripts/
 * (see WMS-R12 / WMS KAAF Drift Resolution Plan: this was the manifest-
 * declared server/index.js <-> scripts/backup.js cycle KAAF generation
 * blocked on).
 *
 *   node scripts/backup.js [destinationDir]
 *   npm run backup                       # dir from BACKUP_DIR or ./backups
 *
 * See docs/OPS-RUNBOOK.md for offsite copy and restore procedures
 * (RPO 24h / RTO 4h). Verify a set with `npm run verify-backup`.
 */
const { backup, sha256File } = require('../server/services/backup');

module.exports = { backup, sha256File };

// Run directly: node scripts/backup.js [dir]
if (require.main === module) {
  backup(process.argv[2])
    .then((r) => { console.log(`Backup written: ${r.db}\nManifest: ${r.manifest}`); process.exit(0); })
    .catch((err) => { console.error('Backup failed:', err.message); process.exit(1); });
}
