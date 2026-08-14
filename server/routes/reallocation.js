/**
 * Governed stock reallocation workflow.
 *
 * Flow:
 *  1. Requester creates a mandatory-reason reallocation request.
 *  2. A different authorised user approves or rejects it (SoD).
 *  3. An authorised executor posts the approved move. Execution revalidates
 *     stock, reservations, target master data and inventory freezes.
 *
 * Safe replay rules:
 *  - Approving an already approved/executed request is idempotent.
 *  - Rejecting an already rejected request is idempotent.
 *  - Executing an already executed request returns the recorded result and
 *    never moves stock twice.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isId, isPositiveNumber, isNonEmptyString, parsePagination } = require('./../utils/validate');
const { sendError } = require('./../utils/errors');
const audit = require('./../services/audit');
const notify = require('./../services/notify');
const qrService = require('./../services/qr');
const { recordMovement } = require('./../services/ledger');
const { activeFreeze, freezeMessage } = require('./../services/freeze');

const router = express.Router();
router.use(authenticate);

function nextReallocNumber() {
  const year = new Date().getFullYear();
  const n = db.prepare('SELECT COUNT(*) AS n FROM stock_reallocations WHERE realloc_number LIKE ?')
    .get(`RA-${year}-%`).n;
  return `RA-${year}-${String(n + 1).padStart(6, '0')}`;
}

function getMove(id) {
  return db.prepare('SELECT * FROM stock_reallocations WHERE id=?').get(id);
}

function validateTarget(batch, body) {
  const toWarehouse = isNonEmptyString(body.to_warehouse) ? body.to_warehouse.trim() : batch.warehouse_code;
  const toProject = body.to_project !== undefined
    ? (isNonEmptyString(body.to_project) ? body.to_project.trim() : null)
    : batch.project;

  const wh = db.prepare('SELECT warehouse_code FROM warehouses WHERE warehouse_code=? AND is_active=1').get(toWarehouse);
  if (!wh) return { error: `Unknown warehouse '${toWarehouse}'.` };

  let toBin = batch.bin_location;
  if (body.to_bin !== undefined) {
    if (isNonEmptyString(body.to_bin)) {
      const bin = db.prepare(
        'SELECT bin_code FROM bin_locations WHERE warehouse_code=? AND (bin_code=? OR full_bin_location=?)'
      ).get(toWarehouse, body.to_bin.trim(), body.to_bin.trim());
      if (!bin) return { error: `Bin '${body.to_bin}' does not exist in warehouse ${toWarehouse}.` };
      toBin = bin.bin_code;
    } else {
      toBin = null;
    }
  } else if (toWarehouse !== batch.warehouse_code) {
    toBin = null;
  }

  const nothingChanges = toWarehouse === batch.warehouse_code
    && (toBin || null) === (batch.bin_location || null)
    && (toProject || null) === (batch.project || null);
  if (nothingChanges) return { error: 'Nothing to move — target warehouse, bin and project all match the current values.' };

  return { toWarehouse, toBin, toProject };
}

/** GET /api/reallocation — governed request/movement history. */
router.get('/', requirePermission(['reallocation', 'bin_batch_assignment']), (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { page: 1, limit: 50 });
  const q = (req.query.search || '').trim();
  const status = (req.query.status || '').trim().toUpperCase();
  const clauses = [];
  const params = [];
  if (q) {
    const like = `%${q}%`;
    clauses.push('(realloc_number LIKE ? OR material_code LIKE ? OR batch_number LIKE ?)');
    params.push(like, like, like);
  }
  if (status) {
    clauses.push('status=?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM stock_reallocations ${where}`).get(...params).n;
  const moves = db.prepare(`SELECT * FROM stock_reallocations ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  res.json({ moves, total, page, limit });
});

/** GET /api/reallocation/:id — one request with current source-batch state. */
router.get('/:id', requirePermission(['reallocation', 'bin_batch_assignment']), (req, res) => {
  const move = getMove(req.params.id);
  if (!move) return res.status(404).json({ error: 'Reallocation request not found.' });
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(move.batch_id) || null;
  res.json({ move, batch });
});

/** POST /api/reallocation — create a pending request; stock is not moved here. */
router.post('/', requirePermission('reallocation'), (req, res) => {
  const b = req.body || {};
  if (!isId(b.batch_id)) return res.status(400).json({ error: 'A valid batch_id is required.' });
  if (!isPositiveNumber(b.quantity)) return res.status(400).json({ error: 'Quantity must be greater than zero.' });
  if (!isNonEmptyString(b.reason)) return res.status(400).json({ error: 'A business reason is required.' });

  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(b.batch_id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });
  const qty = Number(b.quantity);
  const movable = Number(batch.remaining_quantity) - Number(batch.reserved_quantity || 0);
  if (qty > movable) {
    return res.status(400).json({
      error: `Only ${movable} of batch ${batch.batch_number} can move — ${batch.reserved_quantity || 0} is reserved.`,
    });
  }

  const target = validateTarget(batch, b);
  if (target.error) return res.status(400).json({ error: target.error });
  for (const code of new Set([batch.warehouse_code, target.toWarehouse])) {
    const freeze = activeFreeze(code);
    if (freeze) return res.status(400).json({ error: freezeMessage(freeze, code) });
  }

  const reallocNumber = nextReallocNumber();
  let id;
  try {
    id = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO stock_reallocations
          (realloc_number, batch_id, material_id, material_code, batch_number, quantity,
           from_warehouse, from_bin, from_project, to_warehouse, to_bin, to_project, reason,
           status, requested_by, requested_by_name, requested_at, moved_by, moved_by_name, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING_APPROVAL',?,?,datetime('now'),?,?,datetime('now'),datetime('now'))
      `).run(reallocNumber, batch.id, batch.material_id, batch.material_code, batch.batch_number, qty,
        batch.warehouse_code, batch.bin_location, batch.project,
        target.toWarehouse, target.toBin, target.toProject, b.reason.trim(),
        req.user.id, req.user.name, req.user.id, req.user.name);
      audit.record({ entityType: 'StockReallocation', entityId: info.lastInsertRowid, action: 'REALLOCATION_REQUESTED',
        newValue: { realloc: reallocNumber, batch_id: batch.id, qty, from_warehouse: batch.warehouse_code,
          to_warehouse: target.toWarehouse, to_bin: target.toBin, to_project: target.toProject },
        reason: b.reason.trim(), user: req.user, sourceScreen: 'Reallocation' });
      return info.lastInsertRowid;
    })();
  } catch (err) { return sendError(res, err); }

  notify.notifyPermission('bin_batch_assignment', {
    notificationType: 'REALLOCATION_APPROVAL_REQUIRED',
    title: `Reallocation ${reallocNumber} requires approval`,
    message: `${batch.material_code} · ${qty} from ${batch.warehouse_code} to ${target.toWarehouse}.`,
  });
  res.status(201).json({
    message: `Reallocation ${reallocNumber} submitted for approval.`,
    id, realloc_number: reallocNumber, status: 'PENDING_APPROVAL',
  });
});

