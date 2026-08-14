/**
 * ERP Operator queue — enter ERP reservation/reference number, confirm movement
 * type, plant, storage location, and issue warehouse, then route to warehouse.
 * The system blocks routing until every mandatory ERP field is present.
 * Movement type may only be set here (or by admin) — never by requester/picker.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isNonEmptyString } = require('./../utils/validate');
const { sendError } = require('./../utils/errors');
const audit = require('./../services/audit');
const notify = require('./../services/notify');
const erp = require('./../services/erp');
const sod = require('./../services/sod');
const { setHeaderStatus, getHeaderOr404 } = require('./../services/requests');
const { HEADER_STATUS, LINE_STATUS } = require('./../workflow/states');
const { withExecutionContexts } = require('./../services/workflowContext');

const router = express.Router();
router.use(authenticate, requirePermission('erp_operator'));

const ERP_STAGES = [
  HEADER_STATUS.APPROVED_PENDING_ERP, HEADER_STATUS.PENDING_ERP_RESERVATION,
  HEADER_STATUS.ERP_RESERVATION_CREATED, HEADER_STATUS.MOVEMENT_TYPE_ASSIGNED, HEADER_STATUS.ON_HOLD,
];

/** GET /api/erp-operator — queue of approved requests awaiting ERP processing. */
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, request_number, requester_id, requester_name, department, wbs_element, wbs_element AS project,
           cost_center, required_date, priority, request_status, movement_type, movement_type_description,
           erp_reservation_number, erp_reference_number, plant, storage_location,
           issue_warehouse_code, issue_warehouse_name, approved_at, created_at
    FROM material_request_headers
    WHERE request_status IN (${ERP_STAGES.map(() => '?').join(',')})
    ORDER BY approved_at
  `).all(...ERP_STAGES);
  res.json({ requests: withExecutionContexts(rows) });
});

/**
 * PATCH /api/erp-operator/:id — set ERP reservation/reference, movement type,
 * plant, storage location, issue warehouse. Partial saves allowed.
 */
router.patch('/:id', (req, res) => {
  const header = getHeaderOr404(res, req.params.id);
  if (!header) return;
  if (!ERP_STAGES.includes(header.request_status)) {
    return res.status(400).json({ error: `Request is not in ERP processing (status '${header.request_status}').` });
  }
  const b = req.body || {};

  // Validate movement type against the controlled list if provided.
  let mt = null;
  if (isNonEmptyString(b.movement_type)) {
    mt = db.prepare('SELECT * FROM movement_types WHERE code=? AND is_active=1').get(b.movement_type.trim());
    if (!mt) return res.status(400).json({ error: `Unknown movement type '${b.movement_type}'.` });
  }
  // Validate warehouse if provided.
  let wh = null;
  if (isNonEmptyString(b.issue_warehouse_code)) {
    wh = db.prepare('SELECT * FROM warehouses WHERE warehouse_code=? AND is_active=1').get(b.issue_warehouse_code.trim());
    if (!wh) return res.status(400).json({ error: `Unknown warehouse '${b.issue_warehouse_code}'.` });
  }

  // Non-stock items (materials.is_stock_item = 0) must never receive a stock
  // reservation — block before anything is recorded.
  if (isNonEmptyString(b.erp_reservation_number) || isNonEmptyString(b.erp_reference_number)) {
    const nonStock = db.prepare(`
      SELECT DISTINCT l.material_code FROM material_request_lines l
      JOIN materials m ON m.id = l.material_id
      WHERE l.request_id=? AND l.line_status NOT IN ('Rejected','Cancelled') AND m.is_stock_item = 0
    `).all(header.id).map((r) => r.material_code);
    if (nonStock.length) {
      return res.status(400).json({
        error: `Reservations are not allowed for non-stock items: ${nonStock.join(', ')}. `
          + 'Remove these lines (or mark the materials as stock items) before creating a reservation.',
      });
    }
  }

  const fields = {
    erp_reservation_number: b.erp_reservation_number,
    erp_reference_number: b.erp_reference_number,
    movement_type: mt ? mt.code : undefined,
    movement_type_description: mt ? mt.description : undefined,
    plant: b.plant,
    storage_location: b.storage_location,
    issue_warehouse_code: wh ? wh.warehouse_code : undefined,
    issue_warehouse_name: wh ? wh.warehouse_name : undefined,
  };

  const apply = db.transaction(() => {
    Object.entries(fields).forEach(([f, v]) => {
      if (v === undefined) return;
      const oldV = header[f];
      if (String(oldV ?? '') === String(v ?? '')) return;
      db.prepare(`UPDATE material_request_headers SET ${f}=?, updated_by=? WHERE id=?`).run(v, req.user.id, header.id);
      audit.record({ entityType: 'MaterialRequestHeader', entityId: header.id, requestNumber: header.request_number,
        action: 'ERP_FIELD_SET', oldValue: { [f]: oldV }, newValue: { [f]: v }, user: req.user, sourceScreen: 'ERP Operator' });
      header[f] = v;
    });

    // Record reservation creation via ERP connector when a reservation/reference is first set.
    if ((fields.erp_reservation_number || fields.erp_reference_number) &&
        header.request_status === HEADER_STATUS.APPROVED_PENDING_ERP) {
      const r = erp.connector().createReservation({
        requestNumber: header.request_number,
        reservationNumber: header.erp_reservation_number,
        referenceNumber: header.erp_reference_number,
        payload: { requestNumber: header.request_number }, user: req.user,
      });
      if (r.ok) {
        setHeaderStatus(header, HEADER_STATUS.ERP_RESERVATION_CREATED, { user: req.user, sourceScreen: 'ERP Operator',
          set: { erp_reservation_date: new Date().toISOString(), erp_created_by: req.user.id } });
        db.prepare('UPDATE material_request_lines SET line_status=? WHERE request_id=? AND line_status=?')
          .run(LINE_STATUS.RESERVED, header.id, LINE_STATUS.PENDING_ERP_RESERVATION);
      }
    }
    if (fields.movement_type && header.request_status === HEADER_STATUS.ERP_RESERVATION_CREATED) {
      setHeaderStatus(header, HEADER_STATUS.MOVEMENT_TYPE_ASSIGNED, { user: req.user, sourceScreen: 'ERP Operator' });
    }
  });
  apply();
  res.json({ message: 'ERP details saved.', request: db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(header.id) });
});

/**
 * POST /api/erp-operator/:id/send-to-warehouse — hard gate: reservation/reference,
 * movement type, plant, storage location, and issue warehouse are all mandatory.
 */
router.post('/:id/send-to-warehouse', (req, res) => {
  const header = getHeaderOr404(res, req.params.id);
  if (!header) return;

  // SoD: the ERP operator must not be the person who approved the request.
  const sodErr = sod.conflict(req.user, [{ id: sod.approverId(header.request_number), label: 'approval' }]);
  if (sodErr) return res.status(403).json({ error: sodErr });

  const missing = [];
  if (!header.erp_reservation_number && !header.erp_reference_number) missing.push('ERP Reservation or Reference Number');
  if (!header.movement_type) missing.push('Movement Type');
  if (!header.plant) missing.push('Plant');
  if (!header.storage_location) missing.push('Storage Location');
  if (!header.issue_warehouse_code) missing.push('Issue Warehouse');
  if (missing.length) {
    return res.status(400).json({ error: `Cannot send to warehouse. Missing: ${missing.join(', ')}.` });
  }
  const approvedLines = db.prepare(
    "SELECT COUNT(*) AS n FROM material_request_lines WHERE request_id=? AND line_status NOT IN ('Rejected','Cancelled')"
  ).get(header.id).n;
  if (approvedLines === 0) return res.status(400).json({ error: 'No approved lines to process.' });

  const send = db.transaction(() => {
    // stamp warehouse + storage location onto the lines
    db.prepare(`
      UPDATE material_request_lines
      SET warehouse_code=?, warehouse_name=?, storage_location=?, plant=?
      WHERE request_id=? AND line_status NOT IN ('Rejected','Cancelled')
    `).run(header.issue_warehouse_code, header.issue_warehouse_name, header.storage_location, header.plant, header.id);

    // walk the status chain to the warehouse queue
    if (header.request_status !== HEADER_STATUS.MOVEMENT_TYPE_ASSIGNED) {
      // allow send even if operator saved everything in one shot
      setHeaderStatus(header, HEADER_STATUS.MOVEMENT_TYPE_ASSIGNED, { user: req.user, sourceScreen: 'ERP Operator' });
    }
    setHeaderStatus(header, HEADER_STATUS.WAREHOUSE_ASSIGNED, { user: req.user, sourceScreen: 'ERP Operator' });
    setHeaderStatus(header, HEADER_STATUS.PENDING_BIN_ASSIGNMENT, { user: req.user, sourceScreen: 'ERP Operator' });
  });
  try { send(); } catch (err) { return sendError(res, err); }

  notify.notifyPermission('bin_batch_assignment', { requestNumber: header.request_number,
    notificationType: 'WAREHOUSE_QUEUE', title: `Request ${header.request_number} routed to ${header.issue_warehouse_code}`,
    message: 'A request is waiting for bin/batch assignment.' });

  res.json({ message: `Request sent to warehouse ${header.issue_warehouse_code}.` });
});

module.exports = router;
