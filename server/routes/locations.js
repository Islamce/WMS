const express = require('express');
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { isNonEmptyString, isId, parsePagination } = require('../utils/validate');
const audit = require('../services/audit');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/locations/all — simple list for dropdowns (stock in screen).
 */
router.get('/all', requirePermission(['locations', 'stock_in', 'stock_out']), (req, res) => {
  res.json({ locations: db.prepare('SELECT id, code FROM locations ORDER BY code').all() });
});

/**
 * GET /api/locations/overview — "All Locations" screen.
 * Bins come from the Bin Location Master; contents (materials + quantities)
 * come from the batches physically stored in each bin, so this view always
 * matches Bin Location Master and Batch Tracking. Batches that carry a bin
 * value not present in the master are surfaced as extra "unregistered" bins so
 * no stock is hidden.
 */
router.get('/overview', requirePermission('all_locations'), (req, res) => {
  const bins = db.prepare(`
    SELECT id, warehouse_code, bin_code, full_bin_location, zone, rack, capacity, is_active
    FROM bin_locations ORDER BY warehouse_code, full_bin_location
  `).all();

  const contents = db.prepare(`
    SELECT b.warehouse_code, b.bin_location, b.material_id,
           b.material_code AS item_code, b.material_description AS description,
           COALESCE(m.unit, '') AS unit, SUM(b.remaining_quantity) AS quantity
    FROM batches b LEFT JOIN materials m ON m.id = b.material_id
    WHERE b.remaining_quantity > 0 AND b.bin_location IS NOT NULL AND b.bin_location != ''
    GROUP BY b.warehouse_code, b.bin_location, b.material_id
    ORDER BY b.material_code
  `).all();

  const key = (wh, bin) => `${wh || ''}||${bin || ''}`;
  const byBin = {};
  contents.forEach((c) => { (byBin[key(c.warehouse_code, c.bin_location)] = byBin[key(c.warehouse_code, c.bin_location)] || []).push(c); });
  const used = new Set();

  const locations = bins.map((bl) => {
    const k1 = key(bl.warehouse_code, bl.bin_code);
    const k2 = key(bl.warehouse_code, bl.full_bin_location);
    const mats = [...(byBin[k1] || []), ...(byBin[k2] || [])];
    used.add(k1); used.add(k2);
    return {
      id: bl.id, code: bl.full_bin_location, warehouse_code: bl.warehouse_code,
      bin_code: bl.bin_code, capacity: bl.capacity, registered: true,
      materials_count: mats.length,
      total_quantity: mats.reduce((s, m) => s + m.quantity, 0),
      materials: mats,
    };
  });

  // Any batch bin that isn't in the master (e.g. imported/free-text) — don't hide it.
  Object.keys(byBin).filter((k) => !used.has(k)).forEach((k) => {
    const mats = byBin[k];
    const [wh, bin] = k.split('||');
    locations.push({
      id: null, code: bin || '(unassigned)', warehouse_code: wh, registered: false,
      materials_count: mats.length,
      total_quantity: mats.reduce((s, m) => s + m.quantity, 0),
      materials: mats,
    });
  });

  res.json({ locations });
});

/**
 * GET /api/locations/empty — "Empty Locations" screen.
 * Active master bins that currently hold no stock.
 */
router.get('/empty', requirePermission('empty_locations'), (req, res) => {
  const locations = db.prepare(`
    SELECT bl.id, bl.full_bin_location AS code, bl.warehouse_code
    FROM bin_locations bl
    WHERE bl.is_active = 1 AND NOT EXISTS (
      SELECT 1 FROM batches b
      WHERE b.warehouse_code = bl.warehouse_code
        AND b.bin_location IN (bl.bin_code, bl.full_bin_location)
        AND b.remaining_quantity > 0
    )
    ORDER BY bl.warehouse_code, bl.full_bin_location
  `).all();
  res.json({ locations });
});

/** GET /api/locations — paginated list with search (management screen). */
router.get('/', requirePermission('locations'), (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const q = (req.query.search || '').trim();
  const where = q ? 'WHERE code LIKE ?' : '';
  const params = q ? [`%${q}%`] : [];

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM locations ${where}`).get(...params);
  const locations = db.prepare(`
    SELECT l.*,
      COALESCE((SELECT SUM(quantity) FROM material_location_stock WHERE location_id = l.id), 0) AS total_stock
    FROM locations l ${where}
    ORDER BY l.code LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ locations, total, page, limit });
});

/** POST /api/locations — create. */
router.post('/', requirePermission('locations'), (req, res) => {
  const { code } = req.body || {};
  if (!isNonEmptyString(code)) return res.status(400).json({ error: 'Location code is required.' });

  const exists = db.prepare('SELECT id FROM locations WHERE code = ?').get(code.trim());
  if (exists) return res.status(409).json({ error: 'A location with this code already exists.' });

  const result = db.prepare('INSERT INTO locations (code) VALUES (?)').run(code.trim());
  audit.record({ entityType: 'Location', entityId: result.lastInsertRowid, action: 'CREATE',
    newValue: code.trim(), user: req.user, sourceScreen: 'Locations' });
  res.status(201).json({ message: 'Location created.', id: result.lastInsertRowid });
});

/** PUT /api/locations/:id — edit location code. */
router.put('/:id', requirePermission('locations'), (req, res) => {
  const { id } = req.params;
  const { code } = req.body || {};
  if (!isId(id)) return res.status(400).json({ error: 'Invalid location id.' });
  if (!isNonEmptyString(code)) return res.status(400).json({ error: 'Location code is required.' });

  const duplicate = db.prepare('SELECT id FROM locations WHERE code = ? AND id != ?').get(code.trim(), id);
  if (duplicate) return res.status(409).json({ error: 'Another location already uses this code.' });

  const before = db.prepare('SELECT code FROM locations WHERE id=?').get(id);
  const result = db.prepare(
    "UPDATE locations SET code = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(code.trim(), id);
  if (result.changes === 0) return res.status(404).json({ error: 'Location not found.' });

  audit.record({ entityType: 'Location', entityId: Number(id), action: 'UPDATE',
    oldValue: before?.code, newValue: code.trim(), user: req.user, sourceScreen: 'Locations' });
  res.json({ message: 'Location updated.' });
});

/**
 * DELETE /api/locations/:id
 * Restricted: only when the location has no stock and no transactions.
 */
router.delete('/:id', requirePermission('locations'), (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return res.status(400).json({ error: 'Invalid location id.' });

  const hasStock = db.prepare(
    'SELECT 1 FROM material_location_stock WHERE location_id = ? AND quantity > 0 LIMIT 1'
  ).get(id);
  if (hasStock) {
    return res.status(409).json({ error: 'This location still contains stock and cannot be deleted.' });
  }
  const hasTransactions = db.prepare('SELECT 1 FROM stock_transactions WHERE location_id = ? LIMIT 1').get(id);
  if (hasTransactions) {
    return res.status(409).json({ error: 'This location has stock transactions and cannot be deleted.' });
  }

  const before = db.prepare('SELECT code FROM locations WHERE id=?').get(id);
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM material_location_stock WHERE location_id = ?').run(id);
    return db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  });
  const result = remove();
  if (result.changes === 0) return res.status(404).json({ error: 'Location not found.' });

  audit.record({ entityType: 'Location', entityId: Number(id), action: 'DELETE',
    oldValue: before?.code, user: req.user, sourceScreen: 'Locations' });
  res.json({ message: 'Location deleted.' });
});

module.exports = router;
