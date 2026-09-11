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
const { isNonEmptyString, isId, isPositiveNumber, parsePagination } = require('./../utils/validate');
const audit = require('./../services/audit');
const { withIdempotency } = require('./../middleware/idempotency');
const { recordMovement } = require('./../services/ledger');
const { activeFreeze, freezeMessage } = require('./../services/freeze');

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
router.post('/deliveries', requirePermission('subcontractor_receiving'), withIdempotency('POST /api/subcontractor/deliveries', (req, res) => {
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
    if (!isPositiveNumber(l.quantity_delivered)) return res.status(400).json({ error: `Line ${i + 1}: quantity must be greater than zero.` });
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
}));

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
  if (quality_status !== 'Rejected' && !isPositiveNumber(quantity_approved)) {
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
router.post('/consumption', requirePermission('subcontractor_receiving'), withIdempotency('POST /api/subcontractor/consumption', (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.warehouse_code)) return res.status(400).json({ error: 'Warehouse is required.' });
  if (!isNonEmptyString(b.description)) return res.status(400).json({ error: 'Description is required.' });
  if (!isPositiveNumber(b.quantity_issued)) return res.status(400).json({ error: 'quantity_issued must be greater than zero.' });
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
}));

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

// ---------------------------------------------------------------------------
// Owned-stock report (Contracting edition, phase 3)
//
// One report per subcontractor and material over the REAL inventory phase 1
// created — batches carrying an owner — rather than over the older SAP-free
// delivery/consumption stream that /reconciliation covers. The two answer
// different questions and neither replaces the other.
//
// Every figure here is derived from receipt and issue quantities alone. That is
// the deliberate constraint from §1.2 of the requirements: the contractor was
// clear that a BOM/BOQ mapped to each WBS element is hard to establish on a
// construction project and harder to keep accurate, so an indicator that needs
// one is an indicator nobody can use. Received, issued, returned and on hand
// need no such mapping and are correct from day one.
//
//   received = the quantity booked into the owned batches
//   returned = what has actually been handed back under movement type 542
//   on hand  = what is still physically in the store
//   issued   = received - returned - on hand
//
// Issued is a RESIDUAL, not an independently posted figure: stock_transactions
// carries no batch reference, so consumption cannot be attributed per batch from
// the ledger. Calling it "issued" rather than "consumed" is deliberate — the
// system knows the material left the store, not that it was built into the work.
// Progress and execution rates belong to project management, not to the stores.
// ---------------------------------------------------------------------------

/**
 * GET /api/subcontractor/owned-stock-report
 *
 * Query: subcontractor_id, warehouse_code, low_stock_percent (default 10).
 *
 * engagement_type rides along on every row so the client can present
 * supply-only and supply-and-execute differently. Per §4.2 that distinction is
 * PRESENTATIONAL only — both post through identical transactions, and nothing
 * in this query branches on it.
 */
