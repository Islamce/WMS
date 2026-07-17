/**
 * Migration 2 — Material Request & Warehouse Goods Issue platform.
 *
 * Adds the enterprise MRP/WMS-execution entities on top of the base schema
 * (users, roles, permissions, materials, locations, stock). Idempotent:
 * every statement uses IF NOT EXISTS, so it is safe to re-run.
 *
 * Design notes:
 *  - ERP-agnostic: no SAP/Oracle-specific columns; erp_system is a free field
 *    and integration payloads are stored as JSON text in erp_integration_log.
 *  - Extensible: goods receipt / batches / QR are modelled as first-class
 *    tables so future receiving, putaway, transfer and counting phases plug in
 *    without schema churn.
 *  - Money/quantity kept as REAL for portability (SQLite); swap to NUMERIC on
 *    a server RDBMS.
 */
const db = require('./connection');

const schema = `
-- ===========================================================================
-- Material master extensions: shelf-life / batch / serial control
-- (SQLite lacks "ADD COLUMN IF NOT EXISTS"; the migrate runner below adds them
--  conditionally.)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Movement types (controlled list, ERP-agnostic).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movement_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL,
  direction     TEXT NOT NULL DEFAULT 'ISSUE'
                CHECK (direction IN ('ISSUE','RECEIPT','TRANSFER','REVERSAL')),
  cost_object   TEXT,                 -- COST_CENTER | WBS | ORDER | STORAGE | PO | NONE
  is_reversal   INTEGER NOT NULL DEFAULT 0,
  requires_cost_center INTEGER NOT NULL DEFAULT 0,
  requires_wbs         INTEGER NOT NULL DEFAULT 0,
  requires_order       INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Warehouses (many per plant / storage location).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_code    TEXT NOT NULL UNIQUE,
  warehouse_name    TEXT NOT NULL,
  company           TEXT,
  business_unit     TEXT,
  plant             TEXT,
  storage_location  TEXT,
  warehouse_type    TEXT,             -- STANDARD | COLD | HAZMAT | QUALITY ...
  responsible_team  TEXT,
  supervisor_id     INTEGER REFERENCES users(id),
  supervisor_name   TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Bin locations. Supports compact (R-03-02-23) and expanded
-- (WH01-ZA-R03-L02-C23) formats via the structured columns + full_bin_location.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bin_locations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_code        TEXT NOT NULL REFERENCES warehouses(warehouse_code),
  zone                  TEXT,
  rack                  TEXT,
  line_or_aisle         TEXT,
  level                 TEXT,
  column_number         TEXT,
  bin_code              TEXT NOT NULL,          -- compact code e.g. R-03-02-23
  full_bin_location     TEXT NOT NULL,          -- expanded e.g. WH01-ZA-R03-L02-C23
  capacity              REAL NOT NULL DEFAULT 0,
  current_occupancy     REAL NOT NULL DEFAULT 0,
  allowed_material_types TEXT,                  -- CSV, empty = any
  hazard_flag           INTEGER NOT NULL DEFAULT 0,
  temperature_controlled_flag INTEGER NOT NULL DEFAULT 0,
  quality_restricted_flag INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (warehouse_code, full_bin_location)
);

-- ---------------------------------------------------------------------------
-- Batches (mandatory for received materials). Stock is tracked at batch level
-- so FIFO/FEFO and expiry logic operate on real on-hand quantities.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batches (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_number       TEXT NOT NULL,
  material_id        INTEGER NOT NULL REFERENCES materials(id),
  material_code      TEXT NOT NULL,
  material_description TEXT,
  supplier_code      TEXT,
  supplier_name      TEXT,
  po_number          TEXT,
  gr_number          TEXT,
  receiving_date     TEXT,
  manufacturing_date TEXT,
  expiry_date        TEXT,
  shelf_life_period  INTEGER,
  shelf_life_unit    TEXT,                       -- DAYS | MONTHS | YEARS
  received_quantity  REAL NOT NULL DEFAULT 0,
  remaining_quantity REAL NOT NULL DEFAULT 0 CHECK (remaining_quantity >= 0),
  reserved_quantity  REAL NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  warehouse_code     TEXT REFERENCES warehouses(warehouse_code),
  bin_location       TEXT,
  quality_status     TEXT NOT NULL DEFAULT 'RELEASED'
                     CHECK (quality_status IN ('RELEASED','QUALITY_HOLD','BLOCKED','REJECTED')),
  qr_code_id         INTEGER,
  fifo_date          TEXT,                        -- receiving/defined FIFO date
  fefo_date          TEXT,                        -- expiry date for FEFO
  is_blocked         INTEGER NOT NULL DEFAULT 0,
  blocked_reason     TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (material_id, batch_number, warehouse_code)
);
-- available_quantity is derived = remaining_quantity - reserved_quantity.

-- ---------------------------------------------------------------------------
-- QR codes generated at goods receipt.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qr_codes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  qr_code_value      TEXT NOT NULL UNIQUE,        -- scannable payload/id
  material_id        INTEGER REFERENCES materials(id),
  material_code      TEXT,
  material_description TEXT,
  batch_id           INTEGER REFERENCES batches(id),
  batch_number       TEXT,
  po_number          TEXT,
  gr_number          TEXT,
  supplier_code      TEXT,
  supplier_name      TEXT,
  warehouse_code     TEXT,
  bin_location       TEXT,
  received_quantity  REAL,
  remaining_quantity REAL,
  uom                TEXT,
  receiving_date     TEXT,
  manufacturing_date TEXT,
  expiry_date        TEXT,
  quality_status     TEXT,
  qr_status          TEXT NOT NULL DEFAULT 'ACTIVE'
                     CHECK (qr_status IN ('ACTIVE','CONSUMED','BLOCKED','EXPIRED')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  printed_at         TEXT,
  print_count        INTEGER NOT NULL DEFAULT 0,
  last_scanned_at    TEXT,
  last_scanned_by    INTEGER REFERENCES users(id)
);

-- ---------------------------------------------------------------------------
-- Material request header.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_request_headers (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  request_number         TEXT NOT NULL UNIQUE,
  request_type           TEXT NOT NULL DEFAULT 'COST_CENTER',  -- COST_CENTER|WBS|ORDER|...
  requester_id           INTEGER NOT NULL REFERENCES users(id),
  requester_name         TEXT,
  employee_id            TEXT,
  department             TEXT,
  section                TEXT,
  company                TEXT,
  business_unit          TEXT,
  plant                  TEXT,
  cost_center            TEXT,
  wbs_element            TEXT,
  internal_order         TEXT,
  production_order       TEXT,
  required_date          TEXT,
  priority               TEXT NOT NULL DEFAULT 'NORMAL'
                         CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  purpose                TEXT,
  delivery_location      TEXT,
  request_status         TEXT NOT NULL DEFAULT 'Draft',
  current_workflow_step  TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at           TEXT,
  approved_at            TEXT,
  rejected_at            TEXT,
  returned_at            TEXT,
  closed_at              TEXT,
  created_by             INTEGER REFERENCES users(id),
  updated_by             INTEGER REFERENCES users(id),
  approval_comments      TEXT,
  rejection_reason       TEXT,
  return_reason          TEXT,
  closure_reason         TEXT,
  erp_reservation_number TEXT,
  erp_reference_number   TEXT,
  erp_reservation_date   TEXT,
  erp_created_by         INTEGER REFERENCES users(id),
  movement_type          TEXT,
  movement_type_description TEXT,
  storage_location       TEXT,
  issue_warehouse_code   TEXT REFERENCES warehouses(warehouse_code),
  issue_warehouse_name   TEXT,
  gi_document_number     TEXT,
  gi_fiscal_year         TEXT,
  gi_posting_date        TEXT,
  erp_posted_by          INTEGER REFERENCES users(id),
  erp_posting_status     TEXT,        -- PENDING|POSTED|FAILED
  erp_error_message      TEXT,
  attachment_reference   TEXT,
  total_lines            INTEGER NOT NULL DEFAULT 0,
  completed_lines        INTEGER NOT NULL DEFAULT 0,
  shortage_lines         INTEGER NOT NULL DEFAULT 0,
  cancelled_lines        INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Material request line.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_request_lines (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id            INTEGER NOT NULL REFERENCES material_request_headers(id) ON DELETE CASCADE,
  request_number        TEXT NOT NULL,
  line_number           INTEGER NOT NULL,
  material_id           INTEGER REFERENCES materials(id),
  material_code         TEXT NOT NULL,
  material_description   TEXT,
  material_type         TEXT,
  material_group        TEXT,
  uom                   TEXT,
  requested_quantity    REAL NOT NULL DEFAULT 0,
  approved_quantity     REAL,
  reserved_quantity     REAL NOT NULL DEFAULT 0,
  picked_quantity       REAL NOT NULL DEFAULT 0,
  issued_quantity       REAL NOT NULL DEFAULT 0,
  shortage_quantity     REAL NOT NULL DEFAULT 0,
  cancelled_quantity    REAL NOT NULL DEFAULT 0,
  line_status           TEXT NOT NULL DEFAULT 'Draft',
  plant                 TEXT,
  storage_location      TEXT,
  warehouse_code        TEXT,
  warehouse_name        TEXT,
  bin_location          TEXT,
  batch_number          TEXT,
  batch_id              INTEGER REFERENCES batches(id),
  qr_code_id            INTEGER REFERENCES qr_codes(id),
  expiry_date           TEXT,
  manufacturing_date    TEXT,
  shelf_life_period     INTEGER,
  shelf_life_unit       TEXT,
  fifo_sequence         INTEGER,
  fefo_sequence         INTEGER,
  picking_remarks       TEXT,
  shortage_reason       TEXT,
  replacement_material_code TEXT,
  is_batch_managed      INTEGER NOT NULL DEFAULT 0,
  is_expiry_managed     INTEGER NOT NULL DEFAULT 0,
  is_serial_managed     INTEGER NOT NULL DEFAULT 0,
  serial_number         TEXT,
  quality_status        TEXT,
  is_blocked            INTEGER NOT NULL DEFAULT 0,
  blocked_reason        TEXT,
  supervisor_override_flag INTEGER NOT NULL DEFAULT 0,
  supervisor_override_reason TEXT,
  supervisor_override_by INTEGER REFERENCES users(id),
  supervisor_override_at TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (request_id, line_number)
);

-- ---------------------------------------------------------------------------
-- Picking allocations: proposed batch/bin splits per request line (FIFO/FEFO).
-- One request line can span multiple batches/bins, each confirmed separately.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS picking_allocations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id         INTEGER NOT NULL REFERENCES material_request_headers(id) ON DELETE CASCADE,
  request_number     TEXT NOT NULL,
  line_id            INTEGER NOT NULL REFERENCES material_request_lines(id) ON DELETE CASCADE,
  line_number        INTEGER NOT NULL,
  material_id        INTEGER NOT NULL REFERENCES materials(id),
  batch_id           INTEGER REFERENCES batches(id),
  batch_number       TEXT,
  warehouse_code     TEXT,
  bin_location       TEXT,
  qr_code_id         INTEGER REFERENCES qr_codes(id),
  proposed_quantity  REAL NOT NULL DEFAULT 0,
  picked_quantity    REAL NOT NULL DEFAULT 0,
  allocation_method  TEXT,                       -- FIFO | FEFO
  sequence           INTEGER,
  status             TEXT NOT NULL DEFAULT 'PROPOSED'
                     CHECK (status IN ('PROPOSED','SCANNED','PICKED','SHORT','CANCELLED')),
  scanned_qr_value   TEXT,
  scan_result        TEXT,                        -- PASS | FAIL reason
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Picking tasks (manual assignment, acceptance, reminders, escalation).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS picking_tasks (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id            INTEGER NOT NULL REFERENCES material_request_headers(id) ON DELETE CASCADE,
  request_number        TEXT NOT NULL,
  assigned_picker_id    INTEGER REFERENCES users(id),
  assigned_picker_name  TEXT,
  assigned_by           INTEGER REFERENCES users(id),
  assigned_at           TEXT,
  accepted_at           TEXT,
  started_at            TEXT,
  completed_at          TEXT,
  task_status           TEXT NOT NULL DEFAULT 'Created',
  priority              TEXT NOT NULL DEFAULT 'NORMAL',
  target_completion_time TEXT,
  reminder_count        INTEGER NOT NULL DEFAULT 0,
  last_reminder_at      TEXT,
  escalation_level      INTEGER NOT NULL DEFAULT 0,
  escalated_to          INTEGER REFERENCES users(id),
  warehouse_code        TEXT,
  total_lines           INTEGER NOT NULL DEFAULT 0,
  total_bin_locations   INTEGER NOT NULL DEFAULT 0,
  remarks               TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Audit trail (append-only).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_trail (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type           TEXT NOT NULL,
  entity_id             INTEGER,
  request_number        TEXT,
  line_number           INTEGER,
  action                TEXT NOT NULL,
  old_value             TEXT,
  new_value             TEXT,
  changed_by            INTEGER REFERENCES users(id),
  changed_by_name       TEXT,
  changed_at            TEXT NOT NULL DEFAULT (datetime('now')),
  reason                TEXT,
  comments              TEXT,
  user_role             TEXT,
  source_screen         TEXT,
  transaction_reference TEXT
);

-- ---------------------------------------------------------------------------
-- Notification log (multi-channel, with escalation levels).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  request_number     TEXT,
  task_id            INTEGER REFERENCES picking_tasks(id),
  recipient_user_id  INTEGER REFERENCES users(id),
  recipient_name     TEXT,
  recipient_role     TEXT,
  notification_type  TEXT NOT NULL,
  notification_title TEXT,
  notification_message TEXT,
  channel            TEXT NOT NULL DEFAULT 'IN_APP',  -- IN_APP|EMAIL|PUSH|TEAMS|SMS|WHATSAPP
  sent_at            TEXT NOT NULL DEFAULT (datetime('now')),
  read_at            TEXT,
  acknowledged_at    TEXT,
  status             TEXT NOT NULL DEFAULT 'SENT'
                     CHECK (status IN ('SENT','READ','ACKNOWLEDGED','FAILED')),
  escalation_level   INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- ERP integration log (payload/response per transaction, retry tracking).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_integration_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  request_number     TEXT,
  transaction_type   TEXT NOT NULL,        -- RESERVATION|GI_POSTING|STOCK_CHECK|...
  erp_system         TEXT,                 -- MANUAL|SAP_ECC|S4HANA|ORACLE|DYNAMICS
  payload            TEXT,                 -- JSON
  response           TEXT,                 -- JSON
  status             TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','SUCCESS','FAILED')),
  error_code         TEXT,
  error_message      TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_by         INTEGER REFERENCES users(id),
  retry_count        INTEGER NOT NULL DEFAULT 0,
  last_retry_at      TEXT
);

-- ---------------------------------------------------------------------------
-- Approval matrix: value thresholds that require a higher approval authority.
-- A request whose approved value reaches min_amount needs an approver holding
-- required_permission (admins are always exempt). Rows are additive; the
-- highest matching threshold wins.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_thresholds (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  label               TEXT NOT NULL,
  min_amount          REAL NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'USD',
  required_permission TEXT NOT NULL,   -- permission key the approver must hold
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Request attachments (metadata; bytes live on disk under data/attachments).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS request_attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id     INTEGER NOT NULL REFERENCES material_request_headers(id) ON DELETE CASCADE,
  request_number TEXT NOT NULL,
  file_name      TEXT NOT NULL,
  content_type   TEXT,
  byte_size      INTEGER NOT NULL DEFAULT 0,
  storage_path   TEXT NOT NULL,
  uploaded_by    INTEGER REFERENCES users(id),
  uploaded_by_name TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Cycle counts: physical count of a batch's on-hand vs system quantity, with a
-- posted variance that adjusts batch remaining_quantity and the ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_counts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  count_number     TEXT NOT NULL UNIQUE,
  batch_id         INTEGER NOT NULL REFERENCES batches(id),
  material_id      INTEGER NOT NULL REFERENCES materials(id),
  material_code    TEXT,
  warehouse_code   TEXT,
  bin_location     TEXT,
  system_quantity  REAL NOT NULL DEFAULT 0,
  counted_quantity REAL,
  variance         REAL,
  status           TEXT NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN','COUNTED','POSTED','CANCELLED')),
  counted_by       INTEGER REFERENCES users(id),
  counted_by_name  TEXT,
  posted_by        INTEGER REFERENCES users(id),
  reason           TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cycle_counts_batch  ON cycle_counts(batch_id);
CREATE INDEX IF NOT EXISTS idx_cycle_counts_status ON cycle_counts(status);
CREATE INDEX IF NOT EXISTS idx_attach_request      ON request_attachments(request_id);

-- ---------------------------------------------------------------------------
-- Scheduler lock. A single-row-per-job table used to make the background
-- sweeps (reminders, reservation timeout) safe to run when more than one
-- process is live (PM2 cluster, rolling deploy). A tick only fires if the
-- caller can atomically claim the lock past its lease; others skip that tick.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduler_locks (
  job_name     TEXT PRIMARY KEY,
  locked_until INTEGER NOT NULL DEFAULT 0,  -- epoch ms the current lease expires
  holder       TEXT,                        -- id of the process holding it
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Reference data for dropdowns (departments, plants, cost centers). Admin can
-- extend rows without code changes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reference_data (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  category  TEXT NOT NULL,           -- DEPARTMENT | PLANT | COST_CENTER
  code      TEXT NOT NULL,
  label     TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (category, code)
);

-- ---------------------------------------------------------------------------
-- Registered mobile device tokens for real push notifications (Firebase
-- Cloud Messaging). A user can be signed in on more than one device; each
-- token maps to exactly one user (re-registering moves it, e.g. after a
-- sign-out/sign-in with a different account on the same phone).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token      TEXT NOT NULL UNIQUE,
  platform   TEXT NOT NULL DEFAULT 'android',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

-- ---------------------------------------------------------------------------
-- Stock reallocations — every warehouse/bin/project move of batch stock, with
-- full movement history. Partial moves clone the batch into a new row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_reallocations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  realloc_number TEXT NOT NULL UNIQUE,
  batch_id       INTEGER NOT NULL REFERENCES batches(id),
  new_batch_id   INTEGER REFERENCES batches(id),   -- set on partial (split) moves
  material_id    INTEGER NOT NULL REFERENCES materials(id),
  material_code  TEXT,
  batch_number   TEXT,
  quantity       REAL NOT NULL,
  from_warehouse TEXT, from_bin TEXT, from_project TEXT,
  to_warehouse   TEXT, to_bin TEXT, to_project TEXT,
  reason         TEXT,
  moved_by       INTEGER REFERENCES users(id),
  moved_by_name  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_realloc_batch ON stock_reallocations(batch_id);

-- ---------------------------------------------------------------------------
-- Physical inventory — annual / periodic counting sessions over a warehouse.
-- A session snapshots every batch, supports blind counting, recounts and
-- variance approval, and posts adjustments to batches + the movement ledger.
-- While a freeze-enabled session is open the warehouse blocks receipts,
-- allocations and reallocations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_number  TEXT NOT NULL UNIQUE,
  session_type    TEXT NOT NULL CHECK (session_type IN ('ANNUAL','PERIODIC','CYCLE')),
  warehouse_code  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'COUNTING'
                  CHECK (status IN ('COUNTING','REVIEW','POSTED','CANCELLED')),
  blind           INTEGER NOT NULL DEFAULT 1,   -- hide system qty from counters
  freeze_stock    INTEGER NOT NULL DEFAULT 1,   -- block movements while open
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_by_name TEXT,
  posted_by       INTEGER REFERENCES users(id),
  posted_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inventory_count_lines (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id           INTEGER NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  batch_id             INTEGER NOT NULL REFERENCES batches(id),
  batch_number         TEXT,
  material_id          INTEGER,
  material_code        TEXT,
  material_description TEXT,
  warehouse_code       TEXT,
  bin_location         TEXT,
  system_quantity      REAL NOT NULL DEFAULT 0,   -- snapshot at session creation
  counted_quantity     REAL,
  recount_quantity     REAL,
  final_quantity       REAL,
  variance             REAL,
  status               TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','COUNTED','RECOUNT','APPROVED','POSTED')),
  counted_by           INTEGER,
  counted_by_name      TEXT,
  approved_by          INTEGER,
  approved_by_name     TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invlines_session ON inventory_count_lines(session_id);
CREATE INDEX IF NOT EXISTS idx_invsess_wh       ON inventory_sessions(warehouse_code, status);

-- ---------------------------------------------------------------------------
-- Outbound shipping — delivery orders created from GI-posted requests, packed,
-- loaded, dispatched and delivered (with proof of delivery). Each shipment
-- carries its own scannable QR label.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipments (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_number       TEXT NOT NULL UNIQUE,
  request_id            INTEGER REFERENCES material_request_headers(id),
  request_number        TEXT,
  delivery_order_number TEXT,
  ship_to               TEXT,
  carrier               TEXT,
  vehicle               TEXT,
  driver                TEXT,
  status                TEXT NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','PACKED','LOADED','DISPATCHED','DELIVERED','CANCELLED')),
  qr_code_value         TEXT,
  packages              INTEGER NOT NULL DEFAULT 1,
  weight_kg             REAL,
  notes                 TEXT,
  packed_at             TEXT,
  loaded_at             TEXT,
  dispatched_at         TEXT,
  delivered_at          TEXT,
  delivered_to          TEXT,
  pod_note              TEXT,
  created_by            INTEGER REFERENCES users(id),
  created_by_name       TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shipments_status  ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_request ON shipments(request_id);

-- ===========================================================================
-- Indexes
-- ===========================================================================
CREATE INDEX IF NOT EXISTS idx_mrh_status       ON material_request_headers(request_status);
CREATE INDEX IF NOT EXISTS idx_mrh_requester    ON material_request_headers(requester_id);
CREATE INDEX IF NOT EXISTS idx_mrh_warehouse    ON material_request_headers(issue_warehouse_code);
CREATE INDEX IF NOT EXISTS idx_mrl_request      ON material_request_lines(request_id);
CREATE INDEX IF NOT EXISTS idx_mrl_material     ON material_request_lines(material_id);
CREATE INDEX IF NOT EXISTS idx_mrl_status       ON material_request_lines(line_status);
CREATE INDEX IF NOT EXISTS idx_batches_material ON batches(material_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry   ON batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_batches_fifo     ON batches(fifo_date);
CREATE INDEX IF NOT EXISTS idx_bins_warehouse   ON bin_locations(warehouse_code);
CREATE INDEX IF NOT EXISTS idx_qr_material      ON qr_codes(material_id);
CREATE INDEX IF NOT EXISTS idx_qr_batch         ON qr_codes(batch_id);
CREATE INDEX IF NOT EXISTS idx_alloc_line       ON picking_allocations(line_id);
CREATE INDEX IF NOT EXISTS idx_tasks_picker     ON picking_tasks(assigned_picker_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status     ON picking_tasks(task_status);
CREATE INDEX IF NOT EXISTS idx_audit_request    ON audit_trail(request_number);
CREATE INDEX IF NOT EXISTS idx_audit_entity     ON audit_trail(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notif_recipient  ON notification_log(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_erp_request      ON erp_integration_log(request_number);

-- ===========================================================================
-- Append-only enforcement for the audit trail.
-- The audit log is legally the record of who changed what; nothing in the app
-- ever updates or deletes a row. These triggers make that a database-level
-- guarantee, so even a stray query (or a compromised route) cannot rewrite or
-- erase history — the transaction aborts.
-- ===========================================================================
CREATE TRIGGER IF NOT EXISTS audit_trail_block_update
BEFORE UPDATE ON audit_trail
BEGIN
  SELECT RAISE(ABORT, 'audit_trail is append-only: rows cannot be updated');
END;

CREATE TRIGGER IF NOT EXISTS audit_trail_block_delete
BEFORE DELETE ON audit_trail
BEGIN
  SELECT RAISE(ABORT, 'audit_trail is append-only: rows cannot be deleted');
END;
`;

