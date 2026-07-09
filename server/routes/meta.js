/**
 * Metadata endpoints — dropdown/reference data for the frontend:
 * workflow statuses, movement types, warehouses, bins, roles.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate } = require('./../middleware/auth');
const states = require('./../workflow/states');

const router = express.Router();
router.use(authenticate);

router.get('/', (req, res) => {
  res.json({
    headerStatuses: Object.values(states.HEADER_STATUS),
    lineStatuses: Object.values(states.LINE_STATUS),
    taskStatuses: Object.values(states.TASK_STATUS),
    priorities: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
    requestTypes: ['COST_CENTER', 'WBS', 'ORDER', 'GENERAL'],
    movementTypes: db.prepare('SELECT code, description, direction, cost_object, requires_cost_center, requires_wbs, requires_order FROM movement_types WHERE is_active=1 ORDER BY code').all(),
    warehouses: db.prepare('SELECT warehouse_code, warehouse_name, plant, storage_location FROM warehouses WHERE is_active=1 ORDER BY warehouse_code').all(),
  });
});

/** Bins for a warehouse (for bin-assignment dropdowns). */
router.get('/warehouses/:code/bins', (req, res) => {
  const bins = db.prepare(
    'SELECT id, bin_code, full_bin_location, zone, rack FROM bin_locations WHERE warehouse_code=? AND is_active=1 ORDER BY full_bin_location'
  ).all(req.params.code);
  res.json({ bins });
});

module.exports = router;