router.get('/owned-stock-report',
  requirePermission(['subcontractor_admin', 'subcontractor_receiving',
    'subcontractor_return_approval', 'project_management_approval', 'kpi_dashboard']),
  (req, res) => {
    const filters = ["b.owner_type = 'SUBCONTRACTOR'", 'b.owner_subcontractor_id IS NOT NULL'];
    const params = [];
    if (req.query.subcontractor_id) {
      if (!isId(req.query.subcontractor_id)) return res.status(400).json({ error: 'subcontractor_id is invalid.' });
      filters.push('b.owner_subcontractor_id = ?');
      params.push(req.query.subcontractor_id);
    }
    if (req.query.warehouse_code) { filters.push('b.warehouse_code = ?'); params.push(req.query.warehouse_code); }

    // A percentage rather than an absolute level, because no reorder point can
    // exist for material the company neither buys nor owns. "Nearly finished"
    // here means: little of what was delivered is left.
    const lowStockPercent = req.query.low_stock_percent === undefined
      ? 10 : Number(req.query.low_stock_percent);
    if (!Number.isFinite(lowStockPercent) || lowStockPercent < 0 || lowStockPercent > 100) {
      return res.status(400).json({ error: 'low_stock_percent must be between 0 and 100.' });
    }

    const rows = db.prepare(`
      SELECT s.id AS subcontractor_id, s.name AS subcontractor_name,
             s.engagement_type, s.trade_category,
             b.warehouse_code, b.material_id, b.material_code, b.material_description,
             m.unit AS uom,
             SUM(b.received_quantity)  AS quantity_received,
             SUM(b.remaining_quantity) AS quantity_on_hand,
             SUM(b.reserved_quantity)  AS quantity_reserved,
             COALESCE((
               SELECT SUM(r.quantity_approved) FROM subcontractor_returns r
               WHERE r.status = 'EXECUTED' AND r.batch_id IN (
                 SELECT b2.id FROM batches b2
                 WHERE b2.owner_subcontractor_id = b.owner_subcontractor_id
                   AND b2.material_id = b.material_id
                   AND b2.warehouse_code IS b.warehouse_code
               )
             ), 0) AS quantity_returned,
             COUNT(*) AS batch_count
      FROM batches b
      JOIN subcontractors s ON s.id = b.owner_subcontractor_id
      LEFT JOIN materials m ON m.id = b.material_id
      WHERE ${filters.join(' AND ')}
      GROUP BY b.owner_subcontractor_id, b.material_id, b.warehouse_code
      ORDER BY s.name, b.material_code, b.warehouse_code
    `).all(...params);

    const report = rows.map((row) => {
      const received = Number(row.quantity_received) || 0;
      const onHand = Number(row.quantity_on_hand) || 0;
      const returned = Number(row.quantity_returned) || 0;
      // Clamped at zero: a negative residual would mean the books disagree, and
      // a report is the wrong place to silently invent a correction. It is
      // surfaced as a discrepancy instead so somebody looks at it.
      const issued = Math.max(0, received - returned - onHand);
      const percentRemaining = received > 0 ? (onHand / received) * 100 : 0;
      return {
        ...row,
        quantity_received: received,
        quantity_on_hand: onHand,
        quantity_returned: returned,
        quantity_issued: issued,
        percent_remaining: Math.round(percentRemaining * 10) / 10,
        // Depleted material is not "low" — there is nothing left to warn about,
        // and a permanent alert on every finished line is how alerts get ignored.
        low_stock: onHand > 0 && percentRemaining <= lowStockPercent,
        discrepancy: received - returned - onHand < -0.001
          ? 'On-hand plus returned exceeds what was received for this line.' : null,
      };
    });

    res.json({
      report,
      low_stock_percent: lowStockPercent,
      alerts: report.filter((r) => r.low_stock),
      basis: 'Derived from receipt and issue quantities only; no BOQ or WBS mapping is required or assumed. '
        + '"Issued" means the material left the store, not that it was installed in the works.',
    });
  });

// ---------------------------------------------------------------------------
// Return of subcontractor-owned material
//
// Leftover material in a site store still belongs to the subcontractor; we hold
// it. Returning it is therefore NOT a stock adjustment and NOT consumption — it
// is a real outbound movement of someone else's property, and the contractor was
// explicit about the shape: a SEPARATE approval stage by project management,
// after which the APPROVED quantity (not the requested one) is issued out under
// a distinctive movement number.
//
// Movement type 542 is what keeps a return distinguishable from consumption in
// every later report and reconciliation. Ownership is never transferred by any
// of this; only possession moves.
//
// The lifecycle deliberately mirrors stock reallocation
// (PENDING_APPROVAL → APPROVED → EXECUTING → EXECUTED, with idempotent replay,
// an atomic claim, and re-validation at execution time): the guarantees are the
// same, and a reviewer already knows the shape.
// ---------------------------------------------------------------------------

