/**
 * Warehouse execution — bin & batch assignment (FIFO/FEFO allocation) and
 * manual picker assignment. Allocation reserves batch quantities and proposes
 * bin/batch splits per line; the picker confirms them later.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isId, isPositiveNumber } = require('./../utils/validate');
const { sendError } = require('./../utils/errors');
const audit = require('./../services/audit');
const notify = require('./../services/notify');
const allocation = require('./../services/allocation');
const { setHeaderStatus, getHeaderOr404, releaseOpenAllocations, sweepReservations } = require('./../services/requests');
const { HEADER_STATUS, LINE_STATUS, TASK_STATUS } = require('./../workflow/states');

const router = express.Router();
router.use(authenticate);

/** GET /api/warehouse/queue — requests in warehouse stages for the user's warehouses. */
router.get('/queue', requirePermission(['warehouse_dashboard', 'bin_batch_assignment', 'picker_assignment']), (req, res) => {
  const stages = [
    HEADER_STATUS.PENDING_BIN_ASSIGNMENT, HEADER_STATUS.LOCATION_ASSIGNED, HEADER_STATUS.BATCH_ASSIGNED,
    HEADER_STATUS.PENDING_PICKER_ASSIGNMENT, HEADER_STATUS.ASSIGNED_TO_PICKER,
    HEADER_STATUS.PENDING_PICKER_ACCEPTANCE, HEADER_STATUS.ESCALATED_TO_SUPERVISOR,
    HEADER_STATUS.PICKING_IN_PROGRESS, HEADER_STATUS.PICKING_COMPLETED, HEADER_STATUS.PARTIALLY_PICKED,
  ];
  const rows = db.prepare(`
    SELECT id, request_number, requester_name, priority, request_status, issue_warehouse_code,
           movement_type, total_lines, created_at
    FROM material_request_headers
    WHERE request_status IN (${stages.map(() => '?').join(',')})
    ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, id
  `).all(...stages);
  res.json({ requests: rows });
});

/**
 * POST /api/warehouse/:id/allocate — run FIFO/FEFO allocation for every
 * approved line, reserve batch stock, and write picking_allocations.
 */
