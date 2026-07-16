/**
 * Stock reallocation — move batch stock between warehouses, bins and projects
 * with a full movement history (stock_reallocations) and ledger entries for
 * cross-warehouse moves. Partial quantities split the batch: the moved part
 * becomes a new batch row (same traceability data, own QR label).
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isId, isPositiveNumber, isNonEmptyString, parsePagination } = require('./../utils/validate');
const { sendError } = require('./../utils/errors');
const audit = require('./../services/audit');
const qrService = require('./../services/qr');
const { recordMovement } = require('./../services/ledger');
const { activeFreeze, freezeMessage } = require('./../services/freeze');

const router = express.Router();
router.use(authenticate, requirePermission(['reallocation', 'bin_batch_assignment']));

function nextReallocNumber() {
  const year = new Date().getFullYear();
  const n = db.prepare('SELECT COUNT(*) AS n FROM stock_reallocations WHERE realloc_number LIKE ?')
    .get(`RA-${year}-%`).n;
  return `RA-${year}-${String(n + 1).padStart(6, '0')}`;
}

/** GET /api/reallocation — movement history (paginated, searchable). */
router.get('/', (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { page: 1, limit: 50 });
  const q = (req.query.search || '').trim();
  const like = `%${q}%`;
  const where = q ? 'WHERE realloc_number LIKE ? OR material_code LIKE ? OR batch_number LIKE ?' : '';
  const params = q ? [like, like, like] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM stock_reallocations ${where}`).get(...params).n;
  const moves = db.prepare(`SELECT * FROM stock_reallocations ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  res.json({ moves, total, page, limit });
});

/**
 * POST /api/reallocation — move stock.
 * body: { batch_id, quantity, to_warehouse?, to_bin?, to_project?, reason? }
 * At least one of to_warehouse / to_bin / to_project must change something.
 * Reserved stock never moves: quantity is capped at remaining - reserved.
 */
