/**
 * Request helpers: number generation, guarded status transitions, and header
 * rollups. Centralising these keeps route handlers thin and consistent.
 */
const db = require('./../db/connection');
const audit = require('./audit');
const { canTransition } = require('./../workflow/states');

/** Generate the next request number: MR-YYYY-000123. */
function nextRequestNumber() {
  const year = new Date().getFullYear();
  const row = db.prepare(
    "SELECT COUNT(*) AS n FROM material_request_headers WHERE request_number LIKE ?"
  ).get(`MR-${year}-%`);
  const seq = String(row.n + 1).padStart(6, '0');
  return `MR-${year}-${seq}`;
}

/**
 * Move a header to a new status with transition guard + audit.
 * Throws { status: 400 } on an illegal transition. Extra column updates can be
 * merged via `set` (object of column: value).
 */
function setHeaderStatus(header, toStatus, { user, reason, comments, sourceScreen, set = {}, workflowStep } = {}) {
  if (!canTransition(header.request_status, toStatus)) {
    const err = new Error(`Illegal transition: '${header.request_status}' -> '${toStatus}'.`);
    err.status = 400;
    throw err;
  }
  const cols = ['request_status = @to', 'current_workflow_step = @step', 'updated_by = @uid'];
  const params = {
    to: toStatus,
    step: workflowStep || toStatus,
    uid: user ? user.id : null,
    id: header.id,
  };
  Object.entries(set).forEach(([k, v], i) => {
    cols.push(`${k} = @c${i}`);
    params[`c${i}`] = v;
  });
  db.prepare(`UPDATE material_request_headers SET ${cols.join(', ')} WHERE id = @id`).run(params);

  audit.record({
    entityType: 'MaterialRequestHeader',
    entityId: header.id,
    requestNumber: header.request_number,
    action: 'STATUS_CHANGE',
    oldValue: header.request_status,
    newValue: toStatus,
    user, reason, comments, sourceScreen,
  });
  header.request_status = toStatus; // keep the in-memory copy fresh
}

/** Recalculate header line rollups (total/completed/shortage/cancelled). */
function refreshRollups(requestId) {
  const rows = db.prepare('SELECT line_status FROM material_request_lines WHERE request_id = ?').all(requestId);
  const total = rows.length;
  const completed = rows.filter((r) => ['Picked', 'GI Posted'].includes(r.line_status)).length;
  const shortage = rows.filter((r) => ['Shortage', 'Partially Picked'].includes(r.line_status)).length;
  const cancelled = rows.filter((r) => r.line_status === 'Cancelled').length;
  db.prepare(`
    UPDATE material_request_headers
    SET total_lines=?, completed_lines=?, shortage_lines=?, cancelled_lines=?
    WHERE id=?
  `).run(total, completed, shortage, cancelled, requestId);
  return { total, completed, shortage, cancelled };
}

/**
 * Release batch reservations held by a request's open (not yet picked)
 * allocations and mark those allocations CANCELLED. Called when a request is
 * cancelled/put on hold and before re-allocation, so reserved_quantity never
 * leaks and stock stays available. Returns the number of allocations released.
 */
function releaseOpenAllocations(requestId) {
  const open = db.prepare(`
    SELECT id, batch_id, proposed_quantity FROM picking_allocations
    WHERE request_id = ? AND status IN ('PROPOSED','SCANNED')
  `).all(requestId);
  const decBatch = db.prepare(
    'UPDATE batches SET reserved_quantity = MAX(0, reserved_quantity - ?) WHERE id = ?'
  );
  const cancelAlloc = db.prepare("UPDATE picking_allocations SET status='CANCELLED' WHERE id = ?");
  open.forEach((a) => {
    if (a.batch_id) decBatch.run(a.proposed_quantity, a.batch_id);
    cancelAlloc.run(a.id);
  });
  db.prepare('UPDATE material_request_lines SET reserved_quantity = 0 WHERE request_id = ?').run(requestId);
  return open.length;
}

function getHeaderOr404(res, id) {
  const header = db.prepare('SELECT * FROM material_request_headers WHERE id = ?').get(id);
  if (!header) {
    res.status(404).json({ error: 'Request not found.' });
    return null;
  }
  return header;
}

module.exports = { nextRequestNumber, setHeaderStatus, refreshRollups, getHeaderOr404, releaseOpenAllocations };
