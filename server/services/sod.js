/**
 * Segregation of duties (SoD) across the request lifecycle.
 *
 * Beyond "you can't approve your own request" (enforced in approvals.js), the
 * three money-touching control points — approve → create ERP reservation →
 * post goods issue — must be performed by three *different* people so no single
 * user can push a request from raised to issued alone. Admins are exempt
 * (super-user, and needed to drive tests and bootstrap).
 *
 * The approver is read from the audit trail (the actor of the Approved status
 * change); the ERP operator and GI poster are stamped on the header
 * (erp_created_by, erp_posted_by).
 */
const db = require('./../db/connection');

/** The user id who approved this request, or null. */
function approverId(requestNumber) {
  const row = db.prepare(
    "SELECT changed_by FROM audit_trail WHERE request_number=? AND action='STATUS_CHANGE' AND new_value='Approved' ORDER BY id DESC LIMIT 1"
  ).get(requestNumber);
  return row ? row.changed_by : null;
}

/**
 * Return a violation message if `user` already performed one of the named prior
 * roles on this request, or null if the action is permitted. `actors` is a list
 * of { id, label } for the conflicting earlier steps. Admins never conflict.
 */
function conflict(user, actors) {
  if (!user || user.role === 'admin') return null;
  const hit = actors.find((a) => a && a.id != null && a.id === user.id);
  return hit
    ? `Segregation of duties: you performed the ${hit.label} step for this request; a different user must perform this step.`
    : null;
}

module.exports = { approverId, conflict };