router.post('/:id/allocate', requirePermission('bin_batch_assignment'), (req, res) => {
  const header = getHeaderOr404(res, req.params.id);
  if (!header) return;
  // Re-allocation is permitted up until a picker is assigned; it is
  // reservation-safe because releaseOpenAllocations() runs first.
  const allowed = [HEADER_STATUS.PENDING_BIN_ASSIGNMENT, HEADER_STATUS.WAREHOUSE_ASSIGNED,
    HEADER_STATUS.LOCATION_ASSIGNED, HEADER_STATUS.BATCH_ASSIGNED, HEADER_STATUS.PENDING_PICKER_ASSIGNMENT];
  if (!allowed.includes(header.request_status)) {
    return res.status(400).json({ error: `Request is not ready for allocation (status '${header.request_status}').` });
  }

  const lines = db.prepare(
    "SELECT * FROM material_request_lines WHERE request_id=? AND line_status NOT IN ('Rejected','Cancelled')"
  ).all(header.id);

  const results = [];
  const run = db.transaction(() => {
    // Clean re-allocation: FIRST release the batch reservations held by prior
    // proposals (otherwise reserved_quantity double-counts on every re-run),
    // then remove the superseded proposal rows.
    releaseOpenAllocations(header.id);
    db.prepare("DELETE FROM picking_allocations WHERE request_id=? AND status='CANCELLED'").run(header.id);

    for (const line of lines) {
      const qty = line.approved_quantity ?? line.requested_quantity;
      const plan = allocation.propose({
        materialId: line.material_id, warehouseCode: header.issue_warehouse_code,
        quantity: qty, isExpiryManaged: !!line.is_expiry_managed,
      });

      let seq = 1;
      plan.allocations.forEach((a) => {
        db.prepare(`
          INSERT INTO picking_allocations
            (request_id, request_number, line_id, line_number, material_id, batch_id, batch_number,
             warehouse_code, bin_location, qr_code_id, proposed_quantity, allocation_method, sequence, status)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'PROPOSED')
        `).run(header.id, header.request_number, line.id, line.line_number, line.material_id,
          a.batch_id, a.batch_number, a.warehouse_code, a.bin_location, a.qr_code_id,
          a.proposed_quantity, a.allocation_method, seq++);
        // reserve batch quantity
        db.prepare('UPDATE batches SET reserved_quantity = reserved_quantity + ? WHERE id=?')
          .run(a.proposed_quantity, a.batch_id);
      });

      // stamp the primary bin/batch on the line + reserved qty
      const primary = plan.allocations[0];
      db.prepare(`
        UPDATE material_request_lines
        SET bin_location=?, batch_number=?, batch_id=?, qr_code_id=?, reserved_quantity=?,
            fifo_sequence=?, fefo_sequence=?, line_status=?, updated_at=datetime('now')
        WHERE id=?
      `).run(
        primary ? primary.bin_location : null,
        primary ? primary.batch_number : null,
        primary ? primary.batch_id : null,
        primary ? primary.qr_code_id : null,
        plan.allocatedQty,
        plan.method === 'FIFO' ? 1 : null,
        plan.method === 'FEFO' ? 1 : null,
        primary ? LINE_STATUS.BATCH_ASSIGNED : LINE_STATUS.NOT_AVAILABLE,
        line.id
      );

      audit.record({ entityType: 'MaterialRequestLine', entityId: line.id, requestNumber: header.request_number,
        lineNumber: line.line_number, action: 'ALLOCATE', newValue: {
          method: plan.method, allocated: plan.allocatedQty, shortfall: plan.shortfall,
          batches: plan.allocations.map((a) => `${a.batch_number}:${a.proposed_quantity}`),
        }, user: req.user, sourceScreen: 'Bin & Batch Assignment' });

      results.push({ line_number: line.line_number, material_code: line.material_code, method: plan.method,
        allocated: plan.allocatedQty, requested: qty, shortfall: plan.shortfall,
        allocations: plan.allocations });
    }

    setHeaderStatus(header, HEADER_STATUS.LOCATION_ASSIGNED, { user: req.user, sourceScreen: 'Bin & Batch Assignment' });
    setHeaderStatus(header, HEADER_STATUS.BATCH_ASSIGNED, { user: req.user, sourceScreen: 'Bin & Batch Assignment' });
    setHeaderStatus(header, HEADER_STATUS.PENDING_PICKER_ASSIGNMENT, { user: req.user, sourceScreen: 'Bin & Batch Assignment' });
  });
  try { run(); } catch (err) { return sendError(res, err); }

  notify.notifyPermission('picker_assignment', { requestNumber: header.request_number,
    notificationType: 'PICKER_ASSIGNMENT_NEEDED', title: `Request ${header.request_number} ready for picker assignment`,
    message: 'Bins and batches are assigned; assign a picker.' });

  res.json({ message: 'Allocation complete (FIFO/FEFO applied).', allocations: results });
});

/** GET /api/warehouse/pickers — active pickers for the assignment dropdown. */
router.get('/pickers', requirePermission('picker_assignment'), (req, res) => {
  const pickers = db.prepare(`
    SELECT u.id, u.name, u.email FROM users u JOIN roles r ON r.id=u.role_id
    WHERE r.name='picker' AND u.status='active' ORDER BY u.name
  `).all();
  res.json({ pickers });
});