/** Read a return with the joined context every handler needs. */
function getReturn(id) {
  return db.prepare(`
    SELECT r.*, s.name AS subcontractor_name, b.batch_number, b.material_id,
           b.material_code, b.remaining_quantity, b.reserved_quantity,
           b.owner_type, b.owner_subcontractor_id
    FROM subcontractor_returns r
    JOIN subcontractors s ON s.id = r.subcontractor_id
    JOIN batches b ON b.id = r.batch_id
    WHERE r.id = ?
  `).get(id);
}

/** GET /api/subcontractor/returns — queue, newest first. */
router.get('/returns', requirePermission(['subcontractor_admin', 'subcontractor_receiving', 'subcontractor_return_approval']), (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  const status = isNonEmptyString(req.query.status) ? req.query.status.trim() : null;
  const where = status ? 'WHERE r.status = ?' : '';
  const params = status ? [status] : [];
  const returns = db.prepare(`
    SELECT r.*, s.name AS subcontractor_name, b.batch_number, b.material_code
    FROM subcontractor_returns r
    JOIN subcontractors s ON s.id = r.subcontractor_id
    JOIN batches b ON b.id = r.batch_id
    ${where}
    ORDER BY r.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({ returns });
});

/**
 * POST /api/subcontractor/returns — request a return.
 * Body: { batch_id, quantity, reason }
 */
router.post('/returns', requirePermission(['subcontractor_admin', 'subcontractor_receiving']),
  withIdempotency('POST /api/subcontractor/returns', (req, res) => {
    const b = req.body || {};
    if (!isId(b.batch_id)) return res.status(400).json({ error: 'A batch is required.' });
    if (!isPositiveNumber(b.quantity)) return res.status(400).json({ error: 'Quantity must be greater than zero.' });

    const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(b.batch_id);
    if (!batch) return res.status(404).json({ error: 'Batch not found.' });

    // Only material the subcontractor owns can go back to them. Company stock
    // leaving the store is a goods issue, a different thing with a different
    // authority — refusing here is what stops the two being confused.
    if (batch.owner_type !== 'SUBCONTRACTOR' || !batch.owner_subcontractor_id) {
      return res.status(409).json({
        error: 'This batch is company-owned. Only subcontractor-owned material can be returned to its owner.',
      });
    }

    const available = Number(batch.remaining_quantity) - Number(batch.reserved_quantity || 0);
    if (Number(b.quantity) > available) {
      return res.status(409).json({ error: `Only ${available} is available to return (the rest is reserved).` });
    }

    const seq = db.prepare('SELECT COUNT(*) AS n FROM subcontractor_returns').get().n + 1;
    const returnNumber = `SCR-${String(seq).padStart(6, '0')}`;
    const info = db.prepare(`
      INSERT INTO subcontractor_returns
        (return_number, subcontractor_id, warehouse_code, batch_id, quantity_requested, reason,
         requested_by, requested_by_name)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(returnNumber, batch.owner_subcontractor_id, batch.warehouse_code, batch.id,
      Number(b.quantity), isNonEmptyString(b.reason) ? b.reason.trim() : null,
      req.user.id, req.user.name);

    audit.record({ entityType: 'SubcontractorReturn', entityId: info.lastInsertRowid, action: 'REQUESTED',
      newValue: { return_number: returnNumber, batch: batch.batch_number, quantity: Number(b.quantity) },
      user: req.user, sourceScreen: 'Subcontractor Returns' });

    res.status(201).json({
      message: `Return ${returnNumber} submitted for project-management approval.`,
      id: info.lastInsertRowid, return_number: returnNumber, status: 'PENDING_APPROVAL',
    });
  }));

/**
 * POST /api/subcontractor/returns/:id/approve — project management only.
 * Body: { quantity_approved? } — defaults to the requested quantity.
 */
