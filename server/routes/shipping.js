/**
 * Shipping & outbound — delivery orders built from GI-posted requests, moving
 * through pack → load → dispatch → deliver (with proof of delivery). Each
 * shipment gets a scannable QR label (PDF) carrying the shipment number and
 * source request for gate/receiving checks.
 */
const express = require('express');
const crypto = require('crypto');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isId, isNonEmptyString, parsePagination } = require('./../utils/validate');
const { sendError } = require('./../utils/errors');
const audit = require('./../services/audit');
const notify = require('./../services/notify');
const { streamShipmentLabelPdf } = require('./../services/labels');

const router = express.Router();
router.use(authenticate, requirePermission(['shipping', 'gi_posting']));

// GI has been posted on these header statuses — stock physically left, so a
// delivery order can carry it out.
const SHIPPABLE = ['Completed', 'Partially Completed', 'Closed with Shortage'];

function nextShipmentNumber() {
  const year = new Date().getFullYear();
  const n = db.prepare('SELECT COUNT(*) AS n FROM shipments WHERE shipment_number LIKE ?').get(`SHP-${year}-%`).n;
  return `SHP-${year}-${String(n + 1).padStart(6, '0')}`;
}

/** GET /api/shipping — shipments (?status=, ?search=, paginated). */
router.get('/', (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { page: 1, limit: 50 });
  const clauses = [];
  const params = [];
  const { status } = req.query;
  if (status && ['OPEN', 'PACKED', 'LOADED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'].includes(status)) {
    clauses.push('status=?'); params.push(status);
  }
  const q = (req.query.search || '').trim();
  if (q) {
    clauses.push('(shipment_number LIKE ? OR request_number LIKE ? OR delivery_order_number LIKE ? OR ship_to LIKE ?)');
    const like = `%${q}%`; params.push(like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM shipments ${where}`).get(...params).n;
  const shipments = db.prepare(`SELECT * FROM shipments ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  res.json({ shipments, total, page, limit });
});

/** GET /api/shipping/eligible — GI-posted requests without an active shipment. */
router.get('/eligible', (req, res) => {
  const rows = db.prepare(`
    SELECT h.id, h.request_number, h.requester_name, h.department, h.wbs_element AS project, h.issue_warehouse_code,
           h.gi_document_number, h.request_status, h.closed_at
    FROM material_request_headers h
    WHERE h.request_status IN (${SHIPPABLE.map(() => '?').join(',')})
      AND h.gi_document_number IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.request_id=h.id AND s.status NOT IN ('CANCELLED'))
    ORDER BY h.id DESC LIMIT 100
  `).all(...SHIPPABLE);
  res.json({ requests: rows });
});

/**
 * POST /api/shipping — create a delivery order / shipment.
 * body: { request_id?, delivery_order_number?, ship_to, carrier?, vehicle?,
 *         driver?, packages?, weight_kg?, notes? }
 */
router.post('/', (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.ship_to)) return res.status(400).json({ error: 'Ship-to (destination) is required.' });

  let header = null;
  if (b.request_id !== undefined && b.request_id !== null && b.request_id !== '') {
    if (!isId(b.request_id)) return res.status(400).json({ error: 'Invalid request id.' });
    header = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(b.request_id);
    if (!header) return res.status(404).json({ error: 'Request not found.' });
    if (!SHIPPABLE.includes(header.request_status) || !header.gi_document_number) {
      return res.status(400).json({ error: `Request ${header.request_number} has no posted goods issue to ship.` });
    }
    const active = db.prepare("SELECT shipment_number FROM shipments WHERE request_id=? AND status NOT IN ('CANCELLED')").get(header.id);
    if (active) return res.status(409).json({ error: `Shipment ${active.shipment_number} already covers this request.` });
  }

  const shipmentNumber = nextShipmentNumber();
  const qrValue = `SHP|${shipmentNumber}|${header ? header.request_number : 'NA'}|${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const info = db.prepare(`
    INSERT INTO shipments
      (shipment_number, request_id, request_number, delivery_order_number, ship_to, carrier, vehicle, driver,
       status, qr_code_value, packages, weight_kg, notes, created_by, created_by_name)
    VALUES (?,?,?,?,?,?,?,?, 'OPEN', ?,?,?,?,?,?)
  `).run(shipmentNumber, header ? header.id : null, header ? header.request_number : null,
    b.delivery_order_number || null, b.ship_to.trim(), b.carrier || null, b.vehicle || null, b.driver || null,
    qrValue, Number(b.packages) > 0 ? Math.floor(Number(b.packages)) : 1,
    Number(b.weight_kg) > 0 ? Number(b.weight_kg) : null, b.notes || null, req.user.id, req.user.name);

  audit.record({ entityType: 'Shipment', entityId: info.lastInsertRowid,
    requestNumber: header ? header.request_number : null, action: 'SHIPMENT_CREATED',
    newValue: { shipment: shipmentNumber, ship_to: b.ship_to.trim() }, user: req.user, sourceScreen: 'Shipping' });

  res.status(201).json({ message: `Shipment ${shipmentNumber} created.`, id: info.lastInsertRowid,
    shipment_number: shipmentNumber, qr_code_value: qrValue });
});

/** GET /api/shipping/:id — shipment detail (+ issued lines when linked). */
router.get('/:id', (req, res) => {
  const shipment = db.prepare('SELECT * FROM shipments WHERE id=?').get(req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  const lines = shipment.request_id
    ? db.prepare('SELECT line_number, material_code, material_description, issued_quantity, uom, batch_number, bin_location FROM material_request_lines WHERE request_id=? AND issued_quantity > 0 ORDER BY line_number').all(shipment.request_id)
    : [];
  res.json({ shipment, lines });
});

// Ordered status machine; each step stamps its own timestamp.
const STEPS = {
  pack: { from: ['OPEN'], to: 'PACKED', stamp: 'packed_at', label: 'packed' },
  load: { from: ['PACKED'], to: 'LOADED', stamp: 'loaded_at', label: 'loaded' },
  dispatch: { from: ['LOADED', 'PACKED'], to: 'DISPATCHED', stamp: 'dispatched_at', label: 'dispatched' },
};

Object.entries(STEPS).forEach(([step, cfg]) => {
  router.post(`/:id/${step}`, (req, res) => {
    const shipment = db.prepare('SELECT * FROM shipments WHERE id=?').get(req.params.id);
    if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
    if (!cfg.from.includes(shipment.status)) {
      return res.status(400).json({ error: `Shipment cannot be ${cfg.label} from status '${shipment.status}'.` });
    }
    db.prepare(`UPDATE shipments SET status=?, ${cfg.stamp}=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .run(cfg.to, shipment.id);
    audit.record({ entityType: 'Shipment', entityId: shipment.id, requestNumber: shipment.request_number,
      action: `SHIPMENT_${cfg.to}`, user: req.user, sourceScreen: 'Shipping' });
    if (cfg.to === 'DISPATCHED' && shipment.request_id) {
      const h = db.prepare('SELECT requester_id FROM material_request_headers WHERE id=?').get(shipment.request_id);
      if (h) notify.send({ requestNumber: shipment.request_number, recipientUserId: h.requester_id,
        notificationType: 'SHIPMENT_DISPATCHED', title: `Shipment ${shipment.shipment_number} dispatched`,
        message: `Your materials for ${shipment.request_number} are on the way to ${shipment.ship_to}.` });
    }
    res.json({ message: `Shipment ${shipment.shipment_number} ${cfg.label}.`, status: cfg.to });
  });
});

