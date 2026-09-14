#!/usr/bin/env node
/**
 * Install a minimal, usable starting point into an EMPTY tenant.
 *
 * The gap this closes: provisioning hands a customer a correct, clean database
 * and 43 screens with nothing in them. They cannot post a goods receipt at all
 * — there is no store to receive into, no bin to put it in, and no material to
 * receive. The distance between "I said yes" and "I saw it work" is therefore
 * measured in data entry, and that is where pilots die.
 *
 * This is NOT a demo seed and must not be confused with one. It writes no
 * users, no credentials, no transactions and no stock. It writes master data a
 * contractor would have created by hand anyway: one site store, a few bins, a
 * short list of common materials, one subcontractor. All of it is editable and
 * deletable from the normal screens.
 *
 * SAFETY. The script REFUSES on a tenant that already has any material,
 * warehouse or bin. That is deliberate and is the whole guard: there is no
 * --force. A tenant with data is a tenant in use, and the failure mode this
 * avoids — writing sample rows into a live store — is exactly the kind of
 * damage that is hard to distinguish from real data afterwards. Nothing here
 * updates or deletes an existing row under any circumstance.
 *
 *   node scripts/install-starter-data.js --db /path/to/wms.db
 *   node scripts/install-starter-data.js --db ... --dry-run
 */
const path = require('path');
const Database = require('better-sqlite3');

/**
 * Materials a contracting site store actually holds. Chosen to exercise the
 * product rather than to look impressive: a mix of units (bag, tonne, m3, m,
 * each), and two expiry-managed items so FEFO and the expiry screens have
 * something real to act on the first time somebody opens them.
 */
const MATERIALS = [
  { item_code: 'CEM-OPC-50', description: 'Portland cement OPC 42.5, 50 kg bag', unit: 'BAG', material_group: 'Cement & binders' },
  { item_code: 'AGG-SAND-WASH', description: 'Washed building sand', unit: 'M3', material_group: 'Aggregates' },
  { item_code: 'AGG-GRAVEL-20', description: 'Crushed aggregate 20 mm', unit: 'M3', material_group: 'Aggregates' },
  { item_code: 'STL-REBAR-12', description: 'Deformed steel reinforcement bar, 12 mm', unit: 'TON', material_group: 'Steel' },
  { item_code: 'STL-REBAR-16', description: 'Deformed steel reinforcement bar, 16 mm', unit: 'TON', material_group: 'Steel' },
  { item_code: 'STL-TIEWIRE', description: 'Annealed rebar tie wire, 1.6 mm', unit: 'KG', material_group: 'Steel' },
  { item_code: 'BLK-HOLLOW-20', description: 'Hollow concrete block 200 mm', unit: 'EA', material_group: 'Masonry' },
  { item_code: 'TMB-PLY-18', description: 'Formwork plywood sheet, 18 mm', unit: 'EA', material_group: 'Formwork & timber' },
  { item_code: 'TMB-BATTEN', description: 'Softwood formwork batten, 50 x 100 mm', unit: 'M', material_group: 'Formwork & timber' },
  { item_code: 'PIP-PVC-110', description: 'uPVC drainage pipe, 110 mm', unit: 'M', material_group: 'Plumbing' },
  { item_code: 'ELE-CONDUIT-20', description: 'Electrical conduit, 20 mm', unit: 'M', material_group: 'Electrical' },
  { item_code: 'PPE-HELMET', description: 'Safety helmet', unit: 'EA', material_group: 'Safety' },
  // Expiry-managed in practice: these are the two that make FEFO and the
  // shelf-life screens mean something on day one.
  { item_code: 'CHM-ADHESIVE-20', description: 'Tile adhesive, 20 kg bag (shelf life)', unit: 'BAG', material_group: 'Chemicals' },
  { item_code: 'CHM-MEMBRANE', description: 'Bituminous waterproofing membrane roll (shelf life)', unit: 'EA', material_group: 'Chemicals' },
];

const WAREHOUSE = { warehouse_code: 'SITE-01', warehouse_name: 'Main Site Store' };

/**
 * Bins that describe a site store rather than a distribution centre: an open
 * yard for aggregates, a covered rack for bagged and boxed goods, a locked cage
 * for the things that walk.
 */
const BINS = [
  { bin_code: 'YARD-A', zone: 'Yard', capacity: 0 },
  { bin_code: 'YARD-B', zone: 'Yard', capacity: 0 },
  { bin_code: 'RACK-01', zone: 'Covered store', capacity: 0 },
  { bin_code: 'RACK-02', zone: 'Covered store', capacity: 0 },
  { bin_code: 'RACK-03', zone: 'Covered store', capacity: 0 },
  { bin_code: 'CAGE-01', zone: 'Secure cage', capacity: 0 },
];

