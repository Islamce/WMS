/**
 * Emergency admin recovery — creates or force-resets the admin account.
 *
 * Usage (non-production):
 *   npm run reset-admin                          # admin@example.com / Admin@123456
 *   npm run reset-admin -- you@co.com NewPass1   # custom email + password
 *
 * Usage (production) — all three arguments are mandatory:
 *   npm run reset-admin -- you@co.com 'NewPass1' 'RESET ADMIN PASSWORD'
 *
 * For when the admin password is lost or the users table was wiped. Ensures an
 * ACTIVE admin exists with the given credentials and forces a password change
 * on next login.
 *
 * Safety rules (issue #40, INC-2026-07-25-01):
 *
 * 1. In production the built-in default credentials are REFUSED. A bare
 *    `npm run reset-admin` used to install a publicly known email/password
 *    pair; run during a deploy or by reflex it hands over an admin account,
 *    and the symptom — "the admin password reverted to the default" — is
 *    exactly what issue #40 was raised to explain.
 * 2. In production an exact typed confirmation phrase is required, so this
 *    cannot succeed from muscle memory or an unattended script.
 * 3. This script NEVER seeds. It previously ran the full demo seed when the
 *    roles table was empty, so a command named "reset-admin" could write a
 *    demo dataset into an empty production database. It now refuses and tells
 *    the operator to diagnose instead.
 * 4. Every reset is written to the append-only audit trail. Passwords and
 *    hashes are never logged or audited.
 */
const bcrypt = require('bcryptjs');
const db = require('../server/db/connection');
const config = require('../server/config');

const DEFAULT_EMAIL = 'admin@example.com';
const DEFAULT_PASSWORD = 'Admin@123456';
const CONFIRM_PHRASE = 'RESET ADMIN PASSWORD';

const isProduction = process.env.NODE_ENV === 'production';
const emailArg = (process.argv[2] || '').trim();
const passwordArg = process.argv[3] || '';
const confirmArg = process.argv[4] || '';

function refuse(lines) {
  console.error(`\n[REFUSED] ${lines.join('\n          ')}\n`);
  process.exit(1);
}

// --- Production guards -----------------------------------------------------
if (isProduction) {
  if (!emailArg || !passwordArg) {
    refuse([
      'Production requires an explicit email and password.',
      '',
      `Usage: npm run reset-admin -- <email> <password> '${CONFIRM_PHRASE}'`,
    ]);
  }
  if (emailArg === DEFAULT_EMAIL || passwordArg === DEFAULT_PASSWORD) {
    refuse([
      'Refusing to use the built-in default credentials in production.',
      'They are published in this repository and must never reach a live system.',
      'Choose a real administrator email and a unique password.',
    ]);
  }
  if (confirmArg !== CONFIRM_PHRASE) {
    refuse([
      'Production requires an exact typed confirmation.',
      '',
      `Re-run with the final argument: '${CONFIRM_PHRASE}'`,
      '',
      'Before you do: confirm this is the intended database, take a verified',
      'backup, and rule out that the account looks missing only because the',
      'application is pointed at the wrong DB_PATH — see WMS-PRODUCTION-RUNBOOK.md.',
    ]);
  }
}

const email = emailArg || DEFAULT_EMAIL;
const password = passwordArg || DEFAULT_PASSWORD;

if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  console.error('Password must be at least 8 characters and contain a letter and a number.');
  process.exit(1);
}

// Make sure the schema exists (idempotent, additive).
require('../server/db/migrate');

// This script must never create business data. An empty roles table on a live
// system means the wrong database or data loss — both need diagnosis, not a
// demo seed written underneath the operator.
const adminRole = db.prepare("SELECT id FROM roles WHERE name='admin'").get();
if (!adminRole) {
  refuse([
    "No 'admin' role exists in this database — refusing to continue.",
    `Database: ${config.dbPath}`,
    '',
    'This script does not seed. An empty roles table usually means DB_PATH',
    'points at the wrong file, or this is not the database you think it is.',
    'Diagnose read-only first (WMS-PRODUCTION-RUNBOOK.md). If this genuinely is',
    'a fresh install, run `npm run seed` deliberately.',
  ]);
}

const hash = bcrypt.hashSync(password, 10);
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
let action;
let userId;
if (existing) {
  db.prepare(`
    UPDATE users SET password_hash=?, status='active', must_change_password=1,
      role_id=(SELECT id FROM roles WHERE name='admin'), updated_at=datetime('now')
    WHERE id=?
  `).run(hash, existing.id);
  userId = existing.id;
  action = 'ADMIN_PASSWORD_RESET_CLI';
  console.log(`Reset existing user ${email}: role=admin, status=active, new password set.`);
} else {
  const info = db.prepare(`
    INSERT INTO users (name, email, password_hash, role_id, status, must_change_password)
    VALUES ('System Admin', ?, ?, (SELECT id FROM roles WHERE name='admin'), 'active', 1)
  `).run(email, hash);
  userId = info.lastInsertRowid;
  action = 'ADMIN_ACCOUNT_CREATED_CLI';
  console.log(`Created admin user ${email} (active).`);
}

// Append-only audit record. Never store the password or its hash.
try {
  require('../server/services/audit').record({
    entityType: 'User',
    entityId: userId,
    action,
    newValue: { email, status: 'active', must_change_password: 1, source: 'scripts/reset-admin.js' },
    reason: 'Emergency administrator recovery via CLI',
    sourceScreen: 'cli:reset-admin',
  });
} catch (err) {
  console.warn('[WARN] Could not write audit record:', err.message);
}

console.log('You will be asked to change this password on first login.');