/** POST /api/shipping/:id/deliver — proof of delivery. body { delivered_to, pod_note? } */
router.post('/:id/deliver', (req, res) => {
  const shipment = db.prepare('SELECT * FROM shipments WHERE id=?').get(req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  if (shipment.status !== 'DISPATCHED') {
    return res.status(400).json({ error: `Only a dispatched shipment can be delivered (status '${shipment.status}').` });
  }
  const b = req.body || {};
  if (!isNonEmptyString(b.delivered_to)) return res.status(400).json({ error: 'Received-by name is required for proof of delivery.' });
  db.prepare(`UPDATE shipments SET status='DELIVERED', delivered_at=datetime('now'), delivered_to=?, pod_note=?,
    updated_at=datetime('now') WHERE id=?`).run(b.delivered_to.trim(), b.pod_note || null, shipment.id);
  audit.record({ entityType: 'Shipment', entityId: shipment.id, requestNumber: shipment.request_number,
    action: 'SHIPMENT_DELIVERED', newValue: { delivered_to: b.delivered_to.trim(), pod: b.pod_note || null },
    user: req.user, sourceScreen: 'Shipping' });
  if (shipment.request_id) {
    const h = db.prepare('SELECT requester_id FROM material_request_headers WHERE id=?').get(shipment.request_id);
    if (h) notify.send({ requestNumber: shipment.request_number, recipientUserId: h.requester_id,
      notificationType: 'SHIPMENT_DELIVERED', title: `Shipment ${shipment.shipment_number} delivered`,
      message: `Received by ${b.delivered_to.trim()}.`, email: true });
  }
  res.json({ message: `Delivery confirmed — received by ${b.delivered_to.trim()}.` });
});

/** POST /api/shipping/:id/cancel — cancel before delivery. */
router.post('/:id/cancel', (req, res) => {
  const shipment = db.prepare('SELECT * FROM shipments WHERE id=?').get(req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  if (['DELIVERED', 'CANCELLED'].includes(shipment.status)) {
    return res.status(400).json({ error: `Shipment is already ${shipment.status.toLowerCase()}.` });
  }
  db.prepare("UPDATE shipments SET status='CANCELLED', updated_at=datetime('now') WHERE id=?").run(shipment.id);
  audit.record({ entityType: 'Shipment', entityId: shipment.id, requestNumber: shipment.request_number,
    action: 'SHIPMENT_CANCELLED', reason: (req.body || {}).reason, user: req.user, sourceScreen: 'Shipping' });
  res.json({ message: `Shipment ${shipment.shipment_number} cancelled.` });
});

/** GET /api/shipping/:id/label — printable QR label PDF for the shipment. */
router.get('/:id/label', async (req, res) => {
  const shipment = db.prepare('SELECT * FROM shipments WHERE id=?').get(req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  try {
    await streamShipmentLabelPdf(res, shipment);
  } catch (err) { return sendError(res, err, 'Label generation failed.'); }
});

module.exports = router;
