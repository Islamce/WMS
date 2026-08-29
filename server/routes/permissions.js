/**
 * Permissions management: list permission keys, view/update role default
 * permissions. Per-user permission grants live in routes/users.js.
 */
const express = require('express');
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { isId } = require('../utils/validate');
const audit = require('../services/audit');

const router = express.Router();

router.use(authenticate, requirePermission('permissions_management'));

/** GET /api/permissions — all permission keys in the system. */
router.get('/', (req, res) => {
  res.json({ permissions: db.prepare('SELECT id, key, label FROM permissions ORDER BY id').all() });
});

/** GET /api/permissions/roles — roles with their default permissions. */
router.get('/roles', (req, res) => {
  const roles = db.prepare('SELECT id, name, description FROM roles ORDER BY id').all();
  const rolePerms = db.prepare('SELECT role_id, permission_id FROM role_permissions').all();
  const byRole = {};
  rolePerms.forEach((rp) => {
    (byRole[rp.role_id] = byRole[rp.role_id] || []).push(rp.permission_id);
  });
  res.json({ roles: roles.map((r) => ({ ...r, permission_ids: byRole[r.id] || [] })) });
});

/**
 * PUT /api/permissions/roles/:id
 * Replaces a role's default permission set: { permission_ids: [...] }.
 */
router.put('/roles/:id', (req, res) => {
  const { id } = req.params;
  const { permission_ids } = req.body || {};
  if (!isId(id)) return res.status(400).json({ error: 'Invalid role id.' });
  if (!Array.isArray(permission_ids) || permission_ids.some((p) => !isId(p))) {
    return res.status(400).json({ error: 'permission_ids must be an array of permission ids.' });
  }

  const role = db.prepare('SELECT id, name FROM roles WHERE id = ?').get(id);
  if (!role) return res.status(404).json({ error: 'Role not found.' });
  if (role.name === 'admin') {
    return res.status(400).json({ error: 'The admin role always has full access and cannot be edited.' });
  }

  const before = db.prepare(`
    SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?
  `).all(id).map((r) => r.key);

  const update = db.transaction(() => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE id = ?'
    );
    permission_ids.forEach((pid) => insert.run(id, pid));
  });
  update();

  const after = db.prepare(`
    SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?
  `).all(id).map((r) => r.key);
  audit.record({ entityType: 'Role', entityId: Number(id), action: 'ROLE_PERMISSIONS_CHANGED',
    oldValue: before, newValue: after, user: req.user, sourceScreen: 'permissions' });
  res.json({ message: `Permissions updated for role '${role.name}'.` });
});

module.exports = router;
