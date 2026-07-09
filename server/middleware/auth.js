const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const config = require('../config');

/**
 * Effective permissions for a user = role permissions UNION per-user permissions.
 * Returns an array of permission keys.
 */
function getUserPermissions(userId) {
  const rows = db.prepare(`
    SELECT DISTINCT p.key
    FROM permissions p
    WHERE p.id IN (
      SELECT rp.permission_id FROM role_permissions rp
      JOIN users u ON u.role_id = rp.role_id WHERE u.id = ?
    )
    OR p.id IN (
      SELECT up.permission_id FROM user_permissions up WHERE up.user_id = ?
    )
  `).all(userId, userId);
  return rows.map((r) => r.key);
}

/**
 * Authentication middleware: verifies the JWT and loads a fresh copy of the
 * user from the database, so status/role changes take effect immediately.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session. Please login again.' });
  }

  const user = db.prepare(`
    SELECT u.id, u.name, u.email, u.status, u.role_id, r.name AS role
    FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(payload.sub);

  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: 'Account is not active.' });
  }

  req.user = user;
  req.user.permissions = getUserPermissions(user.id);
  next();
}

/**
 * Permission middleware factory. Accepts one key or an array of keys;
 * the user must hold at least one of them. Admins always pass.
 */
function requirePermission(keys) {
  const required = Array.isArray(keys) ? keys : [keys];
  return (req, res, next) => {
    if (req.user.role === 'admin') return next();
    if (required.some((k) => req.user.permissions.includes(k))) return next();
    return res.status(403).json({ error: 'You do not have permission to access this resource.' });
  };
}

/** Admin-only middleware. */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { authenticate, requirePermission, requireAdmin, getUserPermissions };