// Columns to add to the existing materials table (shelf-life / batch control).
const MATERIAL_COLUMNS = [
  ['is_batch_managed', 'INTEGER NOT NULL DEFAULT 0'],
  ['is_expiry_managed', 'INTEGER NOT NULL DEFAULT 0'],
  ['is_serial_managed', 'INTEGER NOT NULL DEFAULT 0'],
  ['shelf_life_managed', 'INTEGER NOT NULL DEFAULT 0'],
  ['manufacturing_date_required', 'INTEGER NOT NULL DEFAULT 0'],
  ['expiry_date_required', 'INTEGER NOT NULL DEFAULT 0'],
  ['shelf_life_period', 'INTEGER'],
  ['shelf_life_unit', "TEXT DEFAULT 'MONTHS'"],
  ['expiry_calculation_rule', "TEXT DEFAULT 'FROM_MANUFACTURING'"], // FROM_MANUFACTURING|FROM_RECEIVING
  ['alert_before_expiry_days', 'INTEGER DEFAULT 30'],
  ['block_after_expiry', 'INTEGER NOT NULL DEFAULT 1'],
  ['fefo_required', 'INTEGER NOT NULL DEFAULT 0'],
  // Non-stock items (services, consumables bought ad hoc) are requestable but
  // must never receive an ERP stock reservation or warehouse allocation.
  ['is_stock_item', 'INTEGER NOT NULL DEFAULT 1'],
];

function addMissingColumns() {
  const existing = new Set(db.prepare('PRAGMA table_info(materials)').all().map((c) => c.name));
  MATERIAL_COLUMNS.forEach(([name, def]) => {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE materials ADD COLUMN ${name} ${def}`);
    }
  });
  // Batch-level project assignment (set/changed by reallocation).
  const batchCols = new Set(db.prepare('PRAGMA table_info(batches)').all().map((c) => c.name));
  if (!batchCols.has('project')) {
    db.exec('ALTER TABLE batches ADD COLUMN project TEXT');
  }
  // Posted final quantity on inventory count lines (installs created before it).
  const invCols = new Set(db.prepare('PRAGMA table_info(inventory_count_lines)').all().map((c) => c.name));
  if (!invCols.has('final_quantity')) {
    db.exec('ALTER TABLE inventory_count_lines ADD COLUMN final_quantity REAL');
  }
  // Force-a-password-change flag on users (idempotent).
  const userCols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  if (!userCols.has('must_change_password')) {
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  }
}

function migrate2() {
  db.exec(schema);
  addMissingColumns();
  console.log('Migration 2 (MRP/WMS execution) applied.');
}

if (require.main === module) {
  migrate2();
}

module.exports = { migrate2 };
