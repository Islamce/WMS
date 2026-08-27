const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const config = require('../config');
const { authenticate, getUserPermissions } = require('../middleware/auth');
const { loginRateLimit, recordLoginFailure, clearLoginFailures } = require('../middleware/rateLimit');
const { isNonEmptyString, isEmail, validatePasswordPolicy } = require('../utils/validate');
const audit = require('../services/audit');

const router = express.Router();

// A fixed bcrypt hash compared against when the email is unknown, so a failed
// login costs the same time whether or not the account exists (no user
// enumeration via timing). Computed once at boot.
const DUMMY_HASH = bcrypt.hashSync('$dummy-password-for-timing-safety$', 10);

// Express 4 does not forward rejections from async handlers to the error
// middleware; this wrapper does, so a thrown DB/bcrypt error returns a 500
// instead of hanging the request.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * POST /api/auth/signup
 * Creates a new account with status 'pending'. The user cannot login
 * until an admin approves the account.
 */
router.post('/signup', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'Name is required.' });
  if (!isEmail(email)) return res.status(400).json({ error: 'A valid email is required.' });
  const pol = validatePasswordPolicy(password);
  if (!pol.ok) return res.status(400).json({ error: pol.error });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
  if (exists) return res.status(409).json({ error: 'An account with this email already exists.' });

  // Async hashing keeps the event loop free under concurrent signups.
  const hash = await bcrypt.hash(password, 10);
  db.prepare(`
    INSERT INTO users (name, email, password_hash, role_id, status)
    VALUES (?, ?, ?, (SELECT id FROM roles WHERE name = 'user'), 'pending')
  `).run(name.trim(), email.trim(), hash);

  res.status(201).json({
    message: 'Account created. An administrator must approve your account before you can login.',
  });
}));

/**
 * POST /api/auth/login
 * Only users with status 'active' may login.
 */
router.post('/login', loginRateLimit, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || !isNonEmptyString(password)) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare(`
    SELECT u.*, r.name AS role FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.email = ?
  `).get(email.trim());

  // Compare against the stored hash, or a throwaway hash when the account is
  // unknown, so response timing doesn't reveal whether the email exists.
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    recordLoginFailure(req); // consume one attempt from the brute-force budget
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  clearLoginFailures(req);

  if (user.status === 'pending') {
    return res.status(403).json({ error: 'Your account is waiting for admin approval.' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Your account is not active. Contact the administrator.' });
  }

  const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      must_change_password: !!user.must_change_password,
      permissions: getUserPermissions(user.id),
    },
  });
}));

/**
 * GET /api/auth/me
 * Returns the current user with fresh permissions (used on app load).
 */
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

/**
 * PATCH /api/auth/me
 * Update the signed-in user's own display name. Deliberately does not allow
 * self-service email changes: email is the login identifier, and letting a
 * user repoint it without any verification step is a materially different,
 * security-relevant decision — same category as self-service password
 * reset — not a routine profile edit.
 */
router.patch('/me', authenticate, (req, res) => {
  const { name } = req.body || {};
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'Name is required.' });
  const trimmed = name.trim();
  if (trimmed.length > 200) return res.status(400).json({ error: 'Name is too long.' });

  const oldName = req.user.name;
  db.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?").run(trimmed, req.user.id);
  audit.record({
    entityType: 'User',
    entityId: req.user.id,
    action: 'PROFILE_UPDATED_BY_SELF',
    oldValue: { name: oldName },
    newValue: { name: trimmed },
    user: req.user,
    sourceScreen: 'account',
  });
  res.json({ message: 'Profile updated.', user: { ...req.user, name: trimmed } });
});

/**
 * PATCH /api/auth/password
 * Change the signed-in user's own password (current password required).
 */
router.patch('/password', authenticate, asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!isNonEmptyString(current_password) || !isNonEmptyString(new_password)) {
    return res.status(400).json({ error: 'Current and new passwords are required.' });
  }
  const pol = validatePasswordPolicy(new_password);
  if (!pol.ok) return res.status(400).json({ error: pol.error });
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !(await bcrypt.compare(current_password, row.password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  const hash = await bcrypt.hash(new_password, 10);
  // Clearing must_change_password is what makes the account solely the user's:
  // only they know this password. Audited without the password or its hash.
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?")
    .run(hash, req.user.id);
  audit.record({
    entityType: 'User',
    entityId: req.user.id,
    action: 'PASSWORD_CHANGED_BY_SELF',
    newValue: { must_change_password: 0 },
    user: req.user,
    sourceScreen: 'account',
  });
  res.json({ message: 'Password changed.' });
}));

module.exports = router;
