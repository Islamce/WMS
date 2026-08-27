/**
 * Subcontractor material receiving — a deliberately SAP-free stream for
 * materials subcontractors bring onto a site/project warehouse. No item code,
 * no material master, no ERP posting: just description/qty/category, a
 * quality inspection step, and a receipt into a local on-hand view.
 *
 * Flow: Site Warehouse Supervisor logs the delivery with its details →
 * Site Quality Supervisor inspects each line → an Approved / Approved with
 * Remarks decision posts that quantity into stock in the same step (no
 * separate manual "receive" action — the quality decision *is* the receipt).
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isNonEmptyString, isId, parsePagination } = require('./../utils/validate');
const audit = require('./../services/audit');

const router = express.Router();
router.use(authenticate);

const QUALITY_STATUSES = ['Pending', 'Approved', 'Approved with Remarks', 'Rejected'];

// --- Subcontractors ----------------------------------------------------------
router.get('/subcontractors', requirePermission(['subcontractor_admin', 'subcontractor_quality_inspection', 'subcontractor_receiving']), (req, res) => {
  const rows = db.prepare('SELECT * FROM subcontractors WHERE is_active=1 ORDER BY name').all();
  res.json({ subcontractors: rows });
});

router.post('/subcontractors', requirePermission('subcontractor_admin'), (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.name)) return res.status(400).json({ error: 'Subcontractor name is required.' });
  const info = db.prepare(`INSERT INTO subcontractors (name, trade_category, contract_reference, contact_name, contact_phone, created_by)
    VALUES (?,?,?,?,?,?)`).run(b.name.trim(), b.trade_category || null, b.contract_reference || null,
    b.contact_name || null, b.contact_phone || null, req.user.id);
  audit.record({ entityType: 'Subcontractor', entityId: info.lastInsertRowid, action: 'CREATE', newValue: b.name, user: req.user, sourceScreen: 'Subcontractors' });
  res.status(201).json({ message: 'Subcontractor created.', id: info.lastInsertRowid });
});

router.patch('/subcontractors/:id', requirePermission('subcontractor_admin'), (req, res) => {
  const row = db.prepare('SELECT * FROM subcontractors WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Subcontractor not found.' });
  const b = req.body || {};
  db.prepare(`UPDATE subcontractors SET name=?, trade_category=?, contract_reference=?, contact_name=?, contact_phone=?, is_active=? WHERE id=?`)
    .run(isNonEmptyString(b.name) ? b.name.trim() : row.name, b.trade_category ?? row.trade_category,
      b.contract_reference ?? row.contract_reference, b.contact_name ?? row.contact_name,
      b.contact_phone ?? row.contact_phone, b.is_active != null ? (b.is_active ? 1 : 0) : row.is_active, row.id);
  audit.record({ entityType: 'Subcontractor', entityId: row.id, action: 'UPDATE', oldValue: row.name, newValue: b.name || row.name, user: req.user, sourceScreen: 'Subcontractors' });
  res.json({ message: 'Subcontractor updated.' });
});

// --- Categories ---------------------------------------------------------------
router.get('/categories', requirePermission(['subcontractor_admin', 'subcontractor_quality_inspection', 'subcontractor_receiving']), (req, res) => {
  res.json({ categories: db.prepare('SELECT * FROM subcontractor_categories WHERE is_active=1 ORDER BY name').all() });
});

router.post('/categories', requirePermission('subcontractor_admin'), (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.name)) return res.status(400).json({ error: 'Category name is required.' });
  if (db.prepare('SELECT 1 FROM subcontractor_categories WHERE name=?').get(b.name.trim())) {
    return res.status(409).json({ error: 'Category already exists.' });
  }
  const info = db.prepare('INSERT INTO subcontractor_categories (name, created_by) VALUES (?, ?)').run(b.name.trim(), req.user.id);
  res.status(201).json({ message: 'Category created.', id: info.lastInsertRowid });
});

// --- Deliveries (log + quality inspection) ------------------------------------
router.get('/deliveries', requirePermission(['subcontractor_quality_inspection', 'subcontractor_receiving', 'subcontractor_admin']), (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { page: 1, limit: 20 });
  const filters = [];
  const params = [];
  if (req.query.warehouse_code) { filters.push('d.warehouse_code = ?'); params.push(req.query.warehouse_code); }
  if (req.query.status) { filters.push('d.status = ?'); params.push(req.query.status); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM subcontractor_deliveries d ${where}`).get(...params).n;
  const rows = db.prepare(`
    SELECT d.*, s.name AS subcontractor_name,
      (SELECT COUNT(*) FROM subcontractor_delivery_lines l WHERE l.delivery_id = d.id) AS line_count,
      (SELECT COUNT(*) FROM subcontractor_delivery_lines l WHERE l.delivery_id = d.id AND l.quality_status = 'Pending') AS pending_lines
    FROM subcontractor_deliveries d
    JOIN subcontractors s ON s.id = d.subcontractor_id
    ${where} ORDER BY d.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({ deliveries: rows, total, page, limit });
});

router.get('/deliveries/:id', requirePermission(['subcontractor_quality_inspection', 'subcontractor_receiving', 'subcontractor_admin']), (req, res) => {
  const delivery = db.prepare(`
    SELECT d.*, s.name AS subcontractor_name FROM subcontractor_deliveries d
    JOIN subcontractors s ON s.id = d.subcontractor_id WHERE d.id = ?
  `).get(req.params.id);
  if (!delivery) return res.status(404).json({ error: 'Delivery not found.' });
  const lines = db.prepare(`
    SELECT l.*, c.name AS category_name FROM subcontractor_delivery_lines l
    LEFT JOIN subcontractor_categories c ON c.id = l.category_id
    WHERE l.delivery_id = ? ORDER BY l.line_number
  `).all(delivery.id);
  res.json({ delivery, lines });
});

/** POST /api/subcontractor/deliveries — Site Warehouse Supervisor logs a new delivery with its lines. */
router.post('/deliveries', requirePermission('subcontractor_receiving'), (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.warehouse_code)) return res.status(400).json({ error: 'Warehouse is required.' });
  if (!db.prepare('SELECT 1 FROM warehouses WHERE warehouse_code=?').get(b.warehouse_code)) {
    return res.status(404).json({ error: 'Warehouse not found.' });
  }
  if (!isId(b.subcontractor_id) || !db.prepare('SELECT 1 FROM subcontractors WHERE id=? AND is_active=1').get(b.subcontractor_id)) {
    return res.status(400).json({ error: 'A valid subcontractor is required.' });
  }
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) return res.status(400).json({ error: 'At least one line is required.' });
  for (const [i, l] of lines.entries()) {
    if (!isNonEmptyString(l.description)) return res.status(400).json({ error: `Line ${i + 1}: description is required.` });
    if (!(Number(l.quantity_delivered) > 0)) return res.status(400).json({ error: `Line ${i + 1}: quantity must be greater than zero.` });
  }

  const run = db.transaction(() => {
    const info = db.prepare(`INSERT INTO subcontractor_deliveries (warehouse_code, subcontractor_id, delivery_note_ref, delivered_date, logged_by, logged_by_name)
      VALUES (?,?,?,?,?,?)`).run(b.warehouse_code, b.subcontractor_id, b.delivery_note_ref || null,
      b.delivered_date || new Date().toISOString().slice(0, 10), req.user.id, req.user.name);
    const deliveryId = info.lastInsertRowid;
    const insLine = db.prepare(`INSERT INTO subcontractor_delivery_lines (delivery_id, line_number, description, category_id, uom, quantity_delivered)
      VALUES (?,?,?,?,?,?)`);
    lines.forEach((l, i) => insLine.run(deliveryId, i + 1, l.description.trim(), l.category_id || null, l.uom || 'EA', Number(l.quantity_delivered)));
    return deliveryId;
  });
  const deliveryId = run();
  audit.record({ entityType: 'SubcontractorDelivery', entityId: deliveryId, action: 'CREATE',
    newValue: `${lines.length} line(s)`, user: req.user, sourceScreen: 'Subcontractor Receiving' });
  res.status(201).json({ message: 'Delivery logged and forwarded for quality inspection.', id: deliveryId });
});

