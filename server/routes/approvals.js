/**
 * Manager Approval — approve / reject / return / partially approve, and modify
 * header fields, line quantities, add/delete lines. Every modification is
 * written to the audit trail with old value, new value, user, role and reason.
 * No silent changes are possible.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isId, isPositiveNumber, isNonEmptyString } = require('./../utils/validate');
const audit = require('./../services/audit');
const notify = require('./../services/notify');
const approvalMatrix = require('./../services/approvalMatrix');
const { setHeaderStatus, refreshRollups } = require('./../services/requests');
const { HEADER_STATUS, LINE_STATUS } = require('./../workflow/states');
const { getTenant } = require('./../services/tenant');
const { usesErpStaging } = require('./../services/tenantProfile');

const router = express.Router();
router.use(authenticate, requirePermission('approvals'));

const APPROVABLE = [HEADER_STATUS.PENDING_MANAGER_APPROVAL, HEADER_STATUS.UNDER_REVIEW];

/**
 * On a request raised for a subcontractor, quantities are project management's
 * call, not the warehouse's — the contractor was explicit about that. Holding
 * 'approvals' lets you see the request; deciding what quantity it may draw
 * additionally needs this authority.
 *
 * Returns an error payload to send, or null when the user may act. Admins are
 * exempt, as they are for the approval matrix: on a fresh install nobody holds
 * this yet, and an administrator has to be able to assign it.
 */
function projectManagementGate(user, header) {
  if (!header.subcontractor_id) return null;
  if (user.role === 'admin') return null;
  if (user.permissions.includes('project_management_approval')) return null;
  return {
    error: `Request ${header.request_number} is raised for subcontractor `
      + `'${header.subcontractor_name || header.subcontractor_id}'. Quantities on a subcontractor `
      + "request are approved by project management, which requires the 'project_management_approval' authority.",
    required_permission: 'project_management_approval',
  };
}

/** GET /api/approvals/matrix — the value-based approval authority table. */
router.get('/matrix', (req, res) => {
  res.json({ thresholds: approvalMatrix.listThresholds() });
});