/** POST /api/reallocation/:id/approve — SoD approval. */
router.post('/:id/approve', requirePermission('bin_batch_assignment'), (req, res) => {
  const move = getMove(req.params.id);
  if (!move) return res.status(404).json({ error: 'Reallocation request not found.' });
  if (['APPROVED', 'EXECUTING', 'EXECUTED'].includes(move.status)) {
    return res.json({ message: `Reallocation ${move.realloc_number} is already approved.`, status: move.status, idempotent: true });
  }
  if (move.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: `Cannot approve a ${move.status} request.` });
  if (Number(move.requested_by) === Number(req.user.id)) {
    return res.status(403).json({ error: 'Segregation of duties: the requester cannot approve their own reallocation.' });
  }

  const changed = db.prepare(`UPDATE stock_reallocations SET status='APPROVED', approved_by=?, approved_by_name=?,
    approved_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='PENDING_APPROVAL'`)
    .run(req.user.id, req.user.name, move.id);
  if (!changed.changes) return res.status(409).json({ error: 'The request state changed. Refresh and try again.' });
  audit.record({ entityType: 'StockReallocation', entityId: move.id, action: 'REALLOCATION_APPROVED',
    newValue: { realloc: move.realloc_number }, user: req.user, sourceScreen: 'Reallocation Approval' });
  notify.send({ recipientUserId: move.requested_by, notificationType: 'REALLOCATION_APPROVED',
    title: `Reallocation ${move.realloc_number} approved`, message: 'The request is ready for execution.' });
  res.json({ message: `Reallocation ${move.realloc_number} approved.`, status: 'APPROVED' });
});

