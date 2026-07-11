const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const config = require('../config');
const { authenticate, getUserPermissions } = require('../middleware/auth');
const { loginRateLimit, recordLoginFailure, clearLoginFailures } = require('../middleware/rateLimit');
const { isNonEmptyString, isEmail } = require('../utils/validate');

const router = express.Router();

/**
 * POST /api/auth/signup
 * Creates a new account with status 'pending'. The user cannot login
 * until an admin approves the account.
 */
router.post('/signup', (req, res) => {
  const { name, email, password } = req.body || {};

  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'Name is required.' });
  if (!isEmail(email)) return res.status(400).json({ error: 'A valid email is required.' });
  if (!isNonEmptyString(password) || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
  if (exists) return res.status(409).json({ error: 'An account with this email already exists.' });

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (name, email, password_hash, role_id, status)
    VALUES (?, ?, ?, (SELECT id FROM roles WHERE name = 'user'), 'pending')
  `).run(name.trim(), email.trim(), hash);

  res.status(201).json({
    message: 'Account created. An administrator must approve your account before you can login.',
  });
});

/**
 * POST /api/auth/login
 * Only users with status 'active' may login.
 */
router.post('/login', loginRateLimit, (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email) || !isNonEmptyString(password)) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare(`
    SELECT u.*, r.name AS role FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.email = ?
  `).get(email.trim());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
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
      permissions: getUserPermissions(user.id),
    },
  });
});

/**
 * GET /api/auth/me
 * Returns the current user with fresh permissions (used on app load).
 */
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