router.post('/returns/:id/approve', requirePermission('subcontractor_return_approval'), (req, res) => {
  const ret = getReturn(req.params.id);
  if (!ret) return res.status(404).json({ error: 'Return request not found.' });
  if (ret.status === 'APPROVED') {
    return res.json({ message: `Return ${ret.return_number} is already approved.`, status: 'APPROVED', idempotent: true });
  }
  if (ret.status !== 'PENDING_APPROVAL') {
    return res.status(409).json({ error: `Cannot approve a ${ret.status} return.` });
  }
  // Four-eyes, consistent with every other approval in this system.
  if (Number(ret.requested_by) === Number(req.user.id) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You cannot approve a return you requested yourself.' });
  }

  const requested = Number(ret.quantity_requested);
  const approved = req.body && req.body.quantity_approved !== undefined
    ? Number(req.body.quantity_approved) : requested;
  if (!isPositiveNumber(approved)) return res.status(400).json({ error: 'Approved quantity must be greater than zero.' });
  if (approved > requested) {
    return res.status(400).json({ error: `Cannot approve ${approved}; only ${requested} was requested.` });
  }

  const changed = db.prepare(`
    UPDATE subcontractor_returns
    SET status='APPROVED', quantity_approved=?, approved_by=?, approved_by_name=?,
        approved_at=datetime('now'), updated_at=datetime('now')
    WHERE id=? AND status='PENDING_APPROVAL'
  `).run(approved, req.user.id, req.user.name, ret.id);
  if (!changed.changes) return res.status(409).json({ error: 'The return changed state; reload and try again.' });

  audit.record({ entityType: 'SubcontractorReturn', entityId: ret.id, action: 'APPROVED',
    oldValue: { status: 'PENDING_APPROVAL', quantity_requested: requested },
    newValue: { status: 'APPROVED', quantity_approved: approved },
    user: req.user, sourceScreen: 'Subcontractor Returns' });

  res.json({
    message: approved < requested
      ? `Return ${ret.return_number} approved for ${approved} of ${requested}.`
      : `Return ${ret.return_number} approved.`,
    status: 'APPROVED', quantity_approved: approved,
  });
});

/** POST /api/subcontractor/returns/:id/reject — project management only. */
router.post('/returns/:id/reject', requirePermission('subcontractor_return_approval'), (req, res) => {
  const ret = getReturn(req.params.id);
  if (!ret) return res.status(404).json({ error: 'Return request not found.' });
  if (ret.status === 'REJECTED') {
    return res.json({ message: `Return ${ret.return_number} is already rejected.`, status: 'REJECTED', idempotent: true });
  }
  if (ret.status !== 'PENDING_APPROVAL') {
    return res.status(409).json({ error: `Cannot reject a ${ret.status} return.` });
  }

  const reason = isNonEmptyString((req.body || {}).reason) ? req.body.reason.trim() : null;
  const changed = db.prepare(`
    UPDATE subcontractor_returns
    SET status='REJECTED', rejected_by=?, rejected_by_name=?, rejected_at=datetime('now'),
        rejection_reason=?, updated_at=datetime('now')
    WHERE id=? AND status='PENDING_APPROVAL'
  `).run(req.user.id, req.user.name, reason, ret.id);
  if (!changed.changes) return res.status(409).json({ error: 'The return changed state; reload and try again.' });

  audit.record({ entityType: 'SubcontractorReturn', entityId: ret.id, action: 'REJECTED',
    oldValue: 'PENDING_APPROVAL', newValue: 'REJECTED', reason,
    user: req.user, sourceScreen: 'Subcontractor Returns' });

  res.json({ message: `Return ${ret.return_number} rejected.`, status: 'REJECTED' });
});

/**
 * POST /api/subcontractor/returns/:id/execute — hand the material back.
 *
 * Issues the APPROVED quantity out of the batch under movement type 542. Stock
 * is re-validated here rather than trusted from approval time: approval and
 * handover are separated in time, and the batch can have moved or been reserved
 * in between.
 */
