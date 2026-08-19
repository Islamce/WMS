/**
 * Import Center — master data, opening stock and protected movement history.
 */
const express = require('express');
const crypto = require('crypto');
const db = require('./../db/connection');
const { authenticate } = require('./../middleware/auth');
const audit = require('./../services/audit');

const router = express.Router();
router.use(authenticate);

const MAX_ROWS = 5000;
const MOVEMENT_CATEGORIES = [
  'RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT',
  'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'REVERSAL',
];
const REVERSAL_TARGETS = MOVEMENT_CATEGORIES.filter((category) => category !== 'REVERSAL');
const LEGACY_MOVEMENT_TYPE = {
  RECEIPT: 'RECEIPT', TRANSFER_IN: 'RECEIPT', ADJUSTMENT_IN: 'RECEIPT',
  ISSUE: 'ISSUE', TRANSFER_OUT: 'ISSUE', ADJUSTMENT_OUT: 'ISSUE',
  RETURN: 'RETURN',
};
const MAPPABLE_FIELDS = new Set([
  'external_id', 'material_code', 'quantity', 'unit', 'posting_date', 'document_date',
  'movement_timestamp', 'erp_movement_type', 'plant_code', 'warehouse_code',
  'storage_location', 'bin_location', 'batch_number', 'reservation_number',
  'erp_document_reference', 'purchase_order', 'cost_center', 'wbs_element',
  'performed_by', 'description', 'reversal_of_category',
]);
const s = (v) => (v == null ? '' : String(v).trim());
const num = (v) => {
  const normalized = typeof v === 'string' ? v.replace(/,/g, '').trim() : v;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};
const normalizeKey = (k) => s(k).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const normalizeRow = (row) => Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [normalizeKey(k), v]));
function serverComputedChecksum(rows) {
  // WMS-R14: derive a checksum from the canonical received payload server-side
  // instead of trusting the client-supplied value as a provenance label alone.
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function canImportMovements(user) {
  return user.role === 'admin' || ['goods_receipt', 'stock_out', 'ai_analytics'].some((p) => user.permissions.includes(p));
}
// WMS-R15: preview and chunk-insert stay under the broader import/analytics
// roles above, but finalize commits the batch as authoritative movement
// history feeding DEAD-stock and analytics decisions — gate it separately so
// analytics-read access alone cannot finalize an import.
function canFinalizeMovementImport(user) {
  return user.role === 'admin' || user.permissions.includes('movement_import_finalize');
}

function parseDate(value) {
  const raw = s(value);
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = m;
    const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${mi}:${ss}`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== Number(yyyy)
        || d.getMonth() + 1 !== Number(mm) || d.getDate() !== Number(dd)) return null;
    return iso;
  }
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (isoDate) {
    const [, yyyy, mm, dd, hh = '00', mi = '00', ss = '00'] = isoDate;
    const dateOnly = `${yyyy}-${mm}-${dd}`;
    const d = new Date(`${dateOnly}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() !== Number(yyyy)
        || d.getUTCMonth() + 1 !== Number(mm) || d.getUTCDate() !== Number(dd)) return null;
    return `${dateOnly}T${hh}:${mi}:${ss}`;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace('Z', '');
}

function parseDay(value, label) {
  const parsed = parseDate(value);
  if (!parsed) throw new Error(`${label} must be a valid date.`);
  return parsed.slice(0, 10);
}

function mappedRow(raw, fieldMapping) {
  const normalized = normalizeRow(raw);
  Object.entries(fieldMapping || {}).forEach(([canonical, source]) => {
    const key = normalizeKey(canonical);
    if (!MAPPABLE_FIELDS.has(key)) return;
    normalized[key] = normalized[normalizeKey(source)];
  });
  return normalized;
}

function normalizedCategory(body) {
  return s(body.movement_category || body.movement_type).toUpperCase();
}

function legacyMovementType(category, reversalOf) {
  if (category !== 'REVERSAL') return LEGACY_MOVEMENT_TYPE[category];
  if (['ISSUE', 'TRANSFER_OUT', 'ADJUSTMENT_OUT'].includes(reversalOf)) return 'RETURN';
  return 'ISSUE';
}

