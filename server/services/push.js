/**
 * Real device push notifications via Firebase Cloud Messaging (FCM).
 *
 * Entirely optional and self-disabling: without Firebase credentials
 * configured (FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH),
 * every call here is a silent no-op — the in-app notification inbox
 * (notify.js) keeps working exactly as before. See DEPLOY-HOSTINGER.md for
 * the one-time Firebase project setup required to turn this on.
 */
const fs = require('fs');
const db = require('./../db/connection');

let admin = null;
let initTried = false;
let app = null;

function loadCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
  }
  return null;
}

/** Lazily initialize firebase-admin once; returns the app, or null if not configured. */
function getApp() {
  if (app || initTried) return app;
  initTried = true;
  try {
    const credential = loadCredential();
    if (!credential) return null;
    // eslint-disable-next-line global-require
    admin = require('firebase-admin');
    app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(credential) });
  } catch (err) {
    console.error('[push] Firebase initialization failed — push notifications disabled:', err.message);
    app = null;
  }
  return app;
}

/** Register (or move to another user) a device's FCM token. */
function registerDevice({ userId, token, platform }) {
  db.prepare(`
    INSERT INTO device_tokens (user_id, token, platform) VALUES (?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, platform=excluded.platform, updated_at=datetime('now')
  `).run(userId, token, platform || 'android');
}

/** Remove a device token (called on sign-out). */
function unregisterDevice(token) {
  db.prepare('DELETE FROM device_tokens WHERE token=?').run(token);
}

/**
 * Push a notification to every device registered for a user. Best-effort:
 * never throws — a push failure must never break the workflow action that
 * triggered it. Prunes tokens FCM reports as no-longer-registered.
 */
async function sendToUser(userId, { title, message }) {
  if (!userId) return;
  const a = getApp();
  if (!a) return; // Firebase not configured — in-app inbox already has the notification.
  const rows = db.prepare('SELECT token FROM device_tokens WHERE user_id=?').all(userId);
  if (!rows.length) return;
  try {
    const res = await admin.messaging(a).sendEachForMulticast({
      tokens: rows.map((r) => r.token),
      notification: { title: title || 'WMS', body: message || '' },
    });
    res.responses.forEach((r, i) => {
      if (!r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']
        .includes(r.error && r.error.code)) {
        unregisterDevice(rows[i].token);
      }
    });
  } catch (err) {
    console.error('[push] send failed:', err.message);
  }
}

module.exports = { registerDevice, unregisterDevice, sendToUser };
