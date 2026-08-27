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
  {
    id: '013_canonical_analytical_movements',
    description: 'Extend append-only movement history with ERP-agnostic categories, source traceability and analytical dates.',
    up(database) {
      addColumnIfMissing(database, 'stock_movement_import_batches', 'movement_category', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_import_batches', 'source_system', "TEXT NOT NULL DEFAULT 'CSV'");
      addColumnIfMissing(database, 'stock_movement_import_batches', 'source_file_checksum', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_import_batches', 'field_mapping_json', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_import_batches', 'reconciliation_json', 'TEXT');

      addColumnIfMissing(database, 'stock_movement_history', 'material_id', 'INTEGER REFERENCES materials(id)');
      addColumnIfMissing(database, 'stock_movement_history', 'movement_category', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_history', 'erp_movement_type', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_history', 'posting_date', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_history', 'document_date', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_history', 'storage_location', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_history', 'batch_number', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_history', 'erp_document_reference', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_history', 'purchase_order', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_history', 'cost_center', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_history', 'wbs_element', 'TEXT');
      addColumnIfMissing(database, 'stock_movement_history', 'source_system', "TEXT NOT NULL DEFAULT 'CSV'");
      addColumnIfMissing(database, 'stock_movement_history', 'reversal_of_category', 'TEXT');

      database.exec(`
        DROP TRIGGER IF EXISTS movement_history_block_update;

        UPDATE stock_movement_import_batches
        SET movement_category=COALESCE(movement_category, movement_type),
            source_system=COALESCE(NULLIF(source_system, ''), 'CSV');

        UPDATE stock_movement_history
        SET movement_category=COALESCE(movement_category, movement_type),
            posting_date=COALESCE(posting_date, movement_date),
            source_system=COALESCE(NULLIF(source_system, ''), 'CSV'),
            material_id=COALESCE(material_id,
              (SELECT id FROM materials WHERE item_code=stock_movement_history.material_code LIMIT 1));

        CREATE INDEX IF NOT EXISTS idx_movement_history_posting
          ON stock_movement_history(posting_date, movement_category);
        CREATE INDEX IF NOT EXISTS idx_movement_history_material_id
          ON stock_movement_history(material_id, posting_date);
        CREATE INDEX IF NOT EXISTS idx_movement_history_erp_document
          ON stock_movement_history(erp_document_reference);

        CREATE TRIGGER IF NOT EXISTS movement_history_block_update BEFORE UPDATE ON stock_movement_history
        BEGIN SELECT RAISE(ABORT, 'stock_movement_history is append-only'); END;
      `);
    },
  },
  {
    id: '014_operational_movement_semantics',
    description: 'Persist operational movement categories and traceable reversal links; backfill only unambiguous legacy records.',
    up(database) {
      const categories = "'RECEIPT','ISSUE','RETURN','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT','REVERSAL','OPENING_BALANCE'";
      addColumnIfMissing(database, 'stock_transactions', 'movement_category', `TEXT CHECK (movement_category IS NULL OR movement_category IN (${categories}))`);
      addColumnIfMissing(database, 'stock_transactions', 'movement_classification_status', "TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK (movement_classification_status IN ('EXPLICIT','BACKFILLED','NEEDS_REVIEW'))");
      addColumnIfMissing(database, 'stock_transactions', 'category_backfill_reason', 'TEXT');
      addColumnIfMissing(database, 'stock_transactions', 'reversal_of_transaction_id', 'INTEGER REFERENCES stock_transactions(id) ON DELETE SET NULL');
      addColumnIfMissing(database, 'stock_transactions', 'request_line_id', 'INTEGER REFERENCES material_request_lines(id) ON DELETE SET NULL');

      database.exec(`
        UPDATE stock_transactions
        SET movement_category = CASE
          WHEN lower(COALESCE(notes, '')) LIKE 'opening stock import — batch %' AND transaction_type='IN' THEN 'OPENING_BALANCE'
          WHEN lower(COALESCE(notes, '')) LIKE 'gi reversal %' AND transaction_type='IN' THEN 'REVERSAL'
          WHEN lower(COALESCE(notes, '')) LIKE 'gi % / %' AND transaction_type='OUT' THEN 'ISSUE'
          WHEN lower(COALESCE(notes, '')) LIKE 'reallocation % to %' AND transaction_type='OUT' THEN 'TRANSFER_OUT'
          WHEN lower(COALESCE(notes, '')) LIKE 'reallocation % from %' AND transaction_type='IN' THEN 'TRANSFER_IN'
          WHEN lower(COALESCE(notes, '')) LIKE 'cycle count % adjustment (%' AND transaction_type='IN' THEN 'ADJUSTMENT_IN'
          WHEN lower(COALESCE(notes, '')) LIKE 'cycle count % adjustment (%' AND transaction_type='OUT' THEN 'ADJUSTMENT_OUT'
          WHEN lower(COALESCE(notes, '')) LIKE 'physical inventory % adjustment (%' AND transaction_type='IN' THEN 'ADJUSTMENT_IN'
          WHEN lower(COALESCE(notes, '')) LIKE 'physical inventory % adjustment (%' AND transaction_type='OUT' THEN 'ADJUSTMENT_OUT'
          WHEN lower(COALESCE(notes, '')) = 'sample gi history' AND transaction_type='OUT' THEN 'ISSUE'
          WHEN lower(COALESCE(notes, '')) = 'sample gr history' AND transaction_type='IN' THEN 'RECEIPT'
          ELSE NULL
        END
        WHERE movement_category IS NULL;

        UPDATE stock_transactions
        SET movement_classification_status = CASE
              WHEN movement_category='REVERSAL' THEN 'NEEDS_REVIEW'
              WHEN movement_category IS NULL THEN 'NEEDS_REVIEW'
              ELSE 'BACKFILLED'
            END,
            category_backfill_reason = CASE
              WHEN movement_category='REVERSAL' THEN 'REVERSAL_ORIGINAL_NOT_UNAMBIGUOUS'
              WHEN movement_category IS NULL THEN 'UNRECOGNIZED_LEGACY_NOTES'
              ELSE NULL
            END
        WHERE movement_classification_status='NEEDS_REVIEW';

        UPDATE stock_transactions AS reversal
        SET reversal_of_transaction_id = (
          SELECT original.id
          FROM stock_transactions AS original
          WHERE original.id < reversal.id
            AND original.transaction_type='OUT'
            AND original.movement_category='ISSUE'
            AND original.material_id=reversal.material_id
            AND original.reservation_number=reversal.reservation_number
          ORDER BY original.id DESC
          LIMIT 1
        )
        WHERE reversal.movement_category='REVERSAL'
          AND reversal.reversal_of_transaction_id IS NULL
          AND reversal.reservation_number IS NOT NULL
          AND 1 = (
            SELECT COUNT(*)
            FROM stock_transactions AS original
            WHERE original.id < reversal.id
              AND original.transaction_type='OUT'
              AND original.movement_category='ISSUE'
              AND original.material_id=reversal.material_id
              AND original.reservation_number=reversal.reservation_number
          );

        UPDATE stock_transactions
        SET movement_classification_status='BACKFILLED', category_backfill_reason=NULL
        WHERE movement_category='REVERSAL'
          AND reversal_of_transaction_id IS NOT NULL
          AND movement_classification_status='NEEDS_REVIEW';

        CREATE INDEX IF NOT EXISTS idx_stock_tx_category_date
          ON stock_transactions(movement_category, transaction_date);
        CREATE INDEX IF NOT EXISTS idx_stock_tx_reversal_original
          ON stock_transactions(reversal_of_transaction_id);
        CREATE INDEX IF NOT EXISTS idx_stock_tx_request_line
          ON stock_transactions(request_line_id);
      `);
    },
  },
  {
    id: '015_import_checksum_and_permission_scope',
    description: 'Server-computed import checksum for provenance verification (WMS-R14) and dedicated analytical-import permission scoping (WMS-R15).',
    up(database) {
      addColumnIfMissing(database, 'stock_movement_import_batches', 'server_computed_checksum', 'TEXT');
    },
  },
  {
    id: '016_analytical_scope_attestations',
    description: 'Immutable material-and-plant analytical scope attestations with two-person approval and supersession evidence.',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS analytical_scope_attestations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          import_batch_id INTEGER NOT NULL REFERENCES stock_movement_import_batches(id),
          material_id INTEGER NOT NULL REFERENCES materials(id),
          material_code TEXT NOT NULL,
          plant_code TEXT NOT NULL,
          source_system TEXT NOT NULL,
          source_extract_reference TEXT NOT NULL,
          data_generated_at TEXT NOT NULL,
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          exception_window_json TEXT,
          supersedes_attestation_id INTEGER REFERENCES analytical_scope_attestations(id),
          evidence_state TEXT NOT NULL CHECK (evidence_state IN ('ATTESTED_PAYLOAD_UNVERIFIED')),
          status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','APPROVED')),
          submitted_by INTEGER NOT NULL REFERENCES users(id),
          submitted_by_name TEXT,
          submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
          approved_by INTEGER REFERENCES users(id),
          approved_by_name TEXT,
          approved_at TEXT,
          CHECK (period_start <= period_end),
          CHECK ((status='SUBMITTED' AND approved_by IS NULL AND approved_at IS NULL)
            OR (status='APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
          CHECK (approved_by IS NULL OR approved_by <> submitted_by)
        );

        CREATE TABLE IF NOT EXISTS analytical_scope_attestation_supersessions (
          prior_attestation_id INTEGER PRIMARY KEY REFERENCES analytical_scope_attestations(id),
          replacement_attestation_id INTEGER NOT NULL UNIQUE REFERENCES analytical_scope_attestations(id),
          superseded_by INTEGER NOT NULL REFERENCES users(id),
          superseded_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK (prior_attestation_id <> replacement_attestation_id)
        );

        CREATE INDEX IF NOT EXISTS idx_scope_attestation_active
          ON analytical_scope_attestations(status, material_id, plant_code, approved_at DESC);
        CREATE INDEX IF NOT EXISTS idx_scope_attestation_batch
          ON analytical_scope_attestations(import_batch_id);

        CREATE TRIGGER IF NOT EXISTS scope_attestation_block_delete
        BEFORE DELETE ON analytical_scope_attestations
        BEGIN SELECT RAISE(ABORT, 'analytical_scope_attestations are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS scope_attestation_block_approved_update
        BEFORE UPDATE ON analytical_scope_attestations
        WHEN OLD.status='APPROVED'
        BEGIN SELECT RAISE(ABORT, 'approved analytical_scope_attestations are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS scope_attestation_supersession_block_update
        BEFORE UPDATE ON analytical_scope_attestation_supersessions
        BEGIN SELECT RAISE(ABORT, 'attestation supersessions are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS scope_attestation_supersession_block_delete
        BEFORE DELETE ON analytical_scope_attestation_supersessions
        BEGIN SELECT RAISE(ABORT, 'attestation supersessions are append-only'); END;

        INSERT OR IGNORE INTO permissions(key,label) VALUES
          ('analytical_attestation_submit','Submit analytical scope attestation evidence'),
          ('analytical_attestation_approve','Approve analytical scope attestation evidence');
      `);
    },
  },
  {
    id: '017_subcontractor_materials',
    description: 'Subcontractor material receiving (site warehouses) — free-text goods, quality inspection before receipt, no material-master or ERP linkage.',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS subcontractors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          trade_category TEXT,
          contract_reference TEXT,
          contact_name TEXT,
          contact_phone TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_by INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS subcontractor_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_by INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Header: what a subcontractor dropped off at a site, before it enters stock.
        CREATE TABLE IF NOT EXISTS subcontractor_deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          warehouse_code TEXT NOT NULL REFERENCES warehouses(warehouse_code),
          subcontractor_id INTEGER NOT NULL REFERENCES subcontractors(id),
          delivery_note_ref TEXT,
          delivered_date TEXT NOT NULL DEFAULT (date('now')),
          status TEXT NOT NULL DEFAULT 'Pending Inspection'
            CHECK (status IN ('Pending Inspection','Received','Closed')),
          logged_by INTEGER REFERENCES users(id),
          logged_by_name TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Lines: free-text description/qty/category, no material_id — this stream
        -- is deliberately outside the SAP-linked material master.
        CREATE TABLE IF NOT EXISTS subcontractor_delivery_lines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          delivery_id INTEGER NOT NULL REFERENCES subcontractor_deliveries(id),
          line_number INTEGER NOT NULL,
          description TEXT NOT NULL,
          category_id INTEGER REFERENCES subcontractor_categories(id),
          uom TEXT NOT NULL DEFAULT 'EA',
          quantity_delivered REAL NOT NULL CHECK (quantity_delivered > 0),
          quality_status TEXT NOT NULL DEFAULT 'Pending'
            CHECK (quality_status IN ('Pending','Approved','Approved with Remarks','Rejected')),
          quality_notes TEXT,
          quantity_approved REAL,
          inspected_by INTEGER REFERENCES users(id),
          inspected_by_name TEXT,
          inspected_at TEXT,
          quantity_received REAL NOT NULL DEFAULT 0,
          UNIQUE(delivery_id, line_number)
        );

        -- Receipt: Site Warehouse Supervisor pulls quality-approved lines into stock.
        -- Kept separate from the delivery/inspection step so "who approved quality"
        -- and "who received into stock" are always two distinct, auditable actors.
        CREATE TABLE IF NOT EXISTS subcontractor_receipts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          warehouse_code TEXT NOT NULL REFERENCES warehouses(warehouse_code),
          received_by INTEGER REFERENCES users(id),
          received_by_name TEXT,
          received_at TEXT NOT NULL DEFAULT (datetime('now')),
          notes TEXT
        );

        CREATE TABLE IF NOT EXISTS subcontractor_receipt_lines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          receipt_id INTEGER NOT NULL REFERENCES subcontractor_receipts(id),
          delivery_line_id INTEGER NOT NULL REFERENCES subcontractor_delivery_lines(id),
          quantity_received REAL NOT NULL CHECK (quantity_received > 0)
        );

        CREATE INDEX IF NOT EXISTS idx_subc_delivery_warehouse ON subcontractor_deliveries(warehouse_code, status);
        CREATE INDEX IF NOT EXISTS idx_subc_delivery_lines_delivery ON subcontractor_delivery_lines(delivery_id);
        CREATE INDEX IF NOT EXISTS idx_subc_receipt_lines_delivery_line ON subcontractor_receipt_lines(delivery_line_id);

        INSERT OR IGNORE INTO permissions(key,label) VALUES
          ('subcontractor_admin','Manage Subcontractors & Categories'),
          ('subcontractor_quality_inspection','Subcontractor Delivery Quality Inspection'),
          ('subcontractor_receiving','Subcontractor Material Receiving');

        -- Grant to the existing roles that already do this job in the field
        -- (quality inspection = Quality role, receiving = Warehouse Supervisor role).
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT r.id, p.id FROM roles r, permissions p
          WHERE r.name = 'quality' AND p.key = 'subcontractor_quality_inspection';
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT r.id, p.id FROM roles r, permissions p
          WHERE r.name = 'warehouse_supervisor' AND p.key = 'subcontractor_receiving';
        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
          SELECT r.id, p.id FROM roles r, permissions p
          WHERE r.name = 'warehouse_supervisor' AND p.key = 'subcontractor_admin';
      `);
    },
  },
  {
    id: '018_subcontractor_consumption',
    description: 'Subcontractor stock consumption (issue) — depletes the same computed on-hand view that receiving builds up, logged by the Site Warehouse Supervisor, no approval step.',
    up(database) {
      database.exec(`
        -- One row per consumption event, matched against the same
        -- (warehouse_code, description, category_id, uom) grouping the stock
        -- view aggregates on, since receipts are never tied to a single SKU.
        CREATE TABLE IF NOT EXISTS subcontractor_consumptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          warehouse_code TEXT NOT NULL REFERENCES warehouses(warehouse_code),
          description TEXT NOT NULL,
          category_id INTEGER REFERENCES subcontractor_categories(id),
          uom TEXT NOT NULL DEFAULT 'EA',
          quantity_issued REAL NOT NULL CHECK (quantity_issued > 0),
          reference TEXT,
          notes TEXT,
          issued_by INTEGER REFERENCES users(id),
          issued_by_name TEXT,
          issued_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_subc_consumption_key
          ON subcontractor_consumptions(warehouse_code, description, category_id, uom);
      `);
    },
  },
  {
    id: '019_warehouse_project_scope',
    description: 'Group warehouses by project_name (site/project stores in particular) — no new table, just a column every warehouse-facing screen can filter and group on.',
    up(database) {
      addColumnIfMissing(database, 'warehouses', 'project_name', 'TEXT');
      database.exec(`CREATE INDEX IF NOT EXISTS idx_warehouses_project ON warehouses(project_name);`);
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
