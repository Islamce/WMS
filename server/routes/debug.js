/**
 * TEMPORARY debug routes — push-notification validation.
 *
 * ⚠️  REMOVE BEFORE VERSION 1.0 RELEASE.
 * This router exists only to let a System Admin fire a single test
 * notification through the real notification pipeline and confirm that
 * Firebase Cloud Messaging is wired up end-to-end. It performs no business
 * action and must not survive into the 1.0 release build.
 *
 * To remove: delete this file and its `app.use('/api/debug', …)` line in
 * server/index.js (see the matching "REMOVE BEFORE V1.0" marker there).
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requireAdmin } = require('./../middleware/auth');
const notify = require('./../services/notify');

const router = express.Router();
router.use(authenticate);
router.use(requireAdmin);

/**
 * POST /api/debug/push-test
 * Sends a test notification to the logged-in admin through the normal
 * notify.send() pipeline: it writes the in-app notification_log row AND, for
 * IN_APP notifications with a recipient, fires push.sendToUser() (real FCM
 * delivery when Firebase is configured — otherwise a silent no-op). We do not
 * touch Firebase or the log directly; everything goes through the service.
 */
router.post('/push-test', (req, res) => {
  const userId = req.user.id;
  try {
    const notificationLogId = notify.send({
      recipientUserId: userId,
      notificationType: 'PUSH_TEST',
      title: 'Push Notification Test',
      message: 'Firebase Push Notifications are working correctly.',
    });

    // Read-only diagnostics so the admin can interpret the result on the
    // device (no Firebase call — just an env check and a token count).
    const firebaseConfigured = Boolean(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    );
    const registeredDevices = db
      .prepare('SELECT COUNT(*) AS n FROM device_tokens WHERE user_id=?')
      .get(userId).n;

    return res.json({
      success: true,
      message: 'Test notification dispatched through the notification pipeline.',
      notificationLogId,
      recipientUserId: userId,
      firebaseConfigured,
      registeredDevices,
      note: firebaseConfigured
        ? (registeredDevices > 0
            ? 'A real device push was attempted. Check the Android device.'
            : 'No device tokens registered for this user — sign in on the mobile app first, then retry.')
        : 'Firebase is not configured on the server (FIREBASE_SERVICE_ACCOUNT_*). '
          + 'The in-app notification was saved; real push is a no-op until Firebase is set.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
