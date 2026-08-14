/**
 * Physical inventory — annual and periodic counting sessions (plus ad-hoc
 * CYCLE sessions) over a whole warehouse.
 *
 * Flow: create session (snapshots every batch with stock into count lines,
 * optionally freezing the warehouse) → blind count entry per line → optional
 * recount → variance approval → post (adjusts batches + movement ledger).
 * Blind mode hides system quantities from counters until review.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isNonEmptyString, isNonNegativeNumber, parsePagination } = require('./../utils/validate');
const { sendError } = require('./../utils/errors');
const audit = require('./../services/audit');
const notify = require('./../services/notify');
const { recordMovement } = require('./../services/ledger');

const router = express.Router();
router.use(authenticate, requirePermission(['inventory_count', 'cycle_count']));

const TYPES = ['ANNUAL', 'PERIODIC', 'CYCLE'];

function nextSessionNumber(type) {
  const year = new Date().getFullYear();
  const prefix = { ANNUAL: 'PI-A', PERIODIC: 'PI-P', CYCLE: 'PI-C' }[type];
  const n = db.prepare('SELECT COUNT(*) AS n FROM inventory_sessions WHERE session_number LIKE ?')
    .get(`${prefix}-${year}-%`).n;
  return `${prefix}-${year}-${String(n + 1).padStart(4, '0')}`;
}

/** Hide system/variance figures from non-admin counters while a blind session is counting. */
function maskLines(session, lines, user) {
  if (!session.blind || user.role === 'admin' || ['REVIEW', 'POSTED'].includes(session.status)) return lines;
  return lines.map((l) => ({ ...l, system_quantity: null, variance: null }));
}

/** GET /api/inventory — sessions list (?status=, paginated). */
router.get('/', (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { page: 1, limit: 50 });
  const { status } = req.query;
  const valid = ['COUNTING', 'REVIEW', 'POSTED', 'CANCELLED'];
  const where = status && valid.includes(status) ? 'WHERE status=?' : '';
  const params = where ? [status] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM inventory_sessions ${where}`).get(...params).n;
  const sessions = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM inventory_count_lines WHERE session_id=s.id) AS total_lines,
      (SELECT COUNT(*) FROM inventory_count_lines WHERE session_id=s.id AND status!='PENDING') AS counted_lines,
      (SELECT COUNT(*) FROM inventory_count_lines WHERE session_id=s.id AND COALESCE(variance,0)!=0) AS variance_lines
    FROM inventory_sessions s ${where} ORDER BY s.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  res.json({ sessions, total, page, limit });
});

/**
 * POST /api/inventory — open a session.
 * body: { session_type, warehouse_code, blind?, freeze_stock?, notes? }
 */
router.post('/', (req, res) => {
  const b = req.body || {};
  const type = (b.session_type || '').toUpperCase();
  if (!TYPES.includes(type)) return res.status(400).json({ error: `session_type must be one of ${TYPES.join(', ')}.` });
  if (!isNonEmptyString(b.warehouse_code)) return res.status(400).json({ error: 'Warehouse is required.' });
  const wh = db.prepare('SELECT * FROM warehouses WHERE warehouse_code=?').get(b.warehouse_code.trim());
  if (!wh) return res.status(404).json({ error: 'Warehouse not found.' });

  const open = db.prepare(
    "SELECT session_number FROM inventory_sessions WHERE warehouse_code=? AND status IN ('COUNTING','REVIEW')"
  ).get(wh.warehouse_code);
  if (open) {
    return res.status(400).json({ error: `Session ${open.session_number} is already open for ${wh.warehouse_code}. Post or cancel it first.` });
  }

  const batches = db.prepare(
    'SELECT * FROM batches WHERE warehouse_code=? AND remaining_quantity > 0 ORDER BY bin_location, batch_number'
  ).all(wh.warehouse_code);
  if (!batches.length) return res.status(400).json({ error: `Warehouse ${wh.warehouse_code} has no stock to count.` });

  const sessionNumber = nextSessionNumber(type);
  let sessionId;
  const create = db.transaction(() => {
    sessionId = db.prepare(`
      INSERT INTO inventory_sessions
        (session_number, session_type, warehouse_code, status, blind, freeze_stock, notes, created_by, created_by_name)
      VALUES (?,?,?, 'COUNTING', ?, ?, ?, ?, ?)
    `).run(sessionNumber, type, wh.warehouse_code,
      b.blind === false || b.blind === 0 ? 0 : 1,
      b.freeze_stock === false || b.freeze_stock === 0 ? 0 : 1,
      b.notes || null, req.user.id, req.user.name).lastInsertRowid;

    const ins = db.prepare(`
      INSERT INTO inventory_count_lines
        (session_id, batch_id, batch_number, material_id, material_code, material_description,
         warehouse_code, bin_location, system_quantity)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);
    batches.forEach((batch) => ins.run(sessionId, batch.id, batch.batch_number, batch.material_id,
      batch.material_code, batch.material_description, batch.warehouse_code, batch.bin_location,
      batch.remaining_quantity));

    audit.record({ entityType: 'InventorySession', entityId: sessionId, action: 'INVENTORY_SESSION_OPEN',
      newValue: { session: sessionNumber, type, warehouse: wh.warehouse_code, lines: batches.length,
        blind: b.blind !== false, freeze: b.freeze_stock !== false },
      user: req.user, sourceScreen: 'Physical Inventory' });
  });
  try { create(); } catch (err) { return sendError(res, err); }

  notify.notifyPermission('inventory_count', {
    notificationType: 'INVENTORY_COUNT_OPENED',
    title: `${type === 'ANNUAL' ? 'Annual' : type === 'PERIODIC' ? 'Periodic' : 'Cycle'} inventory ${sessionNumber} opened`,
    message: `${batches.length} batch(es) to count in ${wh.warehouse_code}.`,
  });
  res.status(201).json({ message: `Inventory session ${sessionNumber} opened with ${batches.length} count line(s).`,
    id: sessionId, session_number: sessionNumber, lines: batches.length });
});

