/**
 * Canonical material-request execution context.
 *
 * Queue routes keep their existing flat fields for backward compatibility and
 * attach this stable nested representation so web/mobile clients do not need
 * to invent a different ERP-context contract at every workflow stage.
 */

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

function withExecutionContext(row) {
  return row ? { ...row, execution_context: executionContext(row) } : row;
}

function withExecutionContexts(rows) {
  return (rows || []).map(withExecutionContext);
}

module.exports = { CONTEXT_FIELDS, executionContext, withExecutionContext, withExecutionContexts };