/** POST /api/reallocation/:id/reject — SoD rejection with mandatory reason. */
router.post('/:id/reject', requirePermission('bin_batch_assignment'), (req, res) => {
  const move = getMove(req.params.id);
  if (!move) return res.status(404).json({ error: 'Reallocation request not found.' });
  const reason = req.body && req.body.reason;
  if (!isNonEmptyString(reason)) return res.status(400).json({ error: 'Rejection reason is required.' });
  if (move.status === 'REJECTED') {
    return res.json({ message: `Reallocation ${move.realloc_number} is already rejected.`, status: 'REJECTED', idempotent: true });
  }
  if (move.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: `Cannot reject a ${move.status} request.` });
  if (Number(move.requested_by) === Number(req.user.id)) {
    return res.status(403).json({ error: 'Segregation of duties: the requester cannot reject their own reallocation.' });
  }
  const changed = db.prepare(`UPDATE stock_reallocations SET status='REJECTED', rejected_by=?, rejected_by_name=?,
    rejected_at=datetime('now'), rejection_reason=?, updated_at=datetime('now')
    WHERE id=? AND status='PENDING_APPROVAL'`).run(req.user.id, req.user.name, reason.trim(), move.id);
  if (!changed.changes) return res.status(409).json({ error: 'The request state changed. Refresh and try again.' });
  audit.record({ entityType: 'StockReallocation', entityId: move.id, action: 'REALLOCATION_REJECTED',
    reason: reason.trim(), newValue: { realloc: move.realloc_number }, user: req.user, sourceScreen: 'Reallocation Approval' });
  notify.send({ recipientUserId: move.requested_by, notificationType: 'REALLOCATION_REJECTED',
    title: `Reallocation ${move.realloc_number} rejected`, message: reason.trim() });
  res.json({ message: `Reallocation ${move.realloc_number} rejected.`, status: 'REJECTED' });
});

