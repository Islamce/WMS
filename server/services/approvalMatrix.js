/**
 * Approval matrix — value-based approval authority.
 *
 * Some requests are worth enough that a normal approver shouldn't wave them
 * through alone. `approval_thresholds` maps a monetary floor to the permission
 * key an approver must hold; the highest matching threshold wins. Admins are
 * always exempt. The request value is the sum of (approved-or-requested
 * quantity × material price) across its non-rejected lines.
 */
const db = require('./../db/connection');

/** Total monetary value of a request's live lines. */
function requestValue(requestId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(
      COALESCE(l.approved_quantity, l.requested_quantity) * COALESCE(m.price, 0)
    ), 0) AS value
    FROM material_request_lines l
    LEFT JOIN materials m ON m.id = l.material_id
    WHERE l.request_id = ? AND l.line_status NOT IN ('Rejected','Cancelled')
  `).get(requestId);
  return row.value || 0;
}

/** Active thresholds, highest floor first. */
function listThresholds() {
  return db.prepare(
    'SELECT id, label, min_amount, currency, required_permission FROM approval_thresholds WHERE is_active=1 ORDER BY min_amount DESC'
  ).all();
}

/**
 * The permission key required to approve a request of the given value, or null
 * if no threshold applies. Returns the highest (most restrictive) match.
 */
function requiredPermissionFor(value) {
  const match = listThresholds().find((t) => value >= t.min_amount);
  return match ? match.required_permission : null;
}

module.exports = { requestValue, listThresholds, requiredPermissionFor };
