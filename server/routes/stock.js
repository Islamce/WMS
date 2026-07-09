/**
 * Stock in / stock out operations and transaction history.
 * Both movements run inside a database transaction: the balance update in
 * material_location_stock and the log row in stock_transactions succeed or
 * fail together. Stock can never go negative.
 */
const express = require('express');
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');
const { isNonEmptyString, isPositiveNumber, isId, parsePagination } = require('../utils/validate');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/stock/material/:id/summary
 * Material details + total stock + per-location breakdown.
 * Used by the stock in and stock out screens after a material is selected.
 */
router.get('/material/:id/summary', requirePermission(['stock_in', 'stock_out']), (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return res.status(400).json({ error: 'Invalid material id.' });

  const material = db.prepare(
    'SELECT id, plant, item_code, description, unit FROM materials WHERE id = ?'
  ).get(id);
  if (!material) return res.status(404).json({ error: 'Material not found.' });

  const locations = db.prepare(`
    SELECT l.id AS location_id, l.code, mls.quantity
    FROM material_location_stock mls
    JOIN locations l ON l.id = mls.location_id
    WHERE mls.material_id = ?
    ORDER BY l.code
  `).all(id);

  const total = locations.reduce((sum, l) => sum + l.quantity, 0);

  res.json({ material, total_stock: total, locations });
});

/** Shared validation for stock movement payloads. */
function validateMovement(body) {
  if (!isId(body.material_id)) return 'Material is required.';
  if (!isId(body.location_id)) return 'Location is required.';
  if (!isPositiveNumber(body.quantity)) return 'Quantity is required and must be greater than zero.';
  return null;
}

/** POST /api/stock/in — increase stock and record an IN transaction. */
router.post('/in', requirePermission('stock_in'), (req, res) => {
  const body = req.body || {};
  const error = validateMovement(body);
  if (error) return res.status(400).json({ error });

  const material = db.prepare('SELECT id FROM materials WHERE id = ?').get(body.material_id);
  if (!material) return res.status(404).json({ error: 'Material not found.' });
  const location = db.prepare('SELECT id FROM locations WHERE id = ?').get(body.location_id);
  if (!location) return res.status(404).json({ error: 'Location not found.' });

  const quantity = Number(body.quantity);

  const stockIn = db.transaction(() => {
    // Upsert the balance row and add the quantity.
    db.prepare(`
      INSERT INTO material_location_stock (material_id, location_id, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(material_id, location_id)
      DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = datetime('now')
    `).run(body.material_id, body.location_id, quantity);

    db.prepare(`
      INSERT INTO stock_transactions
        (transaction_type, material_id, location_id, quantity, reservation_number, user_id, notes)
      VALUES ('IN', ?, ?, ?, ?, ?, ?)
    `).run(
      body.material_id,
      body.location_id,
      quantity,
      isNonEmptyString(body.reservation_number) ? body.reservation_number.trim() : null,
      req.user.id,
      isNonEmptyString(body.notes) ? body.notes.trim() : null
    );
  });

  try {
    stockIn();
  } catch (err) {
    console.error('Stock in failed:', err);
    return res.status(500).json({ error: 'Stock in failed. No changes were saved.' });
  }

  res.status(201).json({ message: 'Stock in recorded successfully.' });
});

/** POST /api/stock/out — decrease stock and record an OUT transaction. */
router.post('/out', requirePermission('stock_out'), (req, res) => {
  const body = req.body || {};
  const error = validateMovement(body);
  if (error) return res.status(400).json({ error });
  if (!isNonEmptyString(body.reservation_number)) {
    return res.status(400).json({ error: 'Reservation number is required for stock out.' });
  }

  const quantity = Number(body.quantity);

  const stockOut = db.transaction(() => {
    // Read the current balance inside the transaction to avoid races.
    const row = db.prepare(
      'SELECT quantity FROM material_location_stock WHERE material_id = ? AND location_id = ?'
    ).get(body.material_id, body.location_id);

    const available = row ? row.quantity : 0;
    if (quantity > available) {
      const err = new Error(`Quantity out (${quantity}) exceeds available stock (${available}) in the selected location.`);
      err.status = 400;
      throw err;
    }

    db.prepare(`
      UPDATE material_location_stock
      SET quantity = quantity - ?, updated_at = datetime('now')
      WHERE material_id = ? AND location_id = ?
    `).run(quantity, body.material_id, body.location_id);

    db.prepare(`
      INSERT INTO stock_transactions
        (transaction_type, material_id, location_id, quantity, reservation_number, user_id, notes)
      VALUES ('OUT', ?, ?, ?, ?, ?, ?)
    `).run(
      body.material_id,
      body.location_id,
      quantity,
      body.reservation_number.trim(),
      req.user.id,
      isNonEmptyString(body.notes) ? body.notes.trim() : null
    );
  });

  try {
    stockOut();
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('Stock out failed:', err);
    return res.status(500).json({ error: 'Stock out failed. No changes were saved.' });
  }

  res.status(201).json({ message: 'Stock out recorded successfully.' });
});

/**
 * GET /api/stock/transactions — paginated transaction history.
 * Visible to users who can do stock in/out or see the dashboard.
 */
router.get('/transactions', requirePermission(['stock_in', 'stock_out', 'dashboard']), (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const q = (req.query.search || '').trim();
  const like = `%${q}%`;
  const where = q
    ? `WHERE m.item_code LIKE ? OR m.description LIKE ? OR l.code LIKE ?
       OR st.reservation_number LIKE ? OR u.name LIKE ?`
    : '';
  const params = q ? [like, like, like, like, like] : [];

  const { total } = db.prepare(`
    SELECT COUNT(*) AS total
    FROM stock_transactions st
    JOIN materials m ON m.id = st.material_id
    JOIN locations l ON l.id = st.location_id
    JOIN users u ON u.id = st.user_id
    ${where}
  `).get(...params);

  const transactions = db.prepare(`
    SELECT st.id, st.transaction_type, st.quantity, st.reservation_number,
           st.transaction_date, st.notes,
           m.item_code, m.description AS material_description, m.unit,
           l.code AS location_code, u.name AS user_name
    FROM stock_transactions st
    JOIN materials m ON m.id = st.material_id
    JOIN locations l ON l.id = st.location_id
    JOIN users u ON u.id = st.user_id
    ${where}
    ORDER BY st.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ transactions, total, page, limit });
});

module.exports = router;
