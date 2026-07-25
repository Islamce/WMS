/**
 * Import Center — master data, opening stock and protected movement history.
 */
const express = require('express');
const crypto = require('crypto');
const db = require('./../db/connection');
const { authenticate } = require('./../middleware/auth');

const router = express.Router();
router.use(authenticate);

const MAX_ROWS = 5000;
const s = (v) => (v == null ? '' : String(v).trim());
const num = (v) => {
  const normalized = typeof v === 'string' ? v.replace(/,/g, '').trim() : v;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};
const normalizeKey = (k) => s(k).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const normalizeRow = (row) => Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [normalizeKey(k), v]));

function canImportMovements(user) {
  return user.role === 'admin' || ['goods_receipt', 'stock_out', 'ai_analytics'].some((p) => user.permissions.includes(p));
}

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

function movementRecord(raw, movementType, filename, rowNumber) {
  const r = normalizeRow(raw);
  const materialCode = s(r.item || r.material_code || r.material || r.item_code);
  const quantity = Math.abs(num(r.quantity));
  const dateRaw = r.last_update || r.movement_date || r.date;
  const timestampRaw = r.timestamp || r.movement_timestamp || dateRaw;
  const movementTimestamp = parseDate(timestampRaw);
  const movementDate = parseDate(dateRaw || timestampRaw);
  if (!materialCode) throw new Error('Material/item is required.');
  if (!(quantity > 0)) throw new Error('Quantity must be greater than zero.');
  if (!movementDate) throw new Error('A valid movement date is required (DD/MM/YYYY supported).');
  const rec = {
    external_id: s(r.id || r.external_id) || null,
    movement_type: movementType,
    material_code: materialCode,
    plant_code: s(r.plant || r.plant_code) || null,
    warehouse_code: s(r.warehouse || r.warehouse_code) || null,
    bin_location: s(r.bin_location || r.bin) || null,
    description: s(r.description) || null,
    unit: s(r.unit || r.uom) || null,
    quantity,
    movement_date: movementDate.slice(0, 10),
    movement_timestamp: movementTimestamp,
    performed_by: s(r.user || r.performed_by || r.created_by) || null,
    reservation_number: s(r.reservation_number || r.reservation) || null,
    source_filename: filename,
    source_row_number: rowNumber,
  };
  rec.row_fingerprint = crypto.createHash('sha256').update(JSON.stringify([
    rec.movement_type, rec.external_id, rec.material_code, rec.plant_code, rec.bin_location,
    rec.quantity, rec.movement_date, rec.movement_timestamp, rec.reservation_number,
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
    if (row && row.receiving_date) return { date: row.receiving_date, source: search.source };
  }
  return { date: new Date().toISOString().slice(0, 10), source: 'ESTIMATED_IMPORT_DATE' };
}

function transactionDateColumn() {
  const columns = new Set(db.prepare('PRAGMA table_info(stock_transactions)').all().map((c) => c.name));
  for (const name of ['transaction_date', 'created_at', 'timestamp']) if (columns.has(name)) return name;
  return null;
}

router.get('/movements/summary', (req, res) => {
  if (!canImportMovements(req.user)) return res.status(403).json({ error: 'You do not have permission to view movement history.' });
  const totals = db.prepare(`SELECT movement_type, COUNT(*) rows, SUM(quantity) quantity,
    MIN(movement_date) period_start, MAX(movement_date) period_end
    FROM stock_movement_history GROUP BY movement_type ORDER BY movement_type`).all();
  const batches = db.prepare(`SELECT id, movement_type, source_filename, period_start, period_end, status,
    total_rows, inserted_rows, duplicate_rows, invalid_rows, created_by_name, created_at, completed_at
    FROM stock_movement_import_batches ORDER BY id DESC LIMIT 30`).all();
  res.json({ totals, batches });
});

router.post('/movements/chunk', (req, res) => {
  if (!canImportMovements(req.user)) return res.status(403).json({ error: 'You do not have permission to import movement history.' });
  const body = req.body || {};
  const movementType = s(body.movement_type).toUpperCase();
  if (!['RECEIPT', 'ISSUE', 'RETURN'].includes(movementType)) return res.status(400).json({ error: 'movement_type must be RECEIPT, ISSUE or RETURN.' });
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length || rows.length > MAX_ROWS) return res.status(400).json({ error: `Provide 1-${MAX_ROWS} rows per chunk.` });
  const filename = s(body.source_filename) || 'uploaded.csv';
  let batchId = Number(body.batch_id) || null;
  const run = db.transaction(() => {
    if (!batchId) {
      const created = db.prepare(`INSERT INTO stock_movement_import_batches
        (movement_type, source_filename, period_start, period_end, created_by, created_by_name)
        VALUES (?, ?, ?, ?, ?, ?)`).run(movementType, filename, s(body.period_start) || null, s(body.period_end) || null,
          req.user.id, req.user.name || req.user.email || null);
      batchId = Number(created.lastInsertRowid);
    } else {
      const batch = db.prepare('SELECT * FROM stock_movement_import_batches WHERE id=?').get(batchId);
      if (!batch || batch.status !== 'IN_PROGRESS') throw new Error('Import batch is missing or already closed.');
      if (batch.movement_type !== movementType) throw new Error('Chunk movement type does not match the import batch.');
    }

    const ins = db.prepare(`INSERT INTO stock_movement_history
      (import_batch_id, external_id, movement_type, material_code, plant_code, warehouse_code, bin_location,
       description, unit, quantity, movement_date, movement_timestamp, performed_by, reservation_number,
       source_filename, source_row_number, row_fingerprint)
      VALUES (@import_batch_id,@external_id,@movement_type,@material_code,@plant_code,@warehouse_code,@bin_location,
       @description,@unit,@quantity,@movement_date,@movement_timestamp,@performed_by,@reservation_number,
       @source_filename,@source_row_number,@row_fingerprint)`);
    const errIns = db.prepare(`INSERT INTO stock_movement_import_errors
      (import_batch_id, source_row_number, external_id, error_code, error_message, raw_row_json)
      VALUES (?, ?, ?, ?, ?, ?)`);
    let inserted = 0; let duplicates = 0; let invalid = 0;
    const offset = Number(body.row_offset) || 0;
    rows.forEach((raw, i) => {
      const rowNo = offset + i + 2;
      try {
        const rec = movementRecord(raw, movementType, filename, rowNo);
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
      db.prepare(`UPDATE stock_movement_import_batches SET status=CASE WHEN invalid_rows>0 THEN 'COMPLETED_WITH_ERRORS' ELSE 'COMPLETED' END,
        completed_at=datetime('now') WHERE id=?`).run(batchId);
    }
    return { batch_id: batchId, inserted, duplicates, invalid };
  });
  try {
    const result = run();
    res.json({ message: `${result.inserted} inserted, ${result.duplicates} duplicates skipped, ${result.invalid} invalid.`, ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
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
      const fb = db.prepare('SELECT id,receiving_date,receiving_date_source FROM batches WHERE material_id=? AND batch_number=? AND warehouse_code=? AND bin_location=?');
      const ib = db.prepare(`INSERT INTO batches(batch_number,material_id,material_code,material_description,po_number,receiving_date,manufacturing_date,expiry_date,received_quantity,remaining_quantity,warehouse_code,bin_location,quality_status,fifo_date,fefo_date,receiving_date_source)
        VALUES(@batch_number,@material_id,@material_code,@material_description,@po_number,@receiving_date,@manufacturing_date,@expiry_date,@quantity,@quantity,@warehouse_code,@bin_location,@quality_status,@receiving_date,@expiry_date,@receiving_date_source)`);
      const top = db.prepare(`UPDATE batches SET received_quantity=received_quantity+@quantity,
        remaining_quantity=remaining_quantity+@quantity,
        receiving_date=CASE WHEN receiving_date IS NULL OR date(@receiving_date)<date(receiving_date) THEN @receiving_date ELSE receiving_date END,
        fifo_date=CASE WHEN fifo_date IS NULL OR date(@receiving_date)<date(fifo_date) THEN @receiving_date ELSE fifo_date END,
        receiving_date_source=CASE WHEN receiving_date IS NULL OR date(@receiving_date)<date(receiving_date) THEN @receiving_date_source ELSE receiving_date_source END
        WHERE id=@id`);
      const upsertStock = db.prepare(`INSERT INTO material_location_stock(material_id,location_id,quantity)
        VALUES(@material_id,@location_id,@quantity)
        ON CONFLICT(material_id,location_id) DO UPDATE SET
          quantity=material_location_stock.quantity+excluded.quantity,
          updated_at=datetime('now')`);
      const txDateColumn = transactionDateColumn();
      const insertTransaction = txDateColumn
        ? db.prepare(`INSERT INTO stock_transactions
          (transaction_type,material_id,location_id,quantity,user_id,notes,${txDateColumn})
          VALUES('IN',@material_id,@location_id,@quantity,@user_id,@notes,@receiving_date)`)
        : db.prepare(`INSERT INTO stock_transactions
          (transaction_type,material_id,location_id,quantity,user_id,notes)
          VALUES('IN',@material_id,@location_id,@quantity,@user_id,@notes)`);

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
        let locationRow = location.get(canonicalBin);
        if (!locationRow) locationRow = { id: Number(insertLocation.run(canonicalBin).lastInsertRowid) };

        const receiving = resolveReceivingDate(m.item_code, warehouse_code, canonicalBin, r.receiving_date);
        const batch_number = s(r.batch_number) || `OPEN-${m.item_code}-${warehouse_code}-${canonicalBin}`;
        const existing = fb.get(m.id, batch_number, warehouse_code, canonicalBin);
        const batchData = {
          id: existing && existing.id,
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
        if (existing) top.run(batchData); else ib.run(batchData);

        upsertStock.run({ material_id: m.id, location_id: locationRow.id, quantity });
        insertTransaction.run({
          material_id: m.id,
          location_id: locationRow.id,
          quantity,
          user_id: user.id,
          receiving_date: receiving.date,
          notes: `Opening stock import — batch ${batch_number}; receiving_date=${receiving.date}; date_source=${receiving.source}`,
        });
        return { status: existing ? 'updated' : 'created', message: `${m.item_code} +${quantity} at ${canonicalBin}; receiving ${receiving.date} (${receiving.source})` };
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