function movementRecord(raw, category, filename, rowNumber, options = {}) {
  const r = mappedRow(raw, options.fieldMapping);
  const materialCode = s(r.item || r.material_code || r.material || r.item_code);
  const quantity = Math.abs(num(r.quantity));
  const dateRaw = r.posting_date || r.last_update || r.movement_date || r.date;
  const timestampRaw = r.timestamp || r.movement_timestamp || dateRaw;
  const movementTimestamp = parseDate(timestampRaw);
  const postingDate = parseDate(dateRaw || timestampRaw);
  const documentDate = parseDate(r.document_date);
  const reversalOf = category === 'REVERSAL'
    ? s(r.reversal_of_category || options.defaultReversalOf).toUpperCase()
    : null;
  if (!materialCode) throw new Error('Material/item is required.');
  if (!(quantity > 0)) throw new Error('Quantity must be greater than zero.');
  if (!postingDate) throw new Error('A valid posting date is required (DD/MM/YYYY and ISO supported).');
  if (timestampRaw && !movementTimestamp) throw new Error('Movement timestamp is invalid.');
  if (r.document_date && !documentDate) throw new Error('Document date is invalid.');
  const today = new Date().toISOString().slice(0, 10);
  if (postingDate.slice(0, 10) > today) throw new Error('Posting date cannot be in the future.');
  if (documentDate && documentDate.slice(0, 10) > postingDate.slice(0, 10)) {
    throw new Error('Document date cannot be after posting date.');
  }
  if (options.periodStart && postingDate.slice(0, 10) < options.periodStart) {
    throw new Error('Posting date is before the declared period_start.');
  }
  if (options.periodEnd && postingDate.slice(0, 10) > options.periodEnd) {
    throw new Error('Posting date is after the declared period_end.');
  }
  if (category === 'REVERSAL' && !REVERSAL_TARGETS.includes(reversalOf)) {
    throw new Error(`REVERSAL requires reversal_of_category (${REVERSAL_TARGETS.join(', ')}).`);
  }
  const material = db.prepare('SELECT id FROM materials WHERE item_code=?').get(materialCode);
  const rec = {
    external_id: s(r.id || r.external_id) || null,
    movement_type: legacyMovementType(category, reversalOf),
    movement_category: category,
    erp_movement_type: s(r.erp_movement_type || r.movement_type_code || r.movement_code) || null,
    material_id: material ? material.id : null,
    material_code: materialCode,
    plant_code: s(r.plant || r.plant_code) || null,
    warehouse_code: s(r.warehouse || r.warehouse_code) || null,
    storage_location: s(r.storage_location || r.sloc) || null,
    bin_location: s(r.bin_location || r.bin) || null,
    batch_number: s(r.batch_number || r.batch) || null,
    description: s(r.description) || null,
    unit: s(r.unit || r.uom) || null,
    quantity,
    movement_date: postingDate.slice(0, 10),
    posting_date: postingDate.slice(0, 10),
    document_date: documentDate ? documentDate.slice(0, 10) : null,
    movement_timestamp: movementTimestamp,
    performed_by: s(r.user || r.performed_by || r.created_by) || null,
    reservation_number: s(r.reservation_number || r.reservation) || null,
    erp_document_reference: s(r.erp_document_reference || r.material_document || r.document_reference || r.document_number) || null,
    purchase_order: s(r.purchase_order || r.po_number || r.po) || null,
    cost_center: s(r.cost_center) || null,
    wbs_element: s(r.wbs_element || r.wbs || r.project) || null,
    source_system: s(options.sourceSystem) || 'CSV',
    reversal_of_category: reversalOf,
    source_filename: filename,
    source_row_number: rowNumber,
  };
  rec.row_fingerprint = crypto.createHash('sha256').update(JSON.stringify([
    rec.source_system, rec.movement_category, rec.reversal_of_category, rec.external_id,
    rec.erp_movement_type, rec.material_code, rec.plant_code, rec.warehouse_code,
    rec.storage_location, rec.bin_location, rec.batch_number, rec.quantity,
    rec.posting_date, rec.document_date, rec.movement_timestamp, rec.reservation_number,
    rec.erp_document_reference, rec.purchase_order, rec.cost_center, rec.wbs_element,
    rec.performed_by, rec.description, rec.unit, rec.source_filename,
  ])).digest('hex');
  return rec;
}

function resolveReceivingDate(materialCode, warehouseCode, binLocation, explicitValue) {
  const explicit = parseDate(explicitValue);
  if (explicit) return { date: explicit.slice(0, 10), source: 'EXPLICIT' };

  const searches = [
    {
      source: 'HISTORICAL_BIN',
      sql: `SELECT MIN(movement_date) AS receiving_date FROM stock_movement_history
        WHERE COALESCE(movement_category,movement_type)='RECEIPT'
          AND material_code=? AND warehouse_code=? AND bin_location=?`,
      params: [materialCode, warehouseCode, binLocation],
    },
    {
      source: 'HISTORICAL_WAREHOUSE',
      sql: `SELECT MIN(movement_date) AS receiving_date FROM stock_movement_history
        WHERE COALESCE(movement_category,movement_type)='RECEIPT'
          AND material_code=? AND warehouse_code=?`,
      params: [materialCode, warehouseCode],
    },
    {
      source: 'HISTORICAL_MATERIAL',
      sql: `SELECT MIN(movement_date) AS receiving_date FROM stock_movement_history
        WHERE COALESCE(movement_category,movement_type)='RECEIPT' AND material_code=?`,
      params: [materialCode],
    },
  ];

  for (const search of searches) {
    const row = db.prepare(search.sql).get(...search.params);
    if (row && row.receiving_date) return { date: row.receiving_date, source: search.source };
  }
  return { date: new Date().toISOString().slice(0, 10), source: 'ESTIMATED_IMPORT_DATE' };
}

