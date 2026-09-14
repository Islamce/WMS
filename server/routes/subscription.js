/**
 * Subscription status, for the banner and the admin screen.
 *
 * Read-only over HTTP. Setting or renewing a subscription is a commercial act
 * performed by the supplier, not a button inside the customer's own system —
 * an endpoint that let an administrator extend their own term would make the
 * whole thing decorative. scripts/set-subscription.js does it on the host,
 * where the person running it already has the database.
 */
const express = require('express');
const { authenticate } = require('./../middleware/auth');
const { getSubscription } = require('./../services/subscription');

const router = express.Router();
router.use(authenticate);

/** GET /api/subscription/status — term, state and what it means today. */
router.get('/status', (req, res) => {
  const sub = getSubscription();
  res.json({
    configured: sub.configured,
    state: sub.state,
    writable: sub.writable,
    plan: sub.plan,
    expires_on: sub.expiresOn,
    read_only_from: sub.readOnlyFrom,
    days_remaining: sub.daysRemaining,
    message: sub.message,
  });
});

module.exports = router;