/**
 * PATCH .../deliveries/:id/lines/:lineId — Site Quality Supervisor's decision
 * on one line. Approved / Approved with Remarks posts the approved quantity
 * into stock immediately (one receipt line per decision) — there is no
 * separate manual receiving step in this flow.
 */
router.patch('/deliveries/:id/lines/:lineId', requirePermission('subcontractor_quality_inspection'), (req, res) => {
  const line = db.prepare(`SELECT * FROM subcontractor_delivery_lines WHERE id=? AND delivery_id=?`).get(req.params.lineId, req.params.id);
  if (!line) return res.status(404).json({ error: 'Delivery line not found.' });
  if (line.quality_status !== 'Pending') return res.status(409).json({ error: 'This line has already been inspected.' });
  const { quality_status, quantity_approved, quality_notes } = req.body || {};
  if (!QUALITY_STATUSES.includes(quality_status) || quality_status === 'Pending') {
    return res.status(400).json({ error: `quality_status must be one of ${QUALITY_STATUSES.filter((s) => s !== 'Pending').join(', ')}.` });
  }
  if (quality_status !== 'Rejected' && !(Number(quantity_approved) > 0)) {
    return res.status(400).json({ error: 'quantity_approved must be greater than zero unless the line is rejected.' });
  }
  if (Number(quantity_approved) > line.quantity_delivered) {
    return res.status(400).json({ error: 'quantity_approved cannot exceed the quantity delivered.' });
  }
  if (quality_status !== 'Approved' && !isNonEmptyString(quality_notes)) {
    return res.status(400).json({ error: 'A note is required for rejection or a remark.' });
  }
  const delivery = db.prepare('SELECT * FROM subcontractor_deliveries WHERE id=?').get(req.params.id);
  const approvedQty = quality_status === 'Rejected' ? 0 : Number(quantity_approved);

  const run = db.transaction(() => {
    db.prepare(`UPDATE subcontractor_delivery_lines
      SET quality_status=?, quantity_approved=?, quality_notes=?, inspected_by=?, inspected_by_name=?, inspected_at=datetime('now')
      WHERE id=?`).run(quality_status, approvedQty, quality_notes || null, req.user.id, req.user.name, line.id);

    let receiptId = null;
    if (approvedQty > 0) {
      const receiptInfo = db.prepare(`INSERT INTO subcontractor_receipts (warehouse_code, received_by, received_by_name, notes)
        VALUES (?,?,?,?)`).run(delivery.warehouse_code, req.user.id, req.user.name,
        `Auto-recorded on ${quality_status.toLowerCase()} quality decision`);
      receiptId = receiptInfo.lastInsertRowid;
      db.prepare('INSERT INTO subcontractor_receipt_lines (receipt_id, delivery_line_id, quantity_received) VALUES (?,?,?)')
        .run(receiptId, line.id, approvedQty);
      db.prepare('UPDATE subcontractor_delivery_lines SET quantity_received=? WHERE id=?').run(approvedQty, line.id);
    }

    // Roll the header status up from its lines: Received once every line has a
    // decision and at least one was approved, Closed if every line was rejected.
    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM subcontractor_delivery_lines WHERE delivery_id=? AND quality_status='Pending'`).get(delivery.id).n;
    if (remaining === 0) {
      const anyApproved = db.prepare(`SELECT COUNT(*) AS n FROM subcontractor_delivery_lines WHERE delivery_id=? AND quantity_received > 0`).get(delivery.id).n;
      db.prepare('UPDATE subcontractor_deliveries SET status=? WHERE id=?').run(anyApproved > 0 ? 'Received' : 'Closed', delivery.id);
    }
    return receiptId;
  });
  const receiptId = run();

  audit.record({ entityType: 'SubcontractorDeliveryLine', entityId: line.id, action: 'QUALITY_DECISION',
    oldValue: line.quality_status, newValue: quality_status, reason: quality_notes, user: req.user, sourceScreen: 'Subcontractor Quality' });
  if (receiptId) {
    audit.record({ entityType: 'SubcontractorReceipt', entityId: receiptId, action: 'CREATE',
      newValue: `${approvedQty} recorded as stock from delivery #${delivery.id} line ${line.line_number}`, user: req.user, sourceScreen: 'Subcontractor Quality' });
  }
  res.json({ message: approvedQty > 0 ? `Line ${quality_status.toLowerCase()} and recorded as stock.` : 'Line rejected.' });
});

// --- Current stock (computed: received minus consumed, no maintained ledger) --
router.get('/stock', requirePermission(['subcontractor_receiving', 'subcontractor_quality_inspection', 'subcontractor_admin']), (req, res) => {
  const filters = [];
  const params = [];
  if (req.query.warehouse_code) { filters.push('rec.warehouse_code = ?'); params.push(req.query.warehouse_code); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  // received and consumed are aggregated separately, then joined on the same
  // (warehouse, description, category, uom) key the consumption log matches on —
  // `IS` rather than `=` so two NULL category_ids still line up.
  const rows = db.prepare(`
    WITH received AS (
      SELECT r.warehouse_code, dl.description, dl.category_id, dl.uom,
        SUM(rl.quantity_received) AS qty, GROUP_CONCAT(DISTINCT s.name) AS subcontractors
      FROM subcontractor_receipt_lines rl
      JOIN subcontractor_receipts r ON r.id = rl.receipt_id
      JOIN subcontractor_delivery_lines dl ON dl.id = rl.delivery_line_id
      JOIN subcontractor_deliveries d ON d.id = dl.delivery_id
      JOIN subcontractors s ON s.id = d.subcontractor_id
      WHERE rl.quantity_received > 0
      GROUP BY r.warehouse_code, dl.description, dl.category_id, dl.uom
    ),
    consumed AS (
      SELECT warehouse_code, description, category_id, uom, SUM(quantity_issued) AS qty
      FROM subcontractor_consumptions
      GROUP BY warehouse_code, description, category_id, uom
    )
    SELECT rec.warehouse_code, rec.description, rec.category_id, c.name AS category_name, rec.uom,
      rec.qty - COALESCE(con.qty, 0) AS quantity_on_hand, rec.subcontractors
    FROM received rec
    LEFT JOIN consumed con ON con.warehouse_code = rec.warehouse_code AND con.description = rec.description
      AND con.category_id IS rec.category_id AND con.uom = rec.uom
    LEFT JOIN subcontractor_categories c ON c.id = rec.category_id
    ${where}
    ORDER BY rec.warehouse_code, rec.description
  `).all(...params);
  res.json({ stock: rows.filter((r) => r.quantity_on_hand > 0) });
});

/**
 * POST /api/subcontractor/consumption — Site Warehouse Supervisor logs
 * material used/issued from subcontractor stock. No approval step (v2, per
 * owner direction to keep this stream fast/seamless) — only guarded against
 * issuing more than is actually on hand.
 */
router.post('/consumption', requirePermission('subcontractor_receiving'), (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.warehouse_code)) return res.status(400).json({ error: 'Warehouse is required.' });
  if (!isNonEmptyString(b.description)) return res.status(400).json({ error: 'Description is required.' });
  if (!(Number(b.quantity_issued) > 0)) return res.status(400).json({ error: 'quantity_issued must be greater than zero.' });
  const uom = b.uom || 'EA';
  const categoryId = b.category_id || null;

  const onHand = db.prepare(`
    SELECT COALESCE((
      SELECT SUM(rl.quantity_received) FROM subcontractor_receipt_lines rl
      JOIN subcontractor_receipts r ON r.id = rl.receipt_id
      JOIN subcontractor_delivery_lines dl ON dl.id = rl.delivery_line_id
      WHERE r.warehouse_code = @wh AND dl.description = @desc AND dl.category_id IS @cat AND dl.uom = @uom
    ), 0) - COALESCE((
      SELECT SUM(quantity_issued) FROM subcontractor_consumptions
      WHERE warehouse_code = @wh AND description = @desc AND category_id IS @cat AND uom = @uom
    ), 0) AS available
  `).get({ wh: b.warehouse_code, desc: b.description, cat: categoryId, uom });

  if (Number(b.quantity_issued) > (onHand.available || 0)) {
    return res.status(400).json({ error: `Only ${onHand.available || 0} ${uom} of "${b.description}" is on hand at ${b.warehouse_code}.` });
  }

  const info = db.prepare(`INSERT INTO subcontractor_consumptions
      (warehouse_code, description, category_id, uom, quantity_issued, reference, notes, issued_by, issued_by_name)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(b.warehouse_code, b.description.trim(), categoryId, uom,
    Number(b.quantity_issued), b.reference || null, b.notes || null, req.user.id, req.user.name);
  audit.record({ entityType: 'SubcontractorConsumption', entityId: info.lastInsertRowid, action: 'CREATE',
    newValue: `${b.quantity_issued} ${uom} of "${b.description}" issued at ${b.warehouse_code}`, reason: b.reference,
    user: req.user, sourceScreen: 'Subcontractor Stock' });
  res.status(201).json({ message: 'Consumption logged.', id: info.lastInsertRowid });
});

/** GET /api/subcontractor/consumption — consumption history for a warehouse. */
router.get('/consumption', requirePermission(['subcontractor_receiving', 'subcontractor_quality_inspection', 'subcontractor_admin']), (req, res) => {
  const filters = [];
  const params = [];
  if (req.query.warehouse_code) { filters.push('warehouse_code = ?'); params.push(req.query.warehouse_code); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM subcontractor_consumptions ${where} ORDER BY id DESC LIMIT 100`).all(...params);
  res.json({ consumption: rows });
});