function transactionDateColumn() {
  const columns = new Set(db.prepare('PRAGMA table_info(stock_transactions)').all().map((c) => c.name));
  for (const name of ['transaction_date', 'created_at', 'timestamp']) if (columns.has(name)) return name;
  return null;
}

function movementOptions(body) {
  const periodStart = s(body.period_start) ? parseDay(body.period_start, 'period_start') : null;
  const periodEnd = s(body.period_end) ? parseDay(body.period_end, 'period_end') : null;
  if (periodStart && periodEnd && periodStart > periodEnd) throw new Error('period_start must not be after period_end.');
  return {
    fieldMapping: body.field_mapping && typeof body.field_mapping === 'object' && !Array.isArray(body.field_mapping)
      ? body.field_mapping : {},
    sourceSystem: s(body.source_system) || 'CSV',
    defaultReversalOf: s(body.reversal_of_category).toUpperCase() || null,
    periodStart,
    periodEnd,
  };
}

function validateMovementRequest(body) {
  const category = normalizedCategory(body);
  if (!MOVEMENT_CATEGORIES.includes(category)) {
    throw new Error(`movement_category must be one of: ${MOVEMENT_CATEGORIES.join(', ')}.`);
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length || rows.length > MAX_ROWS) throw new Error(`Provide 1-${MAX_ROWS} rows per chunk.`);
  return { category, rows, filename: s(body.source_filename) || 'uploaded.csv', options: movementOptions(body) };
}

function liveStockSnapshot() {
  const batches = db.prepare(`SELECT COUNT(*) AS batch_rows,
    COALESCE(SUM(remaining_quantity),0) AS remaining_quantity,
    COALESCE(SUM(reserved_quantity),0) AS reserved_quantity FROM batches`).get();
  const ledger = db.prepare(`SELECT COUNT(*) AS transaction_rows,
    COALESCE(SUM(CASE WHEN transaction_type='IN' THEN quantity ELSE -quantity END),0) AS net_quantity
    FROM stock_transactions`).get();
  return { ...batches, ...ledger };
}

function inspectMovementRows(body) {
  const { category, rows, filename, options } = validateMovementRequest(body);
  const offset = Number(body.row_offset) || 0;
  const valid = [];
  const invalid = [];
  const duplicateFingerprints = new Set();
  const seen = new Set();
  const exists = db.prepare('SELECT 1 FROM stock_movement_history WHERE row_fingerprint=?');

  rows.forEach((raw, i) => {
    const rowNumber = offset + i + 2;
    try {
      const rec = movementRecord(raw, category, filename, rowNumber, options);
      if (seen.has(rec.row_fingerprint) || exists.get(rec.row_fingerprint)) duplicateFingerprints.add(rec.row_fingerprint);
      seen.add(rec.row_fingerprint);
      valid.push(rec);
    } catch (error) {
      invalid.push({ row_number: rowNumber, error: error.message, raw });
    }
  });

  const unique = valid.filter((rec, index) => valid.findIndex((candidate) => candidate.row_fingerprint === rec.row_fingerprint) === index);
  const insertable = unique.filter((rec) => !exists.get(rec.row_fingerprint));
  const knownMaterials = new Set(insertable.filter((rec) => rec.material_id).map((rec) => rec.material_code));
  const unknownMaterials = new Set(insertable.filter((rec) => !rec.material_id).map((rec) => rec.material_code));
  const dates = insertable.map((rec) => rec.posting_date).filter(Boolean).sort();
  const snapshot = liveStockSnapshot();
  return {
    category, rows, filename, options, valid, insertable, invalid,
    preview: insertable.slice(0, 10),
    reconciliation: {
      total_rows: rows.length,
      valid_rows: valid.length,
      insertable_rows: insertable.length,
      duplicate_rows: valid.length - insertable.length,
      invalid_rows: invalid.length,
      total_quantity: insertable.reduce((sum, rec) => sum + rec.quantity, 0),
      period_start: dates[0] || null,
      period_end: dates[dates.length - 1] || null,
      matched_materials: [...knownMaterials].sort(),
      unmatched_materials: [...unknownMaterials].sort(),
      live_stock_before: snapshot,
      live_stock_after: snapshot,
      live_stock_changed: false,
    },
  };
}

