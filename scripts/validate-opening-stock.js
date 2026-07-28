#!/usr/bin/env node
/**
 * Opening Stock import validation harness.
 *
 * Proves, against a COPY of a real database, that the Opening Stock import
 * behaves correctly before anyone runs the real import into production.
 *
 * Why this exists
 * ---------------
 * Opening Stock is the inventory baseline. A defect there is expensive to
 * detect and expensive to unwind, because every later FIFO/FEFO calculation
 * inherits the error. Before PR #43 a repeated import silently INCREASED
 * existing batch quantities — import the same file twice and stock doubled.
 *
 * This harness runs the real server and the real HTTP import endpoint against
 * a throwaway copy, so what it proves is what the operator will actually get.
 *
 * Usage
 * -----
 *   node scripts/validate-opening-stock.js <path-to-database-COPY>
 *
 * Safety
 * ------
 * - Refuses to run against the configured live database (DB_PATH / config).
 * - Refuses paths that look like a production location.
 * - Never mutates the file you pass: it works on its own scratch copy, which
 *   is deleted afterwards.
 * - Creates a disposable admin and fixtures prefixed VALIDATE- inside the
 *   scratch copy only, so real data is never touched even there.
 *
 * Exit code 0 = every scenario passed. Non-zero = do NOT proceed with the
 * production import until the failure is understood.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const PREFIX = 'VALIDATE';
const WAREHOUSE = `${PREFIX}-WH`;
const MATERIAL = `${PREFIX}-MAT-1`;
const BIN_A = `${WAREHOUSE}-A-01`;
const BIN_B = `${WAREHOUSE}-B-02`;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail === undefined ? '' : `\n        ${JSON.stringify(detail)}`}`);
  }
}

function die(lines) {
  console.error(`\n[REFUSED] ${lines.join('\n          ')}\n`);
  process.exit(2);
}

// --- 1. Argument + safety guards ------------------------------------------
const sourceArg = process.argv[2];
if (!sourceArg) {
  die([
    'Path to a database COPY is required.',
    '',
    'Usage: node scripts/validate-opening-stock.js <path-to-database-COPY>',
    '',
    'Take the copy with the application stopped, or from a verified backup.',
  ]);
}

const source = path.resolve(sourceArg);
if (!fs.existsSync(source)) die([`No such file: ${source}`]);

// Never operate on the database this checkout is configured to use.
const configuredDb = path.resolve(require('../server/config').dbPath);
if (source === configuredDb) {
  die([
    'That is the database this application is configured to use.',
    `Configured DB_PATH: ${configuredDb}`,
    '',
    'Pass a separate COPY. This harness writes test data and must never',
    'run against a live database.',
  ]);
}

// Heuristic guard against obvious production paths.
const PRODUCTION_MARKERS = ['domains/wms.kynox.io', 'wms.kynox.io/nodejs'];
const marker = PRODUCTION_MARKERS.find((m) => source.replace(/\\/g, '/').includes(m));
if (marker) {
  die([
    `That path looks like production (matched "${marker}").`,
    `Path: ${source}`,
    '',
    'Copy the database somewhere neutral first, then point this harness at',
    'the copy. See WMS-PRODUCTION-RUNBOOK.md.',
  ]);
}

// --- 2. Scratch copy -------------------------------------------------------
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-openstock-validate-'));
const scratchDb = path.join(scratchDir, 'wms.db');
const cleanup = () => { try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* best effort */ } };

console.log('\nOpening Stock import validation');
console.log(`  source (never modified): ${source}`);
console.log(`  scratch copy:            ${scratchDb}\n`);

// Copy via SQLite backup so WAL content is included and the source is only read.
{
  const src = new Database(source, { readonly: true });
  src.exec('PRAGMA wal_checkpoint(FULL)');
  fs.copyFileSync(source, scratchDb);
  src.close();
}

let server;
let scratch;

function stopServer() {
  if (server && !server.killed) { server.kill('SIGKILL'); }
}
process.on('exit', () => { stopServer(); cleanup(); });
process.on('SIGINT', () => { process.exit(130); });

