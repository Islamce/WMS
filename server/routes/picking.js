/**
 * Picking — picker task inbox, acceptance, start, QR-validated line confirmation
 * (with FIFO/FEFO and shortage handling), and completion. Also exposes the
 * reminder/escalation sweep used by the background scheduler.
 *
 * The same original request number is carried through every allocation and
 * confirmation; GI cannot be posted before picking is confirmed.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isId, isPositiveNumber, isNonEmptyString, isNonNegativeNumber } = require('./../utils/validate');
const audit = require('./../services/audit');
const notify = require('./../services/notify');
const qrService = require('./../services/qr');
const { setHeaderStatus, refreshRollups, getHeaderOr404 } = require('./../services/requests');
const { HEADER_STATUS, LINE_STATUS, TASK_STATUS } = require('./../workflow/states');
const { withExecutionContext, withExecutionContexts } = require('./../services/workflowContext');

const router = express.Router();
router.use(authenticate);

/** GET /api/picking/tasks — the picker's own task inbox. */
router.get('/tasks', requirePermission('picking'), (req, res) => {
  const own = req.user.role === 'admin' ? '' : 'AND assigned_picker_id = @uid';
  const tasks = db.prepare(`
    SELECT t.*, h.request_status, h.erp_reservation_number, h.erp_reference_number,
           h.issue_warehouse_code, h.issue_warehouse_name, h.movement_type, h.movement_type_description,
           h.plant, h.storage_location, h.priority AS req_priority, h.requester_id, h.requester_name,
           h.department, h.wbs_element, h.wbs_element AS project, h.cost_center, h.required_date
    FROM picking_tasks t JOIN material_request_headers h ON h.id = t.request_id
    WHERE t.task_status NOT IN ('Picking Completed','Cancelled','Reassigned') ${own}
    ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, t.assigned_at
  `).all({ uid: req.user.id });
  res.json({ tasks: withExecutionContexts(tasks) });
});

function loadTask(res, id, user, { mustOwn = true } = {}) {
  const task = db.prepare('SELECT * FROM picking_tasks WHERE id=?').get(id);
  if (!task) { res.status(404).json({ error: 'Task not found.' }); return null; }
  if (mustOwn && user.role !== 'admin' && task.assigned_picker_id !== user.id) {
    res.status(403).json({ error: 'This task is not assigned to you.' }); return null;
  }
  return task;
}

/** GET /api/picking/tasks/:id — task detail with lines + proposed allocations. */
router.get('/tasks/:id', requirePermission('picking'), (req, res) => {
  const task = loadTask(res, req.params.id, req.user);
  if (!task) return;
  const header = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(task.request_id);
  const lines = db.prepare("SELECT * FROM material_request_lines WHERE request_id=? AND line_status NOT IN ('Rejected','Cancelled') ORDER BY line_number").all(task.request_id);
  const allocations = db.prepare('SELECT * FROM picking_allocations WHERE request_id=? ORDER BY line_number, sequence').all(task.request_id);
  res.json({ task, request: withExecutionContext(header), lines, allocations });
});