function batchReconciliation(batchId) {
  const summary = db.prepare(`SELECT COUNT(*) AS inserted_rows, COALESCE(SUM(quantity),0) AS total_quantity,
    MIN(posting_date) AS actual_period_start, MAX(posting_date) AS actual_period_end,
    COUNT(DISTINCT material_code) AS material_count,
    SUM(CASE WHEN material_id IS NULL THEN 1 ELSE 0 END) AS unmatched_rows
    FROM stock_movement_history WHERE import_batch_id=?`).get(batchId);
  summary.categories = db.prepare(`SELECT DISTINCT movement_category FROM stock_movement_history
    WHERE import_batch_id=? ORDER BY movement_category`).all(batchId).map((row) => row.movement_category);
  // WMS-R14: client-provided checksums are a provenance label, not proof. Surface
  // whether one was supplied and whether a server-side value was ever recorded so
  // reviewers can see this distinction instead of assuming the label was verified.
  const batch = db.prepare('SELECT source_file_checksum, server_computed_checksum FROM stock_movement_import_batches WHERE id=?').get(batchId);
  summary.checksum = {
    client_provided: batch ? batch.source_file_checksum : null,
    server_computed_first_chunk: batch ? batch.server_computed_checksum : null,
    note: 'server_computed_first_chunk covers only the first chunk received; it is server-derived evidence for that chunk, not a whole-file verification of client_provided.',
  };
  return summary;
}

router.get('/movements/summary', (req, res) => {
  if (!canImportMovements(req.user)) return res.status(403).json({ error: 'You do not have permission to view movement history.' });
  const totals = db.prepare(`SELECT COALESCE(movement_category,movement_type) AS movement_category,
    COALESCE(movement_category,movement_type) AS movement_type, COUNT(*) rows, SUM(quantity) quantity,
    MIN(COALESCE(posting_date,movement_date)) period_start, MAX(COALESCE(posting_date,movement_date)) period_end
    FROM stock_movement_history GROUP BY COALESCE(movement_category,movement_type) ORDER BY movement_category`).all();
  const batches = db.prepare(`SELECT id, movement_type, movement_category, source_system, source_filename,
    source_file_checksum, period_start, period_end, status, total_rows, inserted_rows, duplicate_rows,
    invalid_rows, reconciliation_json, created_by_name, created_at, completed_at
    FROM stock_movement_import_batches ORDER BY id DESC LIMIT 30`).all();
  batches.forEach((batch) => { batch.reconciliation = batch.reconciliation_json ? JSON.parse(batch.reconciliation_json) : null; delete batch.reconciliation_json; });
  res.json({ totals, batches });
});

