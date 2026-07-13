/**
 * Cycle counting — physical stock verification at batch level.
 *
 * Flow: open a count against a batch (snapshots the system quantity) → enter the
 * counted quantity (records the variance) → post it (adjusts the batch's
 * remaining quantity and writes the difference to the movement ledger, so
 * analytics and on-hand stay reconciled). Every step is audited.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isId, isNonNegativeNumber, isNonEmptyString } = require('./../utils/validate');
const audit = require('./../services/audit');
const { recordMovement } = require('./../services/ledger');

const router = express.Router();
router.use(authenticate, requirePermission('cycle_count'));

function nextCountNumber() {
  const year = new Date().getFullYear();
  const n = db.prepare("SELECT COUNT(*) AS n FROM cycle_counts WHERE count_number LIKE ?").get(`CC-${year}-%`).n;
  return `CC-${year}-${String(n + 1).padStart(6, '0')}`;
}

/** GET /api/cycle-count — list counts (optional ?status=). */
router.get('/', (req, res) => {
  const { status } = req.query;
  const valid = ['OPEN', 'COUNTED', 'POSTED', 'CANCELLED'];
  let sql = 'SELECT * FROM cycle_counts';
  const params = [];
  if (status && valid.includes(status)) { sql += ' WHERE status=?'; params.push(status); }
  sql += ' ORDER BY id DESC LIMIT 500';
  res.json({ counts: db.prepare(sql).all(...params) });
});

/** POST /api/cycle-count — open a count for a batch. body { batch_id } */
router.post('/', (req, res) => {
  const { batch_id } = req.body || {};
  if (!isId(batch_id)) return res.status(400).json({ error: 'A valid batch_id is required.' });
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(batch_id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });

  const countNumber = nextCountNumber();
  const info = db.prepare(`
    INSERT INTO cycle_counts
      (count_number, batch_id, material_id, material_code, warehouse_code, bin_location, system_quantity, status)
    VALUES (?,?,?,?,?,?,?, 'OPEN')
  `).run(countNumber, batch.id, batch.material_id, batch.material_code, batch.warehouse_code,
    batch.bin_location, batch.remaining_quantity);

  audit.record({ entityType: 'CycleCount', entityId: info.lastInsertRowid, action: 'CYCLE_COUNT_OPEN',
    newValue: { count: countNumber, batch: batch.batch_number, system_qty: batch.remaining_quantity },
    user: req.user, sourceScreen: 'Cycle Counting' });

  res.status(201).json({ message: 'Cycle count opened.', id: info.lastInsertRowid, count_number: countNumber,
    system_quantity: batch.remaining_quantity });
});

/** POST /api/cycle-count/:id/count — enter the counted quantity. body { counted_quantity, reason? } */
router.post('/:id/count', (req, res) => {
  const cc = db.prepare('SELECT * FROM cycle_counts WHERE id=?').get(req.params.id);
  if (!cc) return res.status(404).json({ error: 'Cycle count not found.' });
  if (cc.status !== 'OPEN') return res.status(400).json({ error: `Count is not open (status '${cc.status}').` });
  const { counted_quantity, reason } = req.body || {};
  if (!isNonNegativeNumber(counted_quantity)) {
    return res.status(400).json({ error: 'counted_quantity must be zero or greater.' });
  }
  const variance = Number(counted_quantity) - cc.system_quantity;
  db.prepare(`
    UPDATE cycle_counts SET counted_quantity=?, variance=?, status='COUNTED', reason=?,
      counted_by=?, counted_by_name=?, updated_at=datetime('now') WHERE id=?
  `).run(Number(counted_quantity), variance, reason || null, req.user.id, req.user.name, cc.id);

  audit.record({ entityType: 'CycleCount', entityId: cc.id, action: 'CYCLE_COUNT_ENTER',
    oldValue: { system_qty: cc.system_quantity }, newValue: { counted: Number(counted_quantity), variance },
    reason, user: req.user, sourceScreen: 'Cycle Counting' });

  res.json({ message: 'Count recorded.', variance });
});

/** POST /api/cycle-count/:id/post — apply the variance to the batch + ledger. */
router.post('/:id/post', (req, res) => {
  const cc = db.prepare('SELECT * FROM cycle_counts WHERE id=?').get(req.params.id);
  if (!cc) return res.status(404).json({ error: 'Cycle count not found.' });
  if (cc.status !== 'COUNTED') return res.status(400).json({ error: `Count must be entered before posting (status '${cc.status}').` });
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(cc.batch_id);
  if (!batch) return res.status(404).json({ error: 'Batch no longer exists.' });

  const variance = cc.variance || 0;
  db.transaction(() => {
    // Set the batch on-hand to the counted quantity (never below zero).
    const newQty = Math.max(0, cc.counted_quantity);
    db.prepare("UPDATE batches SET remaining_quantity=?, updated_at=datetime('now') WHERE id=?").run(newQty, batch.id);
    // Ledger the difference so consumption analytics stay reconciled.
    if (variance !== 0) {
      recordMovement({
        type: variance > 0 ? 'IN' : 'OUT', materialId: cc.material_id, warehouseCode: cc.warehouse_code,
        quantity: Math.abs(variance), userId: req.user.id,
        notes: `Cycle count ${cc.count_number} adjustment (${variance > 0 ? '+' : ''}${variance})`,
      });
    }
    db.prepare("UPDATE cycle_counts SET status='POSTED', posted_by=?, updated_at=datetime('now') WHERE id=?")
      .run(req.user.id, cc.id);
    audit.record({ entityType: 'CycleCount', entityId: cc.id, action: 'CYCLE_COUNT_POST',
      newValue: { batch: batch.batch_number, new_qty: newQty, variance }, user: req.user, sourceScreen: 'Cycle Counting' });
  })();

  res.json({ message: 'Cycle count posted; stock adjusted.', variance, new_quantity: Math.max(0, cc.counted_quantity) });
});

module.exports = router;
