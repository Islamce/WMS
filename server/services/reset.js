/**
 * Production data initialization.
 *
 * This module supports one deliberate transition from demo/UAT data to real
 * operational data. It is intentionally harder to invoke than a normal admin
 * action and permanently locks itself after a successful run.
 *
 * NEVER touched: users, roles, permissions, movement types, approval
 * thresholds, reference data, schema history.
 */
const fs = require('fs');
const path = require('path');
const db = require('./../db/connection');
const audit = require('./audit');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const LOCK_FILE = path.join(DATA_DIR, 'production-initialization.lock.json');

// Order matters: children/logs first.
const TRANSACTIONAL = [
  'analytical_scope_attestation_supersessions', 'analytical_scope_attestations',
  'stock_movement_import_errors', 'stock_movement_history', 'stock_movement_import_batches',
  'notification_log', 'erp_integration_log',
  'shipments', 'stock_reallocations', 'inventory_count_lines', 'inventory_sessions',
  'picking_allocations', 'picking_tasks', 'request_attachments',
  'stock_transactions', 'material_request_lines', 'material_request_headers',
  'qr_codes', 'cycle_counts', 'batches', 'material_location_stock',
];
const MASTER = ['bin_locations', 'locations', 'materials', 'warehouses'];

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

function countRows(table) {
  if (!tableExists(table)) return 0;
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function isInitializationEnabled() {
  return String(process.env.PRODUCTION_INITIALIZATION_ENABLED || '').toLowerCase() === 'true';
}

function readInitializationLock() {
  try { return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); } catch { return null; }
}

function getInitializationStatus({ keepMasterData = false } = {}) {
  const tables = keepMasterData ? TRANSACTIONAL : [...TRANSACTIONAL, ...MASTER];
  const counts = {};
  for (const table of tables) counts[table] = countRows(table);
  counts.audit_trail = countRows('audit_trail');
  return {
    enabled: isInitializationEnabled(),
    locked: !!readInitializationLock(),
    lock: readInitializationLock(),
    keep_master_data: keepMasterData,
    counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
  };
}

function writeInitializationLock({ user, keepMasterData, counts, backupReference }) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const lock = {
    completed_at: new Date().toISOString(),
    completed_by_user_id: user?.id || null,
    completed_by_email: user?.email || null,
    kept_master_data: keepMasterData,
    backup_reference: backupReference,
    cleared: counts,
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2), { flag: 'wx', mode: 0o600 });
  return lock;
}

function initializeProductionData({ keepMasterData = false, user = null, backupReference = '' } = {}) {
  if (!isInitializationEnabled()) {
    const err = new Error('Production initialization is disabled. Set PRODUCTION_INITIALIZATION_ENABLED=true for the controlled initialization window.');
    err.code = 'INITIALIZATION_DISABLED';
    throw err;
  }
  if (readInitializationLock()) {
    const err = new Error('Production initialization has already been completed and is permanently locked.');
    err.code = 'INITIALIZATION_LOCKED';
    throw err;
  }
  if (!backupReference || backupReference.trim().length < 8) {
    const err = new Error('A verified backup reference is required before production initialization.');
    err.code = 'BACKUP_REQUIRED';
    throw err;
  }

  const counts = {};
  const run = db.transaction(() => {
    for (const table of TRANSACTIONAL) {
      if (tableExists(table)) counts[table] = db.prepare(`DELETE FROM ${table}`).run().changes;
    }
    if (!keepMasterData) {
      for (const table of MASTER) {
        if (tableExists(table)) counts[table] = db.prepare(`DELETE FROM ${table}`).run().changes;
      }
    }

    // The discarded demo/UAT audit history is removed once. Append-only
    // protection is restored immediately, then the initialization is recorded.
    db.exec('DROP TRIGGER IF EXISTS audit_trail_block_update; DROP TRIGGER IF EXISTS audit_trail_block_delete;');
    counts.audit_trail = tableExists('audit_trail')
      ? db.prepare('DELETE FROM audit_trail').run().changes
      : 0;
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS audit_trail_block_update BEFORE UPDATE ON audit_trail
      BEGIN SELECT RAISE(ABORT, 'audit_trail is append-only: rows cannot be updated'); END;
      CREATE TRIGGER IF NOT EXISTS audit_trail_block_delete BEFORE DELETE ON audit_trail
      BEGIN SELECT RAISE(ABORT, 'audit_trail is append-only: rows cannot be deleted'); END;
    `);
    audit.record({
      entityType: 'System',
      action: 'PRODUCTION_INITIALIZATION',
      newValue: {
        kept_master_data: keepMasterData,
        backup_reference: backupReference.trim(),
        cleared: counts,
      },
      user,
      sourceScreen: 'Import Center',
    });
  });
  run();

  // Uploaded demo attachments are outside the DB. This is deliberately after
  // the committed DB transaction and is best-effort.
  const attachDir = path.join(DATA_DIR, 'attachments');
  try { fs.rmSync(attachDir, { recursive: true, force: true }); } catch { /* best-effort */ }

  const lock = writeInitializationLock({
    user,
    keepMasterData,
    counts,
    backupReference: backupReference.trim(),
  });
  return { counts, lock };
}

/**
 * Legacy helper retained for isolated test/development environments only.
 * Production routes must use initializeProductionData().
 */
function factoryReset({ keepMasterData = false, user = null } = {}) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_LEGACY_FACTORY_RESET !== 'true') {
    throw new Error('Legacy factory reset is disabled in production.');
  }
  const counts = {};
  const run = db.transaction(() => {
    for (const table of TRANSACTIONAL) {
      if (tableExists(table)) counts[table] = db.prepare(`DELETE FROM ${table}`).run().changes;
    }
    if (!keepMasterData) {
      for (const table of MASTER) {
        if (tableExists(table)) counts[table] = db.prepare(`DELETE FROM ${table}`).run().changes;
      }
    }
    db.exec('DROP TRIGGER IF EXISTS audit_trail_block_update; DROP TRIGGER IF EXISTS audit_trail_block_delete;');
    counts.audit_trail = tableExists('audit_trail') ? db.prepare('DELETE FROM audit_trail').run().changes : 0;
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
  return counts;
}

module.exports = {
  factoryReset,
  getInitializationStatus,
  initializeProductionData,
  isInitializationEnabled,
  readInitializationLock,
};