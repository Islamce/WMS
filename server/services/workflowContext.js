/**
 * Canonical material-request execution context.
 *
 * Queue routes keep their existing flat fields for backward compatibility and
 * attach this stable nested representation so web/mobile clients do not need
 * to invent a different ERP-context contract at every workflow stage.
 *
 * WMS-R16: request context previously had no stable lifecycle-event
 * chronology — no way to see, in one canonical shape, who did what to a
 * request and when. lifecycleEvents() reads the existing append-only
 * audit_trail table (already the system of record for every state change,
 * see services/audit.js) rather than introducing a second, parallel history
 * mechanism. This keeps web and mobile clients from inventing their own
 * event ordering logic against raw audit rows.
 */
const db = require('./../db/connection');

const CONTEXT_FIELDS = [
  'request_number',
  'erp_reservation_number',
  'erp_reference_number',
  'movement_type',
  'movement_type_description',
  'plant',
  'issue_warehouse_code',
  'issue_warehouse_name',
  'storage_location',
  'cost_center',
  'wbs_element',
  'required_date',
  'requester_id',
  'requester_name',
  'department',
];

function executionContext(row) {
  const context = {};
  CONTEXT_FIELDS.forEach((field) => { context[field] = row?.[field] ?? null; });
  context.wbs_project = context.wbs_element;
  return context;
}

/**
 * Stable lifecycle-event chronology for a request, read from the existing
 * append-only audit_trail. Each event carries actor, event type, source
 * screen, and both an occurred and recorded timestamp so a caller does not
 * have to assume they are identical (audit_trail currently only stores one
 * changed_at value, so occurred_at and recorded_at are the same today; kept
 * as two fields so a future write-behind or backfilled event does not
 * require a contract change). evidence_ref points back to the audit_trail
 * row so the event is traceable, not just descriptive text.
 */
function lifecycleEvents(requestNumber) {
  if (!requestNumber) return [];
  return db.prepare(`SELECT id, entity_type, action, changed_by_name, user_role, changed_at,
      source_screen, reason, comments, transaction_reference
    FROM audit_trail WHERE request_number = ? ORDER BY changed_at ASC, id ASC`).all(requestNumber)
    .map((row) => ({
      event_id: row.id,
      event_type: row.action,
      entity_type: row.entity_type,
      actor_name: row.changed_by_name,
      actor_role: row.user_role,
      source: row.source_screen,
      occurred_at: row.changed_at,
      recorded_at: row.changed_at,
      reason: row.reason,
      comments: row.comments,
      transaction_reference: row.transaction_reference,
      evidence_ref: `audit_trail#${row.id}`,
    }));
}

function withExecutionContext(row) {
  if (!row) return row;
  return {
    ...row,
    execution_context: executionContext(row),
    lifecycle_events: lifecycleEvents(row.request_number),
  };
}

// List/queue views attach execution_context only — lifecycle_events is
// deliberately omitted here because it is one audit_trail query per row and
// these endpoints can return many rows at once. Detail views for a single
// request go through withExecutionContext (singular), which does include it.
function withListExecutionContext(row) {
  return row ? { ...row, execution_context: executionContext(row) } : row;
}

function withExecutionContexts(rows) {
  return (rows || []).map(withListExecutionContext);
}

module.exports = { CONTEXT_FIELDS, executionContext, lifecycleEvents, withExecutionContext, withExecutionContexts };
