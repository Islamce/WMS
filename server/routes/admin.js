/**
 * Administrative operations — currently the factory reset that clears the
 * demo/test dataset so real data can be imported. Admin-only and guarded by a
 * typed confirmation phrase; the operation is recorded as the first entry of
 * the fresh audit history.
 */
const express = require('express');
const { authenticate, requireAdmin } = require('./../middleware/auth');
const { factoryReset } = require('./../services/reset');

const router = express.Router();
router.use(authenticate, requireAdmin);

/** POST /api/admin/factory-reset — body { confirm: 'RESET', keep_master_data? } */
router.post('/factory-reset', (req, res) => {
  const { confirm, keep_master_data } = req.body || {};
  if (confirm !== 'RESET') {
    return res.status(400).json({ error: "Type RESET in the confirmation field to clear the data." });
  }
  const counts = factoryReset({ keepMasterData: !!keep_master_data, user: req.user });
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  res.json({
    message: `Data cleared (${total} rows). Users, roles, permissions and configuration were kept. `
      + 'You can now import your real data from the Import Center.',
    cleared: counts,
  });
});

module.exports = router;
