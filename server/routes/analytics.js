/**
 * AI Stock Analytics — classification, reorder points, safety stock, trends,
 * and rule-based insights. Protected by the ai_analytics permission.
 */
const express = require('express');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { fullReport } = require('./../services/analytics');

const router = express.Router();
router.use(authenticate, requirePermission('ai_analytics'));

router.get('/', (req, res) => {
  res.json(fullReport());
});

module.exports = router;
