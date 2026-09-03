/**
 * Admin user management: list users, approve/reject/disable, change role,
 * manage per-user permissions.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { isId, validatePasswordPolicy } = require('../utils/validate');
const audit = require('../services/audit');

const router = express.Router();

// Express 4 doesn't forward async-handler rejections to the error middleware;
// this wrapper does, so a thrown bcrypt/DB error returns 500 rather than hanging.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(authenticate, requirePermission('users_management'));

const USER_STATUSES = ['pending', 'active', 'rejected', 'disabled'];

/** GET /api/users — list all users (optionally filter by status). */
router.get('/', (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT u.id, u.name, u.email, u.status, u.role_id, r.name AS role,
           u.created_at, u.updated_at
    FROM users u JOIN roles r ON r.id = u.role_id
  `;
  const params = [];
  if (status && USER_STATUSES.includes(status)) {
    sql += ' WHERE u.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY u.created_at DESC';
  res.json({ users: db.prepare(sql).all(...params) });
});

/** GET /api/users/roles — list available roles (for role dropdown). */
router.get('/roles', (req, res) => {
  res.json({ roles: db.prepare('SELECT id, name, description FROM roles ORDER BY id').all() });
});

/** PATCH /api/users/:id/status — approve / reject / disable / re-activate. */
router.patch('/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!isId(id)) return res.status(400).json({ error: 'Invalid user id.' });
  if (!USER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${USER_STATUSES.join(', ')}.` });
  }
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own status.' });
  }

  const before = db.prepare('SELECT status FROM users WHERE id=?').get(id);
  const result = db.prepare(
    "UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found.' });

  audit.record({ entityType: 'User', entityId: Number(id), action: 'STATUS_CHANGED',
    oldValue: before?.status, newValue: status, user: req.user, sourceScreen: 'users' });
  res.json({ message: `User status updated to ${status}.` });
});

/** PATCH /api/users/:id/role — change a user's role. */
router.patch('/:id/role', (req, res) => {
  const { id } = req.params;
  const { role_id } = req.body || {};
  if (!isId(id) || !isId(role_id)) return res.status(400).json({ error: 'Invalid user or role id.' });
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own role.' });
  }

  const role = db.prepare('SELECT id, name FROM roles WHERE id = ?').get(role_id);
  if (!role) return res.status(404).json({ error: 'Role not found.' });

  const before = db.prepare(`
    SELECT u.role_id, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?
  `).get(id);
  const result = db.prepare(
    "UPDATE users SET role_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(role_id, id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found.' });

  audit.record({ entityType: 'User', entityId: Number(id), action: 'ROLE_CHANGED',
    oldValue: before?.role_name, newValue: role.name, user: req.user, sourceScreen: 'users' });
  res.json({ message: 'User role updated.' });
});

/**
 * PATCH /api/users/:id/password — admin resets a user's password.
 *
 * Sets must_change_password=1: an administrator knows the interim password, so
 * the account is not solely the user's until they change it (issue #40). The
 * self-service change in /api/auth/password is what clears the flag.
 * Audited without the password or its hash.
 */
router.patch('/:id/password', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body || {};
  if (!isId(id)) return res.status(400).json({ error: 'Invalid user id.' });
  const pol = validatePasswordPolicy(new_password);
  if (!pol.ok) return res.status(400).json({ error: pol.error });
  const hash = await bcrypt.hash(new_password, 10);
  const result = db.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?"
  ).run(hash, id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found.' });
  audit.record({
    entityType: 'User',
    entityId: Number(id),
    action: 'PASSWORD_RESET_BY_ADMIN',
    newValue: { must_change_password: 1 },
    user: req.user,
    sourceScreen: 'users',
  });
  res.json({ message: 'Password reset.' });
}));

/**
 * GET /api/users/:id/permissions
 * Returns every permission with flags showing whether the user has it
 * directly and/or through their role.
 */
router.get('/:id/permissions', (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return res.status(400).json({ error: 'Invalid user id.' });

  const user = db.prepare('SELECT id, role_id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const permissions = db.prepare(`
    SELECT p.id, p.key, p.label,
      EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = ? AND up.permission_id = p.id) AS direct,
      EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = ? AND rp.permission_id = p.id) AS from_role
    FROM permissions p ORDER BY p.id
  `).all(user.id, user.role_id);

  res.json({ permissions });
});

/**
 * PUT /api/users/:id/permissions
 * Replaces the user's direct permission set with the provided list of
 * permission ids: { permission_ids: [1, 2, ...] }.
 */
router.put('/:id/permissions', (req, res) => {
  const { id } = req.params;
  const { permission_ids } = req.body || {};
  if (!isId(id)) return res.status(400).json({ error: 'Invalid user id.' });
  if (!Array.isArray(permission_ids) || permission_ids.some((p) => !isId(p))) {
    return res.status(400).json({ error: 'permission_ids must be an array of permission ids.' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const before = db.prepare(`
    SELECT p.key FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = ?
  `).all(id).map((r) => r.key);

  const update = db.transaction(() => {
    db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(id);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO user_permissions (user_id, permission_id) SELECT ?, id FROM permissions WHERE id = ?'
    );
    permission_ids.forEach((pid) => insert.run(id, pid));
  });
  update();

  const after = db.prepare(`
    SELECT p.key FROM user_permissions up JOIN permissions p ON p.id = up.permission_id WHERE up.user_id = ?
  `).all(id).map((r) => r.key);
  audit.record({ entityType: 'User', entityId: Number(id), action: 'PERMISSIONS_CHANGED',
    oldValue: before, newValue: after, user: req.user, sourceScreen: 'users' });
  res.json({ message: 'User permissions updated.' });
});

module.exports = router;
