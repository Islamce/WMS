/**
 * Clear the demo/test dataset from the command line so real data can be
 * imported. Keeps users, roles, permissions, movement types and configuration.
 *
 * Usage:
 *   npm run fresh-start -- --yes                     # clear everything
 *   npm run fresh-start -- --yes --keep-master-data  # keep materials/warehouses/bins/locations
 */
const { factoryReset } = require('../server/services/reset');

if (!process.argv.includes('--yes')) {
  console.error('This deletes ALL transactional data (and sample master data unless');
  console.error('--keep-master-data is passed). Users/roles/permissions are kept.');
  console.error('Re-run with --yes to proceed:  npm run fresh-start -- --yes');
  process.exit(1);
}

const counts = factoryReset({ keepMasterData: process.argv.includes('--keep-master-data') });
const total = Object.values(counts).reduce((s, n) => s + n, 0);
console.log(`Cleared ${total} rows:`);
Object.entries(counts).forEach(([t, n]) => { if (n) console.log(`  ${t}: ${n}`); });
console.log('Done. Import your real data via the Import Center (or /api/import).');
