/**
 * Database schema migration.
 * Run with: npm run migrate
 * Idempotent: uses CREATE TABLE IF NOT EXISTS so it is safe to re-run.
 */
const db = require('./connection');

const schema = `
-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Users
-- status: pending (just signed up), active (approved), rejected, disabled
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','active','rejected','disabled')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Permissions (one row per screen/module key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default permissions per role.
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Per-user permissions (admin grants/revokes screen access for each user).
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- Materials
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materials (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  plant          TEXT NOT NULL DEFAULT '',
  item_code      TEXT NOT NULL UNIQUE,
  description    TEXT NOT NULL,
  unit           TEXT NOT NULL DEFAULT 'EA',
  price          REAL NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'USD',
  material_type  TEXT NOT NULL DEFAULT '',
  material_group TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Locations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Current stock balance per material per location.
-- Quantity can never go negative (enforced by CHECK + app logic).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_location_stock (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  quantity    REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (material_id, location_id)
);

-- ---------------------------------------------------------------------------
-- Immutable log of every stock movement (IN / OUT).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transactions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_type   TEXT NOT NULL CHECK (transaction_type IN ('IN','OUT')),
  material_id        INTEGER NOT NULL REFERENCES materials(id),
  location_id        INTEGER NOT NULL REFERENCES locations(id),
  quantity           REAL NOT NULL CHECK (quantity > 0),
  reservation_number TEXT,             -- nullable for IN, required for OUT (app enforced)
  user_id            INTEGER NOT NULL REFERENCES users(id),
  transaction_date   TEXT NOT NULL DEFAULT (datetime('now')),
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_materials_item_code        ON materials(item_code);
CREATE INDEX IF NOT EXISTS idx_locations_code             ON locations(code);
CREATE INDEX IF NOT EXISTS idx_stock_tx_material          ON stock_transactions(material_id);
CREATE INDEX IF NOT EXISTS idx_stock_tx_location          ON stock_transactions(location_id);
CREATE INDEX IF NOT EXISTS idx_stock_tx_date              ON stock_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_mls_material               ON material_location_stock(material_id);
CREATE INDEX IF NOT EXISTS idx_mls_location               ON material_location_stock(location_id);
`;

function migrate() {
  db.exec(schema);
  console.log('Database schema is up to date.');
}

migrate();

module.exports = { migrate };
