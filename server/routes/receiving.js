/**
 * Goods Receipt & QR generation, plus the two follow-up steps and QR printing.
 *
 * Flow (per business rules):
 *  1. Receive         — material (dropdown), PO number (mandatory), quantity,
 *                        warehouse, supplier, shelf-life. Batch number is
 *                        auto-generated; GR number and bin are assigned later.
 *                        A QR label is generated immediately.
 *  2. Assign GR number — store ERP operator enters the ERP GR document number.
 *  3. Assign bin       — picker / dispatcher sets the bin location (dropdown).
 */
const express = require('express');
const crypto = require('crypto');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isId, isPositiveNumber, isNonEmptyString } = require('./../utils/validate');
const audit = require('./../services/audit');
const notify = require('./../services/notify');
const { withIdempotency } = require('./../middleware/idempotency');
const qrService = require('./../services/qr');
const { calcExpiry } = require('./../services/expiry');
const { streamLabelsPdf } = require('./../services/labels');
const { recordMovement } = require('./../services/ledger');
const { activeFreeze, freezeMessage } = require('./../services/freeze');

const router = express.Router();
router.use(authenticate);

function generateBatchNumber(itemCode) {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `B-${itemCode}-${ymd}-${rand}`;
}

function syncQr(batch) {
  if (!batch.qr_code_id) return;
  db.prepare('UPDATE qr_codes SET gr_number=?, bin_location=? WHERE id=?')
    .run(batch.gr_number, batch.bin_location, batch.qr_code_id);
}

router.post('/', requirePermission('goods_receipt'), withIdempotency('POST /api/receiving', (req, res) => {
  const b = req.body || {};
  if (!isId(b.material_id)) return res.status(400).json({ error: 'Material is required.' });
  if (!isPositiveNumber(b.received_quantity)) return res.status(400).json({ error: 'Received quantity must be greater than zero.' });
  if (!isNonEmptyString(b.warehouse_code)) return res.status(400).json({ error: 'Warehouse is required.' });
  if (!isNonEmptyString(b.po_number)) return res.status(400).json({ error: 'PO number is mandatory.' });

  const material = db.prepare('SELECT * FROM materials WHERE id=?').get(b.material_id);
  if (!material) return res.status(404).json({ error: 'Material not found.' });
  const wh = db.prepare('SELECT * FROM warehouses WHERE warehouse_code=?').get(b.warehouse_code);
  if (!wh) return res.status(404).json({ error: 'Warehouse not found.' });
  const freeze = activeFreeze(wh.warehouse_code);
  if (freeze) return res.status(400).json({ error: freezeMessage(freeze, wh.warehouse_code) });

  let expiry = b.expiry_date || null;
  const mfg = b.manufacturing_date || null;
  if (material.is_expiry_managed) {
    if (!expiry && mfg && (b.shelf_life_period || material.shelf_life_period)) {
      const period = b.shelf_life_period || material.shelf_life_period;
      const unit = b.shelf_life_unit || material.shelf_life_unit || 'MONTHS';
      const base = (material.expiry_calculation_rule === 'FROM_RECEIVING')
        ? (b.receiving_date || new Date().toISOString().slice(0, 10)) : mfg;
      expiry = calcExpiry(base, period, unit);
    }
    if (!expiry) return res.status(400).json({ error: 'Expiry date (or manufacturing date + shelf life) is required for this material.' });
  }

  let binLocation = null;
  if (isNonEmptyString(b.bin_location)) {
    const binRow = db.prepare(
      'SELECT bin_code FROM bin_locations WHERE warehouse_code=? AND (bin_code=? OR full_bin_location=?)'
    ).get(b.warehouse_code, b.bin_location.trim(), b.bin_location.trim());
    if (!binRow) return res.status(400).json({ error: `Bin '${b.bin_location}' does not exist in warehouse ${b.warehouse_code}.` });
    binLocation = binRow.bin_code;
  }

  const receivingDate = b.receiving_date || new Date().toISOString().slice(0, 10);
  const qty = Number(b.received_quantity);
  let batchNumber = generateBatchNumber(material.item_code);
  while (db.prepare('SELECT 1 FROM batches WHERE material_id=? AND batch_number=? AND warehouse_code=?')
    .get(material.id, batchNumber, b.warehouse_code)) {
    batchNumber = generateBatchNumber(material.item_code);
  }

  const create = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO batches
        (batch_number, material_id, material_code, material_description, supplier_code, supplier_name,
         po_number, gr_number, receiving_date, manufacturing_date, expiry_date, shelf_life_period, shelf_life_unit,
         received_quantity, remaining_quantity, warehouse_code, bin_location, quality_status, fifo_date, fefo_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(batchNumber, material.id, material.item_code, material.description,
      b.supplier_code || null, b.supplier_name || null, b.po_number.trim(), null,
      receivingDate, mfg, expiry, b.shelf_life_period || null, b.shelf_life_unit || null,
      qty, qty, b.warehouse_code, binLocation, 'QUALITY_HOLD', receivingDate, expiry);

    const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(info.lastInsertRowid);
    const qrId = qrService.generateForBatch(batch, { uom: material.unit });
    db.prepare('UPDATE batches SET qr_code_id=? WHERE id=?').run(qrId, batch.id);
    recordMovement({ type: 'IN', materialId: material.id, warehouseCode: b.warehouse_code,
      quantity: qty, userId: req.user.id, movementCategory: 'RECEIPT',
      notes: `GR batch ${batchNumber} (PO ${b.po_number.trim()})` });
    audit.record({ entityType: 'Batch', entityId: batch.id, action: 'GOODS_RECEIPT',
      newValue: { batch: batchNumber, qty, po: b.po_number, expiry, warehouse: b.warehouse_code, quality: 'QUALITY_HOLD' },
      user: req.user, sourceScreen: 'Goods Receipt' });
    return { batchId: batch.id, qrId };
  });

  const { batchId, qrId } = create();
  const qr = db.prepare('SELECT * FROM qr_codes WHERE id=?').get(qrId);
  notify.notifyRole('quality', {
    notificationType: 'QUALITY_INSPECTION_NEEDED',
    title: `Batch ${batchNumber} awaiting quality inspection`,
    message: `${material.item_code} — ${qty} ${material.unit} received into ${b.warehouse_code} (PO ${b.po_number.trim()}).`,
  });
  res.status(201).json({
    message: `Goods received. Batch ${batchNumber} created (quality hold) and QR generated.`,
    batch_id: batchId, batch_number: batchNumber, qr,
    warehouse_code: b.warehouse_code, bin_location: binLocation,
  });
}));

