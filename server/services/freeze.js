/**
 * Inventory freeze — while a physical-inventory session with freeze_stock=1 is
 * open (COUNTING or REVIEW) on a warehouse, stock movements in that warehouse
 * are blocked: goods receipt, allocation, and reallocation. This keeps the
 * count snapshot and the physical reality aligned until the session posts.
 */
const db = require('./../db/connection');

/** Returns the open freeze-enabled session for a warehouse, or undefined. */
function activeFreeze(warehouseCode) {
  if (!warehouseCode) return undefined;
  return db.prepare(`
    SELECT id, session_number, session_type, status FROM inventory_sessions
    WHERE warehouse_code=? AND freeze_stock=1 AND status IN ('COUNTING','REVIEW')
    ORDER BY id DESC LIMIT 1
  `).get(warehouseCode);
}

/** Standard 400 message when a warehouse is frozen. */
function freezeMessage(freeze, warehouseCode) {
  return `Warehouse ${warehouseCode} is frozen for physical inventory `
    + `(${freeze.session_type.toLowerCase()} count ${freeze.session_number}). `
    + 'Stock movements resume when the count is posted or cancelled.';
}

module.exports = { activeFreeze, freezeMessage };
