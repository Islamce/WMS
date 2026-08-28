const express = require('express');
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { isNonEmptyString, isNonNegativeNumber, isId, parsePagination } = require('../utils/validate');
const audit = require('../services/audit');

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

/**
 * GET /api/materials — paginated list with search, filters and sorting.
 * Stock figures are computed live from batches (the WMS execution stock,
 * moved by GR / GI / counts / reallocation) plus the basic location stock, so
 * the master always reflects reality without any manual refresh.
 * Query: search, group, type, stock=in|out|low, sort=<column>, dir=asc|desc.
 */
const SORTABLE = {
  item_code: 'm.item_code', description: 'm.description', plant: 'm.plant',
  material_group: 'm.material_group', material_type: 'm.material_type',
  unit: 'm.unit', price: 'm.price', total_stock: 'total_stock',
  available_stock: 'available_stock',
};

router.get('/', requirePermission('materials'), (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const clauses = [];
  const params = [];
  const q = (req.query.search || '').trim();
  if (q) {
    const like = `%${q}%`;
    clauses.push('(item_code LIKE ? OR description LIKE ? OR material_group LIKE ? OR plant LIKE ?)');
    params.push(like, like, like, like);
  }
  if ((req.query.group || '').trim()) { clauses.push('material_group = ?'); params.push(req.query.group.trim()); }
  if ((req.query.type || '').trim()) { clauses.push('material_type = ?'); params.push(req.query.type.trim()); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const stockExpr = `(
    COALESCE((SELECT SUM(remaining_quantity) FROM batches WHERE material_id = m.id), 0)
    + COALESCE((SELECT SUM(quantity) FROM material_location_stock WHERE material_id = m.id), 0))`;
  const reservedExpr = 'COALESCE((SELECT SUM(reserved_quantity) FROM batches WHERE material_id = m.id), 0)';

  // Stock filter runs over the computed figure (HAVING, after the subqueries).
  const stockFilter = { in: `HAVING total_stock > 0`, out: `HAVING total_stock <= 0`, low: `HAVING total_stock > 0 AND available_stock <= 0` }[req.query.stock] || '';

  const orderCol = SORTABLE[req.query.sort] || 'm.item_code';
  const orderDir = req.query.dir === 'desc' ? 'DESC' : 'ASC';

  const base = `
    SELECT m.*, ${stockExpr} AS total_stock, ${reservedExpr} AS reserved_stock,
      (${stockExpr} - ${reservedExpr}) AS available_stock
    FROM materials m ${where}
    GROUP BY m.id ${stockFilter}`;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${base})`).get(...params).n;
  const materials = db.prepare(`${base} ORDER BY ${orderCol} ${orderDir}, m.item_code LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  // Distinct filter values so the UI can build its dropdowns.
  const groups = db.prepare("SELECT DISTINCT material_group AS v FROM materials WHERE material_group != '' ORDER BY v").all().map((r) => r.v);
  const types = db.prepare("SELECT DISTINCT material_type AS v FROM materials WHERE material_type != '' ORDER BY v").all().map((r) => r.v);

  res.json({ materials, total, page, limit, filters: { groups, types } });
});

/**
 * POST /api/materials/bulk — mass upload. Body: { rows: [{plant, item_code,
 * description, unit, price, currency, material_type, material_group}, ...] }.
 * Returns a per-row result (created / skipped duplicate / error) so the UI can
 * show exactly what happened.
 */
