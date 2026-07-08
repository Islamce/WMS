/**
 * FIFO / FEFO allocation engine.
 *
 * Given a request line and a quantity, propose which batches/bins to pick from:
 *  - Expiry-managed materials -> FEFO (nearest expiry first).
 *  - Otherwise                 -> FIFO (earliest receiving/fifo date first).
 *
 * Expired, blocked, and quality-hold batches are excluded (they may only be
 * issued via an authorized supervisor override, handled at picking time).
 * If a single batch cannot cover the quantity, the allocation is split across
 * multiple batches while keeping the same request/line reference.
 */
const db = require('./../db/connection');
const { isExpired } = require('./expiry');

/** Eligible on-hand batches for a material in a warehouse, ordered by method. */
function eligibleBatches(materialId, warehouseCode, method) {
  const rows = db.prepare(`
    SELECT *, (remaining_quantity - reserved_quantity) AS available_quantity
    FROM batches
    WHERE material_id = ?
      AND (warehouse_code = ? OR ? IS NULL)
      AND quality_status = 'RELEASED'
      AND is_blocked = 0
      AND (remaining_quantity - reserved_quantity) > 0
  `).all(materialId, warehouseCode, warehouseCode);

  const usable = rows.filter((b) => !isExpired(b.expiry_date)); // never auto-allocate expired

  usable.sort((a, b) => {
    if (method === 'FEFO') {
      // nearest expiry first; nulls last
      const ax = a.expiry_date || '9999-12-31';
      const bx = b.expiry_date || '9999-12-31';
      if (ax !== bx) return ax < bx ? -1 : 1;
    }
    // FIFO tiebreak / default: earliest fifo/receiving date first
    const af = a.fifo_date || a.receiving_date || '9999-12-31';
    const bf = b.fifo_date || b.receiving_date || '9999-12-31';
    if (af !== bf) return af < bf ? -1 : 1;
    return a.id - b.id;
  });
  return usable;
}

/**
 * Build a proposed allocation for a quantity.
 * @returns {{ method, allocations: Array, allocatedQty, shortfall }}
 */
function propose({ materialId, warehouseCode, quantity, isExpiryManaged }) {
  const method = isExpiryManaged ? 'FEFO' : 'FIFO';
  const batches = eligibleBatches(materialId, warehouseCode, method);

  const allocations = [];
  let remaining = Number(quantity);
  let seq = 1;
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, b.available_quantity);
    if (take <= 0) continue;
    allocations.push({
      batch_id: b.id,
      batch_number: b.batch_number,
      warehouse_code: b.warehouse_code,
      bin_location: b.bin_location,
      qr_code_id: b.qr_code_id,
      proposed_quantity: take,
      allocation_method: method,
      sequence: seq++,
      expiry_date: b.expiry_date,
      fifo_date: b.fifo_date || b.receiving_date,
    });
    remaining -= take;
  }

  return {
    method,
    allocations,
    allocatedQty: Number(quantity) - remaining,
    shortfall: Math.max(0, remaining),
  };
}

module.exports = { propose, eligibleBatches };
