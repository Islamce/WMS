/**
 * Import Center — mass-upload master data and opening stock from CSV
 * (parsed to JSON rows on the client). One endpoint per entity, each with
 * upsert semantics (existing rows are updated, new rows created), so an old
 * database can be loaded — and re-loaded safely — in bulk.
 *
 * POST /api/import/:entity   body: { rows: [ {..}, .. ] }
 * -> { created, updated, skipped, errors, results:[{row,status,message}] }
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate } = require('./../middleware/auth');
const { recordMovement } = require('./../services/ledger');

const router = express.Router();
router.use(authenticate);

const MAX_ROWS = 5000;
const s = (v) => (v == null ? '' : String(v).trim());
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const bool = (v) => /^(1|true|yes|y)$/i.test(s(v));

// entity -> { permission, columns (for the template), run(rows, user) }
const ENTITIES = {
  materials: {
    permission: 'materials',
    columns: ['item_code', 'description', 'unit', 'plant', 'material_type', 'material_group', 'price', 'currency'],
    run(rows) {
      const find = db.prepare('SELECT id FROM materials WHERE item_code = ?');
      const ins = db.prepare(`INSERT INTO materials (plant, item_code, description, unit, price, currency, material_type, material_group)
        VALUES (@plant,@item_code,@description,@unit,@price,@currency,@material_type,@material_group)`);
      const upd = db.prepare(`UPDATE materials SET plant=@plant, description=@description, unit=@unit, price=@price,
        currency=@currency, material_type=@material_type, material_group=@material_group WHERE item_code=@item_code`);
      return applyRows(rows, (r) => {
        const item_code = s(r.item_code);
        if (!item_code || !s(r.description)) return { error: 'item_code and description are required' };
        const rec = { plant: s(r.plant), item_code, description: s(r.description), unit: s(r.unit) || 'EA',
          price: num(r.price), currency: s(r.currency) || 'USD', material_type: s(r.material_type), material_group: s(r.material_group) };
        if (find.get(item_code)) { upd.run(rec); return { status: 'updated', message: item_code }; }
        ins.run(rec); return { status: 'created', message: item_code };
      });
    },
  },

  locations: {
    permission: 'locations',
    columns: ['code'],
    run(rows) {
      const find = db.prepare('SELECT id FROM locations WHERE code = ?');
      const ins = db.prepare('INSERT INTO locations (code) VALUES (?)');
      return applyRows(rows, (r) => {
        const code = s(r.code);
        if (!code) return { error: 'code is required' };
        if (find.get(code)) return { status: 'skipped', message: `exists: ${code}` };
        ins.run(code); return { status: 'created', message: code };
      });
    },
  },

  warehouses: {
    permission: 'warehouses_master',
    columns: ['warehouse_code', 'warehouse_name', 'plant', 'storage_location', 'warehouse_type'],
    run(rows) {
      const find = db.prepare('SELECT id FROM warehouses WHERE warehouse_code = ?');
      const ins = db.prepare(`INSERT INTO warehouses (warehouse_code, warehouse_name, plant, storage_location, warehouse_type)
        VALUES (@warehouse_code,@warehouse_name,@plant,@storage_location,@warehouse_type)`);
      const upd = db.prepare(`UPDATE warehouses SET warehouse_name=@warehouse_name, plant=@plant,
        storage_location=@storage_location, warehouse_type=@warehouse_type WHERE warehouse_code=@warehouse_code`);
      return applyRows(rows, (r) => {
        const warehouse_code = s(r.warehouse_code);
        if (!warehouse_code || !s(r.warehouse_name)) return { error: 'warehouse_code and warehouse_name are required' };
        const rec = { warehouse_code, warehouse_name: s(r.warehouse_name), plant: s(r.plant) || null,
          storage_location: s(r.storage_location) || null, warehouse_type: s(r.warehouse_type) || null };
        if (find.get(warehouse_code)) { upd.run(rec); return { status: 'updated', message: warehouse_code }; }
        ins.run(rec); return { status: 'created', message: warehouse_code };
      });
    },
  },

  bins: {
    permission: 'bins_master',
    columns: ['warehouse_code', 'bin_code', 'full_bin_location', 'zone', 'rack', 'level', 'column_number', 'capacity'],
    run(rows) {
      const wh = db.prepare('SELECT 1 FROM warehouses WHERE warehouse_code = ?');
      const find = db.prepare('SELECT id FROM bin_locations WHERE warehouse_code=? AND full_bin_location=?');
      const ins = db.prepare(`INSERT INTO bin_locations (warehouse_code, zone, rack, line_or_aisle, level, column_number, bin_code, full_bin_location, capacity)
        VALUES (@warehouse_code,@zone,@rack,@line_or_aisle,@level,@column_number,@bin_code,@full_bin_location,@capacity)`);
      const upd = db.prepare(`UPDATE bin_locations SET zone=@zone, rack=@rack, level=@level, column_number=@column_number,
        bin_code=@bin_code, capacity=@capacity WHERE warehouse_code=@warehouse_code AND full_bin_location=@full_bin_location`);
      return applyRows(rows, (r) => {
        const warehouse_code = s(r.warehouse_code);
        const bin_code = s(r.bin_code) || s(r.full_bin_location);
        const full_bin_location = s(r.full_bin_location) || (warehouse_code && bin_code ? `${warehouse_code}-${bin_code}` : '');
        if (!warehouse_code || !full_bin_location) return { error: 'warehouse_code and bin_code/full_bin_location are required' };
        if (!wh.get(warehouse_code)) return { error: `unknown warehouse ${warehouse_code}` };
        const rec = { warehouse_code, zone: s(r.zone) || null, rack: s(r.rack) || null, line_or_aisle: s(r.line_or_aisle) || null,
          level: s(r.level) || null, column_number: s(r.column_number) || null, bin_code, full_bin_location, capacity: num(r.capacity) };
        if (find.get(warehouse_code, full_bin_location)) { upd.run(rec); return { status: 'updated', message: full_bin_location }; }
        ins.run(rec); return { status: 'created', message: full_bin_location };
      });
    },
  },

  'movement-types': {
    permission: 'movement_types_master',
    columns: ['code', 'description', 'direction', 'cost_object'],
    run(rows) {
      const DIRS = ['ISSUE', 'RECEIPT', 'TRANSFER', 'REVERSAL'];
      const find = db.prepare('SELECT id FROM movement_types WHERE code = ?');
      const ins = db.prepare('INSERT INTO movement_types (code, description, direction, cost_object) VALUES (@code,@description,@direction,@cost_object)');
      const upd = db.prepare('UPDATE movement_types SET description=@description, direction=@direction, cost_object=@cost_object WHERE code=@code');
      return applyRows(rows, (r) => {
        const code = s(r.code);
        if (!code || !s(r.description)) return { error: 'code and description are required' };
        let direction = s(r.direction).toUpperCase() || 'ISSUE';
        if (!DIRS.includes(direction)) return { error: `direction must be one of ${DIRS.join('/')}` };
        const rec = { code, description: s(r.description), direction, cost_object: s(r.cost_object) || null };
        if (find.get(code)) { upd.run(rec); return { status: 'updated', message: code }; }
        ins.run(rec); return { status: 'created', message: code };
      });
    },
  },

  // Opening stock: creates (or tops up) a batch and posts an IN movement so the
  // balance is reflected in dashboards, batch tracking and analytics.
  stock: {
    permission: 'goods_receipt',
    columns: ['material_code', 'warehouse_code', 'batch_number', 'quantity', 'bin_location', 'expiry_date', 'manufacturing_date', 'quality_status', 'po_number'],
    run(rows, user) {
      const mat = db.prepare('SELECT id, item_code, description FROM materials WHERE item_code = ?');
      const wh = db.prepare('SELECT 1 FROM warehouses WHERE warehouse_code = ?');
      const findBatch = db.prepare('SELECT id, remaining_quantity, received_quantity FROM batches WHERE material_id=? AND batch_number=? AND warehouse_code=?');
      const insBatch = db.prepare(`INSERT INTO batches
        (batch_number, material_id, material_code, material_description, po_number, receiving_date, manufacturing_date, expiry_date,
         received_quantity, remaining_quantity, warehouse_code, bin_location, quality_status, fifo_date, fefo_date)
        VALUES (@batch_number,@material_id,@material_code,@material_description,@po_number,date('now'),@manufacturing_date,@expiry_date,
         @quantity,@quantity,@warehouse_code,@bin_location,@quality_status,date('now'),@expiry_date)`);
      const topUp = db.prepare('UPDATE batches SET received_quantity=received_quantity+@quantity, remaining_quantity=remaining_quantity+@quantity WHERE id=@id');
      const QS = ['RELEASED', 'QUALITY_HOLD', 'BLOCKED', 'REJECTED'];
      return applyRows(rows, (r) => {
        const m = mat.get(s(r.material_code));
        if (!m) return { error: `unknown material ${s(r.material_code)}` };
        const warehouse_code = s(r.warehouse_code);
        if (!warehouse_code || !wh.get(warehouse_code)) return { error: `unknown warehouse ${warehouse_code}` };
        const quantity = num(r.quantity);
        if (quantity <= 0) return { error: 'quantity must be greater than zero' };
        const quality_status = QS.includes(s(r.quality_status).toUpperCase()) ? s(r.quality_status).toUpperCase() : 'RELEASED';
        const batch_number = s(r.batch_number) || `OPEN-${m.item_code}-${warehouse_code}`;
        const existing = findBatch.get(m.id, batch_number, warehouse_code);
        if (existing) {
          topUp.run({ id: existing.id, quantity });
        } else {
          insBatch.run({ batch_number, material_id: m.id, material_code: m.item_code, material_description: m.description,
            po_number: s(r.po_number) || null, manufacturing_date: s(r.manufacturing_date) || null, expiry_date: s(r.expiry_date) || null,
            quantity, warehouse_code, bin_location: s(r.bin_location) || null, quality_status });
        }
        recordMovement({ type: 'IN', materialId: m.id, warehouseCode: warehouse_code, quantity, userId: user.id,
          notes: `Opening stock import — batch ${batch_number}` });
        return { status: existing ? 'updated' : 'created', message: `${m.item_code} +${quantity}` };
      });
    },
  },
};

/** Runs a per-row handler in one transaction and tallies the outcome. */
function applyRows(rows, handler) {
  const results = [];
  let created = 0, updated = 0, skipped = 0, errors = 0;
  const run = db.transaction(() => {
    rows.forEach((r, i) => {
      const rowNo = i + 1;
      let out;
      try { out = handler(r) || {}; } catch (e) { out = { error: e.message }; }
      if (out.error) { errors++; results.push({ row: rowNo, status: 'error', message: out.error }); }
      else if (out.status === 'updated') { updated++; results.push({ row: rowNo, status: 'updated', message: out.message }); }
      else if (out.status === 'skipped') { skipped++; results.push({ row: rowNo, status: 'skipped', message: out.message }); }
      else { created++; results.push({ row: rowNo, status: 'created', message: out.message }); }
    });
  });
  run();
  return { created, updated, skipped, errors, results };
}

/** GET /api/import/meta — entities the user may import + their template columns. */
router.get('/meta', (req, res) => {
  const entities = Object.entries(ENTITIES)
    .filter(([, def]) => req.user.role === 'admin' || req.user.permissions.includes(def.permission))
    .map(([key, def]) => ({ key, columns: def.columns }));
  res.json({ entities });
});

router.post('/:entity', (req, res) => {
  const def = ENTITIES[req.params.entity];
  if (!def) return res.status(404).json({ error: 'Unknown import type.' });
  if (req.user.role !== 'admin' && !req.user.permissions.includes(def.permission)) {
    return res.status(403).json({ error: 'You do not have permission to import this data.' });
  }
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
  if (rows.length > MAX_ROWS) return res.status(400).json({ error: `Maximum ${MAX_ROWS} rows per import.` });

  let result;
  try { result = def.run(rows, req.user); }
  catch (err) { return res.status(500).json({ error: err.message }); }
  res.json({
    message: `${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors.`,
    ...result,
  });
});

module.exports = router;
