#!/usr/bin/env node
'use strict';

/**
 * Set, change or clear the industry edition of an EXISTING install.
 *
 * scripts/provision-tenant.js writes the edition for a brand-new tenant and
 * refuses to touch a database that already exists — correctly, since it also
 * creates an administrator and strips the demo dataset. That left no way to put
 * a running customer onto an edition, so the Contracting edition could be sold
 * to new tenants only, never to the company already using the system.
 *
 * Changing an edition is not like provisioning. Nothing is created and nothing
 * is destroyed; a single row decides which modules exist for this tenant. The
 * danger is the opposite of data loss and easy to miss: setting an edition
 * SWITCHES SCREENS OFF, silently, for people who were using them yesterday.
 * Nobody notices until a storekeeper cannot post a goods issue.
 *
 * So this runs as a DRY RUN unless --apply is given, and the dry run answers the
 * only question that matters before switching: which modules disappear, and how
 * many people who hold that permission today lose the screen.
 *
 *   node scripts/set-tenant-profile.js --db /app/data/wms.db --profile contracting
 *   node scripts/set-tenant-profile.js --db /app/data/wms.db --profile contracting --apply
 *   node scripts/set-tenant-profile.js --db /app/data/wms.db --profile none --apply
 *
 * `--profile none` removes the row and returns the install to unrestricted,
 * which is the rollback: no tenant_profile row means no edition restriction.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { PROFILES, profileKeys, getProfile } = require('../server/services/tenantProfile');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (key === 'apply') { args.apply = true; continue; }
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

/**
 * Every permission key the product knows about, minus the ones this profile
 * enables. Read from the database rather than from a hard-coded list, so a
 * permission added by a later migration is never silently treated as enabled.
 */
function modulesLost(db, profileKey) {
  const all = db.prepare('SELECT key, label FROM permissions ORDER BY key').all();
  if (profileKey === null) return [];
  const enabled = new Set(getProfile(profileKey).modules);
  return all.filter((p) => !enabled.has(p.key));
}

/** How many ACTIVE users actually hold each permission — the blast radius. */
function holdersOf(db, permissionKey) {
  return db.prepare(`
    SELECT COUNT(DISTINCT u.id) AS n
    FROM users u
    JOIN roles r ON r.id = u.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE p.key = ? AND u.status = 'active' AND r.name != 'admin'
  `).get(permissionKey).n;
}

function main() {
  let args;
  try { args = parseArgs(process.argv); } catch (e) { fail(e.message); }

  const dbPath = path.resolve(args.db || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'wms.db'));
  if (!fs.existsSync(dbPath)) fail(`No database at ${dbPath}.`);

  const raw = String(args.profile || '').trim().toLowerCase();
  if (!raw) fail(`--profile is required. Valid: ${profileKeys().join(', ')}, none`);
  const target = raw === 'none' ? null : raw;
  if (target !== null && !PROFILES[target]) {
    fail(`Unknown profile '${raw}'. Valid: ${profileKeys().join(', ')}, none`);
  }

  const db = new Database(dbPath);
  const current = db.prepare('SELECT * FROM tenant_profile WHERE id = 1').get() || null;

  console.log('');
  console.log(`  Database : ${dbPath}`);
  console.log(`  Current  : ${current ? `${current.industry_profile} (${current.tenant_name})` : 'none — unrestricted, every module visible'}`);
  console.log(`  Target   : ${target === null ? 'none — unrestricted, every module visible' : `${target} (${getProfile(target).label})`}`);

  if ((current ? current.industry_profile : null) === target) {
    console.log('\n  Nothing to change — the install is already on this edition.\n');
    db.close();
    return;
  }

  const tenantName = args['tenant-name'] || (current && current.tenant_name);
  if (target !== null && !tenantName) {
    db.close();
    fail('--tenant-name is required the first time an edition is set (there is no existing name to keep).');
  }

  // What actually changes for people. Modules that were visible under the
  // current edition (or under no edition at all, which means all of them) and
  // are not in the target edition.
  const lostNow = modulesLost(db, target).filter((p) => {
    if (current === null) return true;             // unrestricted today: everything was visible
    return getProfile(current.industry_profile).modules.includes(p.key);
  });
  const gained = target === null
    ? modulesLost(db, current.industry_profile)     // clearing restores everything
    : modulesLost(db, current ? current.industry_profile : null)
      .filter((p) => getProfile(target).modules.includes(p.key));

  if (lostNow.length) {
    console.log(`\n  ${lostNow.length} module(s) will be HIDDEN by this change:\n`);
    let affected = 0;
    lostNow.forEach((p) => {
      const n = holdersOf(db, p.key);
      affected += n;
      console.log(`    - ${p.key.padEnd(34)} ${String(n).padStart(3)} active non-admin user(s) hold this today`);
    });
    console.log(`\n    ${affected} user-permission assignment(s) stop resolving to a visible screen.`);
    console.log('    Permissions are NOT revoked — the module simply no longer exists for this tenant,');
    console.log('    so clearing the edition restores every one of them.');
  } else {
    console.log('\n  No module will be hidden by this change.');
  }

  if (gained.length) {
    console.log(`\n  ${gained.length} module(s) become visible: ${gained.map((p) => p.key).join(', ')}`);
  }

  if (!args.apply) {
    console.log('\n  DRY RUN — nothing was written. Re-run with --apply to make the change.\n');
    db.close();
    return;
  }

  const by = args.by || process.env.USER || 'set-tenant-profile';
  const write = db.transaction(() => {
    if (target === null) {
      db.prepare('DELETE FROM tenant_profile WHERE id = 1').run();
    } else {
      db.prepare(`
        INSERT INTO tenant_profile (id, tenant_name, industry_profile, provisioned_by)
        VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          tenant_name = excluded.tenant_name,
          industry_profile = excluded.industry_profile,
          provisioned_at = datetime('now'),
          provisioned_by = excluded.provisioned_by
      `).run(tenantName, target, by);
    }
    db.prepare(`
      INSERT INTO audit_trail (entity_type, action, old_value, new_value, changed_by_name, source_screen)
      VALUES ('Tenant', 'EDITION_CHANGED', ?, ?, ?, 'set-tenant-profile')
    `).run(
      JSON.stringify(current ? { industry_profile: current.industry_profile, tenant_name: current.tenant_name } : null),
      JSON.stringify(target === null ? null : { industry_profile: target, tenant_name: tenantName, modules_hidden: lostNow.map((p) => p.key) }),
      by
    );
  });
  write();
  db.close();

  console.log('\n  ✓ Edition updated.\n');
  console.log('    The running container caches the edition at startup, so restart it for the');
  console.log('    change to take effect:  docker compose restart wms\n');
}

main();