/**
 * GET /api/subcontractor/reconciliation — site closeout view: received,
 * consumed, and remaining side by side, including fully-depleted items the
 * on-hand stock view drops. Consumption is matched by (warehouse,
 * description, category, uom) rather than to one subcontractor's delivery —
 * if two subcontractors deliver an identically-described item to the same
 * site, consumption cannot be attributed between them from this data model;
 * "subcontractors" lists every contributor to that pooled quantity.
 */
router.get('/reconciliation', requirePermission(['subcontractor_receiving', 'subcontractor_quality_inspection', 'subcontractor_admin']), (req, res) => {
  const filters = [];
  const params = [];
  if (req.query.warehouse_code) { filters.push('rec.warehouse_code = ?'); params.push(req.query.warehouse_code); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`
    WITH received AS (
      SELECT r.warehouse_code, dl.description, dl.category_id, dl.uom,
        SUM(rl.quantity_received) AS qty, GROUP_CONCAT(DISTINCT s.name) AS subcontractors
      FROM subcontractor_receipt_lines rl
      JOIN subcontractor_receipts r ON r.id = rl.receipt_id
      JOIN subcontractor_delivery_lines dl ON dl.id = rl.delivery_line_id
      JOIN subcontractor_deliveries d ON d.id = dl.delivery_id
      JOIN subcontractors s ON s.id = d.subcontractor_id
      WHERE rl.quantity_received > 0
      GROUP BY r.warehouse_code, dl.description, dl.category_id, dl.uom
    ),
    consumed AS (
      SELECT warehouse_code, description, category_id, uom, SUM(quantity_issued) AS qty
      FROM subcontractor_consumptions
      GROUP BY warehouse_code, description, category_id, uom
    )
    SELECT rec.warehouse_code, rec.description, c.name AS category_name, rec.uom, rec.subcontractors,
      rec.qty AS quantity_received, COALESCE(con.qty, 0) AS quantity_consumed,
      rec.qty - COALESCE(con.qty, 0) AS quantity_on_hand
    FROM received rec
    LEFT JOIN consumed con ON con.warehouse_code = rec.warehouse_code AND con.description = rec.description
      AND con.category_id IS rec.category_id AND con.uom = rec.uom
    LEFT JOIN subcontractor_categories c ON c.id = rec.category_id
    ${where}
    ORDER BY rec.warehouse_code, rec.description
  `).all(...params);
  res.json({ reconciliation: rows });
});

module.exports = router;
