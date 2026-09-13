/**
 * FIFO/FEFO allocation of a request's approved lines onto batches and bins.
 *
 * This was the body of POST /api/warehouse/:id/allocate and nothing else. It
 * lives here because the Contracting edition has no bin-assignment operator and
 * no screen on which to run it, yet still needs everything this produces:
 *
 *   - picking_allocations rows, which pick-confirm consumes to decrement
 *     batches.remaining_quantity. Without them a pick records a movement and
 *     never reduces the stock it moved.
 *   - material_request_lines.reserved_quantity, which is the ceiling picking
 *     enforces. It defaults to 0, so with no allocation every pick is refused.
 *   - the batch CHOICE itself: FEFO on expiry-managed material, and the
 *     exclusion of expired, blocked and quality-hold batches.
 *
 * So this step is not ERP ceremony and is not removable. What is removable is a
 * human doing it on a separate screen at a separate time: on Contracting it runs
 * automatically at approval, on the same data with the same rules.
 */
const db = require('./../db/connection');
const audit = require('./audit');
const allocation = require('./allocation');
const { LINE_STATUS } = require('./../workflow/states');

/**
 * Allocate every open line of `header`. Must be called inside a transaction.
 * Returns one result row per line. Callers own the status transitions.
 */
function allocateLines({ header, user, sourceScreen, action = 'ALLOCATE' }) {
  const lines = db.prepare(
    "SELECT * FROM material_request_lines WHERE request_id=? AND line_status NOT IN ('Rejected','Cancelled')"
  ).all(header.id);
  const results = [];

  for (const line of lines) {
    const qty = line.approved_quantity ?? line.requested_quantity;
    const plan = allocation.propose({
      materialId: line.material_id, warehouseCode: header.issue_warehouse_code,
      quantity: qty, isExpiryManaged: !!line.is_expiry_managed,
    });

    let seq = 1;
    plan.allocations.forEach((a) => {
      db.prepare(`
        INSERT INTO picking_allocations
          (request_id, request_number, line_id, line_number, material_id, batch_id, batch_number,
           warehouse_code, bin_location, qr_code_id, proposed_quantity, allocation_method, sequence, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'PROPOSED')
      `).run(header.id, header.request_number, line.id, line.line_number, line.material_id,
        a.batch_id, a.batch_number, a.warehouse_code, a.bin_location, a.qr_code_id,
        a.proposed_quantity, a.allocation_method, seq++);
      db.prepare('UPDATE batches SET reserved_quantity = reserved_quantity + ? WHERE id=?')
        .run(a.proposed_quantity, a.batch_id);
    });

    const primary = plan.allocations[0];
    db.prepare(`
      UPDATE material_request_lines
      SET bin_location=?, batch_number=?, batch_id=?, qr_code_id=?, reserved_quantity=?,
          fifo_sequence=?, fefo_sequence=?, line_status=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      primary ? primary.bin_location : null,
      primary ? primary.batch_number : null,
      primary ? primary.batch_id : null,
      primary ? primary.qr_code_id : null,
      plan.allocatedQty,
      plan.method === 'FIFO' ? 1 : null,
      plan.method === 'FEFO' ? 1 : null,
      primary ? LINE_STATUS.BATCH_ASSIGNED : LINE_STATUS.NOT_AVAILABLE,
      line.id
    );

    audit.record({ entityType: 'MaterialRequestLine', entityId: line.id, requestNumber: header.request_number,
      lineNumber: line.line_number, action, newValue: {
        method: plan.method, allocated: plan.allocatedQty, shortfall: plan.shortfall,
        batches: plan.allocations.map((a) => `${a.batch_number}:${a.proposed_quantity}`),
      }, user, sourceScreen });

    results.push({ line_number: line.line_number, material_code: line.material_code, method: plan.method,
      allocated: plan.allocatedQty, requested: qty, shortfall: plan.shortfall,
      allocations: plan.allocations });
  }

  return results;
}

module.exports = { allocateLines };
