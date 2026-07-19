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
  const timestamp = new Date().toISOString();
  try {
    // Read-only precondition diagnostics — an env check and a token count.
    // No Firebase call; these mirror the two guards push.sendToUser() itself
    // applies, so we can report truthfully whether a push will be attempted.
    const firebaseConfigured = Boolean(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    );
    const registeredDevices = db
      .prepare('SELECT COUNT(*) AS n FROM device_tokens WHERE user_id=?')
      .get(userId).n;

    // Scenario 3: Firebase not configured — no push infrastructure to validate.
    // Report the failure instead of writing a log row that could never deliver.
    if (!firebaseConfigured) {
      return res.status(200).json({
        success: false,
        warning: 'Firebase service is not configured on the server.',
        firebaseConfigured: false,
        registeredDevices,
        attemptedPush: false,
        recipientUserId: userId,
        timestamp,
      });
    }

    // Scenario 2: no registered device — a push cannot be attempted. Do not
    // silently report success when nothing could actually be delivered.
    if (registeredDevices === 0) {
      return res.status(200).json({
        success: false,
        warning: 'No registered Android device for this user.',
        firebaseConfigured: true,
        registeredDevices: 0,
        attemptedPush: false,
        recipientUserId: userId,
        timestamp,
      });
    }

    // Scenario 1: preconditions met — fire the real pipeline. notify.send()
    // writes the notification_log row and triggers push.sendToUser() -> FCM.
    const notificationLogId = notify.send({
      recipientUserId: userId,
      notificationType: 'PUSH_TEST',
      title: 'Push Notification Test',
      message: 'Firebase Push Notifications are working correctly.',
    });

    return res.status(200).json({
      success: true,
      notificationLogId,
      recipientUserId: userId,
      firebaseConfigured: true,
      registeredDevices,
      attemptedPush: true,
      timestamp,
    });
  } catch (err) {
    // Scenario 4: internal error — structured diagnostics; stack only outside
    // production so we never leak internals in a real deployment.
    return res.status(500).json({
      success: false,
      error: err.message,
      ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
      timestamp,
    });
  }
});

module.exports = router;
