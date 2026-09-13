/**
 * Refuse writes when the subscription has lapsed — and nothing else.
 *
 * What this deliberately does NOT block, because each would do more damage than
 * the unpaid invoice it is meant to chase:
 *
 *   - Every GET. The customer's stock records are theirs. Non-payment is a
 *     reason to stop them adding to the system, never a reason to take away the
 *     record of what is in their store.
 *   - Logging in and changing a password. Somebody has to be able to get in,
 *     read the message and renew. A lockout that hides the reason for itself is
 *     just a support call.
 *   - Exports and reports, which are GETs, so they keep working by construction.
 *   - The subscription status endpoint itself.
 *
 * And it only engages after the expiry date AND the grace period, both of which
 * are announced in the UI for thirty days beforehand. See services/subscription.
 */
const { getSubscription } = require('./../services/subscription');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Paths that keep accepting writes whatever the subscription says.
const ALWAYS_ALLOWED = [
  /^\/api\/auth\//,          // log in, log out, change password
  /^\/api\/subscription\b/,  // read the status, renew
];

function enforceSubscription(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  if (ALWAYS_ALLOWED.some((re) => re.test(req.originalUrl || req.url))) return next();

  const sub = getSubscription();
  if (sub.writable) return next();

  // 402 is the honest status: this is a payment problem, not a permission
  // problem, and the client should not treat it as a session failure and log
  // the user out — they need to stay in to read the message.
  return res.status(402).json({
    error: sub.message,
    subscription_state: sub.state,
    read_only: true,
  });
}

module.exports = { enforceSubscription };
