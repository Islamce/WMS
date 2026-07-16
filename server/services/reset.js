/**
 * Factory reset — clears the demo/test dataset so real data can be loaded.
 *
 * Deletes ALL transactional data (requests, picking, batches, QR labels,
 * stock movements, cycle counts, attachments, notifications, ERP logs) and —
 * unless keepMasterData is set — the sample master data (materials, locations,
 * warehouses, bins).
 *
 * NEVER touched: users, roles, permissions, movement types, approval
 * thresholds, reference data, schema history. The audit trail is cleared too
 * (it documents only the discarded test data); its append-only triggers are
 * dropped for the operation and recreated, and a DATA_RESET record is written
 * as the first entry of the new history.
 */
const fs = require('fs');
const path = require('path');
const db = require('./../db/connection');
const audit = require('./audit');

// Order matters: children/logs first (notification_log.task_id references
// picking_tasks; lines reference qr_codes/batches; qr_codes reference batches).
const TRANSACTIONAL = [
  'notification_log', 'erp_integration_log',
  'shipments', 'stock_reallocations', 'inventory_count_lines', 'inventory_sessions',
  'picking_allocations', 'picking_tasks', 'request_attachments',
  'material_request_lines', 'material_request_headers',
  'qr_codes', 'cycle_counts', 'batches',
  'stock_transactions', 'material_location_stock',
];
const MASTER = ['bin_locations', 'locations', 'materials', 'warehouses'];

function factoryReset({ keepMasterData = false, user = null } = {}) {
  const counts = {};
  const run = db.transaction(() => {
    for (const t of TRANSACTIONAL) {
      counts[t] = db.prepare(`DELETE FROM ${t}`).run().changes;
    }
    if (!keepMasterData) {
      for (const t of MASTER) {
        counts[t] = db.prepare(`DELETE FROM ${t}`).run().changes;
      }
    }
    // Audit history of the discarded data: temporarily lift the append-only
    // triggers, clear, and restore the guarantee.
    db.exec('DROP TRIGGER IF EXISTS audit_trail_block_update; DROP TRIGGER IF EXISTS audit_trail_block_delete;');
    counts.audit_trail = db.prepare('DELETE FROM audit_trail').run().changes;
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS audit_trail_block_update BEFORE UPDATE ON audit_trail
      BEGIN SELECT RAISE(ABORT, 'audit_trail is append-only: rows cannot be updated'); END;
      CREATE TRIGGER IF NOT EXISTS audit_trail_block_delete BEFORE DELETE ON audit_trail
      BEGIN SELECT RAISE(ABORT, 'audit_trail is append-only: rows cannot be deleted'); END;
    `);
    audit.record({ entityType: 'System', action: 'DATA_RESET',
      newValue: { kept_master_data: keepMasterData, cleared: counts }, user, sourceScreen: 'Import Center' });
  });
  run();

  // Uploaded attachment files (outside the DB).
  const attachDir = path.join(__dirname, '..', '..', 'data', 'attachments');
  try { fs.rmSync(attachDir, { recursive: true, force: true }); } catch { /* best-effort */ }

  return counts;
}

module.exports = { factoryReset };