/** POST /api/picking/tasks/:id/accept — picker accepts; task -> Accepted. */
router.post('/tasks/:id/accept', requirePermission('picking'), (req, res) => {
  const task = loadTask(res, req.params.id, req.user);
  if (!task) return;
  if (![TASK_STATUS.PENDING_ACCEPTANCE, TASK_STATUS.ASSIGNED, TASK_STATUS.REMINDER_SENT, TASK_STATUS.ESCALATED].includes(task.task_status)) {
    return res.status(400).json({ error: `Task cannot be accepted from status '${task.task_status}'.` });
  }
  const header = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(task.request_id);
  db.transaction(() => {
    db.prepare("UPDATE picking_tasks SET task_status=?, accepted_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
      .run(TASK_STATUS.ACCEPTED, task.id);
    setHeaderStatus(header, HEADER_STATUS.ACCEPTED_BY_PICKER, { user: req.user, sourceScreen: 'Picker Task' });
    audit.record({ entityType: 'PickingTask', entityId: task.id, requestNumber: task.request_number,
      action: 'TASK_ACCEPTED', user: req.user, sourceScreen: 'Picker Task' });
  })();
  notify.send({ requestNumber: task.request_number, taskId: task.id, recipientUserId: task.assigned_by,
    notificationType: 'TASK_ACCEPTED', title: `Task ${task.request_number} accepted`, message: `${req.user.name} accepted the picking task.` });
  res.json({ message: 'Task accepted.' });
});

/** POST /api/picking/tasks/:id/start — begin picking (must be accepted first). */
router.post('/tasks/:id/start', requirePermission('picking'), (req, res) => {
  const task = loadTask(res, req.params.id, req.user);
  if (!task) return;
  if (task.task_status !== TASK_STATUS.ACCEPTED) {
    return res.status(400).json({ error: 'You must accept the task before starting to pick.' });
  }
  const header = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(task.request_id);
  db.transaction(() => {
    db.prepare("UPDATE picking_tasks SET task_status=?, started_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
      .run(TASK_STATUS.IN_PROGRESS, task.id);
    setHeaderStatus(header, HEADER_STATUS.PICKING_IN_PROGRESS, { user: req.user, sourceScreen: 'Picker Task' });
    db.prepare("UPDATE material_request_lines SET line_status=? WHERE request_id=? AND line_status IN (?,?)")
      .run(LINE_STATUS.PICKING_IN_PROGRESS, task.request_id, LINE_STATUS.BATCH_ASSIGNED, LINE_STATUS.RESERVED);
  })();
  res.json({ message: 'Picking started.' });
});

/**
 * POST /api/picking/allocations/:allocId/scan — validate a scanned QR against
 * the proposed allocation. Blocks on mismatch/expired/blocked unless an
 * authorized supervisor override is supplied.
 */
router.post('/allocations/:allocId/scan', requirePermission('picking'), (req, res) => {
  const alloc = db.prepare('SELECT * FROM picking_allocations WHERE id=?').get(req.params.allocId);
  if (!alloc) return res.status(404).json({ error: 'Allocation not found.' });
  const line = db.prepare('SELECT * FROM material_request_lines WHERE id=?').get(alloc.line_id);
  const { qr_value, override, override_reason, skip } = req.body || {};

  if (skip === true) {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only an administrator can skip the QR scan.' });
    }
    db.prepare("UPDATE picking_allocations SET status='SCANNED', scanned_qr_value='(skipped)', scan_result='SKIPPED_BY_ADMIN' WHERE id=?")
      .run(alloc.id);
    db.prepare('UPDATE material_request_lines SET line_status=? WHERE id=?').run(LINE_STATUS.QR_VERIFIED, line.id);
    audit.record({ entityType: 'PickingAllocation', entityId: alloc.id, requestNumber: alloc.request_number,
      lineNumber: alloc.line_number, action: 'QR_SCAN_SKIPPED', newValue: { by: req.user.name },
      user: req.user, sourceScreen: 'QR Scan' });
    return res.json({ ok: true, skipped: true, message: 'Scan skipped by administrator. You may confirm the pick.' });
  }

  if (!isNonEmptyString(qr_value)) return res.status(400).json({ error: 'QR value is required.' });

  const scanned = qr_value.trim();
  const binRow = db.prepare(
    'SELECT bin_code, full_bin_location FROM bin_locations WHERE warehouse_code=? AND (bin_code=? OR full_bin_location=?)'
  ).get(alloc.warehouse_code, scanned, scanned);
  const isBinScan = !!binRow || scanned === (alloc.bin_location || '');
  if (isBinScan) {
    const matchesExpected = scanned === (alloc.bin_location || '')
      || (binRow && (binRow.bin_code === alloc.bin_location || binRow.full_bin_location === alloc.bin_location));
    if (!matchesExpected) {
      audit.record({ entityType: 'PickingAllocation', entityId: alloc.id, requestNumber: alloc.request_number,
        lineNumber: alloc.line_number, action: 'QR_SCAN_FAIL',
        newValue: { qr: scanned, code: 'WRONG_BIN', message: 'Scanned bin does not match the proposed bin.' },
        user: req.user, sourceScreen: 'QR Scan' });
      return res.status(400).json({ ok: false, code: 'WRONG_BIN',
        error: `Scanned bin ${scanned} does not match the proposed bin ${alloc.bin_location}.` });
    }
    db.prepare("UPDATE picking_allocations SET status='SCANNED', scanned_qr_value=?, scan_result='PASS:BIN' WHERE id=?")
      .run(scanned, alloc.id);
    db.prepare('UPDATE material_request_lines SET line_status=? WHERE id=?').run(LINE_STATUS.QR_VERIFIED, line.id);
    audit.record({ entityType: 'PickingAllocation', entityId: alloc.id, requestNumber: alloc.request_number,
      lineNumber: alloc.line_number, action: 'QR_SCAN_PASS', newValue: { qr: scanned, code: 'PASS_BIN' },
      user: req.user, sourceScreen: 'QR Scan' });
    return res.json({ ok: true, message: 'Bin location validated. You may confirm the pick.' });
  }

  const result = qrService.validateScan({
    qrValue: scanned,
    expected: { materialCode: line.material_code, batchNumber: alloc.batch_number,
      warehouseCode: alloc.warehouse_code, binLocation: alloc.bin_location },
  });

  audit.record({ entityType: 'PickingAllocation', entityId: alloc.id, requestNumber: alloc.request_number,
    lineNumber: alloc.line_number, action: result.ok ? 'QR_SCAN_PASS' : 'QR_SCAN_FAIL',
    newValue: { qr: qr_value, code: result.code, message: result.message }, user: req.user, sourceScreen: 'QR Scan' });
  if (result.qr) qrService.markScanned(result.qr.id, req.user.id);

  if (!result.ok) {
    const canOverride = req.user.role === 'admin' || req.user.permissions.includes('bin_batch_assignment') || req.user.permissions.includes('picker_assignment');
    if (override && canOverride && isNonEmptyString(override_reason)) {
      db.prepare("UPDATE picking_allocations SET status='SCANNED', scanned_qr_value=?, scan_result=? WHERE id=?")
        .run(qr_value, `OVERRIDE:${result.code}`, alloc.id);
      audit.record({ entityType: 'PickingAllocation', entityId: alloc.id, requestNumber: alloc.request_number,
        lineNumber: alloc.line_number, action: 'SUPERVISOR_OVERRIDE', oldValue: result.code,
        reason: override_reason, user: req.user, sourceScreen: 'QR Scan' });
      return res.json({ ok: true, overridden: true, message: `Validation bypassed by override: ${result.message}` });
    }
    notify.notifyPermission('picker_assignment', { requestNumber: alloc.request_number,
      notificationType: 'QR_VALIDATION_FAILED', title: `QR validation failed on ${alloc.request_number}`,
      message: result.message });
    return res.status(400).json({ ok: false, code: result.code, error: result.message });
  }

  db.prepare("UPDATE picking_allocations SET status='SCANNED', scanned_qr_value=?, scan_result='PASS' WHERE id=?")
    .run(qr_value, alloc.id);
  db.prepare("UPDATE material_request_lines SET line_status=? WHERE id=?").run(LINE_STATUS.QR_VERIFIED, line.id);
  res.json({ ok: true, message: 'QR validated. You may confirm the pick.' });
});

/**
 * POST /api/picking/lines/:lineId/confirm — confirm picked quantity for a line.
 * Requires the line's allocations to be QR-scanned (unless override). Shortage
 * reason mandatory when picked < required.
 */
router.post('/lines/:lineId/confirm', requirePermission('picking'), (req, res) => {
  const line = db.prepare('SELECT * FROM material_request_lines WHERE id=?').get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Line not found.' });
  const header = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(line.request_id);
  const task = db.prepare("SELECT * FROM picking_tasks WHERE request_id=? AND task_status='Picking in Progress' ORDER BY id DESC LIMIT 1").get(line.request_id);
  if (!task) return res.status(400).json({ error: 'No in-progress picking task for this request.' });
  if (req.user.role !== 'admin' && task.assigned_picker_id !== req.user.id) {
    return res.status(403).json({ error: 'This task is not assigned to you.' });
  }

  const { picked_quantity, shortage_reason } = req.body || {};
  if (!isNonNegativeNumber(picked_quantity)) return res.status(400).json({ error: 'Picked quantity must be zero or more.' });
  const approvedQty = line.approved_quantity ?? line.requested_quantity;
  const picked = Number(picked_quantity);
  if (picked > line.reserved_quantity) {
    return res.status(400).json({ error: `Picked quantity (${picked}) exceeds allocated/available quantity (${line.reserved_quantity}).` });
  }
  if (picked > approvedQty) {
    return res.status(400).json({ error: `Picked quantity (${picked}) exceeds approved quantity (${approvedQty}).` });
  }
  const isShort = picked < approvedQty;
  if (isShort && picked > 0 && !isNonEmptyString(shortage_reason)) {
    return res.status(400).json({ error: 'A shortage reason is required when picking less than the approved quantity.' });
  }

  const allocs = db.prepare("SELECT * FROM picking_allocations WHERE line_id=? AND status IN ('PROPOSED','SCANNED')").all(line.id);
  if (picked > 0 && allocs.length === 0) {
    return res.status(400).json({ error: 'This line has no open allocations to pick from (already confirmed or not allocated). Re-run allocation or return the task properly.' });
  }
  if ((line.is_batch_managed || line.is_expiry_managed)) {
    const unscanned = allocs.filter((a) => a.status === 'PROPOSED');
    if (picked > 0 && unscanned.length > 0) {
      return res.status(400).json({ error: 'Scan the QR code for each proposed batch/bin before confirming this line.' });
    }
  }

  const confirm = db.transaction(() => {
    let toConsume = picked;
    for (const a of allocs) {
      if (toConsume <= 0) break;
      const take = Math.min(toConsume, a.proposed_quantity);
      db.prepare("UPDATE picking_allocations SET picked_quantity=?, status=? WHERE id=?")
        .run(take, take >= a.proposed_quantity ? 'PICKED' : 'SHORT', a.id);
      db.prepare('UPDATE batches SET remaining_quantity = remaining_quantity - ?, reserved_quantity = MAX(0, reserved_quantity - ?) WHERE id=?')
        .run(take, a.proposed_quantity, a.batch_id);
      toConsume -= take;
    }
    allocs.forEach((a) => {
      if (a.status === 'PROPOSED') {
        db.prepare('UPDATE batches SET reserved_quantity = MAX(0, reserved_quantity - ?) WHERE id=?')
          .run(a.proposed_quantity, a.batch_id);
        db.prepare("UPDATE picking_allocations SET status='CANCELLED' WHERE id=?").run(a.id);
      }
    });

    const shortageQty = Math.max(0, approvedQty - picked);
    const status = picked === 0 ? LINE_STATUS.SHORTAGE
      : isShort ? LINE_STATUS.PARTIALLY_PICKED : LINE_STATUS.PICKED;
    db.prepare(`
      UPDATE material_request_lines
      SET picked_quantity=?, shortage_quantity=?, shortage_reason=?, line_status=?, updated_at=datetime('now')
      WHERE id=?
    `).run(picked, shortageQty, isShort ? (shortage_reason || null) : null, status, line.id);

    audit.record({ entityType: 'MaterialRequestLine', entityId: line.id, requestNumber: header.request_number,
      lineNumber: line.line_number, action: 'PICK_CONFIRM',
      oldValue: { approved: approvedQty }, newValue: { picked, shortage: shortageQty, status },
      reason: isShort ? shortage_reason : null, user: req.user, sourceScreen: 'Line Picking' });
  });
  confirm();

  if (isShort) {
    notify.notifyPermission('gi_posting', { requestNumber: header.request_number,
      notificationType: 'SHORTAGE', title: `Shortage on ${header.request_number} line ${line.line_number}`,
      message: shortage_reason || 'Partial pick recorded.' });
  }
  res.json({ message: 'Line pick confirmed.' });
});

/** POST /api/picking/tasks/:id/complete — finish picking; route to GI queue. */
router.post('/tasks/:id/complete', requirePermission('picking'), (req, res) => {
  const initialTask = loadTask(res, req.params.id, req.user);
  if (!initialTask) return;

  const replayTaskStatuses = [TASK_STATUS.COMPLETED, TASK_STATUS.PARTIALLY_COMPLETED];
  const replayHeaderStatuses = [HEADER_STATUS.PENDING_ERP_GI, HEADER_STATUS.GI_POSTED, HEADER_STATUS.COMPLETED];
  const initialHeader = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(initialTask.request_id);
  if (replayTaskStatuses.includes(initialTask.task_status) && replayHeaderStatuses.includes(initialHeader.request_status)) {
    return res.json({
      message: 'Picking completion already recorded. Request is in the GI workflow.',
      idempotent: true,
      task_status: initialTask.task_status,
      request_status: initialHeader.request_status,
    });
  }

  let outcome = null;
  let replay = null;
  const complete = db.transaction(() => {
    const task = db.prepare('SELECT * FROM picking_tasks WHERE id=?').get(initialTask.id);
    const header = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(task.request_id);

    if (replayTaskStatuses.includes(task.task_status) && replayHeaderStatuses.includes(header.request_status)) {
      replay = { task_status: task.task_status, request_status: header.request_status };
      return;
    }
    if (task.task_status !== TASK_STATUS.IN_PROGRESS) {
      const err = new Error(`Task cannot be completed from status '${task.task_status}'.`);
      err.status = 409;
      throw err;
    }

    const lines = db.prepare("SELECT * FROM material_request_lines WHERE request_id=? AND line_status NOT IN ('Rejected','Cancelled')").all(task.request_id);
    const pending = lines.filter((l) => ![LINE_STATUS.PICKED, LINE_STATUS.PARTIALLY_PICKED, LINE_STATUS.SHORTAGE, LINE_STATUS.NOT_AVAILABLE].includes(l.line_status));
    if (pending.length > 0) {
      const err = new Error(`Confirm all lines before completing (${pending.length} still pending).`);
      err.status = 400;
      throw err;
    }

    const anyShort = lines.some((l) => [LINE_STATUS.PARTIALLY_PICKED, LINE_STATUS.SHORTAGE].includes(l.line_status));
    const allShort = lines.every((l) => [LINE_STATUS.SHORTAGE, LINE_STATUS.NOT_AVAILABLE].includes(l.line_status));
    const taskStatus = anyShort && !allShort ? TASK_STATUS.PARTIALLY_COMPLETED : TASK_STATUS.COMPLETED;

    const claimed = db.prepare(`
      UPDATE picking_tasks
      SET task_status=?, completed_at=COALESCE(completed_at, datetime('now')), updated_at=datetime('now')
      WHERE id=? AND task_status=?
    `).run(taskStatus, task.id, TASK_STATUS.IN_PROGRESS);
    if (claimed.changes !== 1) {
      const current = db.prepare('SELECT task_status FROM picking_tasks WHERE id=?').get(task.id);
      if (replayTaskStatuses.includes(current.task_status)) {
        replay = { task_status: current.task_status, request_status: header.request_status };
        return;
      }
      const err = new Error(`Task completion could not claim status '${current.task_status}'.`);
      err.status = 409;
      throw err;
    }

    setHeaderStatus(header, anyShort ? HEADER_STATUS.PARTIALLY_PICKED : HEADER_STATUS.PICKING_COMPLETED,
      { user: req.user, sourceScreen: 'Picker Task' });
    setHeaderStatus(header, HEADER_STATUS.PENDING_ERP_GI, { user: req.user, sourceScreen: 'Picker Task' });
    db.prepare("UPDATE material_request_lines SET line_status=? WHERE request_id=? AND line_status IN (?,?)")
      .run(LINE_STATUS.PENDING_GI, header.id, LINE_STATUS.PICKED, LINE_STATUS.PARTIALLY_PICKED);
    refreshRollups(header.id);
    outcome = { anyShort, requestNumber: header.request_number, taskStatus };
  });

  try { complete(); } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Failed to complete picking.' });
  }

  if (replay) {
    return res.json({
      message: 'Picking completion already recorded. Request is in the GI workflow.',
      idempotent: true,
      task_status: replay.task_status,
      request_status: replay.request_status,
    });
  }

  notify.notifyPermission('gi_posting', { requestNumber: outcome.requestNumber,
    notificationType: 'PICKING_COMPLETED', title: `Picking complete for ${outcome.requestNumber}`,
    message: 'Ready for Goods Issue posting.' });
  res.json({
    message: `Picking ${outcome.anyShort ? 'partially ' : ''}completed. Sent to GI posting.`,
    task_status: outcome.taskStatus,
  });
});