/** POST /api/reallocation/:id/execute — atomically post an approved move. */
router.post('/:id/execute', requirePermission('bin_batch_assignment'), (req, res) => {
  const initial = getMove(req.params.id);
  if (!initial) return res.status(404).json({ error: 'Reallocation request not found.' });
  if (initial.status === 'EXECUTED') {
    return res.json({ message: `Reallocation ${initial.realloc_number} was already executed.`, status: 'EXECUTED',
      new_batch_id: initial.new_batch_id, idempotent: true });
  }
  if (initial.status !== 'APPROVED') return res.status(409).json({ error: `Only APPROVED requests can execute (current: ${initial.status}).` });

  let result;
  const execute = db.transaction(() => {
    const move = getMove(initial.id);
    if (move.status === 'EXECUTED') return { idempotent: true, newBatchId: move.new_batch_id };
    if (move.status !== 'APPROVED') throw Object.assign(new Error(`Request state changed to ${move.status}.`), { status: 409 });
    const claim = db.prepare("UPDATE stock_reallocations SET status='EXECUTING', execution_error=NULL, updated_at=datetime('now') WHERE id=? AND status='APPROVED'")
      .run(move.id);
    if (!claim.changes) throw Object.assign(new Error('Execution was already claimed.'), { status: 409 });

    const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(move.batch_id);
    if (!batch) throw Object.assign(new Error('Source batch no longer exists.'), { status: 409 });
    const qty = Number(move.quantity);
    const movable = Number(batch.remaining_quantity) - Number(batch.reserved_quantity || 0);
    if (qty > movable) throw Object.assign(new Error(`Only ${movable} is now movable; stock or reservations changed after approval.`), { status: 409 });

    const target = validateTarget(batch, { to_warehouse: move.to_warehouse, to_bin: move.to_bin, to_project: move.to_project });
    if (target.error) throw Object.assign(new Error(target.error), { status: 409 });
    for (const code of new Set([batch.warehouse_code, target.toWarehouse])) {
      const freeze = activeFreeze(code);
      if (freeze) throw Object.assign(new Error(freezeMessage(freeze, code)), { status: 409 });
    }

    const isPartial = qty < Number(batch.remaining_quantity);
    let newBatchId = null;
    if (isPartial) {
      const suffix = db.prepare('SELECT COUNT(*) AS n FROM stock_reallocations WHERE batch_id=? AND new_batch_id IS NOT NULL')
        .get(batch.id).n + 1;
      const newNumber = `${batch.batch_number}/R${suffix}`;
      const info = db.prepare(`
        INSERT INTO batches
          (batch_number, material_id, material_code, material_description, supplier_code, supplier_name,
           po_number, gr_number, receiving_date, manufacturing_date, expiry_date, shelf_life_period, shelf_life_unit,
           received_quantity, remaining_quantity, reserved_quantity, warehouse_code, bin_location, project,
           quality_status, fifo_date, fefo_date)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)
      `).run(newNumber, batch.material_id, batch.material_code, batch.material_description,
        batch.supplier_code, batch.supplier_name, batch.po_number, batch.gr_number,
        batch.receiving_date, batch.manufacturing_date, batch.expiry_date,
        batch.shelf_life_period, batch.shelf_life_unit, qty, qty,
        target.toWarehouse, target.toBin, target.toProject, batch.quality_status, batch.fifo_date, batch.fefo_date);
      newBatchId = info.lastInsertRowid;
      const newBatch = db.prepare('SELECT * FROM batches WHERE id=?').get(newBatchId);
      const qrId = qrService.generateForBatch(newBatch, {});
      db.prepare('UPDATE batches SET qr_code_id=? WHERE id=?').run(qrId, newBatchId);
      const reduced = db.prepare(`UPDATE batches SET remaining_quantity=remaining_quantity-?,
        received_quantity=received_quantity-?, updated_at=datetime('now')
        WHERE id=? AND remaining_quantity-(reserved_quantity) >= ?`).run(qty, qty, batch.id, qty);
      if (!reduced.changes) throw Object.assign(new Error('Source stock changed during execution.'), { status: 409 });
    } else {
      const moved = db.prepare(`UPDATE batches SET warehouse_code=?, bin_location=?, project=?, updated_at=datetime('now')
        WHERE id=? AND remaining_quantity-(reserved_quantity) >= ?`).run(target.toWarehouse, target.toBin, target.toProject, batch.id, qty);
      if (!moved.changes) throw Object.assign(new Error('Source stock changed during execution.'), { status: 409 });
      if (batch.qr_code_id) {
        db.prepare('UPDATE qr_codes SET warehouse_code=?, bin_location=? WHERE id=?')
          .run(target.toWarehouse, target.toBin, batch.qr_code_id);
      }
    }

    if (target.toWarehouse !== batch.warehouse_code) {
      recordMovement({ type: 'OUT', materialId: batch.material_id, warehouseCode: batch.warehouse_code,
        quantity: qty, userId: req.user.id, movementCategory: 'TRANSFER_OUT',
        notes: `Reallocation ${move.realloc_number} to ${target.toWarehouse}` });
      recordMovement({ type: 'IN', materialId: batch.material_id, warehouseCode: target.toWarehouse,
        quantity: qty, userId: req.user.id, movementCategory: 'TRANSFER_IN',
        notes: `Reallocation ${move.realloc_number} from ${batch.warehouse_code}` });
    }

    db.prepare(`UPDATE stock_reallocations SET status='EXECUTED', new_batch_id=?, moved_by=?, moved_by_name=?,
      executed_by=?, executed_by_name=?, executed_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='EXECUTING'`)
      .run(newBatchId, req.user.id, req.user.name, req.user.id, req.user.name, move.id);
    audit.record({ entityType: 'StockReallocation', entityId: move.id, action: 'REALLOCATION_EXECUTED',
      oldValue: { warehouse: batch.warehouse_code, bin: batch.bin_location, project: batch.project },
      newValue: { realloc: move.realloc_number, qty, warehouse: target.toWarehouse, bin: target.toBin,
        project: target.toProject, split_batch_id: newBatchId }, reason: move.reason,
      user: req.user, sourceScreen: 'Reallocation Execution' });
    return { idempotent: false, newBatchId, isPartial };
  });

  try {
    result = execute();
  } catch (err) {
    try {
      db.prepare("UPDATE stock_reallocations SET execution_error=?, updated_at=datetime('now') WHERE id=? AND status='APPROVED'")
        .run(err.message, initial.id);
    } catch (_) { /* preserve original error */ }
    return sendError(res, err);
  }

  const finalMove = getMove(initial.id);
  notify.send({ recipientUserId: finalMove.requested_by, notificationType: 'REALLOCATION_EXECUTED',
    title: `Reallocation ${finalMove.realloc_number} executed`,
    message: `${finalMove.quantity} of ${finalMove.material_code} moved to ${finalMove.to_warehouse}.` });
  res.json({ message: `Reallocation ${finalMove.realloc_number} executed${result.isPartial ? ' (batch split)' : ''}.`,
    status: 'EXECUTED', new_batch_id: result.newBatchId, idempotent: result.idempotent });
});

module.exports = router;
