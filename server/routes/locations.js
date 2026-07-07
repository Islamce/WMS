const express = require('express');
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { isNonEmptyString, isId, parsePagination } = require('../utils/validate');

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
 * Every location with material count, total quantity and the materials inside.
 */
router.get('/overview', requirePermission('all_locations'), (req, res) => {
  const locations = db.prepare(`
    SELECT l.id, l.code,
      COALESCE(s.materials_count, 0) AS materials_count,
      COALESCE(s.total_quantity, 0) AS total_quantity
    FROM locations l
    LEFT JOIN (
      SELECT location_id,
             COUNT(CASE WHEN quantity > 0 THEN 1 END) AS materials_count,
             SUM(quantity) AS total_quantity
      FROM material_location_stock GROUP BY location_id
    ) s ON s.location_id = l.id
    ORDER BY l.code
  `).all();

  const contents = db.prepare(`
    SELECT mls.location_id, m.id AS material_id, m.item_code, m.description, m.unit, mls.quantity
    FROM material_location_stock mls
    JOIN materials m ON m.id = mls.material_id
    WHERE mls.quantity > 0
    ORDER BY m.item_code
  `).all();

  const byLocation = {};
  contents.forEach((c) => {
    (byLocation[c.location_id] = byLocation[c.location_id] || []).push(c);
  });

  res.json({ locations: locations.map((l) => ({ ...l, materials: byLocation[l.id] || [] })) });
});

/**
 * GET /api/locations/empty — "Empty Locations" screen.
 * Empty = no rows in material_location_stock OR all quantities are zero.
 */
router.get('/empty', requirePermission('empty_locations'), (req, res) => {
  const locations = db.prepare(`
    SELECT l.id, l.code FROM locations l
    WHERE NOT EXISTS (
      SELECT 1 FROM material_location_stock mls
      WHERE mls.location_id = l.id AND mls.quantity > 0
    )
    ORDER BY l.code
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

  const result = db.prepare(
    "UPDATE locations SET code = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(code.trim(), id);
  if (result.changes === 0) return res.status(404).json({ error: 'Location not found.' });

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

  const remove = db.transaction(() => {
    db.prepare('DELETE FROM material_location_stock WHERE location_id = ?').run(id);
    return db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  });
  const result = remove();
  if (result.changes === 0) return res.status(404).json({ error: 'Location not found.' });

  res.json({ message: 'Location deleted.' });
});

module.exports = router;