function sweepReminders(nowMs = Date.now()) {
  const tasks = db.prepare(`
    SELECT * FROM picking_tasks
    WHERE task_status IN ('Pending Picker Acceptance','Reminder Sent','Assigned to Picker','Escalated to Supervisor')
      AND accepted_at IS NULL
  `).all();
  const actions = [];
  for (const task of tasks) {
    const sla = notify.SLA[task.priority === 'URGENT' ? 'URGENT' : 'NORMAL'];
    const assignedMs = new Date((task.assigned_at || task.created_at).replace(' ', 'T') + 'Z').getTime();
    const elapsedMin = (nowMs - assignedMs) / 60000;
    const header = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(task.request_id);

    if (elapsedMin >= sla.escalateAfter && task.escalation_level < 2) {
      db.prepare("UPDATE picking_tasks SET escalation_level=2, task_status='Escalated to Supervisor', updated_at=datetime('now') WHERE id=?").run(task.id);
      if (header) try { setHeaderStatus(header, HEADER_STATUS.ESCALATED_TO_SUPERVISOR, { sourceScreen: 'Scheduler' }); } catch {}
      notify.notifyPermission('picker_assignment', { requestNumber: task.request_number, taskId: task.id,
        notificationType: 'ESCALATION', escalationLevel: 2,
        title: `Escalation: ${task.request_number} not accepted`, message: 'Picking task not accepted; reassign required.' });
      audit.record({ entityType: 'PickingTask', entityId: task.id, requestNumber: task.request_number,
        action: 'ESCALATE', newValue: { level: 2, elapsedMin: Math.round(elapsedMin) }, sourceScreen: 'Scheduler' });
      actions.push({ task: task.id, action: 'ESCALATE_MANAGER' });
    } else if (elapsedMin >= sla.supervisorAfter && task.escalation_level < 1) {
      db.prepare("UPDATE picking_tasks SET escalation_level=1, task_status='Escalated to Supervisor', updated_at=datetime('now') WHERE id=?").run(task.id);
      if (header) try { setHeaderStatus(header, HEADER_STATUS.ESCALATED_TO_SUPERVISOR, { sourceScreen: 'Scheduler' }); } catch {}
      notify.notifyPermission('picker_assignment', { requestNumber: task.request_number, taskId: task.id,
        notificationType: 'ESCALATION', escalationLevel: 1,
        title: `Supervisor alert: ${task.request_number} not accepted`, message: 'Picker has not accepted the task.' });
      audit.record({ entityType: 'PickingTask', entityId: task.id, requestNumber: task.request_number,
        action: 'ESCALATE', newValue: { level: 1, elapsedMin: Math.round(elapsedMin) }, sourceScreen: 'Scheduler' });
      actions.push({ task: task.id, action: 'ESCALATE_SUPERVISOR' });
    } else {
      const due = sla.reminders.filter((m) => elapsedMin >= m).length;
      if (due > task.reminder_count) {
        db.prepare("UPDATE picking_tasks SET reminder_count=?, last_reminder_at=datetime('now'), task_status='Reminder Sent', updated_at=datetime('now') WHERE id=?")
          .run(due, task.id);
        if (header) try { setHeaderStatus(header, HEADER_STATUS.REMINDER_SENT, { sourceScreen: 'Scheduler' }); } catch {}
        notify.send({ requestNumber: task.request_number, taskId: task.id, recipientUserId: task.assigned_picker_id,
          notificationType: 'TASK_REMINDER', title: `Reminder: accept picking task ${task.request_number}`,
          message: `Reminder ${due}: please accept your picking task.` });
        audit.record({ entityType: 'PickingTask', entityId: task.id, requestNumber: task.request_number,
          action: 'REMINDER', newValue: { reminder: due }, sourceScreen: 'Scheduler' });
        actions.push({ task: task.id, action: 'REMINDER', count: due });
      }
    }
  }
  return actions;
}

router.post('/sweep', requirePermission(['picker_assignment']), (req, res) => {
  const now = isPositiveNumber(req.body.testMinutes)
    ? Date.now() + Number(req.body.testMinutes) * 60000
    : Date.now();
  const actions = sweepReminders(now);
  res.json({ message: `Sweep processed ${actions.length} action(s).`, actions });
});

module.exports = router;
module.exports.sweepReminders = sweepReminders;
