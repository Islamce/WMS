#!/usr/bin/env node
'use strict';

/**
 * Provision a NEW tenant database.
 *
 * This is deliberately NOT the same code path as
 * server/services/reset.js#initializeProductionData. That function wipes an
 * EXISTING live database and is permanently locked after one use, because of
 * INC-2026-07-25-01. Conflating "stand up a new customer" with "wipe a live
 * customer" is what made onboarding a second tenant impossible: the lock that
 * protects the running company also blocked every new install.
 *
 * The two operations are separated here by one hard invariant:
 *
 *     THIS SCRIPT REFUSES TO RUN IF THE TARGET DATABASE ALREADY EXISTS.
 *
 * That single rule makes it structurally incapable of destroying data, which is
 * why it needs no lock of its own and can be run as often as you like.
 *
 * Schema and baseline reference data are produced by running the project's own
 * tested migrate/seed scripts in child processes with DB_PATH pointed at the new
 * file. Reusing them rather than reimplementing means a provisioned tenant is
 * schema-identical to production by construction.
 *
 * Usage:
 *   node scripts/provision-tenant.js \
 *     --db data/tenants/acme/wms.db \
 *     --name "Acme Contracting" \
 *     --profile contracting \
 *     --admin-email ops@acme.example \
 *     --admin-name "Operations Manager"
 *
 * Optional: --keep-demo   keep the sample materials/warehouses (for a sales demo
 *                         or a sandbox; never for a paying tenant's live data).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { getProfile, DEFAULT_PROFILE } = require('../server/services/tenantProfile');

const REPO_ROOT = path.join(__dirname, '..');

/** Demo rows seed.js/seed2.js/seed3.js create. Removed unless --keep-demo. */
const DEMO_TABLES = [
  'stock_movement_import_errors', 'stock_movement_history', 'stock_movement_import_batches',
  'notification_log', 'erp_integration_log',
  'shipments', 'stock_reallocations', 'inventory_count_lines', 'inventory_sessions',
  'picking_allocations', 'picking_tasks', 'request_attachments',
  'stock_transactions', 'material_request_lines', 'material_request_headers',
  'qr_codes', 'cycle_counts', 'batches', 'material_location_stock',
  'bin_locations', 'locations', 'materials', 'warehouses',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'keep-demo') { args.keepDemo = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option --${key} requires a value.`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

/**
 * Generate an admin password with real entropy.
 *
 * seed.js ships a well-known default (admin@example.com / Admin@123456) which
 * is fine for a throwaway dev database and unacceptable on a customer install:
 * a tenant whose operator never changes it is publicly compromised. Every
 * provisioned tenant therefore gets a unique random password, shown once.
 */
function generatePassword() {
  const raw = crypto.randomBytes(18).toString('base64').replace(/[+/=]/g, '');
  return `Wms#${raw.slice(0, 16)}`;
}

function validEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Run one of the repo's own node scripts against the new database file. */
function runAgainstNewDb(scriptRelPath, dbPath, label) {
  process.stdout.write(`  → ${label} … `);
  try {
    execFileSync(process.execPath, [path.join(REPO_ROOT, scriptRelPath)], {
      cwd: REPO_ROOT,
      // NODE_ENV is deliberately NOT 'production' here: this is a provisioning
      // context against a brand-new file, and the production guards in
      // config.js/firstRunSeed.js exist to protect a LIVE database. The target
      // is proven non-existent above, so there is no live data to protect.
      env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'provisioning', SKIP_AUTO_SEED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log('ok');
  } catch (error) {
    console.log('FAILED');
    const detail = (error.stderr && error.stderr.toString().trim()) || error.message;
    fail(`${label} failed:\n${detail}`);
  }
}

function main() {
  let args;
  try { args = parseArgs(process.argv); } catch (error) { fail(error.message); }

  // ---- Validate every input BEFORE touching the filesystem -----------------
  if (!args.db) fail('--db <path> is required (where the new tenant database will be created).');
  if (!args.name) fail('--name "<tenant name>" is required.');
  if (!validEmail(args['admin-email'])) fail('--admin-email <email> is required and must be a valid address.');

  const profileKey = (args.profile || DEFAULT_PROFILE).toLowerCase();
  let profile;
  try { profile = getProfile(profileKey); } catch (error) { fail(error.message); }

  const dbPath = path.resolve(args.db);
  const adminEmail = args['admin-email'].trim();
  const adminName = (args['admin-name'] || 'System Administrator').trim();

  // ---- THE SAFETY INVARIANT ------------------------------------------------
  // Everything this script is allowed to do rests on the target not existing.
  // Checked for the file and for SQLite's sidecar journals, because a -wal left
  // behind by a crashed process still represents real data.
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbPath + suffix)) {
      fail(
        `Refusing to provision: ${dbPath + suffix} already exists.\n` +
        '    This script only ever CREATES a new tenant. It will not overwrite,\n' +
        '    migrate or reset an existing database — that is a different, locked\n' +
        '    operation (see server/services/reset.js).\n' +
        '    Choose a new --db path, or remove the existing tenant deliberately.'
      );
    }
  }

  console.log(`\n  Provisioning tenant: ${args.name}`);
  console.log(`  Profile: ${profile.label} (${profile.key})`);
  console.log(`  Database: ${dbPath}\n`);

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // ---- Schema + baseline reference data via the project's own scripts ------
  runAgainstNewDb('server/db/migrate.js', dbPath, 'Applying schema migrations');
  runAgainstNewDb('server/db/seed.js', dbPath, 'Seeding roles, permissions and reference data');

  // ---- Turn the seeded dev database into a clean tenant --------------------
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const summary = { demo_rows_removed: 0, demo_users_removed: 0 };
  const provisionedPassword = generatePassword();

  const finalise = db.transaction(() => {
    if (!args.keepDemo) {
      // The append-only guard on audit_trail is a production protection. It has
      // to come off briefly to clear the seed's demo audit rows, and goes back
      // on inside the same transaction — the window never outlives this call.
      db.exec('DROP TRIGGER IF EXISTS audit_trail_block_update; DROP TRIGGER IF EXISTS audit_trail_block_delete;');
      for (const table of DEMO_TABLES) {
        const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table);
        if (exists) summary.demo_rows_removed += db.prepare(`DELETE FROM ${table}`).run().changes;
      }
      const hasAudit = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = 'audit_trail'").get();
      if (hasAudit) summary.demo_rows_removed += db.prepare('DELETE FROM audit_trail').run().changes;
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS audit_trail_block_update BEFORE UPDATE ON audit_trail
        BEGIN SELECT RAISE(ABORT, 'audit_trail is append-only: rows cannot be updated'); END;
        CREATE TRIGGER IF NOT EXISTS audit_trail_block_delete BEFORE DELETE ON audit_trail
        BEGIN SELECT RAISE(ABORT, 'audit_trail is append-only: rows cannot be deleted'); END;
      `);
    }

    // Every seeded demo account goes, including admin@example.com. Roles,
    // permissions and role_permissions stay — those are the baseline the
    // application cannot run without.
    summary.demo_users_removed = db.prepare('DELETE FROM users').run().changes;

    const hash = bcrypt.hashSync(provisionedPassword, 10);
    db.prepare(`
      INSERT INTO users (name, email, password_hash, role_id, status, must_change_password)
      VALUES (?, ?, ?, (SELECT id FROM roles WHERE name = 'admin'), 'active', 1)
    `).run(adminName, adminEmail, hash);

    // The tenant's identity and edition, readable by the app at runtime.
    db.exec(`
      CREATE TABLE IF NOT EXISTS tenant_profile (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        tenant_name     TEXT NOT NULL,
        industry_profile TEXT NOT NULL,
        provisioned_at  TEXT NOT NULL DEFAULT (datetime('now')),
        provisioned_by  TEXT
      );
    `);
    db.prepare(`
      INSERT OR REPLACE INTO tenant_profile (id, tenant_name, industry_profile, provisioned_by)
      VALUES (1, ?, ?, ?)
    `).run(args.name, profile.key, adminEmail);

    db.prepare(`
      INSERT INTO audit_trail (entity_type, action, new_value, changed_by_name, source_screen)
      VALUES ('Tenant', 'PROVISIONED', ?, ?, 'provision-tenant')
    `).run(
      JSON.stringify({ tenant_name: args.name, industry_profile: profile.key, admin_email: adminEmail, kept_demo: !!args.keepDemo }),
      adminEmail
    );
  });

  finalise();
  db.close();

  console.log('\n  ✓ Tenant provisioned.\n');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log(`  Admin email     : ${adminEmail}`);
  console.log(`  Admin password  : ${provisionedPassword}`);
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('  This password is shown ONCE and is not stored anywhere in');
  console.log('  plain text. The account must change it at first login.\n');
  console.log(`  Demo rows removed : ${args.keepDemo ? 'kept (--keep-demo)' : summary.demo_rows_removed}`);
  console.log(`  Demo accounts removed : ${summary.demo_users_removed}`);
  console.log(`  Modules enabled : ${profile.modules.length}`);
  console.log(`\n  Start the tenant with:\n    DB_PATH=${dbPath} npm start\n`);
}

main();
