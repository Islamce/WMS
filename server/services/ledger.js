/**
 * Movement ledger — a single history of physical stock movements in
 * stock_transactions: goods receipt writes IN, goods issue writes OUT.
 * The AI analytics engine reads consumption/velocity from this ledger.
 *
 * Operational semantics are persisted with each row. Notes remain descriptive
 * evidence, never the source of category or reversal classification.
 */
const db = require('./../db/connection');

const MOVEMENT_CATEGORIES = new Set([
  'RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT',
  'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'REVERSAL', 'OPENING_BALANCE',
]);

const CATEGORY_TYPES = {
  RECEIPT: 'IN',
  ISSUE: 'OUT',
  RETURN: 'IN',
  TRANSFER_IN: 'IN',
  TRANSFER_OUT: 'OUT',
  ADJUSTMENT_IN: 'IN',
  ADJUSTMENT_OUT: 'OUT',
  OPENING_BALANCE: 'IN',
};

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

function validateMovementSemantics({ type, movementCategory, reversalOfTransactionId }) {
  if (!['IN', 'OUT'].includes(type)) throw new Error('Operational transaction type must be IN or OUT.');
  if (!MOVEMENT_CATEGORIES.has(movementCategory)) throw new Error('Operational movement category is required and invalid.');

  if (movementCategory === 'REVERSAL') {
    if (!reversalOfTransactionId) throw new Error('REVERSAL requires reversalOfTransactionId.');
    const original = db.prepare(`SELECT id, transaction_type, material_id
      FROM stock_transactions WHERE id=?`).get(reversalOfTransactionId);
    if (!original) throw new Error('REVERSAL original movement was not found.');
    if (original.transaction_type === type) throw new Error('REVERSAL must have the opposite transaction type from its original movement.');
    return original;
  }

  if (reversalOfTransactionId) throw new Error('Only REVERSAL may set reversalOfTransactionId.');
  if (CATEGORY_TYPES[movementCategory] !== type) throw new Error(`Category ${movementCategory} is incompatible with transaction type ${type}.`);
  return null;
}

/**
 * Record an explicitly classified operational movement. type is 'IN' | 'OUT'.
 * transactionDate is optional (defaults to now) — sample-data seeding uses it.
 */
function recordMovement({ type, materialId, warehouseCode = null, locationId = null, quantity, userId,
                          movementCategory, reversalOfTransactionId = null, requestLineId = null,
                          reservationNumber = null, notes = null, transactionDate = null }) {
  if (!quantity || quantity <= 0) return null;
  const original = validateMovementSemantics({ type, movementCategory, reversalOfTransactionId });
  if (original && Number(original.material_id) !== Number(materialId)) {
    throw new Error('REVERSAL must reference an original movement for the same material.');
  }
  const resolvedLocationId = locationId || locationForWarehouse(warehouseCode);
  const info = db.prepare(`
    INSERT INTO stock_transactions
      (transaction_type, material_id, location_id, quantity, reservation_number, user_id,
       movement_category, movement_classification_status, category_backfill_reason,
       reversal_of_transaction_id, request_line_id, notes, transaction_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'EXPLICIT', NULL, ?, ?, ?, COALESCE(?, datetime('now')))
  `).run(type, materialId, resolvedLocationId, quantity, reservationNumber, userId,
    movementCategory, reversalOfTransactionId, requestLineId, notes, transactionDate);
  return info.lastInsertRowid;
}

module.exports = { recordMovement, locationForWarehouse, MOVEMENT_CATEGORIES };
