#!/usr/bin/env node
'use strict';

/**
 * Build a realistically-sized database for load testing.
 *
 * The existing seed produces a handful of demo rows, which tells you nothing
 * about how the system behaves once a site store has a real catalogue and a
 * year of movements behind it. Query plans that are instant over 8 materials can
 * fall over at 100,000, and that difference is exactly what a buyer's "how much
 * can it take?" question is about.
 *
 * Writes ONLY to a database you name. It refuses to touch a database that
 * already exists, for the same reason scripts/provision-tenant.js does: a load
 * generator must be structurally incapable of destroying real data.
 *
 * Usage:
 *   node tests/load/seed-scale.js --db /tmp/load.db \
 *     --materials 100000 --locations 200 --transactions 1000000
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const REPO_ROOT = path.join(__dirname, '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

/** Deterministic PRNG so a given size always produces the same dataset. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  let args;
  try { args = parseArgs(process.argv); } catch (e) { fail(e.message); }
  if (!args.db) fail('--db <path> is required.');

  const dbPath = path.resolve(args.db);
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbPath + suffix)) {
      fail(`Refusing to seed: ${dbPath + suffix} already exists. Load seeding only ever creates a new database.`);
    }
  }

  const materials = Number(args.materials || 100000);
  const locations = Number(args.locations || 200);
  const transactions = Number(args.transactions || 1000000);
  // The workflow tables. Without these most of the product's SQL is
  // unreachable from a load test: the warehouse queue, the bin screens, the
  // audit facets and the analytics de-duplication all read tables the original
  // seeder never filled - which is how a green load test coexisted with an
  // endpoint that blocked the server for 164 s at ten times production size.
  // Defaults are roughly ten times today's production.
  const bins = Number(args.bins || 2000);
  const batches = Number(args.batches || 30000);
  const requests = Number(args.requests || 20000);
  const linesPerRequest = Number(args['lines-per-request'] || 5);
  const tasks = Number(args.tasks || 60000);
  const audit = Number(args.audit || 300000);
  for (const [name, value] of [['materials', materials], ['locations', locations], ['transactions', transactions],
    ['bins', bins], ['batches', batches], ['requests', requests], ['lines-per-request', linesPerRequest],
    ['tasks', tasks], ['audit', audit]]) {
    if (!Number.isInteger(value) || value < 0) fail(`--${name} must be a non-negative integer.`);
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // Schema from the project's own migrations, so the shape under test is the
  // shape that ships. Seeded in a child process because the migration chain
  // binds to the singleton connection at module load.
  process.stdout.write('  → applying schema … ');
  execFileSync(process.execPath, [path.join(REPO_ROOT, 'server', 'db', 'migrate.js')], {
    cwd: REPO_ROOT,
    env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'loadtest', SKIP_AUTO_SEED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log('ok');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  const random = rng(20260911);

  process.stdout.write('  → roles, permissions, load user … ');
  db.exec(`
    INSERT OR IGNORE INTO roles (name, description) VALUES ('admin','Load test admin');
    INSERT OR IGNORE INTO permissions (key, label) VALUES
      ('dashboard','Dashboard'), ('stock_in','Stock In'), ('stock_out','Stock Out'),
      ('materials','Materials'), ('locations','Locations'), ('kpi_dashboard','KPI Dashboard'),
      ('ai_analytics','AI Stock Analytics'), ('warehouse_dashboard','Warehouse Dashboard'),
      ('goods_receipt','Goods Receipt'), ('audit_trail','Audit Trail'), ('all_locations','All Locations');
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      SELECT (SELECT id FROM roles WHERE name='admin'), id FROM permissions;
  `);
  // A known credential for the load generator. This database is disposable by
  // construction (the refusal above guarantees it is brand new), so a fixed
  // password here can never weaken a real deployment.
  db.prepare(`
    INSERT OR IGNORE INTO users (name, email, password_hash, role_id, status, must_change_password)
    VALUES ('Load Test', 'load@test.local', ?, (SELECT id FROM roles WHERE name='admin'), 'active', 0)
  `).run(bcrypt.hashSync('LoadTest@123456', 10));
  console.log('ok');

  process.stdout.write(`  → ${locations.toLocaleString()} locations … `);
  const insertLocation = db.prepare('INSERT OR IGNORE INTO locations (code) VALUES (?)');
  db.transaction(() => {
    for (let i = 1; i <= locations; i += 1) {
      insertLocation.run(`L-${String(i).padStart(5, '0')}`);
    }
  })();
  console.log('ok');

  process.stdout.write(`  → ${materials.toLocaleString()} materials … `);
  const insertMaterial = db.prepare(`
    INSERT OR IGNORE INTO materials (plant, item_code, description, unit, price, currency, material_type, material_group)
    VALUES (?,?,?,?,?,?,?,?)`);
  const GROUPS = ['REBAR', 'CEMENT', 'BLOCK', 'ELECTRICAL', 'PLUMBING', 'FINISHES', 'FORMWORK', 'PPE'];
  db.transaction(() => {
    for (let i = 1; i <= materials; i += 1) {
      const group = GROUPS[i % GROUPS.length];
      insertMaterial.run(`P${(i % 5) + 100}`, `MAT-${String(i).padStart(7, '0')}`,
        `${group} item ${i}`, 'EA', Math.round(random() * 10000) / 100, 'SAR',
        i % 3 === 0 ? 'CONS' : 'RAW', group);
    }
  })();
  console.log('ok');

  const materialIds = db.prepare('SELECT id FROM materials').all().map((r) => r.id);
  const locationIds = db.prepare('SELECT id FROM locations').all().map((r) => r.id);
  const userId = db.prepare("SELECT id FROM users WHERE email='load@test.local'").get().id;

  if (transactions > 0) {
    process.stdout.write(`  → ${transactions.toLocaleString()} stock transactions … `);
    const insertTx = db.prepare(`
      INSERT INTO stock_transactions
        (transaction_type, material_id, location_id, quantity, reservation_number, user_id, transaction_date, notes)
      VALUES (?,?,?,?,?,?,?,?)`);
    const upsertStock = db.prepare(`
      INSERT INTO material_location_stock (material_id, location_id, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(material_id, location_id)
      DO UPDATE SET quantity = quantity + excluded.quantity`);

    const CHUNK = 50000;
    let done = 0;
    while (done < transactions) {
      const size = Math.min(CHUNK, transactions - done);
      db.transaction(() => {
        for (let i = 0; i < size; i += 1) {
          const materialId = materialIds[Math.floor(random() * materialIds.length)];
          const locationId = locationIds[Math.floor(random() * locationIds.length)];
          const quantity = Math.max(1, Math.floor(random() * 100));
          // Spread over roughly a year so date-range queries have real work.
          const daysAgo = Math.floor(random() * 365);
          const when = new Date(Date.now() - daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19);
          insertTx.run('IN', materialId, locationId, quantity, null, userId, when, 'load seed');
          upsertStock.run(materialId, locationId, quantity);
        }
      })();
      done += size;
      process.stdout.write(`${Math.round((done / transactions) * 100)}% `);
    }
    console.log('ok');
  }

  if (bins > 0) {
    process.stdout.write(`  → 1 warehouse, ${bins.toLocaleString()} bins … `);
    db.prepare(`INSERT OR IGNORE INTO warehouses (warehouse_code, warehouse_name) VALUES ('SITE-01', 'Load Site Store')`).run();
    const insBin = db.prepare(`INSERT OR IGNORE INTO bin_locations (warehouse_code, bin_code, full_bin_location, zone)
      VALUES ('SITE-01', ?, ?, ?)`);
    db.transaction(() => {
      for (let i = 1; i <= bins; i += 1) {
        const code = `R-${String(Math.ceil(i / 40)).padStart(2, '0')}-${String(i % 40 + 1).padStart(2, '0')}`;
        insBin.run(code, `SITE-01-${code}`, i % 5 === 0 ? 'Yard' : 'Rack');
      }
    })();
    console.log('ok');
  }
  const binCodes = db.prepare("SELECT bin_code FROM bin_locations WHERE warehouse_code='SITE-01'").all().map((r) => r.bin_code);

  if (batches > 0 && materialIds.length) {
    process.stdout.write(`  → ${batches.toLocaleString()} batches … `);
    const insBatch = db.prepare(`
      INSERT OR IGNORE INTO batches (batch_number, material_id, material_code, warehouse_code, bin_location,
        received_quantity, remaining_quantity, reserved_quantity, quality_status, is_blocked, fifo_date, receiving_date, owner_type)
      VALUES (?,?,?,?,?,?,?,0,?,0,?,?,'COMPANY')`);
    const codeOf = db.prepare('SELECT item_code FROM materials WHERE id=?');
    db.transaction(() => {
      for (let i = 1; i <= batches; i += 1) {
        const materialId = materialIds[Math.floor(random() * materialIds.length)];
        const qty = Math.max(1, Math.floor(random() * 500));
        const remaining = random() < 0.15 ? 0 : Math.floor(qty * (0.2 + random() * 0.8));
        const daysAgo = Math.floor(random() * 365);
        const when = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
        insBatch.run(`B-${String(i).padStart(7, '0')}`, materialId, codeOf.get(materialId).item_code, 'SITE-01',
          binCodes.length && random() < 0.9 ? binCodes[Math.floor(random() * binCodes.length)] : null,
          qty, remaining, random() < 0.85 ? 'RELEASED' : 'QUALITY_HOLD', when, when);
      }
    })();
    console.log('ok');
  }

  if (requests > 0 && materialIds.length) {
    process.stdout.write(`  → ${requests.toLocaleString()} requests x ${linesPerRequest} lines, ${tasks.toLocaleString()} picking tasks … `);
    const STATUSES = ['Completed', 'Completed', 'Completed', 'Pending Picker Assignment', 'Picking in Progress',
      'Pending Approval', 'Rejected', 'Cancelled', 'Assigned to Picker', 'Picking Completed'];
    const insHeader = db.prepare(`INSERT OR IGNORE INTO material_request_headers
      (request_number, requester_id, requester_name, request_status, priority, issue_warehouse_code, wbs_element, created_at, submitted_at)
      VALUES (?,?,?,?,?,'SITE-01',?,?,?)`);
    const insLine = db.prepare(`INSERT OR IGNORE INTO material_request_lines
      (request_id, request_number, line_number, material_id, material_code, requested_quantity, approved_quantity, line_status)
      VALUES (?,?,?,?,?,?,?,?)`);
    const insTask = db.prepare(`INSERT OR IGNORE INTO picking_tasks (request_id, request_number, assigned_picker_id, task_status, created_at)
      VALUES (?,?,?,?,?)`);
    const codeOf2 = db.prepare('SELECT item_code FROM materials WHERE id=?');
    const headerIds = [];
    db.transaction(() => {
      for (let i = 1; i <= requests; i += 1) {
        const status = STATUSES[Math.floor(random() * STATUSES.length)];
        const daysAgo = Math.floor(random() * 365);
        const when = new Date(Date.now() - daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19);
        const number = `MR-2026-${String(i).padStart(6, '0')}`;
        const info = insHeader.run(number, userId, 'Load Test', status, ['NORMAL', 'HIGH', 'URGENT', 'LOW'][i % 4],
          `PRJ-${String(i % 40 + 1).padStart(3, '0')}`, when, when);
        const hid = Number(info.lastInsertRowid);
        headerIds.push(hid);
        for (let ln = 1; ln <= linesPerRequest; ln += 1) {
          const materialId = materialIds[Math.floor(random() * materialIds.length)];
          const q = Math.max(1, Math.floor(random() * 50));
          insLine.run(hid, number, ln, materialId, codeOf2.get(materialId).item_code, q, q,
            status === 'Completed' ? 'Picked' : 'Pending');
        }
      }
      // Several tasks per request: reassignments and reminders, as a real year has.
      for (let i = 0; i < tasks && headerIds.length; i += 1) {
        const hid = headerIds[Math.floor(random() * headerIds.length)];
        insTask.run(hid, `MR-2026-${String(headerIds.indexOf(hid) + 1).padStart(6, '0')}`, userId,
          ['Picking Completed', 'Picking Completed', 'Reassigned', 'Picking in Progress', 'Pending Picker Acceptance'][i % 5],
          new Date(Date.now() - Math.floor(random() * 365) * 86400000).toISOString().replace('T', ' ').slice(0, 19));
      }
    })();
    console.log('ok');
  }

  if (audit > 0) {
    process.stdout.write(`  → ${audit.toLocaleString()} audit rows … `);
    const insAudit = db.prepare(`INSERT INTO audit_trail (entity_type, entity_id, action, changed_by, changed_by_name, source_screen, changed_at)
      VALUES (?,?,?,?,?,?,?)`);
    const ACTIONS = ['STATUS_CHANGED', 'APPROVED', 'PICK_CONFIRM', 'GI_POSTED', 'GOODS_RECEIPT', 'QUALITY_STATUS', 'CREATE', 'UPDATE'];
    const ENTITIES = ['MaterialRequestHeader', 'MaterialRequestLine', 'Batch', 'PickingTask', 'User'];
    const CHUNK = 50000;
    let done = 0;
    while (done < audit) {
      const size = Math.min(CHUNK, audit - done);
      db.transaction(() => {
        for (let i = 0; i < size; i += 1) {
          insAudit.run(ENTITIES[i % ENTITIES.length], Math.floor(random() * 20000) + 1, ACTIONS[Math.floor(random() * ACTIONS.length)],
            userId, 'Load Test', 'load', new Date(Date.now() - Math.floor(random() * 365) * 86400000).toISOString().replace('T', ' ').slice(0, 19));
        }
      })();
      done += size;
    }
    console.log('ok');
  }

  process.stdout.write('  → optimising … ');
  db.exec('PRAGMA optimize; VACUUM; ANALYZE;');
  console.log('ok');

  const size = fs.statSync(dbPath).size;
  db.close();

  console.log('\n  ✓ Load dataset ready.\n');
  console.log(`    Database     : ${dbPath}`);
  console.log(`    Size on disk : ${(size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`    Materials    : ${materials.toLocaleString()}`);
  console.log(`    Locations    : ${locations.toLocaleString()}`);
  console.log(`    Transactions : ${transactions.toLocaleString()}`);
  console.log(`    Bins/batches : ${bins.toLocaleString()} / ${batches.toLocaleString()}`);
  console.log(`    Requests     : ${requests.toLocaleString()} (x${linesPerRequest} lines), ${tasks.toLocaleString()} picking tasks`);
  console.log(`    Audit rows   : ${audit.toLocaleString()}`);
  console.log(`\n    Serve it with:\n      DB_PATH=${dbPath} SKIP_AUTO_SEED=1 JWT_SECRET=<32+ chars> npm start\n`);
}

main();
