/**
 * Goods Receipt & QR generation. Receiving a supplier delivery creates a batch
 * (mandatory batch number), computes/accepts expiry, and generates a QR label
 * embedding full traceability data. Also handles QR reprint (with print count).
 *
 * This is the foundation for the future full receiving/putaway phase; it is kept
 * modular so procurement/PO receiving can extend it without workflow changes.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isId, isPositiveNumber, isNonEmptyString } = require('./../utils/validate');
const audit = require('./../services/audit');
const qrService = require('./../services/qr');
const { calcExpiry } = require('./../services/expiry');

const router = express.Router();
router.use(authenticate);

/**
 * POST /api/receiving — receive stock into a batch + generate QR.
 * Handles the three shelf-life options: (1) mfg date + shelf life -> calc expiry,
 * (2) explicit expiry date, (3) not shelf-life managed.
 */
router.post('/', requirePermission('goods_receipt'), (req, res) => {
  const b = req.body || {};
  if (!isId(b.material_id)) return res.status(400).json({ error: 'Material is required.' });
  if (!isNonEmptyString(b.batch_number)) return res.status(400).json({ error: 'Batch number is mandatory for received materials.' });
  if (!isPositiveNumber(b.received_quantity)) return res.status(400).json({ error: 'Received quantity must be greater than zero.' });
  if (!isNonEmptyString(b.warehouse_code)) return res.status(400).json({ error: 'Warehouse is required.' });

  const material = db.prepare('SELECT * FROM materials WHERE id=?').get(b.material_id);
  if (!material) return res.status(404).json({ error: 'Material not found.' });
  const wh = db.prepare('SELECT * FROM warehouses WHERE warehouse_code=?').get(b.warehouse_code);
  if (!wh) return res.status(404).json({ error: 'Warehouse not found.' });

  // Expiry resolution.
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

  const create = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO batches
        (batch_number, material_id, material_code, material_description, supplier_code, supplier_name,
         po_number, gr_number, receiving_date, manufacturing_date, expiry_date, shelf_life_period, shelf_life_unit,
         received_quantity, remaining_quantity, warehouse_code, bin_location, quality_status, fifo_date, fefo_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(material_id, batch_number, warehouse_code) DO UPDATE SET
        remaining_quantity = remaining_quantity + excluded.received_quantity,
        received_quantity = received_quantity + excluded.received_quantity,
        updated_at = datetime('now')
    `).run(b.batch_number.trim(), material.id, material.item_code, material.description,
      b.supplier_code || null, b.supplier_name || null, b.po_number || null, b.gr_number || null,
      receivingDate, mfg, expiry, b.shelf_life_period || null, b.shelf_life_unit || null,
      qty, qty, b.warehouse_code, b.bin_location || null,
      b.quality_status || 'RELEASED', receivingDate, expiry);

    const batch = db.prepare('SELECT * FROM batches WHERE material_id=? AND batch_number=? AND warehouse_code=?')
      .get(material.id, b.batch_number.trim(), b.warehouse_code);

    // Generate QR (or reuse existing for this batch).
    let qrId = batch.qr_code_id;
    if (!qrId) {
      qrId = qrService.generateForBatch(batch, { uom: material.unit });
      db.prepare('UPDATE batches SET qr_code_id=? WHERE id=?').run(qrId, batch.id);
    }

    // Keep material_location_stock in sync if the bin maps to a stock location.
    audit.record({ entityType: 'Batch', entityId: batch.id, action: 'GOODS_RECEIPT',
      newValue: { batch: batch.batch_number, qty, expiry, warehouse: b.warehouse_code, bin: b.bin_location },
      user: req.user, sourceScreen: 'Goods Receipt' });
    return { batchId: batch.id, qrId };
  });

  const { batchId, qrId } = create();
  const qr = db.prepare('SELECT * FROM qr_codes WHERE id=?').get(qrId);
  res.status(201).json({ message: 'Goods received and QR generated.', batch_id: batchId, qr });
});

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
