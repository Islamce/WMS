// Material Requests — creation, line management, submission, listing, detail.
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isPositiveNumber, isId, parsePagination } = require('./../utils/validate');
const { sendError } = require('./../utils/errors');
const audit = require('./../services/audit');
const notify = require('./../services/notify');
const { nextRequestNumber, setHeaderStatus, refreshRollups, getHeaderOr404, releaseOpenAllocations } = require('./../services/requests');
const { reverseOneStep } = require('./../services/reverseWorkflow');
const { HEADER_STATUS, LINE_STATUS } = require('./../workflow/states');

const router = express.Router();
router.use(authenticate);

function canView(req, header) {
  if (req.user.role === 'admin') return true;
  if (header.requester_id === req.user.id) return true;
  const perms = req.user.permissions;
  return ['approvals', 'erp_operator', 'warehouse_dashboard', 'bin_batch_assignment',
    'picker_assignment', 'gi_posting', 'picking', 'audit_trail', 'kpi_dashboard']
    .some((p) => perms.includes(p));
}

router.get('/', requirePermission('material_requests'), (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const filters = [];
  const params = [];
  const privileged = req.user.role === 'admin' ||
    ['approvals', 'erp_operator', 'warehouse_dashboard', 'gi_posting', 'audit_trail', 'kpi_dashboard']
      .some((p) => req.user.permissions.includes(p));
  if (!privileged) { filters.push('requester_id = ?'); params.push(req.user.id); }
  if (req.query.status) { filters.push('request_status = ?'); params.push(req.query.status); }
  if (req.query.search) {
    filters.push('(request_number LIKE ? OR purpose LIKE ? OR requester_name LIKE ?)');
    const like = `%${req.query.search}%`;
    params.push(like, like, like);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM material_request_headers ${where}`).get(...params);
  const requests = db.prepare(`
    SELECT id, request_number, request_type, requester_name, department, priority, required_date,
           request_status, current_workflow_step, issue_warehouse_code, movement_type,
           total_lines, completed_lines, shortage_lines, created_at, submitted_at
    FROM material_request_headers ${where}
    ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({ requests, total, page, limit });
});

router.get('/:id', requirePermission('material_requests'), (req, res) => {
  const header = getHeaderOr404(res, req.params.id);
  if (!header) return;
  if (!canView(req, header)) return res.status(403).json({ error: 'Not authorized to view this request.' });
  const lines = db.prepare('SELECT * FROM material_request_lines WHERE request_id=? ORDER BY line_number').all(header.id);
  const task = db.prepare('SELECT * FROM picking_tasks WHERE request_id=? ORDER BY id DESC LIMIT 1').get(header.id);
  res.json({ request: header, lines, task });
});

router.post('/', requirePermission('create_request'), (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.lines) || b.lines.length === 0) {
    return res.status(400).json({ error: 'At least one material line is required.' });
  }
  for (const [i, l] of b.lines.entries()) {
    if (!isId(l.material_id)) return res.status(400).json({ error: `Line ${i + 1}: material is required.` });
    if (!isPositiveNumber(l.requested_quantity)) {
      return res.status(400).json({ error: `Line ${i + 1}: quantity must be greater than zero.` });
    }
  }
  const requestNumber = nextRequestNumber();
  const create = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO material_request_headers
        (request_number, request_type, requester_id, requester_name, employee_id, department, section,
         company, business_unit, plant, cost_center, wbs_element, internal_order, production_order,
         required_date, priority, purpose, delivery_location, request_status, current_workflow_step,
         created_by, total_lines)
      VALUES (@rn, @request_type, @rid, @rname, @employee_id, @department, @section,
         @company, @business_unit, @plant, @cost_center, @wbs_element, @internal_order, @production_order,
         @required_date, @priority, @purpose, @delivery_location, @status, @status, @rid, @total)
    `).run({
      rn: requestNumber,
      request_type: b.request_type || 'COST_CENTER',
      rid: req.user.id, rname: req.user.name,
      employee_id: b.employee_id || null, department: b.department || null, section: b.section || null,
      company: b.company || null, business_unit: b.business_unit || null, plant: b.plant || null,
      cost_center: b.cost_center || null, wbs_element: b.wbs_element || null,
      internal_order: b.internal_order || null, production_order: b.production_order || null,
      required_date: b.required_date || null, priority: b.priority || 'NORMAL',
      purpose: (b.purpose || '').trim() || null, delivery_location: b.delivery_location || null,
      status: HEADER_STATUS.DRAFT, total: b.lines.length,
    });
    const requestId = info.lastInsertRowid;
    const insLine = db.prepare(`
      INSERT INTO material_request_lines
        (request_id, request_number, line_number, material_id, material_code, material_description,
         material_type, material_group, uom, requested_quantity, line_status,
         is_batch_managed, is_expiry_managed, is_serial_managed)
      VALUES (@request_id, @rn, @line_number, @material_id, @material_code, @material_description,
         @material_type, @material_group, @uom, @requested_quantity, @status,
         @is_batch_managed, @is_expiry_managed, @is_serial_managed)`);
    b.lines.forEach((l, idx) => {
      const m = db.prepare('SELECT * FROM materials WHERE id=?').get(l.material_id);
      if (!m) { const e = new Error(`Material ${l.material_id} not found.`); e.status = 400; throw e; }
      insLine.run({
        request_id: requestId, rn: requestNumber, line_number: idx + 1,
        material_id: m.id, material_code: m.item_code, material_description: m.description,
        material_type: m.material_type, material_group: m.material_group, uom: m.unit,
        requested_quantity: Number(l.requested_quantity), status: LINE_STATUS.DRAFT,
        is_batch_managed: m.is_batch_managed || 0, is_expiry_managed: m.is_expiry_managed || 0,
        is_serial_managed: m.is_serial_managed || 0,
      });
    });
    audit.record({ entityType: 'MaterialRequestHeader', entityId: requestId, requestNumber,
      action: 'CREATE', newValue: { lines: b.lines.length }, user: req.user, sourceScreen: 'Create Request' });
    return requestId;
  });
  let id;
  try { id = create(); } catch (err) { return sendError(res, err, 'Failed to create request.'); }
  res.status(201).json({ message: 'Request created as draft.', id, request_number: requestNumber });
});

router.post('/:id/submit', requirePermission('create_request'), (req, res) => {
  const header = getHeaderOr404(res, req.params.id);
  if (!header) return;
  if (header.requester_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You can only submit your own requests.' });
  }

  let outcome;
  const submit = db.transaction(() => {
    const current = db.prepare('SELECT * FROM material_request_headers WHERE id=?').get(header.id);
    if ([HEADER_STATUS.SUBMITTED, HEADER_STATUS.PENDING_MANAGER_APPROVAL, HEADER_STATUS.UNDER_REVIEW].includes(current.request_status)) {
      return { idempotent: true, status: current.request_status };
    }
    if (![HEADER_STATUS.DRAFT, HEADER_STATUS.RETURNED_TO_REQUESTER].includes(current.request_status)) {
      const err = new Error(`Cannot submit a request in status '${current.request_status}'.`);
      err.status = 400;
      throw err;
    }
    const lines = db.prepare('SELECT COUNT(*) AS n FROM material_request_lines WHERE request_id=?').get(current.id);
    if (lines.n === 0) { const err = new Error('Cannot submit a request with no material lines.'); err.status = 400; throw err; }
    setHeaderStatus(current, HEADER_STATUS.SUBMITTED, { user: req.user, sourceScreen: 'My Requests' });
    setHeaderStatus(current, HEADER_STATUS.PENDING_MANAGER_APPROVAL, {
      user: req.user, sourceScreen: 'My Requests', set: { submitted_at: new Date().toISOString() },
    });
    db.prepare('UPDATE material_request_lines SET line_status=? WHERE request_id=?')
      .run(LINE_STATUS.PENDING_APPROVAL, current.id);
    return { idempotent: false, status: HEADER_STATUS.PENDING_MANAGER_APPROVAL };
  });

  try { outcome = submit(); } catch (err) { return sendError(res, err); }
  if (!outcome.idempotent) {
    notify.notifyPermission('approvals', {
      requestNumber: header.request_number, notificationType: 'REQUEST_SUBMITTED',
      title: `New request ${header.request_number} awaiting approval`,
      message: `${req.user.name} submitted a material request for approval.`,
    });
  }
  return res.json({
    message: outcome.idempotent
      ? 'Request was already submitted for manager approval.'
      : 'Request submitted for manager approval.',
    idempotent: outcome.idempotent,
    status: outcome.status,
  });
});

router.post('/:id/cancel', requirePermission('material_requests'), (req, res) => {
  const header = getHeaderOr404(res, req.params.id);
  if (!header) return;
  if (header.requester_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized to cancel this request.' });
  }
  const terminal = [HEADER_STATUS.COMPLETED, HEADER_STATUS.CANCELLED, HEADER_STATUS.GI_POSTED];
  if (terminal.includes(header.request_status)) {
    return res.status(400).json({ error: `Cannot cancel a request in status '${header.request_status}'.` });
  }
  const cancel = db.transaction(() => {
    const released = releaseOpenAllocations(header.id);
    setHeaderStatus(header, HEADER_STATUS.CANCELLED, {
      user: req.user, reason: req.body.reason, sourceScreen: 'Request Detail',
      set: { closed_at: new Date().toISOString(), closure_reason: req.body.reason || 'Cancelled by requester' },
    });
    return released;
  });
  const released = cancel();
  res.json({ message: `Request cancelled.${released ? ` Released ${released} stock reservation(s).` : ''}` });
});

router.post('/:id/reverse', (req, res) => {
  const header = getHeaderOr404(res, req.params.id);
  if (!header) return;
  try {
    const result = reverseOneStep(header, { user: req.user, reason: (req.body || {}).reason });
    res.json(result);
  } catch (err) { sendError(res, err); }
});

module.exports = router;
