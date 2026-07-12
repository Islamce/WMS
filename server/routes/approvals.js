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
const { setHeaderStatus, refreshRollups, getHeaderOr404 } = require('./../services/requests');
const { HEADER_STATUS, LINE_STATUS } = require('./../workflow/states');

const router = express.Router();
router.use(authenticate, requirePermission('approvals'));

const APPROVABLE = [HEADER_STATUS.PENDING_MANAGER_APPROVAL, HEADER_STATUS.UNDER_REVIEW];

/** GET /api/approvals — manager inbox (pending requests). */
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, request_number, requester_name, department, priority, required_date,
           request_status, total_lines, created_at, submitted_at
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
  // Segregation of duties: nobody may act as approver on their own request,
  // regardless of role. Another approver (or admin) must take the decision.
  if (user && header.requester_id === user.id) {
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
      notificationType: 'REQUEST_REJECTED', title: `Request ${header.request_number} rejected`, message: reason });
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
      // auto-hand off to ERP operator queue
      setHeaderStatus(header, HEADER_STATUS.APPROVED_PENDING_ERP, { user: req.user, sourceScreen: 'Approval Detail' });
      db.prepare('UPDATE material_request_lines SET line_status=? WHERE request_id=? AND line_status=?')
        .run(LINE_STATUS.PENDING_ERP_RESERVATION, header.id, LINE_STATUS.APPROVED);
      refreshRollups(header.id);
    })();

    notify.send({ requestNumber: header.request_number, recipientUserId: header.requester_id,
      notificationType: 'REQUEST_APPROVED',
      title: `Request ${header.request_number} ${decision === 'partial' ? 'partially ' : ''}approved`,
      message: comments || 'Your request was approved and moved to ERP processing.' });
    notify.notifyPermission('erp_operator', { requestNumber: header.request_number,
      notificationType: 'ERP_QUEUE', title: `Request ${header.request_number} ready for ERP processing`,
      message: 'An approved request is waiting in the ERP Operator queue.' });
    return res.json({ message: `Request ${decision === 'partial' ? 'partially ' : ''}approved and sent to ERP Operator.` });
  }

  res.status(400).json({ error: 'decision must be one of: approve, partial, reject, return.' });
});

module.exports = router;