router.post('/', (req, res) => {
  const b = req.body || {};
  if (!isId(b.batch_id)) return res.status(400).json({ error: 'A valid batch_id is required.' });
  if (!isPositiveNumber(b.quantity)) return res.status(400).json({ error: 'Quantity must be greater than zero.' });

  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(b.batch_id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });

  const qty = Number(b.quantity);
  const movable = batch.remaining_quantity - (batch.reserved_quantity || 0);
  if (qty > movable) {
    return res.status(400).json({
      error: `Only ${movable} of batch ${batch.batch_number} can move — ${batch.reserved_quantity || 0} `
        + 'is reserved for open picks and reserved stock never relocates.',
    });
  }

  const toWarehouse = isNonEmptyString(b.to_warehouse) ? b.to_warehouse.trim() : batch.warehouse_code;
  const toProject = b.to_project !== undefined ? (isNonEmptyString(b.to_project) ? b.to_project.trim() : null) : batch.project;

  // Validate target warehouse + bin against the master.
  const wh = db.prepare('SELECT * FROM warehouses WHERE warehouse_code=? AND is_active=1').get(toWarehouse);
  if (!wh) return res.status(400).json({ error: `Unknown warehouse '${toWarehouse}'.` });
  let toBin = batch.bin_location;
  if (b.to_bin !== undefined) {
    if (isNonEmptyString(b.to_bin)) {
      const bin = db.prepare(
        'SELECT bin_code FROM bin_locations WHERE warehouse_code=? AND (bin_code=? OR full_bin_location=?)'
      ).get(toWarehouse, b.to_bin.trim(), b.to_bin.trim());
      if (!bin) return res.status(400).json({ error: `Bin '${b.to_bin}' does not exist in warehouse ${toWarehouse}.` });
      toBin = bin.bin_code;
    } else {
      toBin = null;
    }
  } else if (toWarehouse !== batch.warehouse_code) {
    // Moving warehouses without naming a bin: the old bin is meaningless there.
    toBin = null;
  }

  const nothingChanges = toWarehouse === batch.warehouse_code
    && (toBin || null) === (batch.bin_location || null)
    && (toProject || null) === (batch.project || null);
  if (nothingChanges) {
    return res.status(400).json({ error: 'Nothing to move — target warehouse, bin and project all match the current values.' });
  }

  // Physical-inventory freeze blocks moves that touch a frozen warehouse.
  for (const code of new Set([batch.warehouse_code, toWarehouse])) {
    const freeze = activeFreeze(code);
    if (freeze) return res.status(400).json({ error: freezeMessage(freeze, code) });
  }

  const reallocNumber = nextReallocNumber();
  const isPartial = qty < batch.remaining_quantity;
  let newBatchId = null;

  const move = db.transaction(() => {
    if (isPartial) {
      // Split: moved quantity becomes a new batch row with its own QR.
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
        batch.shelf_life_period, batch.shelf_life_unit,
        qty, qty, toWarehouse, toBin, toProject,
        batch.quality_status, batch.fifo_date, batch.fefo_date);
      newBatchId = info.lastInsertRowid;
      const newBatch = db.prepare('SELECT * FROM batches WHERE id=?').get(newBatchId);
      const qrId = qrService.generateForBatch(newBatch, {});
      db.prepare('UPDATE batches SET qr_code_id=? WHERE id=?').run(qrId, newBatchId);
      db.prepare(`UPDATE batches SET remaining_quantity = remaining_quantity - ?,
        received_quantity = received_quantity - ?, updated_at=datetime('now') WHERE id=?`)
        .run(qty, qty, batch.id);
    } else {
      // Full move: relocate the batch in place and keep its QR in sync.
      db.prepare("UPDATE batches SET warehouse_code=?, bin_location=?, project=?, updated_at=datetime('now') WHERE id=?")
        .run(toWarehouse, toBin, toProject, batch.id);
      if (batch.qr_code_id) {
        db.prepare('UPDATE qr_codes SET warehouse_code=?, bin_location=? WHERE id=?')
          .run(toWarehouse, toBin, batch.qr_code_id);
      }
    }

    // Cross-warehouse moves hit the movement ledger (OUT source, IN target)
    // so per-warehouse consumption analytics stay truthful. Bin/project moves
    // inside one warehouse are net-zero and live in the history table only.
    if (toWarehouse !== batch.warehouse_code) {
      recordMovement({ type: 'OUT', materialId: batch.material_id, warehouseCode: batch.warehouse_code,
        quantity: qty, userId: req.user.id, notes: `Reallocation ${reallocNumber} to ${toWarehouse}` });
      recordMovement({ type: 'IN', materialId: batch.material_id, warehouseCode: toWarehouse,
        quantity: qty, userId: req.user.id, notes: `Reallocation ${reallocNumber} from ${batch.warehouse_code}` });
    }

    db.prepare(`
      INSERT INTO stock_reallocations
        (realloc_number, batch_id, new_batch_id, material_id, material_code, batch_number, quantity,
         from_warehouse, from_bin, from_project, to_warehouse, to_bin, to_project, reason, moved_by, moved_by_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(reallocNumber, batch.id, newBatchId, batch.material_id, batch.material_code, batch.batch_number, qty,
      batch.warehouse_code, batch.bin_location, batch.project, toWarehouse, toBin, toProject,
      b.reason || null, req.user.id, req.user.name);

    audit.record({ entityType: 'Batch', entityId: batch.id, action: 'STOCK_REALLOCATED',
      oldValue: { warehouse: batch.warehouse_code, bin: batch.bin_location, project: batch.project },
      newValue: { realloc: reallocNumber, qty, warehouse: toWarehouse, bin: toBin, project: toProject,
        split_batch_id: newBatchId },
      reason: b.reason, user: req.user, sourceScreen: 'Reallocation' });
  });
  try { move(); } catch (err) { return sendError(res, err); }

  res.status(201).json({
    message: `Reallocation ${reallocNumber} posted${isPartial ? ' (batch split)' : ''}.`,
    realloc_number: reallocNumber, new_batch_id: newBatchId,
    moved: { quantity: qty, to_warehouse: toWarehouse, to_bin: toBin, to_project: toProject },
  });
});

module.exports = router;
