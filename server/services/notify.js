/**
 * Notification service. Persists notifications to notification_log (the
 * in-app inbox) and is the single seam where real channels — email, push,
 * Teams, SMS, WhatsApp — get wired in later. Channels are configurable per
 * call; delivery to external channels is stubbed (logged) in this phase.
 */
const db = require('./../db/connection');
const email = require('./email');

// Configurable reminder/escalation SLA (minutes) for unaccepted picking tasks.
const SLA = {
  NORMAL: { reminders: [5, 10], supervisorAfter: 15, escalateAfter: 30 },
  URGENT: { reminders: [2, 4], supervisorAfter: 6, escalateAfter: 12 },
};

const insertLog = db.prepare(`
  INSERT INTO notification_log
    (request_number, task_id, recipient_user_id, recipient_name, recipient_role,
     notification_type, notification_title, notification_message, channel, escalation_level)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Record and dispatch a notification. Always writes the in-app inbox row; when
 * `email` is true (or EMAIL_NOTIFICATIONS=1) it also records an EMAIL-channel
 * row and dispatches through the email transport (best-effort, non-blocking).
 */
function send({ requestNumber, taskId, recipientUserId, notificationType, title, message,
                channel = 'IN_APP', escalationLevel = 0, email: alsoEmail = false }) {
  const user = recipientUserId
    ? db.prepare('SELECT u.name, u.email, r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?')
        .get(recipientUserId)
    : null;

  const info = insertLog.run(
    requestNumber ?? null, taskId ?? null, recipientUserId ?? null,
    user ? user.name : null, user ? user.role : null,
    notificationType, title ?? null, message ?? null, channel, escalationLevel
  );

  // External-channel delivery stub — replace with real gateways per channel.
  if (channel !== 'IN_APP') {
    console.log(`[notify:${channel}] -> ${user ? user.name : recipientUserId}: ${title}`);
  }

  // Optional email copy for this notification.
  const wantEmail = (alsoEmail || process.env.EMAIL_NOTIFICATIONS === '1') && channel === 'IN_APP';
  if (wantEmail && user && user.email) {
    insertLog.run(requestNumber ?? null, taskId ?? null, recipientUserId ?? null,
      user.name, user.role, notificationType, title ?? null, message ?? null, 'EMAIL', escalationLevel);
    // Fire-and-forget; email is best-effort and must never block the workflow.
    email.sendEmail({ to: user.email, subject: title || 'WMS notification', text: message || title || '' })
      .catch((e) => console.error('[notify] email error:', e.message));
  }
  return info.lastInsertRowid;
}

/** Notify every user holding a given role (e.g. all ERP operators). */
function notifyRole(roleName, payload) {
  const users = db.prepare(`
    SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
    WHERE r.name = ? AND u.status='active'
  `).all(roleName);
  users.forEach((u) => send({ ...payload, recipientUserId: u.id }));
  return users.length;
}

/** Notify every user holding any permission key in the given list. */
function notifyPermission(permissionKey, payload) {
  const users = db.prepare(`
    SELECT DISTINCT u.id FROM users u WHERE u.status='active' AND (
      u.role_id IN (
        SELECT rp.role_id FROM role_permissions rp
        JOIN permissions p ON p.id=rp.permission_id WHERE p.key=?)
      OR u.id IN (
        SELECT up.user_id FROM user_permissions up
        JOIN permissions p ON p.id=up.permission_id WHERE p.key=?)
    )
  `).all(permissionKey, permissionKey);
  users.forEach((u) => send({ ...payload, recipientUserId: u.id }));
  return users.length;
}

module.exports = { send, notifyRole, notifyPermission, SLA };
