/**
 * Audit service — append-only trail. Every state change or field modification
 * in the workflow calls record(). Values are stringified so we can diff
 * anything (scalars, arrays, objects).
 */
const db = require('./../db/connection');

function str(v) {
  if (v === undefined || v === null) return null;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/**
 * @param {object} e
 * @param {string} e.entityType   e.g. 'MaterialRequestHeader'
 * @param {number} [e.entityId]
 * @param {string} [e.requestNumber]
 * @param {number} [e.lineNumber]
 * @param {string} e.action        e.g. 'APPROVE', 'QTY_CHANGE'
 * @param {*} [e.oldValue]
 * @param {*} [e.newValue]
 * @param {object} [e.user]        req.user
 * @param {string} [e.reason]
 * @param {string} [e.comments]
 * @param {string} [e.sourceScreen]
 * @param {string} [e.transactionReference]
 */
function record(e) {
  db.prepare(`
    INSERT INTO audit_trail
      (entity_type, entity_id, request_number, line_number, action, old_value, new_value,
       changed_by, changed_by_name, reason, comments, user_role, source_screen, transaction_reference)
    VALUES (@entity_type, @entity_id, @request_number, @line_number, @action, @old_value, @new_value,
       @changed_by, @changed_by_name, @reason, @comments, @user_role, @source_screen, @transaction_reference)
  `).run({
    entity_type: e.entityType,
    entity_id: e.entityId ?? null,
    request_number: e.requestNumber ?? null,
    line_number: e.lineNumber ?? null,
    action: e.action,
    old_value: str(e.oldValue),
    new_value: str(e.newValue),
    changed_by: e.user ? e.user.id : null,
    changed_by_name: e.user ? e.user.name : null,
    reason: e.reason ?? null,
    comments: e.comments ?? null,
    user_role: e.user ? e.user.role : null,
    source_screen: e.sourceScreen ?? null,
    transaction_reference: e.transactionReference ?? null,
  });
}

module.exports = { record };