router.post('/movements/preview', (req, res) => {
  if (!canImportMovements(req.user)) return res.status(403).json({ error: 'You do not have permission to preview movement history.' });
  try {
    const inspected = inspectMovementRows(req.body || {});
    res.json({ mode: 'DRY_RUN', movement_category: inspected.category, preview: inspected.preview,
      invalid_rows: inspected.invalid.slice(0, 100), reconciliation: inspected.reconciliation });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/movements/chunk', (req, res) => {
  if (!canImportMovements(req.user)) return res.status(403).json({ error: 'You do not have permission to import movement history.' });
  const body = req.body || {};
  if (body.finalize && !canFinalizeMovementImport(req.user)) {
    return res.status(403).json({ error: 'You do not have permission to finalize a movement history import. Ask an administrator or warehouse supervisor to finalize this batch.' });
  }
  let request;
  try { request = validateMovementRequest(body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const { category, rows, filename, options } = request;
  if (body.dry_run === true) {
    try {
      const inspected = inspectMovementRows(body);
      return res.json({ mode: 'DRY_RUN', movement_category: category, preview: inspected.preview,
        invalid_rows: inspected.invalid.slice(0, 100), reconciliation: inspected.reconciliation });
    } catch (error) { return res.status(400).json({ error: error.message }); }
  }
  let batchId = Number(body.batch_id) || null;
  const run = db.transaction(() => {
    if (!batchId) {
      const serverChecksum = serverComputedChecksum(rows);
      const created = db.prepare(`INSERT INTO stock_movement_import_batches
        (movement_type, movement_category, source_system, source_filename, source_file_checksum, server_computed_checksum, field_mapping_json,
         period_start, period_end, created_by, created_by_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(legacyMovementType(category, options.defaultReversalOf || 'ISSUE'), category,
          options.sourceSystem, filename, s(body.source_file_checksum) || null, serverChecksum, JSON.stringify(options.fieldMapping),
          options.periodStart, options.periodEnd, req.user.id, req.user.name || req.user.email || null);
      batchId = Number(created.lastInsertRowid);
    } else {
      const batch = db.prepare('SELECT * FROM stock_movement_import_batches WHERE id=?').get(batchId);
      if (!batch || batch.status !== 'IN_PROGRESS') throw new Error('Import batch is missing or already closed.');
      if ((batch.movement_category || batch.movement_type) !== category) throw new Error('Chunk movement category does not match the import batch.');
      const immutable = {
        source_system: options.sourceSystem,
        source_filename: filename,
        source_file_checksum: s(body.source_file_checksum) || null,
        field_mapping_json: JSON.stringify(options.fieldMapping),
        period_start: options.periodStart,
        period_end: options.periodEnd,
      };
      for (const [field, value] of Object.entries(immutable)) {
        if ((batch[field] || null) !== value) throw new Error(`Chunk ${field} does not match the import batch.`);
      }
    }

    const ins = db.prepare(`INSERT INTO stock_movement_history
      (import_batch_id, external_id, movement_type, movement_category, erp_movement_type, material_id, material_code,
       plant_code, warehouse_code, storage_location, bin_location, batch_number, description, unit, quantity,
       movement_date, posting_date, document_date, movement_timestamp, performed_by, reservation_number,
       erp_document_reference, purchase_order, cost_center, wbs_element, source_system, reversal_of_category,
       source_filename, source_row_number, row_fingerprint)
      VALUES (@import_batch_id,@external_id,@movement_type,@movement_category,@erp_movement_type,@material_id,@material_code,
       @plant_code,@warehouse_code,@storage_location,@bin_location,@batch_number,@description,@unit,@quantity,
       @movement_date,@posting_date,@document_date,@movement_timestamp,@performed_by,@reservation_number,
       @erp_document_reference,@purchase_order,@cost_center,@wbs_element,@source_system,@reversal_of_category,
       @source_filename,@source_row_number,@row_fingerprint)`);
    const errIns = db.prepare(`INSERT INTO stock_movement_import_errors
      (import_batch_id, source_row_number, external_id, error_code, error_message, raw_row_json)
      VALUES (?, ?, ?, ?, ?, ?)`);
    let inserted = 0; let duplicates = 0; let invalid = 0;
    const offset = Number(body.row_offset) || 0;
    rows.forEach((raw, i) => {
      const rowNo = offset + i + 2;
      try {
        const rec = movementRecord(raw, category, filename, rowNo, options);
        try { ins.run({ import_batch_id: batchId, ...rec }); inserted++; }
        catch (e) {
          if (/UNIQUE constraint failed: stock_movement_history.row_fingerprint/.test(e.message)) duplicates++;
          else throw e;
        }
      } catch (e) {
        invalid++;
        const n = normalizeRow(raw);
        errIns.run(batchId, rowNo, s(n.id || n.external_id) || null, 'VALIDATION', e.message, JSON.stringify(raw));
      }
    });
    db.prepare(`UPDATE stock_movement_import_batches SET total_rows=total_rows+?, inserted_rows=inserted_rows+?,
      duplicate_rows=duplicate_rows+?, invalid_rows=invalid_rows+? WHERE id=?`)
      .run(rows.length, inserted, duplicates, invalid, batchId);
    if (body.finalize) {
      const reconciliation = batchReconciliation(batchId);
      db.prepare(`UPDATE stock_movement_import_batches SET status=CASE WHEN invalid_rows>0 THEN 'COMPLETED_WITH_ERRORS' ELSE 'COMPLETED' END,
        period_start=COALESCE(period_start, ?), period_end=COALESCE(period_end, ?), reconciliation_json=?,
        completed_at=datetime('now') WHERE id=?`).run(reconciliation.actual_period_start, reconciliation.actual_period_end,
          JSON.stringify(reconciliation), batchId);
      audit.record({ entityType: 'StockMovementImportBatch', entityId: batchId, action: 'FINALIZE_IMPORT', user: req.user,
        newValue: { movement_category: category, source_system: options.sourceSystem, ...reconciliation },
        sourceScreen: 'Import Center' });
    }
    return { batch_id: batchId, inserted, duplicates, invalid,
      reconciliation: body.finalize ? batchReconciliation(batchId) : null };
  });
  try {
    const result = run();
    res.json({ message: `${result.inserted} inserted, ${result.duplicates} duplicates skipped, ${result.invalid} invalid.`, ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/movements/batches/:id/errors', (req, res) => {
  if (!canImportMovements(req.user)) return res.status(403).json({ error: 'You do not have permission to view import errors.' });
  const batch = db.prepare('SELECT id, source_filename FROM stock_movement_import_batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Import batch not found.' });
  const errors = db.prepare(`SELECT source_row_number, external_id, error_code, error_message, raw_row_json, created_at
    FROM stock_movement_import_errors WHERE import_batch_id=? ORDER BY source_row_number`).all(batch.id);
  if (s(req.query.format).toLowerCase() === 'csv') {
    const quote = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
    const header = ['source_row_number', 'external_id', 'error_code', 'error_message', 'raw_row_json', 'created_at'];
    const csv = [header.join(','), ...errors.map((row) => header.map((key) => quote(row[key])).join(','))].join('\n');
    res.type('text/csv').set('Content-Disposition', `attachment; filename="movement-import-${batch.id}-errors.csv"`).send(csv);
    return;
  }
  res.json({ batch_id: batch.id, source_filename: batch.source_filename, errors });
});

router.post('/stock/reconcile-dates', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator permission is required.' });
  const apply = req.body && req.body.apply === true;
  const rows = db.prepare(`SELECT id, material_code, warehouse_code, bin_location, batch_number,
    receiving_date, fifo_date, receiving_date_source
    FROM batches WHERE remaining_quantity > 0
    ORDER BY id`).all();
  const txDateColumn = transactionDateColumn();
  const proposals = [];

  for (const batch of rows) {
    const resolved = resolveReceivingDate(batch.material_code, batch.warehouse_code, batch.bin_location, null);
    if (resolved.source === 'ESTIMATED_IMPORT_DATE') continue;
    if (batch.receiving_date === resolved.date && batch.receiving_date_source === resolved.source) continue;
    proposals.push({
      batch_id: batch.id,
      batch_number: batch.batch_number,
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
      const updateBatch = db.prepare(`UPDATE batches SET receiving_date=?, fifo_date=?, receiving_date_source=? WHERE id=?`);
      const updateTx = txDateColumn
        ? db.prepare(`UPDATE stock_transactions SET ${txDateColumn}=? WHERE notes LIKE ?`)
        : null;
      for (const proposal of proposals) {
        updateBatch.run(proposal.proposed_date, proposal.proposed_date, proposal.date_source, proposal.batch_id);
        if (updateTx) updateTx.run(proposal.proposed_date, `Opening stock import — batch ${proposal.batch_number}%`);
      }
    })();
  }

  res.json({
    mode: apply ? 'APPLIED' : 'DRY_RUN',
    proposed_updates: proposals.length,
    transaction_date_column: txDateColumn,
    changes: proposals.slice(0, 1000),
  });
});

const ENTITIES = {
  materials: {
    permission: 'materials', columns: ['item_code', 'description', 'unit', 'plant', 'material_type', 'material_group', 'price', 'currency'],
    run(rows) {
      const find = db.prepare('SELECT id FROM materials WHERE item_code = ?');
      const ins = db.prepare(`INSERT INTO materials (plant,item_code,description,unit,price,currency,material_type,material_group)
        VALUES (@plant,@item_code,@description,@unit,@price,@currency,@material_type,@material_group)`);
      const upd = db.prepare(`UPDATE materials SET plant=@plant,description=@description,unit=@unit,price=@price,currency=@currency,
        material_type=@material_type,material_group=@material_group WHERE item_code=@item_code`);
      return applyRows(rows, (r) => {
        const item_code = s(r.item_code); if (!item_code || !s(r.description)) return { error: 'item_code and description are required' };
        const rec = { plant: s(r.plant), item_code, description: s(r.description), unit: s(r.unit) || 'EA', price: num(r.price), currency: s(r.currency) || 'USD', material_type: s(r.material_type), material_group: s(r.material_group) };
        if (find.get(item_code)) { upd.run(rec); return { status: 'updated', message: item_code }; }
        ins.run(rec); return { status: 'created', message: item_code };
      });
    },
  },
  locations: { permission: 'locations', columns: ['code'], run(rows) { const f = db.prepare('SELECT id FROM locations WHERE code=?'); const i = db.prepare('INSERT INTO locations(code) VALUES(?)'); return applyRows(rows, (r) => { const code = s(r.code); if (!code) return { error: 'code is required' }; if (f.get(code)) return { status: 'skipped', message: `exists: ${code}` }; i.run(code); return { status: 'created', message: code }; }); } },
  warehouses: { permission: 'warehouses_master', columns: ['warehouse_code', 'warehouse_name', 'plant', 'storage_location', 'warehouse_type'], run(rows) { const f = db.prepare('SELECT id FROM warehouses WHERE warehouse_code=?'); const i = db.prepare('INSERT INTO warehouses(warehouse_code,warehouse_name,plant,storage_location,warehouse_type) VALUES(@warehouse_code,@warehouse_name,@plant,@storage_location,@warehouse_type)'); const u = db.prepare('UPDATE warehouses SET warehouse_name=@warehouse_name,plant=@plant,storage_location=@storage_location,warehouse_type=@warehouse_type WHERE warehouse_code=@warehouse_code'); return applyRows(rows, (r) => { const rec = { warehouse_code: s(r.warehouse_code), warehouse_name: s(r.warehouse_name), plant: s(r.plant) || null, storage_location: s(r.storage_location) || null, warehouse_type: s(r.warehouse_type) || null }; if (!rec.warehouse_code || !rec.warehouse_name) return { error: 'warehouse_code and warehouse_name are required' }; if (f.get(rec.warehouse_code)) { u.run(rec); return { status: 'updated', message: rec.warehouse_code }; } i.run(rec); return { status: 'created', message: rec.warehouse_code }; }); } },
  bins: { permission: 'bins_master', columns: ['warehouse_code', 'bin_code', 'full_bin_location', 'zone', 'rack', 'level', 'column_number', 'capacity'], run(rows) { const wh = db.prepare('SELECT 1 FROM warehouses WHERE warehouse_code=?'); const f = db.prepare('SELECT id FROM bin_locations WHERE warehouse_code=? AND full_bin_location=?'); const i = db.prepare('INSERT INTO bin_locations(warehouse_code,zone,rack,line_or_aisle,level,column_number,bin_code,full_bin_location,capacity) VALUES(@warehouse_code,@zone,@rack,@line_or_aisle,@level,@column_number,@bin_code,@full_bin_location,@capacity)'); const u = db.prepare('UPDATE bin_locations SET zone=@zone,rack=@rack,level=@level,column_number=@column_number,bin_code=@bin_code,capacity=@capacity WHERE warehouse_code=@warehouse_code AND full_bin_location=@full_bin_location'); return applyRows(rows, (r) => { const warehouse_code = s(r.warehouse_code); const bin_code = s(r.bin_code) || s(r.full_bin_location); const full_bin_location = s(r.full_bin_location) || (warehouse_code && bin_code ? `${warehouse_code}-${bin_code}` : ''); if (!warehouse_code || !full_bin_location) return { error: 'warehouse_code and bin_code/full_bin_location are required' }; if (!wh.get(warehouse_code)) return { error: `unknown warehouse ${warehouse_code}` }; const rec = { warehouse_code, zone: s(r.zone) || null, rack: s(r.rack) || null, line_or_aisle: s(r.line_or_aisle) || null, level: s(r.level) || null, column_number: s(r.column_number) || null, bin_code, full_bin_location, capacity: num(r.capacity) }; if (f.get(warehouse_code, full_bin_location)) { u.run(rec); return { status: 'updated', message: full_bin_location }; } i.run(rec); return { status: 'created', message: full_bin_location }; }); } },
  'movement-types': { permission: 'movement_types_master', columns: ['code', 'description', 'direction', 'cost_object'], run(rows) { const f = db.prepare('SELECT id FROM movement_types WHERE code=?'); const i = db.prepare('INSERT INTO movement_types(code,description,direction,cost_object) VALUES(@code,@description,@direction,@cost_object)'); const u = db.prepare('UPDATE movement_types SET description=@description,direction=@direction,cost_object=@cost_object WHERE code=@code'); return applyRows(rows, (r) => { const rec = { code: s(r.code), description: s(r.description), direction: s(r.direction).toUpperCase() || 'ISSUE', cost_object: s(r.cost_object) || null }; if (!rec.code || !rec.description) return { error: 'code and description are required' }; if (!['ISSUE', 'RECEIPT', 'TRANSFER', 'REVERSAL'].includes(rec.direction)) return { error: 'invalid direction' }; if (f.get(rec.code)) { u.run(rec); return { status: 'updated', message: rec.code }; } i.run(rec); return { status: 'created', message: rec.code }; }); } },
  stock: {
    permission: 'goods_receipt',
    columns: ['material_code', 'warehouse_code', 'batch_number', 'quantity', 'bin_location', 'receiving_date', 'expiry_date', 'manufacturing_date', 'quality_status', 'po_number'],
    run(rows, user) {
      const mat = db.prepare('SELECT id,item_code,description FROM materials WHERE item_code=?');
      const wh = db.prepare('SELECT 1 FROM warehouses WHERE warehouse_code=?');
      const bin = db.prepare(`SELECT id, warehouse_code, bin_code, full_bin_location
        FROM bin_locations
        WHERE is_active=1 AND (full_bin_location=? OR bin_code=?)`);
      const location = db.prepare('SELECT id FROM locations WHERE code=?');
      const insertLocation = db.prepare('INSERT INTO locations(code) VALUES(?)');
      const fb = db.prepare('SELECT id,bin_location,receiving_date,receiving_date_source FROM batches WHERE material_id=? AND batch_number=? AND warehouse_code=?');
      const openingRegistered = db.prepare('SELECT 1 FROM opening_stock_batch_registry WHERE batch_id=?');
      const ib = db.prepare(`INSERT INTO batches(batch_number,material_id,material_code,material_description,po_number,receiving_date,manufacturing_date,expiry_date,received_quantity,remaining_quantity,warehouse_code,bin_location,quality_status,fifo_date,fefo_date,receiving_date_source)
        VALUES(@batch_number,@material_id,@material_code,@material_description,@po_number,@receiving_date,@manufacturing_date,@expiry_date,@quantity,@quantity,@warehouse_code,@bin_location,@quality_status,@receiving_date,@expiry_date,@receiving_date_source)`);
      const upsertStock = db.prepare(`INSERT INTO material_location_stock(material_id,location_id,quantity)
        VALUES(@material_id,@location_id,@quantity)
        ON CONFLICT(material_id,location_id) DO UPDATE SET
          quantity=material_location_stock.quantity+excluded.quantity,
          updated_at=datetime('now')`);
      const txDateColumn = transactionDateColumn();
      const insertTransaction = txDateColumn
        ? db.prepare(`INSERT INTO stock_transactions
          (transaction_type,material_id,location_id,quantity,user_id,movement_category,movement_classification_status,notes,${txDateColumn})
          VALUES('IN',@material_id,@location_id,@quantity,@user_id,'OPENING_BALANCE','EXPLICIT',@notes,@receiving_date)`)
        : db.prepare(`INSERT INTO stock_transactions
          (transaction_type,material_id,location_id,quantity,user_id,movement_category,movement_classification_status,notes)
          VALUES('IN',@material_id,@location_id,@quantity,@user_id,'OPENING_BALANCE','EXPLICIT',@notes)`);

      return applyRows(rows, (r) => {
        const materialCode = s(r.material_code);
        const m = mat.get(materialCode);
        if (!m) return { error: `unknown material ${materialCode}` };

        const warehouse_code = s(r.warehouse_code);
        if (!warehouse_code || !wh.get(warehouse_code)) return { error: `unknown warehouse ${warehouse_code}` };

        const bin_location = s(r.bin_location);
        if (!bin_location) return { error: 'bin_location is required' };
        const resolvedBin = bin.get(bin_location, bin_location);
        if (!resolvedBin) return { error: `unknown bin ${bin_location}` };
        if (resolvedBin.warehouse_code !== warehouse_code) return { error: `bin ${bin_location} does not belong to warehouse ${warehouse_code}` };

        const quantity = num(r.quantity);
        if (!(quantity > 0)) return { error: 'quantity must be a valid number greater than zero' };

        const canonicalBin = s(resolvedBin.full_bin_location) || s(resolvedBin.bin_code);
        const receiving = resolveReceivingDate(m.item_code, warehouse_code, canonicalBin, r.receiving_date);
        const batch_number = s(r.batch_number) || `OPEN-${m.item_code}-${warehouse_code}-${canonicalBin}`;
        const existing = fb.get(m.id, batch_number, warehouse_code);

        if (existing && s(existing.bin_location) !== canonicalBin) {
          return {
            error: `batch ${batch_number} already exists for material ${m.item_code} in bin ${existing.bin_location}; it cannot be imported into ${canonicalBin}`
          };
        }

        if (existing && openingRegistered.get(existing.id)) {
          return {
            status: 'skipped',
            message: `opening stock already registered: ${m.item_code} / ${batch_number} / ${warehouse_code} / ${canonicalBin}`
          };
        }

        if (existing) {
          return {
            error: `batch ${batch_number} already exists but is not registered as opening stock; existing stock cannot be increased through opening-stock import`
          };
        }

        let locationRow = location.get(canonicalBin);
        if (!locationRow) {
          locationRow = {
            id: Number(insertLocation.run(canonicalBin).lastInsertRowid)
          };
        }

        const batchData = {
          batch_number,
          material_id: m.id,
          material_code: m.item_code,
          material_description: m.description,
          po_number: s(r.po_number) || null,
          receiving_date: receiving.date,
          receiving_date_source: receiving.source,
          manufacturing_date: s(r.manufacturing_date) || null,
          expiry_date: s(r.expiry_date) || null,
          quantity,
          warehouse_code,
          bin_location: canonicalBin,
          quality_status: s(r.quality_status).toUpperCase() || 'RELEASED',
        };
        ib.run(batchData);

        upsertStock.run({ material_id: m.id, location_id: locationRow.id, quantity });
        insertTransaction.run({
          material_id: m.id,
          location_id: locationRow.id,
          quantity,
          user_id: user.id,
          receiving_date: receiving.date,
          notes: `Opening stock import — batch ${batch_number}; receiving_date=${receiving.date}; date_source=${receiving.source}`,
        });
        return { status: 'created', message: `${m.item_code} +${quantity} at ${canonicalBin}; receiving ${receiving.date} (${receiving.source})` };
      });
    },
  },
};

function applyRows(rows, handler) {
  const results = []; let created = 0; let updated = 0; let skipped = 0; let errors = 0;
  db.transaction(() => {
    rows.forEach((r, i) => {
      const out = handler(r) || {};
      if (out.error) { errors++; results.push({ row: i + 1, status: 'error', message: out.error }); }
      else if (out.status === 'updated') { updated++; results.push({ row: i + 1, status: 'updated', message: out.message }); }
      else if (out.status === 'skipped') { skipped++; results.push({ row: i + 1, status: 'skipped', message: out.message }); }
      else { created++; results.push({ row: i + 1, status: 'created', message: out.message }); }
    });
  })();
  return { created, updated, skipped, errors, results };
}

router.get('/meta', (req, res) => { const entities = Object.entries(ENTITIES).filter(([, d]) => req.user.role === 'admin' || req.user.permissions.includes(d.permission)).map(([key, d]) => ({ key, columns: d.columns })); res.json({ entities }); });
router.post('/:entity', (req, res) => { const def = ENTITIES[req.params.entity]; if (!def) return res.status(404).json({ error: 'Unknown import type.' }); if (req.user.role !== 'admin' && !req.user.permissions.includes(def.permission)) return res.status(403).json({ error: 'You do not have permission to import this data.' }); const rows = Array.isArray(req.body.rows) ? req.body.rows : []; if (!rows.length) return res.status(400).json({ error: 'No rows to import.' }); if (rows.length > MAX_ROWS) return res.status(400).json({ error: `Maximum ${MAX_ROWS} rows per import.` }); try { const result = def.run(rows, req.user); res.json({ message: `${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors.`, ...result }); } catch (err) { res.status(500).json({ error: err.message }); } });

module.exports = router;
