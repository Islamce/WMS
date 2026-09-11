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
  for (const [name, value] of [['materials', materials], ['locations', locations], ['transactions', transactions]]) {
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
      ('materials','Materials'), ('locations','Locations'), ('kpi_dashboard','KPI Dashboard');
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
  console.log(`\n    Serve it with:\n      DB_PATH=${dbPath} SKIP_AUTO_SEED=1 JWT_SECRET=<32+ chars> npm start\n`);
}

main();
