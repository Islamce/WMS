/**
 * Locally minted document numbers — reserved, never derived.
 *
 * These numbers stand in for the SAP documents a contractor does not have: an
 * issue number where a reservation would be, a GI number where a posting
 * reference would be. They are not cosmetic. `ISS-…` is written to
 * `stock_transactions.reservation_number` on every outbound movement, and the
 * GI reversal path identifies what to put back by document number. Two
 * movements sharing one reference is a corrupt audit trail.
 *
 * The first implementation counted the numbers already issued and added one.
 * That is wrong in two ways, and the second one is silent:
 *
 *   - Cancel or delete a numbered request and the count drops, so the next mint
 *     hands out a number that is already on a movement. Demonstrated, not
 *     theorised: three mints, delete the second, and the fourth mint returns
 *     ISS-2026-00003 again.
 *   - Two approvals in the same instant both read the same count and both get
 *     the same number.
 *
 * A counter that is incremented and read in one statement has neither problem.
 * Numbers are consumed even when the work that asked for one then fails, so the
 * series can have gaps. A gap is a non-event; a duplicate is not.
 */
const db = require('./../db/connection');

/**
 * Allocate the next number for a scope, e.g. nextNumber('ISS') -> ISS-2026-00004.
 *
 * Atomic on its own, and safe to call inside a caller's transaction.
 */
function nextNumber(scope, period = String(new Date().getFullYear())) {
  const row = db.prepare(`
    INSERT INTO document_sequences (scope, period, next_value) VALUES (?, ?, 2)
    ON CONFLICT(scope, period) DO UPDATE SET next_value = next_value + 1
    RETURNING next_value
  `).get(scope, period);
  // On insert the row is created holding the NEXT value, so the number just
  // allocated is one below whatever the statement returns, in both branches.
  const value = row.next_value - 1;
  return `${scope}-${period}-${String(value).padStart(5, '0')}`;
}

module.exports = { nextNumber };
