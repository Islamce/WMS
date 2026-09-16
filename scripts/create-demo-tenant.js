#!/usr/bin/env node
/**
 * Create a complete, throwaway DEMO tenant for presentations.
 *
 * One command produces a system you can show: schema, reference data, a site
 * store with bins and materials, a subcontractor, and a single account that can
 * open every screen and drive a request from raised to issued on its own.
 *
 * WHY THE DEMO ACCOUNT IS AN ADMIN, and why that is the point rather than
 * laziness: the product enforces segregation of duties — the person who
 * approves a request cannot post its goods issue, because on a two-person
 * contractor that is the one control against a storekeeper issuing material to
 * himself. A presenter working alone would hit that wall halfway through the
 * demo. Admins are exempt (server/services/sod.js), so one account can walk the
 * whole flow. If you want to SHOW the control working — and for a contractor
 * worried about theft it sells the product — use --with-second-user and run the
 * issue step as the second account.
 *
 * THE SAFETY GUARD, and why it is shaped this way: this script only ever
 * CREATES. It refuses if the target database already exists, so there is no
 * path by which it can add a privileged account to production or to a paying
 * customer's tenant. There is no --force. An all-authorities account with a
 * password printed to a terminal is exactly what must never appear on a live
 * system, and "refuses to touch anything that exists" is a guard that cannot be
 * got wrong in a hurry.
 *
 *   node scripts/create-demo-tenant.js --slug demo-acme --name "Acme Contracting (DEMO)"
 *   node scripts/create-demo-tenant.js --slug demo-acme --db /tmp/demo.db --password 'Demo!2026kynox'
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const REPO_ROOT = path.resolve(__dirname, '..');

// Paths that are production or look like it. Belt and braces: the
// already-exists guard below stops these anyway, because production's database
// exists. This refuses even to name them, so a typo cannot become an incident.
const FORBIDDEN = [/^\/opt\/apps\/wms\b/, /\/domains\/[^/]*\/nodejs\b/];

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => { i += 1; return argv[i]; };
    if (a === '--slug') out.slug = next();
    else if (a === '--name') out.name = next();
    else if (a === '--db') out.db = next();
    else if (a === '--email') out.email = next();
    else if (a === '--password') out.password = next();
    else if (a === '--profile') out.profile = next();
    else if (a === '--with-second-user') out.secondUser = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  return out;
}

const usage = `Usage:
  node scripts/create-demo-tenant.js --slug <slug> [options]

Options:
  --name <text>          tenant name shown in the app (default: derived from slug)
  --db <path>            database path (default: tenants/<slug>/data/wms.db)
  --email <address>      demo account (default: demo@<slug>.demo)
  --password <text>      demo password (default: generated and printed once)
  --profile <key>        contracting | manufacturing (default: contracting)
  --with-second-user     also create a storekeeper account, so the segregation
                         of duties control can be demonstrated rather than
                         bypassed

Refuses if the database already exists. This script only ever creates.`;

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.slug) { console.log(usage); process.exit(args.help ? 0 : 2); }

  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(args.slug)) {
    console.error('REFUSED: --slug must be 2-40 characters of a-z, 0-9 and hyphens.');
    process.exit(1);
  }

  const dbPath = path.resolve(args.db || path.join(REPO_ROOT, 'tenants', args.slug, 'data', 'wms.db'));
  if (FORBIDDEN.some((re) => re.test(dbPath))) {
    console.error(`REFUSED: ${dbPath} is a production path. Demo tenants never go there.`);
    process.exit(1);
  }
  if (fs.existsSync(dbPath)) {
    console.error(`REFUSED: ${dbPath} already exists.`);
    console.error('\nThis script only ever creates a new tenant. It will not add an');
    console.error('all-authorities account to a database that already holds something —');
    console.error('that database might be a live warehouse. Delete it first if it');
    console.error('really is a throwaway, or pick another --slug.');
    process.exit(1);
  }

  const name = args.name || `${args.slug.replace(/-/g, ' ')} (DEMO)`;
  const email = args.email || `demo@${args.slug}.demo`;
  const profile = args.profile || 'contracting';
  const password = args.password
    || `Demo-${crypto.randomBytes(6).toString('base64url')}!${new Date().getFullYear()}`;

  console.log(`Creating DEMO tenant "${name}"`);
  console.log(`  database : ${dbPath}`);
  console.log(`  edition  : ${profile}\n`);

  // Reuse the tested provisioning path rather than reimplementing it: same
  // schema, same reference data, same clean-tenant shaping as a real customer.
  const run = (script, extra) => execFileSync('node', [script, ...extra], {
    cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' },
  });

  // The provisioned administrator IS the demo account. Provisioning generates a
  // password this script would otherwise discard, leaving a live admin account
  // on the demo whose credential nobody holds; the password is reset below to
  // the one actually printed.
  run('scripts/provision-tenant.js', ['--name', name, '--slug', args.slug, '--profile', profile,
    '--admin-email', email, '--db', dbPath]);
  console.log('  provisioned');

  run('scripts/install-starter-data.js', ['--db', dbPath]);
  console.log('  starter data installed');

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const created = [];

  db.transaction(() => {
    // The demo account is an admin on purpose — see the header. It can open
    // every screen AND is exempt from segregation of duties, so one person can
    // demonstrate the whole flow without a second laptop.
    const hash = bcrypt.hashSync(password, 10);
    // must_change_password is cleared: a forced password change in the first
    // thirty seconds of a customer presentation is not a security win.
    db.prepare(`
      UPDATE users SET name = ?, password_hash = ?, must_change_password = 0 WHERE email = ?
    `).run('Demo Presenter', hash, email);
    created.push({ email, role: 'admin', note: 'every screen; exempt from segregation of duties' });

    if (args.secondUser) {
      // Not an admin, so the SoD control is live for this account. A site
      // storekeeper (receives, releases, picks, posts) PLUS an approvals grant
      // the real role deliberately lacks. The grant is what makes the refusal
      // reachable in a demo: this one account can approve a request and then
      // be refused when it tries to issue the same request, which is the
      // sentence the product is bought for. Without it the storekeeper never
      // reaches the control - the approvals screen is simply absent from his
      // menu, and an absent menu item shows a buyer nothing.
      const storeEmail = `store@${args.slug}.demo`;
      db.prepare(`
        INSERT INTO users (name, email, password_hash, role_id, status, must_change_password)
        VALUES (?, ?, ?, (SELECT id FROM roles WHERE name = 'site_storekeeper'), 'active', 0)
      `).run('Demo Storekeeper', storeEmail, hash);
      db.prepare(`
        INSERT INTO user_permissions (user_id, permission_id)
        SELECT u.id, p.id FROM users u, permissions p
        WHERE u.email = ? AND p.key IN ('approvals', 'material_requests')
      `).run(storeEmail);
      created.push({ email: storeEmail, role: 'site_storekeeper + approvals (demo grant)',
        note: 'subject to segregation of duties — approves, then is refused the issue' });
    }

    db.prepare(`
      INSERT INTO audit_trail (entity_type, action, new_value, changed_by_name, source_screen)
      VALUES ('Tenant', 'DEMO_TENANT_CREATED', ?, 'create-demo-tenant', 'create-demo-tenant')
    `).run(JSON.stringify({ tenant: name, profile, accounts: created.map((c) => c.email) }));
  })();
  db.close();

  console.log('\n  demo account(s) created\n');
  console.log('='.repeat(66));
  created.forEach((c) => {
    console.log(`  ${c.email}`);
    console.log(`  role: ${c.role} — ${c.note}`);
  });
  console.log(`\n  password (all accounts): ${password}`);
  console.log('='.repeat(66));
  console.log('\nThis password is printed once and not stored anywhere else.');
  console.log('It is a DEMO credential: never reuse it on a real tenant.\n');
  console.log('Start it with:');
  console.log(`  DB_PATH=${dbPath} npm start\n`);
  console.log('A ten-minute demo, in order:');
  console.log('  1. Goods Receipt      — receive 100 bags of CEM-OPC-50 into SITE-01');
  console.log('  2. Quality Inspection — release the batch (it arrives on hold)');
  console.log('  3. Goods Receipt      — put it away in RACK-01 (Covered store)');
  console.log('  4. Create Material Request — ask for 10 back out, then approve it');
  console.log('  5. My Picking Tasks   — claim it, pick it, post the issue');
  if (args.secondUser) {
    console.log('\n  To show segregation of duties - the control a contractor is buying:');
    console.log('  6. Sign in as the storekeeper. Approve the request (step 4) as HIM.');
    console.log('  7. Still as him, claim and pick it, then open Goods Issue Posting and');
    console.log('     post. The product refuses, on screen, in these words:');
    console.log('       "Segregation of duties: you performed the approval step for this');
    console.log('        request; a different user must perform this step."');
    console.log('     That refusal is what stops a storekeeper issuing material to himself.');
    console.log('  8. Sign in as the presenter and post the issue. Two people, two steps.');
    console.log('  The presenter is an admin and admins are exempt, so approve as the');
    console.log('  storekeeper, not as the presenter, or there is nothing to refuse.');
  }
}

main();
