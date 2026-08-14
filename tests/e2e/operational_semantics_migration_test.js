#!/usr/bin/env node
/*
 * Isolated migration regression: prove legacy operational rows are backfilled
 * only from known note formats and that an unresolved row remains flagged.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wms-cor001-')), 'legacy.db');
process.env.DB_PATH = dbPath;
const db = require('../../server/db/connection');
const { MIGRATIONS } = require('../../server/db/migrations');

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL: ${name}`, detail);
  }
}

try {
  db.exec(`
    CREATE TABLE material_request_lines (id INTEGER PRIMARY KEY);
    CREATE TABLE stock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_type TEXT NOT NULL,
      material_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      reservation_number TEXT,
      user_id INTEGER NOT NULL,
      transaction_date TEXT NOT NULL,
      notes TEXT
    );
  `);
  const insert = db.prepare(`INSERT INTO stock_transactions
    (transaction_type, material_id, location_id, quantity, reservation_number, user_id, transaction_date, notes)
    VALUES (?, 101, 1, 5, ?, 1, '2026-08-01', ?)`);
  insert.run('OUT', 'RES-COR-001', 'GI 4900009001 / REQ-COR-001');
  insert.run('IN', 'RES-COR-001', 'GI reversal 4900009002 / REQ-COR-001');
  insert.run('OUT', 'RES-UNKNOWN', 'Legacy manual correction');

  const migration = MIGRATIONS.find((item) => item.id === '014_operational_movement_semantics');
  migration.up(db);

  const rows = db.prepare(`SELECT id, movement_category, movement_classification_status,
    category_backfill_reason, reversal_of_transaction_id
    FROM stock_transactions ORDER BY id`).all();
  check('legacy GI issue receives the ISSUE enum', rows[0].movement_category === 'ISSUE'
    && rows[0].movement_classification_status === 'BACKFILLED', rows[0]);
  check('legacy GI reversal links to its only matching original', rows[1].movement_category === 'REVERSAL'
    && rows[1].reversal_of_transaction_id === rows[0].id
    && rows[1].movement_classification_status === 'BACKFILLED', rows[1]);
  check('unrecognized legacy notes remain unclassified and flagged', rows[2].movement_category === null
    && rows[2].movement_classification_status === 'NEEDS_REVIEW'
    && rows[2].category_backfill_reason === 'UNRECOGNIZED_LEGACY_NOTES', rows[2]);

  let rejectedInvalidCategory = false;
  try {
    db.prepare(`INSERT INTO stock_transactions
      (transaction_type, material_id, location_id, quantity, user_id, transaction_date, notes, movement_category)
      VALUES ('IN', 101, 1, 1, 1, '2026-08-01', 'invalid category test', 'NOT_A_CATEGORY')`).run();
  } catch (_) {
    rejectedInvalidCategory = true;
  }
  check('operational category enum rejects unsupported values', rejectedInvalidCategory);
} finally {
  console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
  db.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
