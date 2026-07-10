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
 *
 * This is the foundation for the future full receiving/putaway phase and is
 * kept modular so PO receiving can extend it without workflow changes.
 */
const express = require('express');
const crypto = require('crypto');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isId, isPositiveNumber, isNonEmptyString } = require('./../utils/validate');
const audit = require('./../services/audit');
const qrService = require('./../services/qr');
const { calcExpiry } = require('./../services/expiry');

const router = express.Router();
router.use(authenticate);

/** Auto-generate a unique batch number: B-<ITEMCODE>-<YYMMDD>-<RAND>. */
function generateBatchNumber(itemCode) {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `B-${itemCode}-${ymd}-${rand}`;
}

/** Keep the QR label row in sync when GR number / bin are assigned later. */
function syncQr(batch) {
  if (!batch.qr_code_id) return;
  db.prepare('UPDATE qr_codes SET gr_number=?, bin_location=? WHERE id=?')
    .run(batch.gr_number, batch.bin_location, batch.qr_code_id);
}

/**
 * POST /api/receiving — receive stock into an auto-numbered batch + generate QR.
 * PO number is mandatory. GR number and bin are assigned in later steps.
 */
router.post('/', requirePermission('goods_receipt'), (req, res) => {
  const b = req.body || {};
  if (!isId(b.material_id)) return res.status(400).json({ error: 'Material is required.' });
  if (!isPositiveNumber(b.received_quantity)) return res.status(400).json({ error: 'Received quantity must be greater than zero.' });
  if (!isNonEmptyString(b.warehouse_code)) return res.status(400).json({ error: 'Warehouse is required.' });
  if (!isNonEmptyString(b.po_number)) return res.status(400).json({ error: 'PO number is mandatory.' });

  const material = db.prepare('SELECT * FROM materials WHERE id=?').get(b.material_id);
  if (!material) return res.status(404).json({ error: 'Material not found.' });
  const wh = db.prepare('SELECT * FROM warehouses WHERE warehouse_code=?').get(b.warehouse_code);
  if (!wh) return res.status(404).json({ error: 'Warehouse not found.' });

  // Expiry resolution (three shelf-life options).
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

  const receivingDate = b.receiving_date || new Date().toISOString().slice(0, 10);
  const qty = Number(b.received_quantity);
  // Auto batch number (retry on the rare collision).
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
      qty, qty, b.warehouse_code, null, b.quality_status || 'RELEASED', receivingDate, expiry);

    const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(info.lastInsertRowid);
    const qrId = qrService.generateForBatch(batch, { uom: material.unit });
    db.prepare('UPDATE batches SET qr_code_id=? WHERE id=?').run(qrId, batch.id);

    audit.record({ entityType: 'Batch', entityId: batch.id, action: 'GOODS_RECEIPT',
      newValue: { batch: batchNumber, qty, po: b.po_number, expiry, warehouse: b.warehouse_code },
      user: req.user, sourceScreen: 'Goods Receipt' });
    return { batchId: batch.id, qrId };
  });

  const { batchId, qrId } = create();
  const qr = db.prepare('SELECT * FROM qr_codes WHERE id=?').get(qrId);
  res.status(201).json({ message: `Goods received. Batch ${batchNumber} created and QR generated.`, batch_id: batchId, batch_number: batchNumber, qr });
});

// --- Step 2: assign GR number (store ERP operator) --------------------------
/** GET /api/receiving/pending-gr — received batches still missing a GR number. */
router.get('/pending-gr', requirePermission(['goods_receipt', 'erp_operator']), (req, res) => {
  const rows = db.prepare(`
    SELECT id, batch_number, material_code, material_description, po_number, warehouse_code,
           received_quantity, receiving_date, qr_code_id
    FROM batches WHERE gr_number IS NULL OR gr_number = '' ORDER BY id DESC
  `).all();
  res.json({ batches: rows });
});