router.post('/returns/:id/execute', requirePermission(['subcontractor_admin', 'subcontractor_receiving']), (req, res) => {
  const initial = getReturn(req.params.id);
  if (!initial) return res.status(404).json({ error: 'Return request not found.' });
  if (initial.status === 'EXECUTED') {
    return res.json({ message: `Return ${initial.return_number} was already handed over.`, status: 'EXECUTED', idempotent: true });
  }
  if (initial.status !== 'APPROVED') {
    return res.status(409).json({ error: `Only APPROVED returns can be handed over (current: ${initial.status}).` });
  }

  let outcome;
  const execute = db.transaction(() => {
    const ret = getReturn(initial.id);
    if (ret.status === 'EXECUTED') return { idempotent: true };
    if (ret.status !== 'APPROVED') throw Object.assign(new Error(`Return state changed to ${ret.status}.`), { status: 409 });

    // Atomic claim: two concurrent handovers cannot both proceed.
    const claim = db.prepare(`
      UPDATE subcontractor_returns SET status='EXECUTING', execution_error=NULL, updated_at=datetime('now')
      WHERE id=? AND status='APPROVED'
    `).run(ret.id);
    if (!claim.changes) throw Object.assign(new Error('Handover was already claimed.'), { status: 409 });

    const freeze = activeFreeze(ret.warehouse_code);
    if (freeze) throw Object.assign(new Error(freezeMessage(freeze, ret.warehouse_code)), { status: 409 });

    const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(ret.batch_id);
    if (!batch) throw Object.assign(new Error('The batch no longer exists.'), { status: 409 });
    const quantity = Number(ret.quantity_approved);
    const available = Number(batch.remaining_quantity) - Number(batch.reserved_quantity || 0);
    if (quantity > available) {
      throw Object.assign(
        new Error(`Only ${available} is now available; stock or reservations changed after approval.`),
        { status: 409 });
    }

    db.prepare("UPDATE batches SET remaining_quantity = remaining_quantity - ?, updated_at=datetime('now') WHERE id=?")
      .run(quantity, batch.id);

    const transactionId = recordMovement({
      type: 'OUT', materialId: batch.material_id, warehouseCode: ret.warehouse_code,
      quantity, userId: req.user.id, movementCategory: 'ISSUE',
      notes: `Return ${ret.return_number} to ${ret.subcontractor_name} — movement type 542 (subcontractor-owned material)`,
    });

    db.prepare(`
      UPDATE subcontractor_returns
      SET status='EXECUTED', executed_by=?, executed_by_name=?, executed_at=datetime('now'),
          movement_type='542', updated_at=datetime('now')
      WHERE id=?
    `).run(req.user.id, req.user.name, ret.id);

    audit.record({ entityType: 'SubcontractorReturn', entityId: ret.id, action: 'EXECUTED',
      oldValue: 'APPROVED',
      newValue: { status: 'EXECUTED', movement_type: '542', quantity, batch: batch.batch_number,
        stock_transaction_id: transactionId },
      user: req.user, sourceScreen: 'Subcontractor Returns' });

    return { idempotent: false, quantity, transactionId };
  });

  try {
    outcome = execute();
  } catch (err) {
    db.prepare("UPDATE subcontractor_returns SET status='APPROVED', execution_error=?, updated_at=datetime('now') WHERE id=? AND status='EXECUTING'")
      .run(String(err.message || err).slice(0, 500), initial.id);
    return res.status(err.status || 400).json({ error: err.message || 'Handover failed. No changes were saved.' });
  }

  if (outcome.idempotent) {
    return res.json({ message: `Return ${initial.return_number} was already handed over.`, status: 'EXECUTED', idempotent: true });
  }
  res.json({
    message: `Return ${initial.return_number} handed over: ${outcome.quantity} issued under movement type 542.`,
    status: 'EXECUTED', movement_type: '542', quantity: outcome.quantity,
  });
});

module.exports = router;
