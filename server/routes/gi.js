/**
 * Goods Issue posting — warehouse system operator reviews picked quantities and
 * posts GI in ERP (manual entry or connector). On success the request closes as
 * Completed / Partially Completed / Closed with Shortage; on failure it moves to
 * ERP Error and stays open until resolved.
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
const { recordMovement } = require('./../services/ledger');
const { setHeaderStatus, refreshRollups, getHeaderOr404, reopenForRepick } = require('./../services/requests');
const { HEADER_STATUS, LINE_STATUS } = require('./../workflow/states');

const router = express.Router();
router.use(authenticate, requirePermission('gi_posting'));

const GI_STAGES = [HEADER_STATUS.PENDING_ERP_GI, HEADER_STATUS.ERP_ERROR];
const FINAL_GI_STAGES = [HEADER_STATUS.COMPLETED, HEADER_STATUS.PARTIALLY_COMPLETED, HEADER_STATUS.CLOSED_WITH_SHORTAGE];

function existingGiResponse(header) {
  return {
    message: `Goods Issue was already posted. Request ${header.request_status}.`,
    gi: {
      giDocumentNumber: header.gi_document_number,
      fiscalYear: header.gi_fiscal_year,
      postingDate: header.gi_posting_date,
    },
    status: header.request_status,
    idempotent: true,
  };
}

/** GET /api/gi — GI posting queue. */
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, request_number, requester_name, department, wbs_element AS project, cost_center, required_date,
           priority, issue_warehouse_code, movement_type,
           erp_reservation_number, erp_reference_number, request_status,
           total_lines, shortage_lines, erp_error_message
    FROM material_request_headers
    WHERE request_status IN (?, ?)
    ORDER BY id
  `).all(...GI_STAGES);
  res.json({ requests: rows });
});

/** GET /api/gi/:id — review picked quantities, batches, bins, QR history. */
router.get('/:id', (req, res) => {
  const header = getHeaderOr404(res, req.params.id);
  if (!header) return;
  const lines = db.prepare("SELECT * FROM material_request_lines WHERE request_id=? AND line_status NOT IN ('Rejected','Cancelled') ORDER BY line_number").all(header.id);
  const allocations = db.prepare('SELECT * FROM picking_allocations WHERE request_id=? ORDER BY line_number, sequence').all(header.id);
  const scans = db.prepare("SELECT action, new_value, changed_by_name, changed_at, line_number FROM audit_trail WHERE request_number=? AND action LIKE 'QR_SCAN%' ORDER BY id").all(header.request_number);
  res.json({ request: header, lines, allocations, qr_scans: scans });
});

/**
 * POST /api/gi/:id/post — post Goods Issue.
 * body: { gi_document_number, fiscal_year?, posting_date?, simulate_error? }
 */
router.post('/:id/post', (req, res) => {
  const header = getHeaderOr404(res, req.params.id);
  if (!header) return;

  // Safe replay: a client retry after a successful response must not create a
  // second ERP posting or duplicate stock-ledger rows.
  if (FINAL_GI_STAGES.includes(header.request_status) && header.gi_document_number) {
    return res.json(existingGiResponse(header));
  }
  if (!GI_STAGES.includes(header.request_status)) {
    return res.status(400).json({ error: `Request is not ready for GI posting (status '${header.request_status}').` });
  }
  if (header.erp_posting_status === 'PROCESSING') {
    return res.status(409).json({ error: 'Goods Issue posting is already in progress for this request.' });
  }

  const lines = db.prepare("SELECT * FROM material_request_lines WHERE request_id=? AND line_status NOT IN ('Rejected','Cancelled')").all(header.id);
  const picked = lines.filter((l) => (l.picked_quantity || 0) > 0);
  if (picked.length === 0) {
    return res.status(400).json({ error: 'Cannot post GI: no picked quantities. Return to picker.' });
  }

  // SoD: the GI poster must differ from both the approver and the ERP operator.
  const sodErr = sod.conflict(req.user, [
    { id: sod.approverId(header.request_number), label: 'approval' },
    { id: header.erp_created_by, label: 'ERP reservation' },
  ]);
  if (sodErr) return res.status(403).json({ error: sodErr });

  // Atomic claim. This protects duplicate submissions from concurrent browser
  // tabs and from multiple application workers sharing the SQLite database.
  const claim = db.prepare(`
    UPDATE material_request_headers
    SET erp_posting_status='PROCESSING', updated_at=datetime('now')
    WHERE id=? AND request_status IN (?, ?)
      AND COALESCE(erp_posting_status, '') <> 'PROCESSING'
  `).run(header.id, ...GI_STAGES);
  if (claim.changes !== 1) {
    const current = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(header.id);
    if (current && FINAL_GI_STAGES.includes(current.request_status) && current.gi_document_number) {
      return res.json(existingGiResponse(current));
    }
    return res.status(409).json({ error: 'Goods Issue posting is already in progress for this request.' });
  }

  const b = req.body || {};
  const payload = {
    requestNumber: header.request_number, erpReservationNumber: header.erp_reservation_number,
    erpReferenceNumber: header.erp_reference_number, movementType: header.movement_type,
    plant: header.plant, storageLocation: header.storage_location, issueWarehouse: header.issue_warehouse_code,
    costCenter: header.cost_center, wbsElement: header.wbs_element, internalOrder: header.internal_order,
    productionOrder: header.production_order,
    lines: picked.map((l) => ({ material: l.material_code, quantity: l.picked_quantity, uom: l.uom,
      batch: l.batch_number, bin: l.bin_location })),
  };

  let result;
  try {
    result = erp.connector().postGoodsIssue({
      requestNumber: header.request_number, payload,
      giDocumentNumber: b.gi_document_number, fiscalYear: b.fiscal_year,
      simulateError: !!b.simulate_error, user: req.user,
    });
  } catch (err) {
    db.prepare("UPDATE material_request_headers SET erp_posting_status='FAILED', erp_error_message=?, updated_at=datetime('now') WHERE id=?")
      .run(err.message || 'ERP connector failure', header.id);
    return sendError(res, err);
  }

  if (!result.ok) {
    setHeaderStatus(header, HEADER_STATUS.ERP_ERROR, { user: req.user, sourceScreen: 'GI Posting',
      set: { erp_posting_status: 'FAILED', erp_error_message: result.errorMessage } });
    audit.record({ entityType: 'MaterialRequestHeader', entityId: header.id, requestNumber: header.request_number,
      action: 'GI_POST_FAILED', newValue: result.errorMessage, user: req.user, sourceScreen: 'GI Posting' });
    notify.send({ requestNumber: header.request_number, recipientUserId: header.requester_id,
      notificationType: 'ERP_ERROR', title: `ERP posting failed for ${header.request_number}`, message: result.errorMessage });
    return res.status(400).json({ error: result.errorMessage, status: HEADER_STATUS.ERP_ERROR });
  }

  // success
  const anyShort = lines.some((l) => [LINE_STATUS.PARTIALLY_PICKED, LINE_STATUS.SHORTAGE, LINE_STATUS.PENDING_GI].includes(l.line_status)
    && (l.shortage_quantity || 0) > 0);
  const finalStatus = lines.every((l) => (l.picked_quantity || 0) === 0)
    ? HEADER_STATUS.CLOSED_WITH_SHORTAGE
    : anyShort ? HEADER_STATUS.PARTIALLY_COMPLETED : HEADER_STATUS.COMPLETED;

  db.transaction(() => {
    // A retry after an ERP error re-enters the GI queue before posting.
    if (header.request_status === HEADER_STATUS.ERP_ERROR) {
      setHeaderStatus(header, HEADER_STATUS.PENDING_ERP_GI, { user: req.user, sourceScreen: 'GI Posting' });
    }
    setHeaderStatus(header, HEADER_STATUS.GI_POSTED, { user: req.user, sourceScreen: 'GI Posting', set: {
      gi_document_number: result.response.giDocumentNumber, gi_fiscal_year: result.response.fiscalYear,
      gi_posting_date: result.response.postingDate, erp_posted_by: req.user.id,
      erp_posting_status: 'POSTED', erp_error_message: null,
    } });
    db.prepare("UPDATE material_request_lines SET line_status=?, issued_quantity=picked_quantity WHERE request_id=? AND line_status=?")
      .run(LINE_STATUS.GI_POSTED, header.id, LINE_STATUS.PENDING_GI);
    // Movement ledger: goods issue = stock OUT (one row per issued line).
    picked.forEach((l) => recordMovement({
      type: 'OUT', materialId: l.material_id, warehouseCode: header.issue_warehouse_code,
      quantity: l.picked_quantity, userId: req.user.id,
      reservationNumber: header.erp_reservation_number || header.erp_reference_number,
      notes: `GI ${result.response.giDocumentNumber} / ${header.request_number}`,
    }));
    setHeaderStatus(header, finalStatus, { user: req.user, sourceScreen: 'GI Posting',
      set: { closed_at: new Date().toISOString() } });
    refreshRollups(header.id);
    audit.record({ entityType: 'MaterialRequestHeader', entityId: header.id, requestNumber: header.request_number,
      action: 'GI_POSTED', newValue: result.response, user: req.user, sourceScreen: 'GI Posting' });
  })();

  notify.send({ requestNumber: header.request_number, recipientUserId: header.requester_id,
    notificationType: 'REQUEST_COMPLETED', title: `Request ${header.request_number}: ${finalStatus}`,
    message: `GI document ${result.response.giDocumentNumber} posted.`, email: true });

  res.json({ message: `Goods Issue posted. Request ${finalStatus}.`, gi: result.response, status: finalStatus });
});

// Reversal movement type for each issue movement type (SAP-style pairing).
const REVERSAL_OF = { 201: '202', 221: '222', 261: '262' };
const REVERSIBLE_STATUSES = [HEADER_STATUS.COMPLETED, HEADER_STATUS.PARTIALLY_COMPLETED, HEADER_STATUS.CLOSED_WITH_SHORTAGE];

/**
 * POST /api/gi/:id/reverse — reverse a posted Goods Issue.
 * Returns the issued stock to its batches (ledger IN with the reversal movement
 * type) and closes the request as Reversed. body: { reason } (mandatory).
 */
router.post('/:id/reverse', (req, res) => {
  const header = getHeaderOr404(res, req.params.id);
  if (!header) return;
  if (!REVERSIBLE_STATUSES.includes(header.request_status)) {
    return res.status(400).json({ error: `Only a posted/closed request can be reversed (status '${header.request_status}').` });
  }
  if (!header.gi_document_number) {
    return res.status(400).json({ error: 'No goods-issue document on this request to reverse.' });
  }
  const reason = (req.body || {}).reason;
  if (!isNonEmptyString(reason)) {
    return res.status(400).json({ error: 'A reversal reason is required.' });
  }

  const reversalType = REVERSAL_OF[header.movement_type] || null;
  // Allocations that were actually picked hold the batch + issued quantity.
  const picked = db.prepare(
    "SELECT * FROM picking_allocations WHERE request_id=? AND status='PICKED' AND picked_quantity > 0"
  ).all(header.id);
  const issuedLines = db.prepare(
    'SELECT * FROM material_request_lines WHERE request_id=? AND issued_quantity > 0'
  ).all(header.id);
  if (picked.length === 0 && issuedLines.length === 0) {
    return res.status(400).json({ error: 'Nothing was issued on this request; nothing to reverse.' });
  }

  const result = erp.connector().reverseGoodsIssue({
    requestNumber: header.request_number,
    originalGiDocument: header.gi_document_number,
    reversalMovementType: reversalType,
    payload: { lines: issuedLines.map((l) => ({ material: l.material_code, quantity: l.issued_quantity })) },
    user: req.user,
  });

  db.transaction(() => {
    // Put the issued quantity back on each picked batch.
    picked.forEach((a) => {
      db.prepare('UPDATE batches SET remaining_quantity = remaining_quantity + ? WHERE id=?')
        .run(a.picked_quantity, a.batch_id);
    });
    // Ledger IN (reversal) per issued line, and mark the line reversed.
    issuedLines.forEach((l) => {
      recordMovement({
        type: 'IN', materialId: l.material_id, warehouseCode: header.issue_warehouse_code,
        quantity: l.issued_quantity, userId: req.user.id,
        reservationNumber: header.erp_reservation_number || header.erp_reference_number,
        notes: `GI reversal ${result.response.reversalDocumentNumber} / ${header.request_number}`,
      });
      db.prepare("UPDATE material_request_lines SET line_status=?, updated_at=datetime('now') WHERE id=?")
        .run(LINE_STATUS.REVERSED, l.id);
    });
    setHeaderStatus(header, HEADER_STATUS.REVERSED, {
      user: req.user, reason, sourceScreen: 'GI Posting',
      set: { closure_reason: `Reversed: ${reason} (doc ${result.response.reversalDocumentNumber})`, closed_at: new Date().toISOString() },
    });
    audit.record({ entityType: 'MaterialRequestHeader', entityId: header.id, requestNumber: header.request_number,
      action: 'GI_REVERSED', newValue: { reversal: result.response, reversed_lines: issuedLines.length },
      reason, user: req.user, sourceScreen: 'GI Posting' });
  })();

  notify.send({ requestNumber: header.request_number, recipientUserId: header.requester_id,
    notificationType: 'GI_REVERSED', title: `Request ${header.request_number} goods issue reversed`,
    message: `Reversal document ${result.response.reversalDocumentNumber} posted. ${reason}`, email: true });

  res.json({ message: 'Goods issue reversed; stock returned to batches.', reversal: result.response });
});

/** POST /api/gi/:id/return-to-picker — send back for re-pick. */
router.post('/:id/return-to-picker', (req, res) => {
  const header = getHeaderOr404(res, req.params.id);
  if (!header) return;
  if (header.request_status !== HEADER_STATUS.PENDING_ERP_GI && header.request_status !== HEADER_STATUS.ERP_ERROR) {
    return res.status(400).json({ error: 'Only GI-stage requests can be returned to picker.' });
  }
  let task;
  const returnToPicker = db.transaction(() => {
    task = reopenForRepick(header, { user: req.user, reason: req.body.reason, sourceScreen: 'GI Posting' });
  });
  try { returnToPicker(); } catch (err) { return sendError(res, err); }
  if (task) notify.send({ requestNumber: header.request_number, taskId: task.id, recipientUserId: task.assigned_picker_id,
    notificationType: 'RETURNED_TO_PICKER', title: `Request ${header.request_number} returned for re-pick`, message: req.body.reason || '' });
  res.json({ message: 'Returned to picker.' });
});

module.exports = router;