/** PATCH /api/receiving/batches/:id/gr — set the GR document number. */
router.patch('/batches/:id/gr', requirePermission(['goods_receipt', 'erp_operator']), (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });
  const { gr_number } = req.body || {};
  if (!isNonEmptyString(gr_number)) return res.status(400).json({ error: 'GR number is required.' });
  db.prepare("UPDATE batches SET gr_number=?, updated_at=datetime('now') WHERE id=?").run(gr_number.trim(), batch.id);
  batch.gr_number = gr_number.trim();
  syncQr(batch);
  audit.record({ entityType: 'Batch', entityId: batch.id, action: 'GR_NUMBER_SET',
    oldValue: batch.gr_number, newValue: gr_number.trim(), user: req.user, sourceScreen: 'Goods Receipt' });
  res.json({ message: `GR number set for batch ${batch.batch_number}.` });
});

// --- Step 3: assign bin (picker / dispatcher) -------------------------------
/** GET /api/receiving/pending-bin — batches with stock but no bin yet. */
router.get('/pending-bin', requirePermission(['goods_receipt', 'picking']), (req, res) => {
  const rows = db.prepare(`
    SELECT id, batch_number, material_code, material_description, warehouse_code,
           remaining_quantity, gr_number, qr_code_id
    FROM batches WHERE (bin_location IS NULL OR bin_location = '') AND remaining_quantity > 0 ORDER BY id DESC
  `).all();
  res.json({ batches: rows });
});

/** PATCH /api/receiving/batches/:id/bin — set the bin (validated against warehouse). */
router.patch('/batches/:id/bin', requirePermission(['goods_receipt', 'picking']), (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });
  const { bin_location } = req.body || {};
  if (!isNonEmptyString(bin_location)) return res.status(400).json({ error: 'Bin location is required.' });
  const bin = db.prepare('SELECT 1 FROM bin_locations WHERE warehouse_code=? AND (bin_code=? OR full_bin_location=?)')
    .get(batch.warehouse_code, bin_location.trim(), bin_location.trim());
  if (!bin) return res.status(400).json({ error: `Bin '${bin_location}' does not exist in warehouse ${batch.warehouse_code}.` });
  db.prepare("UPDATE batches SET bin_location=?, updated_at=datetime('now') WHERE id=?").run(bin_location.trim(), batch.id);
  batch.bin_location = bin_location.trim();
  syncQr(batch);
  audit.record({ entityType: 'Batch', entityId: batch.id, action: 'BIN_ASSIGNED',
    newValue: bin_location.trim(), user: req.user, sourceScreen: 'Goods Receipt' });
  res.json({ message: `Bin ${bin_location} assigned to batch ${batch.batch_number}.` });
});

// --- QR printing ------------------------------------------------------------
/** GET /api/receiving/qr/:id — QR detail for printing. */
router.get('/qr/:id', requirePermission(['goods_receipt', 'qr_printing']), (req, res) => {
  const qr = db.prepare('SELECT * FROM qr_codes WHERE id=?').get(req.params.id);
  if (!qr) return res.status(404).json({ error: 'QR not found.' });
  res.json({ qr });
});

/** GET /api/receiving/qr — list QR codes for the printing screen. */
router.get('/qr', requirePermission('qr_printing'), (req, res) => {
  const q = (req.query.search || '').trim();
  const like = `%${q}%`;
  const where = q ? 'WHERE material_code LIKE ? OR batch_number LIKE ? OR qr_code_value LIKE ?' : '';
  const params = q ? [like, like, like] : [];
  const rows = db.prepare(`SELECT * FROM qr_codes ${where} ORDER BY id DESC LIMIT 100`).all(...params);
  res.json({ qr_codes: rows });
});

/** POST /api/receiving/qr/:id/print — record a print / reprint (audited). */
router.post('/qr/:id/print', requirePermission('qr_printing'), (req, res) => {
  const qr = db.prepare('SELECT * FROM qr_codes WHERE id=?').get(req.params.id);
  if (!qr) return res.status(404).json({ error: 'QR not found.' });
  qrService.markPrinted(qr.id);
  audit.record({ entityType: 'QRCode', entityId: qr.id, action: qr.print_count > 0 ? 'QR_REPRINT' : 'QR_PRINT',
    newValue: { print_count: qr.print_count + 1 }, user: req.user, sourceScreen: 'QR Printing' });
  res.json({ message: 'QR print recorded.', print_count: qr.print_count + 1 });
});

module.exports = router;
