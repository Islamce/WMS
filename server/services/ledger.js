/**
 * Movement ledger — a single history of physical stock movements in
 * stock_transactions: goods receipt writes IN, goods issue writes OUT.
 * The AI analytics engine reads consumption/velocity from this ledger.
 *
 * stock_transactions.location_id references the basic locations table, so each
 * warehouse gets (or reuses) a locations row whose code is the warehouse code.
 */
const db = require('./../db/connection');

/** Find or create the locations row that mirrors a warehouse code. */
function locationForWarehouse(warehouseCode) {
  const code = warehouseCode || 'WH-UNSPECIFIED';
  let row = db.prepare('SELECT id FROM locations WHERE code = ?').get(code);
  if (!row) {
    const info = db.prepare('INSERT INTO locations (code) VALUES (?)').run(code);
    row = { id: info.lastInsertRowid };
  }
  return row.id;
}

/**
 * Record a movement. type 'IN' | 'OUT'.
 * transactionDate is optional (defaults to now) — sample-data seeding uses it.
 */
function recordMovement({ type, materialId, warehouseCode, quantity, userId,
                          reservationNumber = null, notes = null, transactionDate = null }) {
  if (!quantity || quantity <= 0) return null;
  const locationId = locationForWarehouse(warehouseCode);
  const info = db.prepare(`
    INSERT INTO stock_transactions
      (transaction_type, material_id, location_id, quantity, reservation_number, user_id, notes, transaction_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
  `).run(type, materialId, locationId, quantity, reservationNumber, userId, notes, transactionDate);
  return info.lastInsertRowid;
}

module.exports = { recordMovement, locationForWarehouse };