/** GET /api/inventory/:id — session + lines (blind masking applied). */
router.get('/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM inventory_sessions WHERE id=?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const lines = db.prepare('SELECT * FROM inventory_count_lines WHERE session_id=? ORDER BY bin_location, batch_number')
    .all(session.id);
  res.json({ session, lines: maskLines(session, lines, req.user) });
});

/** POST /api/inventory/lines/:lineId/count — enter a (re)count. body { counted_quantity } */
router.post('/lines/:lineId/count', (req, res) => {
  const line = db.prepare('SELECT * FROM inventory_count_lines WHERE id=?').get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Count line not found.' });
  const session = db.prepare('SELECT * FROM inventory_sessions WHERE id=?').get(line.session_id);
  if (session.status !== 'COUNTING') return res.status(400).json({ error: `Session is not counting (status '${session.status}').` });
  const { counted_quantity } = req.body || {};
  if (!isNonNegativeNumber(counted_quantity)) return res.status(400).json({ error: 'counted_quantity must be zero or greater.' });

  const qty = Number(counted_quantity);
  const isRecount = line.status === 'RECOUNT';
  const variance = qty - line.system_quantity;
  db.prepare(`
    UPDATE inventory_count_lines SET ${isRecount ? 'recount_quantity' : 'counted_quantity'}=?, variance=?,
      status=?, counted_by=?, counted_by_name=?, updated_at=datetime('now') WHERE id=?
  `).run(qty, variance, variance === 0 ? 'APPROVED' : 'COUNTED', req.user.id, req.user.name, line.id);

  audit.record({ entityType: 'InventoryCountLine', entityId: line.id, action: isRecount ? 'INVENTORY_RECOUNT' : 'INVENTORY_COUNT',
    oldValue: { system_qty: line.system_quantity }, newValue: { counted: qty, variance },
    user: req.user, sourceScreen: 'Physical Inventory' });

  // Blind counters don't get the variance back; reviewers do.
  const blindMask = session.blind && req.user.role !== 'admin';
  res.json({ message: 'Count recorded.', variance: blindMask ? undefined : variance });
});

/** POST /api/inventory/lines/:lineId/recount — reviewer requests a blind recount. */
router.post('/lines/:lineId/recount', (req, res) => {
  const line = db.prepare('SELECT * FROM inventory_count_lines WHERE id=?').get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Count line not found.' });
  if (!['COUNTED', 'APPROVED'].includes(line.status)) {
    return res.status(400).json({ error: `Only a counted line can be sent for recount (status '${line.status}').` });
  }
  db.prepare("UPDATE inventory_count_lines SET status='RECOUNT', updated_at=datetime('now') WHERE id=?").run(line.id);
  audit.record({ entityType: 'InventoryCountLine', entityId: line.id, action: 'INVENTORY_RECOUNT_REQUESTED',
    user: req.user, sourceScreen: 'Physical Inventory' });
  res.json({ message: 'Recount requested.' });
});

/** POST /api/inventory/lines/:lineId/approve — approve a variance. */
router.post('/lines/:lineId/approve', (req, res) => {
  const line = db.prepare('SELECT * FROM inventory_count_lines WHERE id=?').get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Count line not found.' });
  if (line.status !== 'COUNTED') return res.status(400).json({ error: `Line is not awaiting approval (status '${line.status}').` });
  // Four-eyes rule: the person approving a variance must not be its counter.
  if (req.user.role !== 'admin' && line.counted_by === req.user.id && (line.variance || 0) !== 0) {
    return res.status(403).json({ error: 'A variance must be approved by someone other than the counter.' });
  }
  db.prepare(`UPDATE inventory_count_lines SET status='APPROVED', approved_by=?, approved_by_name=?,
    updated_at=datetime('now') WHERE id=?`).run(req.user.id, req.user.name, line.id);
  audit.record({ entityType: 'InventoryCountLine', entityId: line.id, action: 'INVENTORY_VARIANCE_APPROVED',
    newValue: { variance: line.variance }, user: req.user, sourceScreen: 'Physical Inventory' });
  res.json({ message: 'Variance approved.' });
});