router.get('/pending-gr', requirePermission(['goods_receipt', 'erp_operator']), (req, res) => {
  const rows = db.prepare(`
    SELECT id, batch_number, material_code, material_description, po_number, warehouse_code,
           received_quantity, receiving_date, qr_code_id
    FROM batches WHERE gr_number IS NULL OR gr_number = '' ORDER BY id DESC
  `).all();
  res.json({ batches: rows });
});

router.patch('/batches/:id/gr', requirePermission(['goods_receipt', 'erp_operator']), (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });
  const { gr_number } = req.body || {};
  if (!isNonEmptyString(gr_number)) return res.status(400).json({ error: 'GR number is required.' });
  const oldGr = batch.gr_number;
  db.prepare("UPDATE batches SET gr_number=?, updated_at=datetime('now') WHERE id=?").run(gr_number.trim(), batch.id);
  batch.gr_number = gr_number.trim();
  syncQr(batch);
  audit.record({ entityType: 'Batch', entityId: batch.id, action: 'GR_NUMBER_SET',
    oldValue: oldGr, newValue: gr_number.trim(), user: req.user, sourceScreen: 'Goods Receipt' });
  res.json({ message: `GR number set for batch ${batch.batch_number}.` });
});

router.get('/pending-bin', requirePermission(['goods_receipt', 'picking']), (req, res) => {
  const rows = db.prepare(`
    SELECT id, batch_number, material_code, material_description, warehouse_code,
           remaining_quantity, gr_number, qr_code_id
    FROM batches WHERE (bin_location IS NULL OR bin_location = '') AND remaining_quantity > 0 ORDER BY id DESC
  `).all();
  res.json({ batches: rows });
});

router.patch('/batches/:id/bin', requirePermission(['goods_receipt', 'picking']), (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });
  const { bin_location } = req.body || {};
  if (!isNonEmptyString(bin_location)) return res.status(400).json({ error: 'Bin location is required.' });
  const bin = db.prepare('SELECT bin_code FROM bin_locations WHERE warehouse_code=? AND (bin_code=? OR full_bin_location=?)')
    .get(batch.warehouse_code, bin_location.trim(), bin_location.trim());
  if (!bin) return res.status(400).json({ error: `Bin '${bin_location}' does not exist in warehouse ${batch.warehouse_code}.` });
  db.prepare("UPDATE batches SET bin_location=?, updated_at=datetime('now') WHERE id=?").run(bin.bin_code, batch.id);
  batch.bin_location = bin.bin_code;
  syncQr(batch);
  audit.record({ entityType: 'Batch', entityId: batch.id, action: 'BIN_ASSIGNED',
    newValue: bin_location.trim(), user: req.user, sourceScreen: 'Goods Receipt' });
  res.json({ message: `Bin ${bin_location} assigned to batch ${batch.batch_number}.` });
});

/**
 * GET /api/receiving/batches/:id/traceability — one authenticated evidence view
 * for the batch, QR lifecycle, picking usage, reallocations, movement ledger and
 * append-only audit events. This endpoint is read-only and permission-gated.
 */
