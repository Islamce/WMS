/**
 * Versioned migration runner.
 *
 * The base schema (`migrate.js`) and the MRP/WMS schema (`migrate2.js`) are the
 * idempotent *baseline*: they use CREATE TABLE IF NOT EXISTS and conditional
 * ALTERs, so an existing install is always brought up to the baseline shape on
 * boot. That baseline is what keeps zero-downtime, git-connected deploys safe.
 *
 * This runner layers ordered, *one-time* migrations on top of that baseline and
 * records each in `schema_migrations`. Any schema change from here on should be
 * added as a new numbered entry in MIGRATIONS rather than by expanding the
 * idempotent baseline — that gives an auditable, ordered history of what's in
 * place and a clean path to a server RDBMS (see docs/POSTGRES-MIGRATION.md), where
 * CREATE IF NOT EXISTS is not a strategy.
 *
 * Each migration is { id, description, up(db) }. `up` runs once, inside a
 * transaction, and only if `id` is not already recorded.
 */
const db = require('./connection');

function addColumnIfMissing(database, table, name, definition) {
  const cols = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  if (!cols.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

// Ordered list. The two baseline entries are recorded as applied because the
// idempotent baseline exec (migrate.js + migrate2.js) already materialises them;
// they exist so `schema_migrations` is a truthful record of what's in place.
// Append new deltas below with the next number and a real `up`.
const MIGRATIONS = [
  {
    id: '001_base_schema',
    description: 'Base inventory schema (users, roles, permissions, materials, locations, stock).',
    up() { /* applied by the idempotent baseline in migrate.js */ },
  },
  {
    id: '002_mrp_wms_execution',
    description: 'MRP / warehouse-execution schema (requests, batches, bins, picking, audit, notifications).',
    up() { /* applied by the idempotent baseline in migrate2.js */ },
  },
  {
    id: '003_audit_append_only',
    description: 'Append-only triggers on audit_trail (block UPDATE/DELETE).',
    up() { /* triggers created by the idempotent baseline in migrate2.js */ },
  },
  {
    id: '004_scheduler_locks',
    description: 'Cross-process scheduler lease table for single-runner background sweeps.',
    up() { /* table created by the idempotent baseline in migrate2.js */ },
  },
  {
    id: '005_enterprise_completeness',
    description: 'Approval matrix, request attachments, and cycle-count tables (P2/P3).',
    up() { /* tables created by the idempotent baseline in migrate2.js */ },
  },
  {
    id: '006_non_stock_items',
    description: 'materials.is_stock_item flag — non-stock items cannot be reserved/allocated.',
    up() { /* column added by the idempotent baseline in migrate2.js */ },
  },
  {
    id: '007_realloc_inventory_shipping',
    description: 'Stock reallocations, physical inventory sessions, outbound shipments, batches.project.',
    up() { /* tables/column created by the idempotent baseline in migrate2.js */ },
  },
  {
    id: '008_device_tokens',
    description: 'device_tokens table for real push notifications (Firebase Cloud Messaging).',
    up() { /* table created by the idempotent baseline in migrate2.js */ },
  },
  {
    id: '009_reallocation_approval_workflow',
    description: 'Approval, segregation-of-duties, execution and replay evidence for stock reallocations.',
    up(database) {
      addColumnIfMissing(database, 'stock_reallocations', 'status', "TEXT NOT NULL DEFAULT 'EXECUTED'");
      addColumnIfMissing(database, 'stock_reallocations', 'requested_by', 'INTEGER REFERENCES users(id)');
      addColumnIfMissing(database, 'stock_reallocations', 'requested_by_name', 'TEXT');
      addColumnIfMissing(database, 'stock_reallocations', 'requested_at', 'TEXT');
      addColumnIfMissing(database, 'stock_reallocations', 'approved_by', 'INTEGER REFERENCES users(id)');
      addColumnIfMissing(database, 'stock_reallocations', 'approved_by_name', 'TEXT');
      addColumnIfMissing(database, 'stock_reallocations', 'approved_at', 'TEXT');
      addColumnIfMissing(database, 'stock_reallocations', 'rejected_by', 'INTEGER REFERENCES users(id)');
      addColumnIfMissing(database, 'stock_reallocations', 'rejected_by_name', 'TEXT');
      addColumnIfMissing(database, 'stock_reallocations', 'rejected_at', 'TEXT');
      addColumnIfMissing(database, 'stock_reallocations', 'rejection_reason', 'TEXT');
      addColumnIfMissing(database, 'stock_reallocations', 'executed_by', 'INTEGER REFERENCES users(id)');
      addColumnIfMissing(database, 'stock_reallocations', 'executed_by_name', 'TEXT');
      addColumnIfMissing(database, 'stock_reallocations', 'executed_at', 'TEXT');
      addColumnIfMissing(database, 'stock_reallocations', 'execution_error', 'TEXT');
      addColumnIfMissing(database, 'stock_reallocations', 'updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))");

      database.exec(`
        UPDATE stock_reallocations
        SET status='EXECUTED',
            requested_by=COALESCE(requested_by, moved_by),
            requested_by_name=COALESCE(requested_by_name, moved_by_name),
            requested_at=COALESCE(requested_at, created_at),
            approved_by=COALESCE(approved_by, moved_by),
            approved_by_name=COALESCE(approved_by_name, moved_by_name),
            approved_at=COALESCE(approved_at, created_at),
            executed_by=COALESCE(executed_by, moved_by),
            executed_by_name=COALESCE(executed_by_name, moved_by_name),
            executed_at=COALESCE(executed_at, created_at),
            updated_at=COALESCE(updated_at, created_at)
        WHERE status IS NULL OR status='' OR status='EXECUTED'
      `);
      database.exec('CREATE INDEX IF NOT EXISTS idx_realloc_status ON stock_reallocations(status, created_at)');
      database.exec('CREATE INDEX IF NOT EXISTS idx_realloc_requester ON stock_reallocations(requested_by, status)');
    },
  },
];

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      description TEXT,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function runMigrations() {
  ensureTable();
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, description) VALUES (?, ?)'
  );
  let count = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      m.up(db);
      record.run(m.id, m.description || '');
    })();
    count += 1;
    console.log(`Applied migration ${m.id} — ${m.description}`);
  }
  console.log(
    count ? `Migrations: ${count} newly applied, ${MIGRATIONS.length} total.`
          : `Migrations: up to date (${MIGRATIONS.length} recorded).`
  );
}

module.exports = { runMigrations, MIGRATIONS };
