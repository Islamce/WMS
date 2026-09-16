/**
 * Clear the demo/test dataset from the command line so real data can be
 * imported. Keeps users, roles, permissions, movement types and configuration.
 *
 * Usage:
 *   npm run fresh-start -- --yes                     # clear everything
 *   npm run fresh-start -- --yes --keep-master-data  # keep materials/warehouses/bins/locations
 */
// --- Production guards -------------------------------------------------------
// Above the require on purpose: server/config.js throws on some production
// configurations, and a guard that only appears to work because an unrelated
// module threw first can be silently removed by someone fixing that module.
const CONFIRM_PHRASE = 'FACTORY RESET THIS DATABASE';

function refuse(lines) {
  console.error(`\n[REFUSED] ${lines.join('\n          ')}\n`);
  process.exit(1);
}

if (process.env.NODE_ENV === 'production' && !process.argv.includes(CONFIRM_PHRASE)) {
  refuse([
    'NODE_ENV=production. This clears transactional data from a live database.',
    '',
    `Re-run with the exact confirmation: npm run fresh-start -- --yes '${CONFIRM_PHRASE}'`,
    '',
    'Before you do: confirm this is the intended database, take a verified backup,',
    'and rule out that the data looks wrong only because DB_PATH points elsewhere.',
  ]);
}
if (/^(\/opt\/apps\/wms|\/app\/data)\//.test(process.env.DB_PATH || '')) {
  refuse([`DB_PATH=${process.env.DB_PATH} is a production path.`]);
}

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
