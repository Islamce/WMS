/**
 * Subcontractor material receiving — a deliberately SAP-free stream for
 * materials subcontractors bring onto a site/project warehouse. No item code,
 * no material master, no ERP posting: just description/qty/category, a
 * quality inspection step, and a receipt into a local on-hand view.
 *
 * Flow: log a delivery (Quality) → inspect each line (Quality) →
 * receive the quality-approved lines into stock (Warehouse Supervisor).
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

/** POST /api/subcontractor/deliveries — log a new delivery with its lines. */
router.post('/deliveries', requirePermission('subcontractor_quality_inspection'), (req, res) => {
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
    newValue: `${lines.length} line(s)`, user: req.user, sourceScreen: 'Subcontractor Quality' });
  res.status(201).json({ message: 'Delivery logged.', id: deliveryId });
});

/** PATCH .../subcontractor-deliveries/:id/lines/:lineId — quality decision on one line. */
router.patch('/deliveries/:id/lines/:lineId', requirePermission('subcontractor_quality_inspection'), (req, res) => {
  const line = db.prepare(`SELECT * FROM subcontractor_delivery_lines WHERE id=? AND delivery_id=?`).get(req.params.lineId, req.params.id);
  if (!line) return res.status(404).json({ error: 'Delivery line not found.' });
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

  db.prepare(`UPDATE subcontractor_delivery_lines
    SET quality_status=?, quantity_approved=?, quality_notes=?, inspected_by=?, inspected_by_name=?, inspected_at=datetime('now')
    WHERE id=?`).run(quality_status, quality_status === 'Rejected' ? 0 : Number(quantity_approved),
    quality_notes || null, req.user.id, req.user.name, line.id);
  audit.record({ entityType: 'SubcontractorDeliveryLine', entityId: line.id, action: 'QUALITY_DECISION',
    oldValue: line.quality_status, newValue: quality_status, reason: quality_notes, user: req.user, sourceScreen: 'Subcontractor Quality' });

  // Roll the header status up from its lines.
  const delivery = db.prepare('SELECT * FROM subcontractor_deliveries WHERE id=?').get(req.params.id);
  const remaining = db.prepare(`SELECT COUNT(*) AS n FROM subcontractor_delivery_lines WHERE delivery_id=? AND quality_status='Pending'`).get(delivery.id).n;
  if (remaining === 0 && delivery.status === 'Pending Inspection') {
    db.prepare(`UPDATE subcontractor_deliveries SET status='Inspected' WHERE id=?`).run(delivery.id);
  }
  res.json({ message: `Line set to ${quality_status}.` });
});

/** POST .../subcontractor-deliveries/:id/receive — receive quality-approved lines into stock. */
router.post('/deliveries/:id/receive', requirePermission('subcontractor_receiving'), (req, res) => {
  const delivery = db.prepare('SELECT * FROM subcontractor_deliveries WHERE id=?').get(req.params.id);
  if (!delivery) return res.status(404).json({ error: 'Delivery not found.' });
  const b = req.body || {};
  const requestedLines = Array.isArray(b.lines) ? b.lines : [];
  if (!requestedLines.length) return res.status(400).json({ error: 'Select at least one line to receive.' });

  const eligible = db.prepare(`
    SELECT * FROM subcontractor_delivery_lines
    WHERE delivery_id = ? AND quality_status IN ('Approved','Approved with Remarks')
  `).all(delivery.id);
  const eligibleById = new Map(eligible.map((l) => [l.id, l]));

  for (const rl of requestedLines) {
    const line = eligibleById.get(Number(rl.delivery_line_id));
    if (!line) return res.status(400).json({ error: `Line ${rl.delivery_line_id} is not eligible for receiving.` });
    const already = line.quantity_received || 0;
    const remaining = line.quantity_approved - already;
    if (!(Number(rl.quantity_received) > 0) || Number(rl.quantity_received) > remaining) {
      return res.status(400).json({ error: `Line ${rl.delivery_line_id}: quantity received must be between 0 and ${remaining} (already received: ${already}).` });
    }
  }

  const run = db.transaction(() => {
    const receiptInfo = db.prepare(`INSERT INTO subcontractor_receipts (warehouse_code, received_by, received_by_name, notes)
      VALUES (?,?,?,?)`).run(delivery.warehouse_code, req.user.id, req.user.name, b.notes || null);
    const receiptId = receiptInfo.lastInsertRowid;
    const insLine = db.prepare('INSERT INTO subcontractor_receipt_lines (receipt_id, delivery_line_id, quantity_received) VALUES (?,?,?)');
    const bumpLine = db.prepare('UPDATE subcontractor_delivery_lines SET quantity_received = quantity_received + ? WHERE id=?');
    requestedLines.forEach((rl) => {
      insLine.run(receiptId, rl.delivery_line_id, Number(rl.quantity_received));
      bumpLine.run(Number(rl.quantity_received), rl.delivery_line_id);
    });
    const stillOpen = db.prepare(`
      SELECT COUNT(*) AS n FROM subcontractor_delivery_lines
      WHERE delivery_id = ? AND quality_status IN ('Approved','Approved with Remarks') AND quantity_received < quantity_approved
    `).get(delivery.id).n;
    if (stillOpen === 0) db.prepare(`UPDATE subcontractor_deliveries SET status='Received' WHERE id=?`).run(delivery.id);
    return receiptId;
  });
  const receiptId = run();
  audit.record({ entityType: 'SubcontractorReceipt', entityId: receiptId, action: 'CREATE',
    newValue: `${requestedLines.length} line(s) from delivery #${delivery.id}`, user: req.user, sourceScreen: 'Subcontractor Receiving' });
  res.status(201).json({ message: 'Materials received into stock.', id: receiptId });
});

// --- Current stock (computed, not a maintained ledger) ------------------------
router.get('/stock', requirePermission(['subcontractor_receiving', 'subcontractor_quality_inspection', 'subcontractor_admin']), (req, res) => {
  const filters = ["rl.quantity_received > 0"];
  const params = [];
  if (req.query.warehouse_code) { filters.push('r.warehouse_code = ?'); params.push(req.query.warehouse_code); }
  const where = `WHERE ${filters.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT r.warehouse_code, dl.description, c.name AS category_name, dl.uom,
      SUM(rl.quantity_received) AS quantity_on_hand,
      GROUP_CONCAT(DISTINCT s.name) AS subcontractors
    FROM subcontractor_receipt_lines rl
    JOIN subcontractor_receipts r ON r.id = rl.receipt_id
    JOIN subcontractor_delivery_lines dl ON dl.id = rl.delivery_line_id
    JOIN subcontractor_deliveries d ON d.id = dl.delivery_id
    JOIN subcontractors s ON s.id = d.subcontractor_id
    LEFT JOIN subcontractor_categories c ON c.id = dl.category_id
    ${where}
    GROUP BY r.warehouse_code, dl.description, c.name, dl.uom
    ORDER BY r.warehouse_code, dl.description
  `).all(...params);
  res.json({ stock: rows });
});

module.exports = router;
