const express = require('express');
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { isNonEmptyString, isNonNegativeNumber, isId, parsePagination } = require('../utils/validate');

const router = express.Router();

router.use(authenticate);

/** Validates the material payload; returns an error message or null. */
function validateMaterialBody(body) {
  if (!isNonEmptyString(body.item_code)) return 'Item code is required.';
  if (!isNonEmptyString(body.description)) return 'Description is required.';
  if (!isNonEmptyString(body.unit)) return 'Unit is required.';
  if (body.price !== undefined && body.price !== '' && !isNonNegativeNumber(body.price)) {
    return 'Price must be a number greater than or equal to zero.';
  }
  return null;
}

/**
 * GET /api/materials/search?q=... — autocomplete for stock in/out screens.
 * Available to anyone who can see materials, stock in or stock out.
 */
router.get('/search', requirePermission(['materials', 'stock_in', 'stock_out', 'create_request', 'material_requests', 'goods_receipt']), (req, res) => {
  const q = (req.query.q || '').trim();
  const like = `%${q}%`;
  // Empty query returns the first materials so the picker can open as a
  // dropdown on focus. total_available = live batch stock (fallback to the
  // basic location stock), so the request screen can warn on shortages.
  const materials = db.prepare(`
    SELECT m.id, m.plant, m.item_code, m.description, m.unit,
      COALESCE(
        (SELECT SUM(remaining_quantity - reserved_quantity) FROM batches WHERE material_id = m.id),
        (SELECT SUM(quantity) FROM material_location_stock WHERE material_id = m.id),
        0
      ) AS total_available
    FROM materials m
    WHERE (? = '' OR m.item_code LIKE ? OR m.description LIKE ?)
    ORDER BY m.item_code LIMIT 20
  `).all(q, like, like);
  res.json({ materials });
});

/** GET /api/materials — paginated list with search. */
router.get('/', requirePermission('materials'), (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const q = (req.query.search || '').trim();
  const like = `%${q}%`;
  const where = q
    ? 'WHERE item_code LIKE ? OR description LIKE ? OR material_group LIKE ? OR plant LIKE ?'
    : '';
  const params = q ? [like, like, like, like] : [];

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM materials ${where}`).get(...params);
  const materials = db.prepare(`
    SELECT m.*,
      COALESCE((SELECT SUM(quantity) FROM material_location_stock WHERE material_id = m.id), 0) AS total_stock
    FROM materials m ${where}
    ORDER BY m.item_code LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ materials, total, page, limit });
});

/** POST /api/materials — create. */
router.post('/', requirePermission('materials'), (req, res) => {
  const body = req.body || {};
  const error = validateMaterialBody(body);
  if (error) return res.status(400).json({ error });

  const exists = db.prepare('SELECT id FROM materials WHERE item_code = ?').get(body.item_code.trim());
  if (exists) return res.status(409).json({ error: 'A material with this item code already exists.' });

  const result = db.prepare(`
    INSERT INTO materials (plant, item_code, description, unit, price, currency, material_type, material_group)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    (body.plant || '').trim(),
    body.item_code.trim(),
    body.description.trim(),
    body.unit.trim(),
    Number(body.price) || 0,
    (body.currency || 'USD').trim(),
    (body.material_type || '').trim(),
    (body.material_group || '').trim()
  );

  res.status(201).json({ message: 'Material created.', id: result.lastInsertRowid });
});

/** PUT /api/materials/:id — update. */
router.put('/:id', requirePermission('materials'), (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return res.status(400).json({ error: 'Invalid material id.' });
  const body = req.body || {};
  const error = validateMaterialBody(body);
  if (error) return res.status(400).json({ error });

  const duplicate = db.prepare('SELECT id FROM materials WHERE item_code = ? AND id != ?')
    .get(body.item_code.trim(), id);
  if (duplicate) return res.status(409).json({ error: 'Another material already uses this item code.' });

  const result = db.prepare(`
    UPDATE materials SET plant = ?, item_code = ?, description = ?, unit = ?,
      price = ?, currency = ?, material_type = ?, material_group = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    (body.plant || '').trim(),
    body.item_code.trim(),
    body.description.trim(),
    body.unit.trim(),
    Number(body.price) || 0,
    (body.currency || 'USD').trim(),
    (body.material_type || '').trim(),
    (body.material_group || '').trim(),
    id
  );
  if (result.changes === 0) return res.status(404).json({ error: 'Material not found.' });

  res.json({ message: 'Material updated.' });
});

/**
 * DELETE /api/materials/:id
 * Deletion is restricted: only allowed when the material has no stock
 * transactions (history must be preserved) and no stock on hand.
 */
router.delete('/:id', requirePermission('materials'), (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return res.status(400).json({ error: 'Invalid material id.' });

  const hasTransactions = db.prepare('SELECT 1 FROM stock_transactions WHERE material_id = ? LIMIT 1').get(id);
  if (hasTransactions) {
    return res.status(409).json({ error: 'This material has stock transactions and cannot be deleted.' });
  }
  const hasStock = db.prepare(
    'SELECT 1 FROM material_location_stock WHERE material_id = ? AND quantity > 0 LIMIT 1'
  ).get(id);
  if (hasStock) {
    return res.status(409).json({ error: 'This material still has stock and cannot be deleted.' });
  }

  const remove = db.transaction(() => {
    db.prepare('DELETE FROM material_location_stock WHERE material_id = ?').run(id);
    return db.prepare('DELETE FROM materials WHERE id = ?').run(id);
  });
  const result = remove();
  if (result.changes === 0) return res.status(404).json({ error: 'Material not found.' });

  res.json({ message: 'Material deleted.' });
});

module.exports = router;