/** POST /api/inventory/:id/review — move a fully counted session to review. */
router.post('/:id/review', (req, res) => {
  const session = db.prepare('SELECT * FROM inventory_sessions WHERE id=?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  if (session.status !== 'COUNTING') return res.status(400).json({ error: `Session is not counting (status '${session.status}').` });
  const pending = db.prepare(
    "SELECT COUNT(*) AS n FROM inventory_count_lines WHERE session_id=? AND status IN ('PENDING','RECOUNT')"
  ).get(session.id).n;
  if (pending > 0) return res.status(400).json({ error: `${pending} line(s) still need counting before review.` });
  db.prepare("UPDATE inventory_sessions SET status='REVIEW', updated_at=datetime('now') WHERE id=?").run(session.id);
  audit.record({ entityType: 'InventorySession', entityId: session.id, action: 'INVENTORY_SESSION_REVIEW',
    user: req.user, sourceScreen: 'Physical Inventory' });
  res.json({ message: 'Session moved to review — variances are now visible.' });
});

/**
 * POST /api/inventory/:id/post — apply approved counts to batches + ledger.
 * Every line must be APPROVED; a count below a batch's open reservations fails.
 */
router.post('/:id/post', (req, res) => {
  const session = db.prepare('SELECT * FROM inventory_sessions WHERE id=?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  if (!['COUNTING', 'REVIEW'].includes(session.status)) {
    return res.status(400).json({ error: `Session cannot be posted (status '${session.status}').` });
  }
  const lines = db.prepare('SELECT * FROM inventory_count_lines WHERE session_id=?').all(session.id);
  const unapproved = lines.filter((l) => l.status !== 'APPROVED');
  if (unapproved.length) {
    return res.status(400).json({ error: `${unapproved.length} line(s) are not approved yet — count, recount or approve them first.` });
  }

  // Never leave a batch's on-hand below its open reservations.
  const blockers = [];
  lines.forEach((l) => {
    const finalQty = Math.max(0, l.recount_quantity ?? l.counted_quantity ?? l.system_quantity);
    const batch = db.prepare('SELECT reserved_quantity, batch_number FROM batches WHERE id=?').get(l.batch_id);
    if (batch && finalQty < (batch.reserved_quantity || 0)) blockers.push(batch.batch_number);
  });
  if (blockers.length) {
    return res.status(400).json({
      error: `Counted quantity is below open pick reservations for: ${blockers.join(', ')}. Resolve those picks first.`,
    });
  }

  let adjusted = 0;
  const post = db.transaction(() => {
    lines.forEach((l) => {
      const finalQty = Math.max(0, l.recount_quantity ?? l.counted_quantity ?? l.system_quantity);
      const variance = finalQty - l.system_quantity;
      db.prepare("UPDATE inventory_count_lines SET final_quantity=?, status='POSTED', updated_at=datetime('now') WHERE id=?")
        .run(finalQty, l.id);
      if (variance !== 0) {
        adjusted += 1;
        db.prepare("UPDATE batches SET remaining_quantity=?, updated_at=datetime('now') WHERE id=?").run(finalQty, l.batch_id);
        recordMovement({ type: variance > 0 ? 'IN' : 'OUT', materialId: l.material_id,
          warehouseCode: l.warehouse_code, quantity: Math.abs(variance), userId: req.user.id,
          movementCategory: variance > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          notes: `Physical inventory ${session.session_number} adjustment (${variance > 0 ? '+' : ''}${variance})` });
      }
    });
    db.prepare("UPDATE inventory_sessions SET status='POSTED', posted_by=?, posted_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
      .run(req.user.id, session.id);
    audit.record({ entityType: 'InventorySession', entityId: session.id, action: 'INVENTORY_SESSION_POSTED',
      newValue: { session: session.session_number, lines: lines.length, adjusted },
      user: req.user, sourceScreen: 'Physical Inventory' });
  });
  try { post(); } catch (err) { return sendError(res, err); }

  res.json({ message: `Inventory ${session.session_number} posted: ${adjusted} adjustment(s) applied. Warehouse unfrozen.`, adjusted });
});

/** POST /api/inventory/:id/cancel — abandon a session (unfreezes the warehouse). */
router.post('/:id/cancel', (req, res) => {
  const session = db.prepare('SELECT * FROM inventory_sessions WHERE id=?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  if (!['COUNTING', 'REVIEW'].includes(session.status)) {
    return res.status(400).json({ error: `Session cannot be cancelled (status '${session.status}').` });
  }
  db.prepare("UPDATE inventory_sessions SET status='CANCELLED', updated_at=datetime('now') WHERE id=?").run(session.id);
  audit.record({ entityType: 'InventorySession', entityId: session.id, action: 'INVENTORY_SESSION_CANCELLED',
    reason: (req.body || {}).reason, user: req.user, sourceScreen: 'Physical Inventory' });
  res.json({ message: `Session ${session.session_number} cancelled.` });
});

module.exports = router;
