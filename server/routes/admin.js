/**
 * Administrative operations.
 *
 * Production initialization is a one-time controlled transition from demo/UAT
 * data to real operational data. It requires an enabled maintenance window,
 * a verified backup reference, a strong typed phrase, and permanently locks
 * itself after success.
 */
const express = require('express');
const { authenticate, requireAdmin } = require('./../middleware/auth');
const {
  factoryReset,
  getInitializationStatus,
  initializeProductionData,
} = require('./../services/reset');

const router = express.Router();
router.use(authenticate, requireAdmin);

/** GET /api/admin/production-initialization?keep_master_data=true|false */
router.get('/production-initialization', (req, res) => {
  const keepMasterData = String(req.query.keep_master_data || '').toLowerCase() === 'true';
  res.json(getInitializationStatus({ keepMasterData }));
});

/**
 * POST /api/admin/production-initialization
 * body {
 *   confirm: 'RESET PRODUCTION DATA',
 *   backup_confirmed: true,
 *   backup_reference: string,
 *   keep_master_data?: boolean
 * }
 */
router.post('/production-initialization', (req, res) => {
  const {
    confirm,
    backup_confirmed: backupConfirmed,
    backup_reference: backupReference,
    keep_master_data: keepMasterData,
  } = req.body || {};

  if (confirm !== 'RESET PRODUCTION DATA') {
    return res.status(400).json({
      error: 'Type RESET PRODUCTION DATA exactly to confirm the one-time initialization.',
    });
  }
  if (backupConfirmed !== true) {
    return res.status(400).json({ error: 'Confirm that a verified production backup exists.' });
  }

  try {
    const result = initializeProductionData({
      keepMasterData: !!keepMasterData,
      user: req.user,
      backupReference: String(backupReference || ''),
    });
    const total = Object.values(result.counts).reduce((sum, count) => sum + count, 0);
    return res.json({
      message: `Production initialization completed (${total} rows cleared). The reset is now permanently locked.`,
      cleared: result.counts,
      lock: result.lock,
    });
  } catch (err) {
    const status = ['INITIALIZATION_DISABLED', 'INITIALIZATION_LOCKED'].includes(err.code) ? 409 : 400;
    return res.status(status).json({ error: err.message, code: err.code || 'INITIALIZATION_FAILED' });
  }
});

/**
 * Legacy endpoint retained for isolated development/test compatibility only.
 * It is blocked in production unless explicitly enabled.
 */
router.post('/factory-reset', (req, res) => {
  const { confirm, keep_master_data } = req.body || {};
  if (confirm !== 'RESET') {
    return res.status(400).json({ error: 'Type RESET in the confirmation field to clear test data.' });
  }
  try {
    const counts = factoryReset({ keepMasterData: !!keep_master_data, user: req.user });
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return res.json({ message: `Test data cleared (${total} rows).`, cleared: counts });
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }
});

module.exports = router;