/** POST /api/warehouse/:id/assign-picker — manual assignment + first notification. */
router.post('/:id/assign-picker', requirePermission('picker_assignment'), (req, res) => {
  const header = getHeaderOr404(res, req.params.id);
  if (!header) return;
  if (![HEADER_STATUS.PENDING_PICKER_ASSIGNMENT, HEADER_STATUS.ESCALATED_TO_SUPERVISOR,
        HEADER_STATUS.ASSIGNED_TO_PICKER, HEADER_STATUS.PENDING_PICKER_ACCEPTANCE].includes(header.request_status)) {
    return res.status(400).json({ error: `Request is not ready for picker assignment (status '${header.request_status}').` });
  }
  const { picker_id } = req.body || {};
  if (!isId(picker_id)) return res.status(400).json({ error: 'A picker must be selected.' });
  const picker = db.prepare("SELECT u.id, u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND r.name='picker' AND u.status='active'").get(picker_id);
  if (!picker) return res.status(404).json({ error: 'Picker not found or inactive.' });

  const lineCount = db.prepare("SELECT COUNT(*) AS n FROM material_request_lines WHERE request_id=? AND line_status NOT IN ('Rejected','Cancelled')").get(header.id).n;
  const binCount = db.prepare("SELECT COUNT(DISTINCT bin_location) AS n FROM picking_allocations WHERE request_id=? AND status='PROPOSED'").get(header.id).n;

  const assign = db.transaction(() => {
    // supersede any existing open task (reassignment)
    const prev = db.prepare("SELECT * FROM picking_tasks WHERE request_id=? AND task_status NOT IN ('Picking Completed','Cancelled')").get(header.id);
    if (prev) db.prepare('UPDATE picking_tasks SET task_status=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(TASK_STATUS.REASSIGNED, prev.id);

    const info = db.prepare(`
      INSERT INTO picking_tasks
        (request_id, request_number, assigned_picker_id, assigned_picker_name, assigned_by, assigned_at,
         task_status, priority, warehouse_code, total_lines, total_bin_locations, target_completion_time)
      VALUES (?,?,?,?,?,datetime('now'),?,?,?,?,?, datetime('now','+2 hours'))
    `).run(header.id, header.request_number, picker.id, picker.name, req.user.id,
      TASK_STATUS.PENDING_ACCEPTANCE, header.priority, header.issue_warehouse_code, lineCount, binCount);

    audit.record({ entityType: 'PickingTask', entityId: info.lastInsertRowid, requestNumber: header.request_number,
      action: 'ASSIGN_PICKER', newValue: { picker: picker.name }, user: req.user, sourceScreen: 'Picker Assignment' });

    if (header.request_status === HEADER_STATUS.PENDING_PICKER_ASSIGNMENT ||
        header.request_status === HEADER_STATUS.ESCALATED_TO_SUPERVISOR) {
      setHeaderStatus(header, HEADER_STATUS.ASSIGNED_TO_PICKER, { user: req.user, sourceScreen: 'Picker Assignment' });
    }
    setHeaderStatus(header, HEADER_STATUS.PENDING_PICKER_ACCEPTANCE, { user: req.user, sourceScreen: 'Picker Assignment' });
    return info.lastInsertRowid;
  });
  const taskId = assign();

  notify.send({ requestNumber: header.request_number, taskId, recipientUserId: picker.id,
    notificationType: 'TASK_ASSIGNED', title: `New picking task ${header.request_number}`,
    message: `You have been assigned a picking task. Please accept it.` });

  res.json({ message: `Picking task assigned to ${picker.name}. Awaiting acceptance.`, task_id: taskId });
});

/** POST /api/warehouse/sweep-reservations — release timed-out reservations now.
 *  Body { testMinutes } fast-forwards the TTL clock for deterministic testing. */
router.post('/sweep-reservations', requirePermission('bin_batch_assignment'), (req, res) => {
  const now = isPositiveNumber(req.body.testMinutes)
    ? Date.now() + Number(req.body.testMinutes) * 60000
    : Date.now();
  const released = sweepReservations(now);
  res.json({ message: `Released ${released.length} timed-out reservation(s).`, released });
});

module.exports = router;
