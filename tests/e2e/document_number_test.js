/**
 * A locally minted document number is never handed out twice.
 *
 * These numbers replace the SAP documents a contractor does not have, and they
 * are not cosmetic: ISS- is written to stock_transactions.reservation_number on
 * every outbound movement, and GI reversal identifies what to put back by
 * document number. Two movements sharing one reference is a corrupt audit trail.
 *
 * The original implementation counted the numbers already issued and added one.
 * The first case below reproduces exactly what that did, so the regression this
 * guards against is visible rather than described.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) { passed += 1; console.log('PASS:', name); }
  else { failed += 1; fails.push(name); console.log('FAIL:', name, detail === undefined ? '' : detail); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-docnum-'));
const dbPath = path.join(tmp, 'wms.db');
process.env.DB_PATH = dbPath;

// ===== 0. The old scheme, reproduced, so the bug is a fact and not a claim ===
{
  const db = new Database(':memory:');
  db.exec('CREATE TABLE material_request_headers (id INTEGER PRIMARY KEY, erp_reservation_number TEXT)');
  const mintByCount = () => {
    const n = db.prepare("SELECT COUNT(*) AS n FROM material_request_headers WHERE erp_reservation_number LIKE 'ISS-2026-%'").get().n + 1;
    return `ISS-2026-${String(n).padStart(5, '0')}`;
  };
  const ins = db.prepare('INSERT INTO material_request_headers (erp_reservation_number) VALUES (?)');
  const issued = [];
  for (let i = 0; i < 3; i += 1) { const v = mintByCount(); ins.run(v); issued.push(v); }
  db.prepare("DELETE FROM material_request_headers WHERE erp_reservation_number='ISS-2026-00002'").run();
  const next = mintByCount();
  check('N0 counting existing numbers DOES re-issue one (the bug being fixed)',
    issued.includes(next), `${issued.join(',')} then ${next}`);
  db.close();
}

// The real schema, through the real migrations.
require('child_process').spawnSync('node', ['server/db/migrate.js'], {
  cwd: path.join(__dirname, '..', '..'),
  env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test', SKIP_AUTO_SEED: '1' },
  stdio: 'ignore',
});

const { nextNumber } = require('./../../server/services/documentNumber');
const db = require('./../../server/db/connection');
// These rows exist only to be counted and deleted; no user or material backs
// them, and the point here is the counter, not referential integrity.
db.pragma('foreign_keys = OFF');

// ===== 1. Numbers are unique, in order, and survive a deletion =====
const first = [];
for (let i = 0; i < 5; i += 1) first.push(nextNumber('ISS'));
check('N1 five mints are five distinct numbers', new Set(first).size === 5, first.join(','));
check('N1 and they run in order', first[0].endsWith('00001') && first[4].endsWith('00005'), first.join(','));

// Record them the way the application does, then remove one, as a cancellation
// would. The counter must not care.
const ins = db.prepare('INSERT INTO material_request_headers (request_number, requester_id, requester_name, created_by, erp_reservation_number) VALUES (?,1,?,1,?)');
first.forEach((n, i) => ins.run(`RQ-DOC-${i}`, 'T', n));
db.prepare("DELETE FROM material_request_headers WHERE erp_reservation_number = ?").run(first[1]);
const afterDelete = nextNumber('ISS');
check('N1 deleting a numbered request does NOT free its number for reuse',
  !first.includes(afterDelete), `${afterDelete} was already in ${first.join(',')}`);

// ===== 2. Scopes are independent =====
const gi = nextNumber('GI');
check('N2 a different scope has its own series', gi.startsWith('GI-') && gi.endsWith('00001'), gi);
check('N2 and does not disturb the first', nextNumber('ISS').endsWith('00007'), 'ISS continued');

// ===== 3. A tenant that already minted under the old scheme is seeded =====
// Without seeding, the new counter would start at 1 on an existing deployment
// and re-issue every number already on a movement.
{
  const seeded = path.join(tmp, 'seeded.db');
  require('child_process').spawnSync('node', ['server/db/migrate.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, DB_PATH: seeded, NODE_ENV: 'test', SKIP_AUTO_SEED: '1' },
    stdio: 'ignore',
  });
  const s = new Database(seeded);
  s.pragma('foreign_keys = OFF');
  // Put the database back into the state the old code would have left it in.
  s.prepare('DELETE FROM document_sequences').run();
  const year = new Date().getFullYear();
  const insert = s.prepare('INSERT INTO material_request_headers (request_number, requester_id, requester_name, created_by, erp_reservation_number) VALUES (?,1,?,1,?)');
  [1, 2, 7].forEach((n) => insert.run(`RQ-OLD-${n}`, 'T', `ISS-${year}-${String(n).padStart(5, '0')}`));
  s.close();

  // Re-run the seeding step of migration 027 against it.
  const { MIGRATIONS } = require('./../../server/db/migrations');
  const m = MIGRATIONS.find((x) => x.id === '027_document_sequences');
  const s2 = new Database(seeded);
  m.up(s2);
  const row = s2.prepare("SELECT next_value FROM document_sequences WHERE scope='ISS' AND period=?").get(String(year));
  s2.close();
  check('N3 an existing deployment is seeded past its highest issued number',
    row && row.next_value === 8, row);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
if (fails.length) console.log('Failed:', fails.join(', '));
process.exit(failed ? 1 : 0);
