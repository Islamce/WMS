/**
 * Notifications center — the current user's in-app inbox, unread count, and
 * mark-as-read / acknowledge actions.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate } = require('./../middleware/auth');
const { isNonEmptyString } = require('./../utils/validate');
const push = require('./../services/push');

const router = express.Router();
router.use(authenticate);

/** GET /api/notifications — current user's notifications (newest first). */
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM notification_log WHERE recipient_user_id=? ORDER BY id DESC LIMIT 100
  `).all(req.user.id);
  const unread = db.prepare("SELECT COUNT(*) AS n FROM notification_log WHERE recipient_user_id=? AND status='SENT'").get(req.user.id).n;
  res.json({ notifications: rows, unread });
});

/** GET /api/notifications/unread-count — badge count. */
router.get('/unread-count', (req, res) => {
  const unread = db.prepare("SELECT COUNT(*) AS n FROM notification_log WHERE recipient_user_id=? AND status='SENT'").get(req.user.id).n;
  res.json({ unread });
});

/** POST /api/notifications/:id/read — mark one as read. */
router.post('/:id/read', (req, res) => {
  db.prepare("UPDATE notification_log SET status='READ', read_at=datetime('now') WHERE id=? AND recipient_user_id=?")
    .run(req.params.id, req.user.id);
  res.json({ message: 'Marked as read.' });
});

/** POST /api/notifications/read-all — mark all as read. */
router.post('/read-all', (req, res) => {
  db.prepare("UPDATE notification_log SET status='READ', read_at=datetime('now') WHERE recipient_user_id=? AND status='SENT'")
    .run(req.user.id);
  res.json({ message: 'All notifications marked as read.' });
});

/**
 * POST /api/notifications/register-device — register this device's FCM token
 * for real push notifications (mobile app, called after sign-in).
 * body: { token, platform? }
 */
router.post('/register-device', (req, res) => {
  const { token, platform } = req.body || {};
  if (!isNonEmptyString(token)) return res.status(400).json({ error: 'Device token is required.' });
  push.registerDevice({ userId: req.user.id, token: token.trim(), platform });
  res.json({ message: 'Device registered for push notifications.' });
});

/** POST /api/notifications/unregister-device — stop pushing to this device (sign-out). */
router.post('/unregister-device', (req, res) => {
  const { token } = req.body || {};
  if (isNonEmptyString(token)) push.unregisterDevice(token.trim());
  res.json({ message: 'Device unregistered.' });
});

module.exports = router;