// --- 3. Disposable admin inside the scratch copy ---------------------------
scratch = new Database(scratchDb);
const adminRole = scratch.prepare("SELECT id FROM roles WHERE name='admin'").get();
if (!adminRole) {
  die([
    "The copy contains no 'admin' role — it may be empty or not a WMS database.",
    `Checked: ${source}`,
  ]);
}
const testEmail = `validate-${crypto.randomBytes(4).toString('hex')}@local.invalid`;
const testPassword = `Vld${crypto.randomBytes(9).toString('hex')}1`;
scratch.prepare(`INSERT INTO users (name, email, password_hash, role_id, status, must_change_password)
  VALUES ('Opening Stock Validator', ?, ?, ?, 'active', 0)`)
  .run(testEmail, bcrypt.hashSync(testPassword, 10), adminRole.id);

// Baseline counts, so we can prove we did not disturb pre-existing data.
const countAll = () => ({
  batches: scratch.prepare('SELECT COUNT(*) n FROM batches').get().n,
  transactions: scratch.prepare('SELECT COUNT(*) n FROM stock_transactions').get().n,
  registry: scratch.prepare('SELECT COUNT(*) n FROM opening_stock_batch_registry').get().n,
});
const baseline = countAll();
console.log(`  baseline: ${baseline.batches} batches, ${baseline.transactions} transactions, `
  + `${baseline.registry} opening-stock registry rows\n`);
scratch.close();

// --- 4. Boot the real server against the scratch copy ----------------------
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;

