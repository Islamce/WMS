/**
 * Emergency admin recovery — creates or force-resets the admin account.
 *
 * Usage:
 *   npm run reset-admin                          # admin@example.com / Admin@123456
 *   npm run reset-admin -- you@co.com NewPass1   # custom email + password
 *
 * For when the admin password is lost or the users table was wiped (e.g. the
 * hosting platform recreated the app without a persistent DB volume). Ensures
 * roles/permissions exist, then upserts an ACTIVE admin with the given
 * credentials and forces a password change on next login.
 */
const bcrypt = require('bcryptjs');
const db = require('../server/db/connection');

const email = (process.argv[2] || 'admin@example.com').trim();
const password = process.argv[3] || 'Admin@123456';

if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  console.error('Password must be at least 8 characters and contain a letter and a number.');
  process.exit(1);
}

// Make sure the schema + roles/permissions exist (idempotent).
require('../server/db/migrate');
const adminRole = db.prepare("SELECT id FROM roles WHERE name='admin'").get();
if (!adminRole) {
  console.log('Roles missing — running full seed first…');
  require('../server/db/seed').seed();
}

const hash = bcrypt.hashSync(password, 10);
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  db.prepare(`
    UPDATE users SET password_hash=?, status='active', must_change_password=1,
      role_id=(SELECT id FROM roles WHERE name='admin'), updated_at=datetime('now')
    WHERE id=?
  `).run(hash, existing.id);
  console.log(`Reset existing user ${email}: role=admin, status=active, new password set.`);
} else {
  db.prepare(`
    INSERT INTO users (name, email, password_hash, role_id, status, must_change_password)
    VALUES ('System Admin', ?, ?, (SELECT id FROM roles WHERE name='admin'), 'active', 1)
  `).run(email, hash);
  console.log(`Created admin user ${email} (active).`);
}
console.log('You will be asked to change this password on first login.');
