/**
 * Notifications center — the current user's in-app inbox, unread count, and
 * mark-as-read / acknowledge actions.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate } = require('./../middleware/auth');

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

module.exports = router;
