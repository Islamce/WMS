const express = require('express');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const s = (v) => (v == null ? '' : String(v).trim());

function parseDate(value) {
  const raw = s(value);
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = m;
    const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${mi}:${ss}`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : iso;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace('Z', '');
}

function resolveReceivingDate(materialCode, warehouseCode, binLocation) {
  const searches = [
    {
      source: 'HISTORICAL_BIN',
      sql: `SELECT MIN(movement_date) AS receiving_date FROM stock_movement_history
        WHERE movement_type='RECEIPT' AND material_code=? AND warehouse_code=? AND bin_location=?`,
      params: [materialCode, warehouseCode, binLocation],
    },
    {
      source: 'HISTORICAL_WAREHOUSE',
      sql: `SELECT MIN(movement_date) AS receiving_date FROM stock_movement_history
        WHERE movement_type='RECEIPT' AND material_code=? AND warehouse_code=?`,
      params: [materialCode, warehouseCode],
    },
    {
      source: 'HISTORICAL_MATERIAL',
      sql: `SELECT MIN(movement_date) AS receiving_date FROM stock_movement_history
        WHERE movement_type='RECEIPT' AND material_code=?`,
      params: [materialCode],
    },
  ];

  for (const search of searches) {
    const row = db.prepare(search.sql).get(...search.params);
    const parsed = row && parseDate(row.receiving_date);
    if (parsed) return { date: parsed.slice(0, 10), source: search.source };
  }
  return null;
}

function transactionDateColumn() {
  const columns = new Set(db.prepare('PRAGMA table_info(stock_transactions)').all().map((c) => c.name));
  for (const name of ['transaction_date', 'created_at', 'timestamp']) {
    if (columns.has(name)) return name;
  }
  return null;
}

router.post('/', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator permission is required.' });
  }

  const apply = req.body && req.body.apply === true;
  const rows = db.prepare(`SELECT b.id, b.material_id, r.location_id, b.material_code,
      b.warehouse_code, b.bin_location, b.batch_number, b.receiving_date,
      b.fifo_date, b.receiving_date_source
    FROM opening_stock_batch_registry r
    JOIN batches b ON b.id = r.batch_id
    WHERE b.remaining_quantity > 0
    ORDER BY b.id`).all();
  const txDateColumn = transactionDateColumn();
  const proposals = [];

  for (const batch of rows) {
    const resolved = resolveReceivingDate(batch.material_code, batch.warehouse_code, batch.bin_location);
    if (!resolved) continue;
    if (batch.receiving_date === resolved.date && batch.receiving_date_source === resolved.source) continue;
    proposals.push({
      batch_id: batch.id,
      batch_number: batch.batch_number,
      material_id: batch.material_id,
      location_id: batch.location_id,
      material_code: batch.material_code,
      warehouse_code: batch.warehouse_code,
      bin_location: batch.bin_location,
      current_date: batch.receiving_date,
      proposed_date: resolved.date,
      date_source: resolved.source,
    });
  }

  if (apply && proposals.length) {
    db.transaction(() => {
      const updateBatch = db.prepare(`UPDATE batches
        SET receiving_date=?, fifo_date=?, receiving_date_source=?
        WHERE id=?`);
      const updateTx = txDateColumn
        ? db.prepare(`UPDATE stock_transactions SET ${txDateColumn}=?
          WHERE material_id=? AND location_id=?
            AND (notes=? OR notes LIKE ?)`)
        : null;

      for (const proposal of proposals) {
        updateBatch.run(proposal.proposed_date, proposal.proposed_date, proposal.date_source, proposal.batch_id);
        if (updateTx) {
          const exact = `Opening stock import — batch ${proposal.batch_number}`;
          updateTx.run(
            proposal.proposed_date,
            proposal.material_id,
            proposal.location_id,
            exact,
            `${exact};%`,
          );
        }
      }
    })();
  }

  return res.json({
    mode: apply ? 'APPLIED' : 'DRY_RUN',
    registered_batches_scanned: rows.length,
    proposed_updates: proposals.length,
    transaction_date_column: txDateColumn,
    changes: proposals.slice(0, 1000),
  });
});

module.exports = router;
