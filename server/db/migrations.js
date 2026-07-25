/**
 * Versioned migration runner.
 * Ordered, forward-only and transactional.
 */
const db = require('./connection');

function addColumnIfMissing(database, table, name, definition) {
  const cols = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  if (!cols.has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

const MIGRATIONS = [
  { id: '001_base_schema', description: 'Base inventory schema (users, roles, permissions, materials, locations, stock).', up() {} },
  { id: '002_mrp_wms_execution', description: 'MRP / warehouse-execution schema (requests, batches, bins, picking, audit, notifications).', up() {} },
  { id: '003_audit_append_only', description: 'Append-only triggers on audit_trail (block UPDATE/DELETE).', up() {} },
  { id: '004_scheduler_locks', description: 'Cross-process scheduler lease table for single-runner background sweeps.', up() {} },
  { id: '005_enterprise_completeness', description: 'Approval matrix, request attachments, and cycle-count tables (P2/P3).', up() {} },
  { id: '006_non_stock_items', description: 'materials.is_stock_item flag — non-stock items cannot be reserved/allocated.', up() {} },
  { id: '007_realloc_inventory_shipping', description: 'Stock reallocations, physical inventory sessions, outbound shipments, batches.project.', up() {} },
  { id: '008_device_tokens', description: 'device_tokens table for real push notifications (Firebase Cloud Messaging).', up() {} },
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
        SET status='EXECUTED', requested_by=COALESCE(requested_by,moved_by),
            requested_by_name=COALESCE(requested_by_name,moved_by_name), requested_at=COALESCE(requested_at,created_at),
            approved_by=COALESCE(approved_by,moved_by), approved_by_name=COALESCE(approved_by_name,moved_by_name),
            approved_at=COALESCE(approved_at,created_at), executed_by=COALESCE(executed_by,moved_by),
            executed_by_name=COALESCE(executed_by_name,moved_by_name), executed_at=COALESCE(executed_at,created_at),
            updated_at=COALESCE(updated_at,created_at)
        WHERE status IS NULL OR status='' OR status='EXECUTED';
        CREATE INDEX IF NOT EXISTS idx_realloc_status ON stock_reallocations(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_realloc_requester ON stock_reallocations(requested_by, status);
      `);
    },
  },
  {
    id: '010_stock_movement_history_import',
    description: 'Protected append-only import batches, movement history and row-level import errors.',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS stock_movement_import_batches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          movement_type TEXT NOT NULL CHECK (movement_type IN ('RECEIPT','ISSUE','RETURN')),
          source_filename TEXT NOT NULL,
          period_start TEXT,
          period_end TEXT,
          status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED','COMPLETED_WITH_ERRORS','FAILED')),
          total_rows INTEGER NOT NULL DEFAULT 0,
          inserted_rows INTEGER NOT NULL DEFAULT 0,
          duplicate_rows INTEGER NOT NULL DEFAULT 0,
          invalid_rows INTEGER NOT NULL DEFAULT 0,
          created_by INTEGER REFERENCES users(id),
          created_by_name TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS stock_movement_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          import_batch_id INTEGER NOT NULL REFERENCES stock_movement_import_batches(id),
          external_id TEXT,
          movement_type TEXT NOT NULL CHECK (movement_type IN ('RECEIPT','ISSUE','RETURN')),
          material_code TEXT NOT NULL,
          plant_code TEXT,
          warehouse_code TEXT,
          bin_location TEXT,
          description TEXT,
          unit TEXT,
          quantity REAL NOT NULL CHECK (quantity > 0),
          movement_date TEXT NOT NULL,
          movement_timestamp TEXT,
          performed_by TEXT,
          reservation_number TEXT,
          source_filename TEXT NOT NULL,
          source_row_number INTEGER NOT NULL,
          row_fingerprint TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS stock_movement_import_errors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          import_batch_id INTEGER NOT NULL REFERENCES stock_movement_import_batches(id),
          source_row_number INTEGER NOT NULL,
          external_id TEXT,
          error_code TEXT NOT NULL,
          error_message TEXT NOT NULL,
          raw_row_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_movement_history_date ON stock_movement_history(movement_date, movement_type);
        CREATE INDEX IF NOT EXISTS idx_movement_history_material ON stock_movement_history(material_code, movement_date);
        CREATE INDEX IF NOT EXISTS idx_movement_history_plant ON stock_movement_history(plant_code, movement_date);
        CREATE INDEX IF NOT EXISTS idx_movement_history_bin ON stock_movement_history(bin_location, movement_date);
        CREATE INDEX IF NOT EXISTS idx_movement_history_reservation ON stock_movement_history(reservation_number);
        CREATE INDEX IF NOT EXISTS idx_movement_batches_created ON stock_movement_import_batches(created_at DESC);

        CREATE TRIGGER IF NOT EXISTS movement_history_block_update BEFORE UPDATE ON stock_movement_history
        BEGIN SELECT RAISE(ABORT, 'stock_movement_history is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS movement_history_block_delete BEFORE DELETE ON stock_movement_history
        BEGIN SELECT RAISE(ABORT, 'stock_movement_history is append-only'); END;
      `);
    },
  },
  {
    id: '011_opening_stock_receiving_date_source',
    description: 'Track the provenance of opening-stock receiving dates for aging and KPI auditability.',
    up(database) {
      addColumnIfMissing(database, 'batches', 'receiving_date_source', "TEXT NOT NULL DEFAULT 'ESTIMATED_IMPORT_DATE'");
      database.exec('CREATE INDEX IF NOT EXISTS idx_batches_receiving_source ON batches(receiving_date_source, receiving_date)');
    },
  },
  {
    id: '012_opening_stock_batch_registry',
    description: 'Permanently register opening-stock batches and their exact material/bin ledger scope.',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS opening_stock_batch_registry (
          batch_id INTEGER PRIMARY KEY REFERENCES batches(id) ON DELETE CASCADE,
          material_id INTEGER NOT NULL REFERENCES materials(id),
          location_id INTEGER NOT NULL REFERENCES locations(id),
          registered_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_opening_registry_scope
          ON opening_stock_batch_registry(material_id, location_id);

        INSERT OR IGNORE INTO opening_stock_batch_registry(batch_id, material_id, location_id)
        SELECT b.id, b.material_id, l.id
        FROM batches b
        JOIN locations l ON l.code = b.bin_location
        JOIN stock_transactions st
          ON st.material_id = b.material_id
         AND st.location_id = l.id
        WHERE st.notes = 'Opening stock import — batch ' || b.batch_number
           OR st.notes LIKE 'Opening stock import — batch ' || b.batch_number || ';%';

        CREATE TRIGGER IF NOT EXISTS register_opening_stock_transaction
        AFTER INSERT ON stock_transactions
        WHEN NEW.notes LIKE 'Opening stock import — batch %'
        BEGIN
          INSERT OR IGNORE INTO opening_stock_batch_registry(batch_id, material_id, location_id)
          SELECT b.id, NEW.material_id, NEW.location_id
          FROM batches b
          JOIN locations l ON l.code = b.bin_location AND l.id = NEW.location_id
          WHERE b.material_id = NEW.material_id
            AND (NEW.notes = 'Opening stock import — batch ' || b.batch_number
              OR NEW.notes LIKE 'Opening stock import — batch ' || b.batch_number || ';%')
          ORDER BY b.id DESC
          LIMIT 1;
        END;
      `);
    },
  },
];

function ensureTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, description TEXT, applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

function runMigrations() {
  ensureTable();
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const record = db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)');
  let count = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.transaction(() => { m.up(db); record.run(m.id, m.description || ''); })();
    count += 1;
    console.log(`Applied migration ${m.id} — ${m.description}`);
  }
  console.log(count ? `Migrations: ${count} newly applied, ${MIGRATIONS.length} total.` : `Migrations: up to date (${MIGRATIONS.length} recorded).`);
}

module.exports = { runMigrations, MIGRATIONS };