const SUBCONTRACTOR = {
  name: 'Sample Subcontractor (rename or delete)',
  trade_category: 'Steel fixing',
  contract_reference: 'SAMPLE-001',
};

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--db') { out.db = argv[i + 1]; i += 1; }
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
    else { console.error(`Unknown argument: ${argv[i]}`); process.exit(2); }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.db) {
    console.log('Usage: node scripts/install-starter-data.js --db <path to wms.db> [--dry-run]');
    console.log('\nWrites one site store, a few bins, common contracting materials and one');
    console.log('subcontractor into an EMPTY tenant. Refuses if any of those already exist.');
    process.exit(args.help ? 0 : 2);
  }

  const dbPath = path.resolve(args.db);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const count = (table) => {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    return exists ? db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n : 0;
  };

  // The guard. Anything already here means this is somebody's tenant, not a
  // blank one, and sample rows must not be mixed into it.
  const occupied = ['materials', 'warehouses', 'bin_locations'].filter((t) => count(t) > 0);
  if (occupied.length) {
    console.error('REFUSED: this database already holds master data.');
    occupied.forEach((t) => console.error(`  ${t}: ${count(t)} row(s)`));
    console.error('\nStarter data is only for an empty tenant. Nothing was written.');
    console.error('To load data into a tenant in use, use the import screen instead.');
    process.exit(1);
  }

  const plan = {
    warehouses: 1,
    bins: BINS.length,
    materials: MATERIALS.length,
    subcontractors: count('subcontractors') === 0 ? 1 : 0,
  };

  console.log(`Starter data for ${dbPath}\n`);
  console.log(`  site store     : ${WAREHOUSE.warehouse_code} — ${WAREHOUSE.warehouse_name}`);
  console.log(`  bins           : ${BINS.map((b) => b.bin_code).join(', ')}`);
  console.log(`  materials      : ${plan.materials}`);
  console.log(`  subcontractors : ${plan.subcontractors}`);

  if (args.dryRun) {
    console.log('\nDRY RUN — nothing was written.');
    db.close();
    return;
  }

  const write = db.transaction(() => {
    db.prepare('INSERT INTO warehouses (warehouse_code, warehouse_name) VALUES (?, ?)')
      .run(WAREHOUSE.warehouse_code, WAREHOUSE.warehouse_name);

    const insBin = db.prepare(`
      INSERT INTO bin_locations (warehouse_code, zone, bin_code, full_bin_location, capacity)
      VALUES (?, ?, ?, ?, ?)
    `);
    BINS.forEach((b) => insBin.run(WAREHOUSE.warehouse_code, b.zone, b.bin_code,
      `${WAREHOUSE.warehouse_code}-${b.bin_code}`, b.capacity));

    const insMat = db.prepare(`
      INSERT INTO materials (item_code, description, unit, material_group, material_type)
      VALUES (?, ?, ?, ?, 'Construction material')
    `);
    MATERIALS.forEach((m) => insMat.run(m.item_code, m.description, m.unit, m.material_group));

    if (plan.subcontractors) {
      db.prepare('INSERT INTO subcontractors (name, trade_category, contract_reference) VALUES (?, ?, ?)')
        .run(SUBCONTRACTOR.name, SUBCONTRACTOR.trade_category, SUBCONTRACTOR.contract_reference);
    }

    db.prepare(`
      INSERT INTO audit_trail (entity_type, action, new_value, changed_by_name, source_screen)
      VALUES ('Tenant', 'STARTER_DATA_INSTALLED', ?, 'install-starter-data', 'install-starter-data')
    `).run(JSON.stringify(plan));
  });
  write();
  db.close();

  console.log('\nWritten. Nothing existing was changed — there was nothing to change.');
  // This order is not advice, it is how the product works. A received batch
  // lands on QUALITY HOLD in no bin, and allocation will not touch it until it
  // is released AND put away. Steps 2 and 3 are the ones a new customer does
  // not know are waiting, and skipping them looks exactly like a broken
  // product: the request approves, then nothing can be picked.
  console.log('\nNext, in this order:');
  console.log('  1. Goods Receipt      — receive something into SITE-01.');
  console.log('  2. Quality Inspection — release the batch. It arrives on hold.');
  console.log('  3. Goods Receipt      — put it away in a bin (e.g. SITE-01-RACK-01).');
  console.log('  4. Create Request     — ask for it back out, and approve it.');
  console.log('  5. My Picking Tasks   — claim it, pick it, and post the issue.');
  console.log('\nEvery row above is a starting point. Edit or delete any of it from the');
  console.log('master-data screens, and use the import screen for the real material list.');
}

main();