router.get('/batches/:id/traceability', requirePermission(['batch_tracking', 'goods_receipt', 'qr_printing', 'quality']), (req, res) => {
  const batch = db.prepare(`
    SELECT b.*, (b.remaining_quantity - b.reserved_quantity) AS available_quantity
    FROM batches b WHERE b.id=?
  `).get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });

  const qr = batch.qr_code_id
    ? db.prepare('SELECT * FROM qr_codes WHERE id=?').get(batch.qr_code_id)
    : null;
  const allocations = db.prepare(`
    SELECT pa.id, pa.request_id, pa.request_number, pa.line_id, pa.line_number,
           pa.warehouse_code, pa.bin_location, pa.proposed_quantity, pa.picked_quantity,
           pa.status, pa.scan_result, pa.scanned_qr_value, pa.created_at,
           l.material_code, l.line_status
    FROM picking_allocations pa
    LEFT JOIN material_request_lines l ON l.id=pa.line_id
    WHERE pa.batch_id=? ORDER BY pa.id DESC
  `).all(batch.id);
  const reallocations = db.prepare(`
    SELECT * FROM stock_reallocations
    WHERE batch_id=? OR new_batch_id=? ORDER BY id DESC
  `).all(batch.id, batch.id);
  const movements = db.prepare(`
    SELECT st.*, u.name AS user_name, l.code AS location_code
    FROM stock_transactions st
    LEFT JOIN users u ON u.id=st.user_id
    LEFT JOIN locations l ON l.id=st.location_id
    WHERE st.material_id=? AND st.notes LIKE ?
    ORDER BY st.id DESC
  `).all(batch.material_id, `%${batch.batch_number}%`);

  const auditFilters = [{ entity: 'Batch', id: batch.id }];
  if (qr) auditFilters.push({ entity: 'QRCode', id: qr.id });
  const auditWhere = auditFilters.map(() => '(entity_type=? AND entity_id=?)').join(' OR ');
  const auditParams = auditFilters.flatMap((x) => [x.entity, x.id]);
  const events = db.prepare(`
    SELECT id, entity_type, entity_id, request_number, line_number, action,
           old_value, new_value, reason, changed_by, changed_by_name,
           source_screen, changed_at
    FROM audit_trail WHERE ${auditWhere} ORDER BY id DESC
  `).all(...auditParams);

  res.json({
    batch,
    qr: qr ? { ...qr, pdf_path: `/api/receiving/qr/pdf?ids=${qr.id}` } : null,
    allocations,
    reallocations,
    movements,
    events,
    summary: {
      allocation_count: allocations.length,
      reallocation_count: reallocations.length,
      movement_count: movements.length,
      event_count: events.length,
      qr_print_count: qr?.print_count || 0,
      last_qr_scan_at: qr?.last_scanned_at || null,
    },
  });
});

router.get('/qr/pdf', requirePermission(['qr_printing', 'goods_receipt']), async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return res.status(400).json({ error: 'Provide ids=1,2,3 of the QR labels to print.' });
  const qrs = ids.map((id) => db.prepare('SELECT * FROM qr_codes WHERE id=?').get(id)).filter(Boolean);
  if (!qrs.length) return res.status(404).json({ error: 'No matching QR codes.' });

  qrs.forEach((qr) => {
    qrService.markPrinted(qr.id);
    audit.record({ entityType: 'QRCode', entityId: qr.id, action: qr.print_count > 0 ? 'QR_REPRINT' : 'QR_PRINT',
      newValue: { print_count: qr.print_count + 1, format: 'PDF' }, user: req.user, sourceScreen: 'QR Printing' });
  });
  try {
    await streamLabelsPdf(res, qrs);
  } catch (err) {
    console.error('PDF generation failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'PDF generation failed.' });
  }
});

router.get('/qr/:id', requirePermission(['goods_receipt', 'qr_printing']), (req, res) => {
  const qr = db.prepare('SELECT * FROM qr_codes WHERE id=?').get(req.params.id);
  if (!qr) return res.status(404).json({ error: 'QR not found.' });
  res.json({ qr });
});

router.get('/qr', requirePermission(['qr_printing', 'goods_receipt']), (req, res) => {
  const q = (req.query.search || '').trim();
  const like = `%${q}%`;
  const where = q ? 'WHERE material_code LIKE ? OR batch_number LIKE ? OR qr_code_value LIKE ?' : '';
  const params = q ? [like, like, like] : [];
  const rows = db.prepare(`SELECT * FROM qr_codes ${where} ORDER BY id DESC LIMIT 100`).all(...params);
  res.json({ qr_codes: rows });
});

router.post('/qr/:id/print', requirePermission(['qr_printing', 'goods_receipt']), (req, res) => {
  const qr = db.prepare('SELECT * FROM qr_codes WHERE id=?').get(req.params.id);
  if (!qr) return res.status(404).json({ error: 'QR not found.' });
  qrService.markPrinted(qr.id);
  audit.record({ entityType: 'QRCode', entityId: qr.id, action: qr.print_count > 0 ? 'QR_REPRINT' : 'QR_PRINT',
    newValue: { print_count: qr.print_count + 1 }, user: req.user, sourceScreen: 'QR Printing' });
  res.json({ message: 'QR print recorded.', print_count: qr.print_count + 1 });
});

module.exports = router;