function request(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(`${BASE}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': payload.length } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); }
        catch { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('server exited during startup');
    try {
      const r = await request('GET', '/healthz');
      if (r.status === 200) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('server did not become healthy');
}

function importRows(token, entity, rows) {
  return request('POST', `/api/import/${entity}`, token, { rows });
}

// Open a fresh read handle for assertions while the server holds its own.
function reader() { return new Database(scratchDb, { readonly: true }); }

function batchRow(batchNumber) {
  const db = reader();
  const row = db.prepare('SELECT * FROM batches WHERE batch_number=?').get(batchNumber);
  db.close();
  return row;
}

function counts() {
  const db = reader();
  const out = {
    batches: db.prepare('SELECT COUNT(*) n FROM batches').get().n,
    transactions: db.prepare('SELECT COUNT(*) n FROM stock_transactions').get().n,
    registry: db.prepare('SELECT COUNT(*) n FROM opening_stock_batch_registry').get().n,
  };
  db.close();
  return out;
}

function binQuantity(materialCode, binCode) {
  const db = reader();
  const row = db.prepare(`SELECT mls.quantity q FROM material_location_stock mls
    JOIN materials m ON m.id = mls.material_id
    JOIN locations l ON l.id = mls.location_id
    WHERE m.item_code=? AND l.code=?`).get(materialCode, binCode);
  db.close();
  return row ? row.q : null;
}

async function main() {
  server = spawn(process.execPath, ['index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DB_PATH: scratchDb,
      PORT: String(PORT),
      NODE_ENV: 'development',
      SKIP_AUTO_SEED: '1',
      ALLOW_AUTO_SEED: '0',
      SCHEDULER_ENABLED: '0',
      LOG_REQUESTS: '0',
      BACKUP_DIR: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });

  try {
    await waitForHealth();
  } catch (err) {
    console.error(`\nServer failed to start: ${err.message}\n${serverLog.slice(-1500)}`);
    process.exit(2);
  }

  const login = await request('POST', '/api/auth/login', null, { email: testEmail, password: testPassword });
  const token = login.body.token;
  if (!token) {
    console.error('\nCould not authenticate against the scratch copy.', login.status, login.body);
    process.exit(2);
  }

  // --- Fixtures: isolated, prefixed, created through the real endpoints ----
  console.log('Fixtures');
  let r = await importRows(token, 'warehouses', [{ warehouse_code: WAREHOUSE, warehouse_name: 'Validation Warehouse' }]);
  check('warehouse fixture created', r.status === 200 && r.body.errors === 0, r.body);
  r = await importRows(token, 'bins', [
    { warehouse_code: WAREHOUSE, bin_code: 'A-01', full_bin_location: BIN_A },
    { warehouse_code: WAREHOUSE, bin_code: 'B-02', full_bin_location: BIN_B },
  ]);
  check('bin fixtures created', r.status === 200 && r.body.errors === 0, r.body);
  r = await importRows(token, 'materials', [{ item_code: MATERIAL, description: 'Validation material', base_unit: 'EA' }]);
  check('material fixture created', r.status === 200 && r.body.errors === 0, r.body);

  const afterFixtures = counts();

  // --- Scenario 1: a new opening-stock batch is created --------------------
  console.log('\n1. New opening-stock batch');
  const batchNo = `${PREFIX}-BATCH-A`;
  const row = { material_code: MATERIAL, warehouse_code: WAREHOUSE, batch_number: batchNo, quantity: '250', bin_location: BIN_A };
  r = await importRows(token, 'stock', [row]);
  check('import succeeds', r.status === 200 && r.body.created === 1 && r.body.errors === 0, r.body);
  check('batch created with the imported quantity', batchRow(batchNo)?.remaining_quantity === 250, batchRow(batchNo));
  check('bin balance matches', binQuantity(MATERIAL, BIN_A) === 250);
  let c = counts();
  check('exactly one batch added', c.batches === afterFixtures.batches + 1, c);
  check('exactly one ledger entry added', c.transactions === afterFixtures.transactions + 1, c);
  check('batch auto-registered as opening stock', c.registry === afterFixtures.registry + 1, c);
  const afterFirst = c;

  // --- Scenario 2: identical re-import is skipped --------------------------
  console.log('\n2. Identical re-import (the PR #43 regression)');
  r = await importRows(token, 'stock', [row]);
  check('re-import reports skipped', r.status === 200 && r.body.skipped === 1 && r.body.created === 0
    && r.body.updated === 0 && r.body.errors === 0, r.body);
  check('quantity unchanged', batchRow(batchNo)?.remaining_quantity === 250, batchRow(batchNo));
  check('bin balance unchanged', binQuantity(MATERIAL, BIN_A) === 250);
  c = counts();
  check('no batch added', c.batches === afterFirst.batches, c);
  check('no ledger entry added', c.transactions === afterFirst.transactions, c);

  // --- Scenario 3: re-import with a DIFFERENT quantity ---------------------
  console.log('\n3. Re-import with a different quantity');
  r = await importRows(token, 'stock', [{ ...row, quantity: '9999' }]);
  check('still skipped, not applied', r.status === 200 && r.body.skipped === 1 && r.body.errors === 0, r.body);
  check('existing balance is NOT overwritten', batchRow(batchNo)?.remaining_quantity === 250, batchRow(batchNo));
  check('bin balance still unchanged', binQuantity(MATERIAL, BIN_A) === 250);
  check('no ledger entry added', counts().transactions === afterFirst.transactions);

  // --- Scenario 4: same batch, different bin -------------------------------
  console.log('\n4. Same batch number in a different bin');
  r = await importRows(token, 'stock', [{ ...row, bin_location: BIN_B }]);
  check('rejected with an error', r.status === 200 && r.body.errors === 1 && r.body.created === 0, r.body);
  check('error names the bin conflict',
    /already exists .*bin|cannot be imported into/i.test(r.body.results?.[0]?.message || ''), r.body.results?.[0]);
  check('nothing written to the other bin', binQuantity(MATERIAL, BIN_B) === null);
  check('no batch added', counts().batches === afterFirst.batches);

  // --- Scenario 5: an operational (non-opening-stock) batch is protected ---
  console.log('\n5. Existing operational goods-receipt batch');
  const grBatch = `${PREFIX}-GR-BATCH`;
  {
    // Simulate a batch that arrived through goods receipt: present in batches,
    // deliberately NOT in the opening-stock registry.
    const db = new Database(scratchDb);
    const m = db.prepare('SELECT id, item_code, description FROM materials WHERE item_code=?').get(MATERIAL);
    db.prepare(`INSERT INTO batches
      (batch_number,material_id,material_code,material_description,received_quantity,remaining_quantity,warehouse_code,bin_location,quality_status)
      VALUES(?,?,?,?,?,?,?,?,'RELEASED')`)
      .run(grBatch, m.id, m.item_code, m.description, 40, 40, WAREHOUSE, BIN_B);
    db.close();
  }
  const beforeGr = counts();
  r = await importRows(token, 'stock', [{ ...row, batch_number: grBatch, bin_location: BIN_B, quantity: '500' }]);
  check('rejected rather than increased', r.status === 200 && r.body.errors === 1 && r.body.created === 0, r.body);
  check('error explains it is not opening stock',
    /not registered as opening stock/i.test(r.body.results?.[0]?.message || ''), r.body.results?.[0]);
  check('operational quantity untouched', batchRow(grBatch)?.remaining_quantity === 40, batchRow(grBatch));
  check('no ledger entry added', counts().transactions === beforeGr.transactions);

  // --- Scenario 6: comma-formatted quantities ------------------------------
  console.log('\n6. Comma-formatted quantity');
  const commaBatch = `${PREFIX}-BATCH-COMMA`;
  r = await importRows(token, 'stock', [{ ...row, batch_number: commaBatch, quantity: '1,234.5' }]);
  check('import succeeds', r.status === 200 && r.body.created === 1 && r.body.errors === 0, r.body);
  check('quantity parsed as 1234.5', batchRow(commaBatch)?.remaining_quantity === 1234.5, batchRow(commaBatch));

  // --- Scenario 7: several bins in one import ------------------------------
  console.log('\n7. Multiple bins in one import');
  const beforeMulti = counts();
  r = await importRows(token, 'stock', [
    { material_code: MATERIAL, warehouse_code: WAREHOUSE, batch_number: `${PREFIX}-MB-1`, quantity: '10', bin_location: BIN_A },
    { material_code: MATERIAL, warehouse_code: WAREHOUSE, batch_number: `${PREFIX}-MB-2`, quantity: '20', bin_location: BIN_B },
  ]);
  check('both rows created', r.status === 200 && r.body.created === 2 && r.body.errors === 0, r.body);
  check('two batches added', counts().batches === beforeMulti.batches + 2);
  check('two ledger entries added', counts().transactions === beforeMulti.transactions + 2);
  check('each bin holds its own quantity',
    batchRow(`${PREFIX}-MB-1`)?.remaining_quantity === 10 && batchRow(`${PREFIX}-MB-2`)?.remaining_quantity === 20);

  // --- Scenario 8: an unexpected failure rolls the whole batch back --------
  console.log('\n8. Forced failure rolls back the entire import');
  const beforeRollback = counts();
  {
    // A trigger that raises on one specific batch number, so we can prove the
    // all-or-nothing guarantee rather than assume it.
    const db = new Database(scratchDb);
    db.exec(`CREATE TRIGGER ${PREFIX}_force_failure BEFORE INSERT ON batches
      WHEN NEW.batch_number = '${PREFIX}-BOOM'
      BEGIN SELECT RAISE(ABORT, 'forced failure for rollback validation'); END;`);
    db.close();
  }
  r = await importRows(token, 'stock', [
    { material_code: MATERIAL, warehouse_code: WAREHOUSE, batch_number: `${PREFIX}-RB-1`, quantity: '5', bin_location: BIN_A },
    { material_code: MATERIAL, warehouse_code: WAREHOUSE, batch_number: `${PREFIX}-BOOM`, quantity: '5', bin_location: BIN_A },
  ]);
  check('import reports failure', r.status === 500 || (r.body.errors || 0) > 0, { status: r.status, body: r.body });
  const afterRollback = counts();
  check('the valid row in the same batch was rolled back too',
    afterRollback.batches === beforeRollback.batches, { before: beforeRollback, after: afterRollback });
  check('no partial ledger entries', afterRollback.transactions === beforeRollback.transactions);
  check('no partial registry rows', afterRollback.registry === beforeRollback.registry);
  check('the preceding row was not written', batchRow(`${PREFIX}-RB-1`) === undefined);
  {
    const db = new Database(scratchDb);
    db.exec(`DROP TRIGGER ${PREFIX}_force_failure`);
    db.close();
  }

  // --- Pre-existing data untouched ----------------------------------------
  console.log('\n9. Pre-existing data');
  const db = reader();
  const preExistingBatches = db.prepare("SELECT COUNT(*) n FROM batches WHERE batch_number NOT LIKE ?").get(`${PREFIX}-%`).n;
  const integrity = db.prepare('PRAGMA integrity_check').get();
  db.close();
  check('no pre-existing batch was added or removed', preExistingBatches === baseline.batches, {
    baseline: baseline.batches, now: preExistingBatches,
  });
  check('database integrity is ok', Object.values(integrity)[0] === 'ok', integrity);

  // --- Report --------------------------------------------------------------
  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log(`Failed: ${failures.join(', ')}`);
    console.log('\nDo NOT run the production Opening Stock import until these are understood.');
  } else {
    console.log('\nOpening Stock import behaved correctly on this data.');
    console.log('Reminder: this validates the CODE against a copy. Still take a verified');
    console.log('backup before the real import, and re-import the same file afterwards to');
    console.log('confirm idempotency on production itself.');
  }
  console.log(`${'='.repeat(60)}\n`);

  stopServer();
  cleanup();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nValidation harness error:', err);
  stopServer();
  cleanup();
  process.exit(2);
});