router.post('/bulk', requirePermission('materials'), (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'No rows to upload.' });
  if (rows.length > 2000) return res.status(400).json({ error: 'Maximum 2000 rows per upload.' });

  const insert = db.prepare(`
    INSERT INTO materials (plant, item_code, description, unit, price, currency, material_type, material_group)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const results = [];
  let created = 0, skipped = 0, errors = 0;

  const run = db.transaction(() => {
    rows.forEach((r, i) => {
      const rowNo = i + 1;
      if (!isNonEmptyString(r.item_code) || !isNonEmptyString(r.description)) {
        errors++; results.push({ row: rowNo, status: 'error', message: 'item_code and description are required' }); return;
      }
      if (db.prepare('SELECT 1 FROM materials WHERE item_code=?').get(r.item_code.trim())) {
        skipped++; results.push({ row: rowNo, status: 'skipped', message: `duplicate item_code ${r.item_code.trim()}` }); return;
      }
      insert.run((r.plant || '').trim(), r.item_code.trim(), r.description.trim(),
        (r.unit || 'EA').trim(), Number(r.price) || 0, (r.currency || 'USD').trim(),
        (r.material_type || '').trim(), (r.material_group || '').trim());
      created++; results.push({ row: rowNo, status: 'created', message: r.item_code.trim() });
    });
  });
  run();
  audit.record({ entityType: 'Material', action: 'BULK_CREATE',
    newValue: { created, skipped, errors, rows: rows.length }, user: req.user, sourceScreen: 'Materials' });
  res.status(201).json({ message: `Mass upload: ${created} created, ${skipped} skipped, ${errors} errors.`, created, skipped, errors, results });
});

/** POST /api/materials — create. */
router.post('/', requirePermission('materials'), (req, res) => {
  const body = req.body || {};
  const error = validateMaterialBody(body);
  if (error) return res.status(400).json({ error });

  const exists = db.prepare('SELECT id FROM materials WHERE item_code = ?').get(body.item_code.trim());
  if (exists) return res.status(409).json({ error: 'A material with this item code already exists.' });

  const result = db.prepare(`
    INSERT INTO materials (plant, item_code, description, unit, price, currency, material_type, material_group, is_stock_item)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    (body.plant || '').trim(),
    body.item_code.trim(),
    body.description.trim(),
    body.unit.trim(),
    Number(body.price) || 0,
    (body.currency || 'USD').trim(),
    (body.material_type || '').trim(),
    (body.material_group || '').trim(),
    body.is_stock_item === 0 || body.is_stock_item === false ? 0 : 1
  );

  audit.record({ entityType: 'Material', entityId: result.lastInsertRowid, action: 'CREATE',
    newValue: { item_code: body.item_code.trim(), description: body.description.trim(), price: Number(body.price) || 0 },
    user: req.user, sourceScreen: 'Materials' });
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

  const before = db.prepare('SELECT item_code, description, price, unit, material_type, material_group FROM materials WHERE id=?').get(id);
  const result = db.prepare(`
    UPDATE materials SET plant = ?, item_code = ?, description = ?, unit = ?,
      price = ?, currency = ?, material_type = ?, material_group = ?, is_stock_item = ?, updated_at = datetime('now')
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
    body.is_stock_item === 0 || body.is_stock_item === false ? 0 : 1,
    id
  );
  if (result.changes === 0) return res.status(404).json({ error: 'Material not found.' });

  audit.record({ entityType: 'Material', entityId: Number(id), action: 'UPDATE',
    oldValue: before,
    newValue: { item_code: body.item_code.trim(), description: body.description.trim(), price: Number(body.price) || 0,
      unit: body.unit.trim(), material_type: (body.material_type || '').trim(), material_group: (body.material_group || '').trim() },
    user: req.user, sourceScreen: 'Materials' });
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

  const before = db.prepare('SELECT item_code, description FROM materials WHERE id=?').get(id);
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM material_location_stock WHERE material_id = ?').run(id);
    return db.prepare('DELETE FROM materials WHERE id = ?').run(id);
  });
  const result = remove();
  if (result.changes === 0) return res.status(404).json({ error: 'Material not found.' });

  audit.record({ entityType: 'Material', entityId: Number(id), action: 'DELETE',
    oldValue: before, user: req.user, sourceScreen: 'Materials' });
  res.json({ message: 'Material deleted.' });
});

module.exports = router;