/** GET /api/approvals — manager inbox (pending requests). */
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, request_number, requester_name, department, priority, required_date,
           request_status, total_lines, created_at, submitted_at,
           subcontractor_id, subcontractor_name
    FROM material_request_headers
    WHERE request_status IN (?, ?)
    ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, submitted_at
  `).all(HEADER_STATUS.PENDING_MANAGER_APPROVAL, HEADER_STATUS.UNDER_REVIEW);
  res.json({ requests: rows });
});

function loadApprovable(res, id, user) {
  const header = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(id);
  if (!header) { res.status(404).json({ error: 'Request not found.' }); return null; }
  if (!APPROVABLE.includes(header.request_status)) {
    res.status(400).json({ error: `Request is not awaiting approval (status '${header.request_status}').` });
    return null;
  }
  // Segregation of duties: a regular approver may not act on their own request.
  // Admins are exempt (super-user, and needed for testing/bootstrapping).
  if (user && user.role !== 'admin' && header.requester_id === user.id) {
    res.status(403).json({ error: 'You cannot approve or modify your own request (segregation of duties).' });
    return null;
  }
  return header;
}

/**
 * PATCH /api/approvals/:id/header — modify header fields (priority, required
 * date, cost objects). Each changed field is audited individually.
 */
router.patch('/:id/header', (req, res) => {
  const header = loadApprovable(res, req.params.id, req.user);
  if (!header) return;
  const editable = ['priority', 'required_date', 'cost_center', 'wbs_element', 'internal_order', 'production_order'];
  const b = req.body || {};
  const changes = [];
  editable.forEach((f) => {
    if (b[f] !== undefined && String(b[f] ?? '') !== String(header[f] ?? '')) {
      changes.push([f, header[f], b[f]]);
    }
  });
  if (changes.length === 0) return res.json({ message: 'No changes.' });

  const apply = db.transaction(() => {
    changes.forEach(([f, oldV, newV]) => {
      db.prepare(`UPDATE material_request_headers SET ${f}=? , updated_by=? WHERE id=?`).run(newV, req.user.id, header.id);
      audit.record({ entityType: 'MaterialRequestHeader', entityId: header.id, requestNumber: header.request_number,
        action: 'HEADER_MODIFY', oldValue: { [f]: oldV }, newValue: { [f]: newV }, user: req.user,
        reason: b.reason, sourceScreen: 'Approval Detail' });
    });
    setHeaderStatus(header, HEADER_STATUS.UNDER_REVIEW, { user: req.user, sourceScreen: 'Approval Detail' });
  });
  apply();
  res.json({ message: `Updated ${changes.length} field(s).` });
});

/** PATCH /api/approvals/:id/lines/:lineId — modify a line's approved quantity. */
router.patch('/:id/lines/:lineId', (req, res) => {
  const header = loadApprovable(res, req.params.id, req.user);
  if (!header) return;
  const line = db.prepare('SELECT * FROM material_request_lines WHERE id=? AND request_id=?')
    .get(req.params.lineId, header.id);
  if (!line) return res.status(404).json({ error: 'Line not found.' });

  const gate = projectManagementGate(req.user, header);
  if (gate) return res.status(403).json(gate);

  const { approved_quantity, reason } = req.body || {};
  if (!isPositiveNumber(approved_quantity)) {
    return res.status(400).json({ error: 'Approved quantity must be greater than zero.' });
  }
  const oldQty = line.approved_quantity ?? line.requested_quantity;
  db.prepare("UPDATE material_request_lines SET approved_quantity=?, updated_at=datetime('now') WHERE id=?")
    .run(Number(approved_quantity), line.id);
  audit.record({ entityType: 'MaterialRequestLine', entityId: line.id, requestNumber: header.request_number,
    lineNumber: line.line_number, action: 'QTY_CHANGE', oldValue: oldQty, newValue: Number(approved_quantity),
    user: req.user, reason, sourceScreen: 'Approval Detail' });
  setHeaderStatus(header, HEADER_STATUS.UNDER_REVIEW, { user: req.user, sourceScreen: 'Approval Detail' });
  res.json({ message: 'Line quantity updated.' });
});

/** DELETE /api/approvals/:id/lines/:lineId — remove a line (reason mandatory). */
router.delete('/:id/lines/:lineId', (req, res) => {
  const header = loadApprovable(res, req.params.id, req.user);
  if (!header) return;
  const line = db.prepare('SELECT * FROM material_request_lines WHERE id=? AND request_id=?')
    .get(req.params.lineId, header.id);
  if (!line) return res.status(404).json({ error: 'Line not found.' });
  if (!isNonEmptyString(req.body.reason)) {
    return res.status(400).json({ error: 'A reason is required to delete a material line.' });
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM material_request_lines WHERE request_id=?').get(header.id).n;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last remaining line.' });

  db.transaction(() => {
    db.prepare('DELETE FROM material_request_lines WHERE id=?').run(line.id);
    audit.record({ entityType: 'MaterialRequestLine', entityId: line.id, requestNumber: header.request_number,
      lineNumber: line.line_number, action: 'LINE_DELETE', oldValue: line.material_code, user: req.user,
      reason: req.body.reason, sourceScreen: 'Approval Detail' });
    refreshRollups(header.id);
    setHeaderStatus(header, HEADER_STATUS.UNDER_REVIEW, { user: req.user, sourceScreen: 'Approval Detail' });
  })();
  res.json({ message: 'Line deleted.' });
});

/** POST /api/approvals/:id/lines — add a new line during approval. */
router.post('/:id/lines', (req, res) => {
  const header = loadApprovable(res, req.params.id, req.user);
  if (!header) return;
  const { material_id, requested_quantity, reason } = req.body || {};
  if (!isId(material_id) || !isPositiveNumber(requested_quantity)) {
    return res.status(400).json({ error: 'Material and a positive quantity are required.' });
  }
  const m = db.prepare('SELECT * FROM materials WHERE id=?').get(material_id);
  if (!m) return res.status(404).json({ error: 'Material not found.' });
  const nextLine = (db.prepare('SELECT MAX(line_number) AS mx FROM material_request_lines WHERE request_id=?').get(header.id).mx || 0) + 1;

  db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO material_request_lines
        (request_id, request_number, line_number, material_id, material_code, material_description,
         material_type, material_group, uom, requested_quantity, approved_quantity, line_status,
         is_batch_managed, is_expiry_managed, is_serial_managed)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(header.id, header.request_number, nextLine, m.id, m.item_code, m.description,
      m.material_type, m.material_group, m.unit, Number(requested_quantity), Number(requested_quantity),
      LINE_STATUS.PENDING_APPROVAL, m.is_batch_managed || 0, m.is_expiry_managed || 0, m.is_serial_managed || 0);
    audit.record({ entityType: 'MaterialRequestLine', entityId: info.lastInsertRowid, requestNumber: header.request_number,
      lineNumber: nextLine, action: 'LINE_ADD', newValue: { material: m.item_code, qty: requested_quantity },
      user: req.user, reason, sourceScreen: 'Approval Detail' });
    refreshRollups(header.id);
    setHeaderStatus(header, HEADER_STATUS.UNDER_REVIEW, { user: req.user, sourceScreen: 'Approval Detail' });
  })();
  res.status(201).json({ message: 'Line added.' });
});


/**
 * Route an approved request straight to the store, with no ERP reservation.
 *
 * The SAP chain this product was modelled on stages an approved request through
 * a reservation raised by an ERP operator. On a construction site there is no
 * SAP and no reservation: the engineer approves and the store issues. Requiring
 * one there means asking a storekeeper to type a document number that does not
 * exist.
 *
 * The stock movement is NOT skipped — that is the real event. What is skipped is
 * the staging document in front of it. `stock_transactions.reservation_number`
 * is required on every outbound movement, so a locally generated issue number
 * takes the reservation's place: same ledger shape, same reports, and the number
 * still answers "which document did this issue happen under". That is the same
 * principle as a delivery note standing in for a purchase order on material the
 * company did not buy.
 *
 * Returns null when the request can go straight through, or an error payload
 * naming what is missing. Nothing is guessed: a site store that cannot be
 * resolved is reported, never picked at random.
 */
function routeWithoutErp(header, user) {
  const warehouse = header.issue_warehouse_code
    ? db.prepare('SELECT * FROM warehouses WHERE warehouse_code=?').get(header.issue_warehouse_code)
    : db.prepare('SELECT * FROM warehouses WHERE COALESCE(is_active,1)=1').all().length === 1
      ? db.prepare('SELECT * FROM warehouses WHERE COALESCE(is_active,1)=1').get()
      : null;

  if (!warehouse) {
    return { error: 'This request does not name a site store, and there is more than one to choose from. '
      + 'Set the issue warehouse on the request before approving it.' };
  }

  // A movement type is still recorded, because every movement is categorised.
  // It is defaulted rather than asked for: this edition does not include the
  // movement-type master, so there is no screen on which to choose one.
  const movementType = header.movement_type
    || (db.prepare("SELECT code FROM movement_types WHERE direction='ISSUE' AND COALESCE(is_active,1)=1 ORDER BY code LIMIT 1").get() || {}).code
    || null;
  if (!movementType) return { error: 'No issue movement type is configured.' };

  const year = new Date().getFullYear();
  const seq = db.prepare(
    "SELECT COUNT(*) AS n FROM material_request_headers WHERE erp_reservation_number LIKE ?"
  ).get(`ISS-${year}-%`).n + 1;
  const issueNumber = `ISS-${year}-${String(seq).padStart(5, '0')}`;

  db.prepare(`
    UPDATE material_request_headers
    SET erp_reservation_number=?, movement_type=?, issue_warehouse_code=?, issue_warehouse_name=?,
        storage_location=COALESCE(storage_location, ?), plant=COALESCE(plant, ?)
    WHERE id=?
  `).run(issueNumber, movementType, warehouse.warehouse_code, warehouse.warehouse_name,
    warehouse.warehouse_code, header.plant, header.id);

  const fresh = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(header.id);
  db.prepare(`
    UPDATE material_request_lines
    SET warehouse_code=?, warehouse_name=?, storage_location=?, plant=?
    WHERE request_id=? AND line_status NOT IN ('Rejected','Cancelled')
  `).run(fresh.issue_warehouse_code, fresh.issue_warehouse_name, fresh.storage_location, fresh.plant, header.id);

  setHeaderStatus(fresh, HEADER_STATUS.WAREHOUSE_ASSIGNED, { user, sourceScreen: 'Approval Detail' });
  setHeaderStatus(fresh, HEADER_STATUS.PENDING_BIN_ASSIGNMENT, { user, sourceScreen: 'Approval Detail' });

  audit.record({ entityType: 'MaterialRequestHeader', entityId: header.id, requestNumber: header.request_number,
    action: 'ROUTED_WITHOUT_ERP',
    newValue: { issue_number: issueNumber, warehouse: warehouse.warehouse_code, movement_type: movementType },
    user, sourceScreen: 'Approval Detail' });

  return null;
}

/**
 * POST /api/approvals/:id/decision — approve / partial / reject / return.
 * body: { decision: 'approve'|'partial'|'reject'|'return', comments, reason,
 *         approvedLineIds?: [] (for partial) }
 */
router.post('/:id/decision', (req, res) => {
  const header = loadApprovable(res, req.params.id, req.user);
  if (!header) return;
  const { decision, comments, reason, approvedLineIds } = req.body || {};
  const lines = db.prepare('SELECT * FROM material_request_lines WHERE request_id=?').all(header.id);

  if (decision === 'reject') {
    if (!isNonEmptyString(reason)) return res.status(400).json({ error: 'A rejection reason is required.' });
    db.transaction(() => {
      db.prepare('UPDATE material_request_lines SET line_status=? WHERE request_id=?').run(LINE_STATUS.REJECTED, header.id);
      setHeaderStatus(header, HEADER_STATUS.REJECTED, { user: req.user, reason, comments, sourceScreen: 'Approval Detail',
        set: { rejected_at: new Date().toISOString(), rejection_reason: reason, approval_comments: comments || null } });
    })();
    notify.send({ requestNumber: header.request_number, recipientUserId: header.requester_id,
      notificationType: 'REQUEST_REJECTED', title: `Request ${header.request_number} rejected`, message: reason, email: true });
    return res.json({ message: 'Request rejected.' });
  }

  if (decision === 'return') {
    if (!isNonEmptyString(reason)) return res.status(400).json({ error: 'A return reason is required.' });
    db.transaction(() => {
      db.prepare('UPDATE material_request_lines SET line_status=? WHERE request_id=?').run(LINE_STATUS.RETURNED, header.id);
      setHeaderStatus(header, HEADER_STATUS.RETURNED_TO_REQUESTER, { user: req.user, reason, comments,
        sourceScreen: 'Approval Detail', set: { returned_at: new Date().toISOString(), return_reason: reason } });
    })();
    notify.send({ requestNumber: header.request_number, recipientUserId: header.requester_id,
      notificationType: 'REQUEST_RETURNED', title: `Request ${header.request_number} returned`, message: reason });
    return res.json({ message: 'Request returned to requester.' });
  }

  if (decision === 'approve' || decision === 'partial') {
    const approvedSet = decision === 'partial'
      ? new Set((approvedLineIds || []).map(Number))
      : new Set(lines.map((l) => l.id));
    if (decision === 'partial' && approvedSet.size === 0) {
      return res.status(400).json({ error: 'Select at least one line to partially approve.' });
    }

    // Project management owns the quantity decision on a subcontractor request.
    // Deliberately not applied to 'reject' or 'return': refusing to release
    // material is never the direction that needs the extra authority, and
    // blocking a rejection would leave a request stuck with nobody able to
    // close it.
    const gate = projectManagementGate(req.user, header);
    if (gate) return res.status(403).json(gate);

    // Approval matrix: a high-value request needs an approver holding the
    // required authority. Admins are exempt.
    const directIssue = !usesErpStaging(getTenant().profileKey);

    const value = approvalMatrix.requestValue(header.id);
    const requiredPerm = approvalMatrix.requiredPermissionFor(value);
    if (requiredPerm && req.user.role !== 'admin' && !req.user.permissions.includes(requiredPerm)) {
      return res.status(403).json({
        error: `This request's value (${value.toFixed(2)}) requires the '${requiredPerm}' authority to approve.`,
        required_permission: requiredPerm, request_value: value,
      });
    }

    db.transaction(() => {
      lines.forEach((l) => {
        if (approvedSet.has(l.id)) {
          const approvedQty = l.approved_quantity ?? l.requested_quantity;
          db.prepare('UPDATE material_request_lines SET line_status=?, approved_quantity=? WHERE id=?')
            .run(LINE_STATUS.APPROVED, approvedQty, l.id);
        } else {
          db.prepare('UPDATE material_request_lines SET line_status=?, approved_quantity=0 WHERE id=?')
            .run(LINE_STATUS.REJECTED, l.id);
          audit.record({ entityType: 'MaterialRequestLine', entityId: l.id, requestNumber: header.request_number,
            lineNumber: l.line_number, action: 'LINE_NOT_APPROVED', user: req.user, sourceScreen: 'Approval Detail' });
        }
      });
      setHeaderStatus(header, HEADER_STATUS.APPROVED, {
        user: req.user, comments, sourceScreen: 'Approval Detail',
        set: { approved_at: new Date().toISOString(), approval_comments: comments || null },
      });
      if (directIssue) {
        const problem = routeWithoutErp(header, req.user);
        if (problem) { const e = new Error(problem.error); e.status = 400; throw e; }
        // Lines stay APPROVED. In the SAP chain they move to
        // PENDING_ERP_RESERVATION because a reservation is about to be raised
        // against them; here none is, so any other status would describe a
        // document that does not exist. The warehouse screen does not filter on
        // line status, so APPROVED is both true and sufficient.
      } else {
        // auto-hand off to ERP operator queue
        setHeaderStatus(header, HEADER_STATUS.APPROVED_PENDING_ERP, { user: req.user, sourceScreen: 'Approval Detail' });
        db.prepare('UPDATE material_request_lines SET line_status=? WHERE request_id=? AND line_status=?')
          .run(LINE_STATUS.PENDING_ERP_RESERVATION, header.id, LINE_STATUS.APPROVED);
      }
      refreshRollups(header.id);
    })();

    notify.send({ requestNumber: header.request_number, recipientUserId: header.requester_id,
      notificationType: 'REQUEST_APPROVED',
      title: `Request ${header.request_number} ${decision === 'partial' ? 'partially ' : ''}approved`,
      message: comments || 'Your request was approved and moved to ERP processing.', email: true });
    if (directIssue) {
      notify.notifyPermission('bin_batch_assignment', { requestNumber: header.request_number,
        notificationType: 'WAREHOUSE_QUEUE', title: `Request ${header.request_number} approved and sent to the store`,
        message: 'An approved request is waiting in the store.' });
      return res.json({
        message: `Request ${decision === 'partial' ? 'partially ' : ''}approved and sent to the store.`,
        routed_without_erp: true,
      });
    }
    notify.notifyPermission('erp_operator', { requestNumber: header.request_number,
      notificationType: 'ERP_QUEUE', title: `Request ${header.request_number} ready for ERP processing`,
      message: 'An approved request is waiting in the ERP Operator queue.' });
    return res.json({ message: `Request ${decision === 'partial' ? 'partially ' : ''}approved and sent to ERP Operator.` });
  }

  res.status(400).json({ error: 'decision must be one of: approve, partial, reject, return.' });
});

module.exports = router;
