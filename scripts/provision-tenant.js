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
 * Production runs on a VPS under Docker Compose behind a central Caddy proxy, so
 * a tenant is a container with its own bind-mounted database, not just a file.
 * By default this writes the whole tenant directory — database, backups dir,
 * compose file and a UNIQUE JWT secret — ready for `docker compose up`.
 *
 * Usage:
 *   node scripts/provision-tenant.js \
 *     --name "Acme Contracting" \
 *     --profile contracting \
 *     --admin-email ops@acme.example \
 *     --admin-name "Operations Manager" \
 *     --domain acme.wms.kynox.io
 *
 * Options:
 *   --slug <name>          container/directory/subdomain id (default: from --name)
 *   --tenants-root <dir>   where tenant directories live (default: ./tenants)
 *   --domain <host>        prints the Caddy reverse_proxy block to add
 *   --db <path>            provision ONLY a database at this path, no deployment
 *                          artifacts (used by tests and throwaway sandboxes)
 *   --keep-demo            keep the sample materials/warehouses (sales demo or
 *                          sandbox only; never for a paying tenant's live data)
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

/**
 * A DNS- and Docker-safe identifier for the tenant, used for the container
 * name, its directory and its subdomain. Derived from the tenant name unless
 * given explicitly, then validated — a slug that is merely "cleaned up" silently
 * could collide with another tenant's container, which on this deployment model
 * means two customers sharing one process.
 */
function toSlug(value) {
  return String(value).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Per-tenant JWT signing secret.
 *
 * THIS MUST BE UNIQUE PER TENANT. Every tenant runs the same image against its
 * own database, and authenticate() resolves a token's `sub` against whatever
 * database its own process is pointed at. A shared secret would therefore make
 * a token minted for user 5 at tenant A verify at tenant B and log the bearer in
 * as tenant B's user 5 — cross-tenant account takeover, with no bug anywhere in
 * the application code. Isolation on this model depends on this value differing.
 */
function generateJwtSecret() {
  return crypto.randomBytes(48).toString('hex');
}

/**
 * Compose file for one tenant.
 *
 * Deliberately publishes NO host port: Caddy reaches the container by name over
 * the shared `web` network, so tenants cannot collide on a port and none of them
 * is reachable from outside the proxy. Diagnostics go through
 * `docker compose exec`.
 *
 * `image` is pinned so the first tenant builds it and every later tenant reuses
 * the same tag — one image, many tenants, which is what keeps the editions
 * honest: they differ by database row, never by build.
 */
function composeFile({ slug, tenantName, profileKey }) {
  return `# Tenant: ${tenantName} (${profileKey} edition)
# Generated by scripts/provision-tenant.js — safe to edit, but keep DB_PATH and
# the safety flags below as they are.
#
#   docker compose -f docker-compose.yml up -d --build
#   docker compose -f docker-compose.yml exec wms node scripts/backup.js
services:
  wms:
    build: ../../..
    image: wms-app:latest
    container_name: wms-${slug}
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      JWT_EXPIRES_IN: 8h
      DB_PATH: /app/data/wms.db
      # Same production guards as the main deployment. A tenant database is
      # real customer data from its first login; nothing here may seed it.
      SKIP_AUTO_SEED: "1"
      ALLOW_AUTO_SEED: "0"
      PRODUCTION_INITIALIZATION_ENABLED: "false"
    volumes:
      - ./data:/app/data
      - ./backups:/app/backups
    networks:
      - web
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://127.0.0.1:3000/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3

networks:
  web:
    external: true
`;
}

/**
 * The block to paste into the central proxy's Caddyfile at /opt/proxy/Caddyfile.
 *
 * Printed rather than written: that file lives outside this repository and
 * serves every site on the host, so a provisioning script must never edit it
 * unattended. Note the migration record's warning — write it without leading
 * tabs, which the VPS web console mangles into stray dots.
 */
function caddyBlock({ slug, domain }) {
  return `${domain} {
    reverse_proxy wms-${slug}:3000
}`;
}

function main() {
  let args;
  try { args = parseArgs(process.argv); } catch (error) { fail(error.message); }

  // ---- Validate every input BEFORE touching the filesystem -----------------
  if (!args.name) fail('--name "<tenant name>" is required.');
  if (!validEmail(args['admin-email'])) fail('--admin-email <email> is required and must be a valid address.');

  const profileKey = (args.profile || DEFAULT_PROFILE).toLowerCase();
  let profile;
  try { profile = getProfile(profileKey); } catch (error) { fail(error.message); }

  const slug = toSlug(args.slug || args.name);
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) {
    fail(`Could not derive a usable slug from "${args.slug || args.name}". ` +
         'Pass --slug <name> with 2-40 characters of a-z, 0-9 and hyphens.');
  }

  // A tenant lives in one directory: its database, its backups, its compose file
  // and its secret. --db still works for a bare database with no deployment
  // artifacts (tests and sandboxes use it).
  const tenantsRoot = path.resolve(args['tenants-root'] || path.join(REPO_ROOT, 'tenants'));
  const tenantDir = args.db ? null : path.join(tenantsRoot, slug);
  const dbPath = args.db ? path.resolve(args.db) : path.join(tenantDir, 'data', 'wms.db');
  const domain = args.domain || null;

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

    // The table itself comes from migration 021, which already ran above — the
    // schema has exactly one owner. Writing the row is what turns this database
    // from an unrestricted install into a tenant on a specific edition.
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

  // ---- Deployment artifacts (skipped when --db targeted a bare file) -------
  if (tenantDir) {
    fs.mkdirSync(path.join(tenantDir, 'backups'), { recursive: true });

    // Its own signing secret. See generateJwtSecret() — a shared secret would
    // let a token from one tenant authenticate at another.
    fs.writeFileSync(
      path.join(tenantDir, '.env'),
      `# Tenant secret for ${args.name}. Unique per tenant — never copy between\n` +
      `# tenants, and never commit. Rotating it signs every active session out.\n` +
      `JWT_SECRET=${generateJwtSecret()}\n`,
      { mode: 0o600 }
    );
    fs.writeFileSync(
      path.join(tenantDir, 'docker-compose.yml'),
      composeFile({ slug, tenantName: args.name, profileKey: profile.key })
    );
  }

  console.log('\n  ✓ Tenant provisioned.\n');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log(`  Admin email     : ${adminEmail}`);
  console.log(`  Admin password  : ${provisionedPassword}`);
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('  This password is shown ONCE and is not stored anywhere in');
  console.log('  plain text. The account must change it at first login.\n');
  console.log(`  Slug            : ${slug}`);
  console.log(`  Demo rows removed : ${args.keepDemo ? 'kept (--keep-demo)' : summary.demo_rows_removed}`);
  console.log(`  Demo accounts removed : ${summary.demo_users_removed}`);
  console.log(`  Modules enabled : ${profile.modules.length}`);

  if (!tenantDir) {
    console.log(`\n  Database only (--db given). Start it with:\n    DB_PATH=${dbPath} npm start\n`);
    return;
  }

  console.log(`\n  Tenant directory : ${tenantDir}`);
  console.log('    data/            the SQLite database (host-visible for backup/restore)');
  console.log('    backups/         where scripts/backup.js writes verified sets');
  console.log('    .env             this tenant\'s unique JWT secret (chmod 600)');
  console.log('    docker-compose.yml');
  console.log('\n  Start it:');
  console.log(`    cd ${tenantDir} && docker compose up -d --build`);

  if (domain) {
    console.log(`\n  Then add this to /opt/proxy/Caddyfile and reload the proxy`);
    console.log('  (write it with NO leading tabs — the VPS web console mangles them):\n');
    caddyBlock({ slug, domain }).split('\n').forEach((line) => console.log(`    ${line}`));
    console.log('\n    cd /opt/proxy && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile');
  } else {
    console.log('\n  No --domain given, so no Caddy block was generated. Re-run with');
    console.log('  --domain <host> to get one, or add the reverse_proxy entry by hand.');
  }
  console.log('');
}

main();
