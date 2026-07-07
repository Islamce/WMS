/**
 * Seed data: roles, permissions, default admin user, sample materials and locations.
 * Run with: npm run seed
 * Idempotent: uses INSERT OR IGNORE / upserts, safe to re-run.
 */
const bcrypt = require('bcryptjs');
const db = require('./connection');

// Every screen/module in the system has a permission key.
// Add new entries here when you add new screens.
const PERMISSIONS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'materials', label: 'Materials' },
  { key: 'locations', label: 'Locations' },
  { key: 'stock_in', label: 'Stock In' },
  { key: 'stock_out', label: 'Stock Out' },
  { key: 'all_locations', label: 'All Locations' },
  { key: 'empty_locations', label: 'Empty Locations' },
  { key: 'users_management', label: 'Users Management' },
  { key: 'permissions_management', label: 'Permissions Management' },
];

const ROLES = [
  { name: 'admin', description: 'Full access to every screen and admin functions' },
  { name: 'user', description: 'Regular warehouse user' },
];

// Default screens a regular user gets when approved (admin can change later).
const DEFAULT_USER_ROLE_PERMISSIONS = ['dashboard', 'stock_in', 'stock_out', 'all_locations', 'empty_locations'];

const SAMPLE_MATERIALS = [
  { plant: 'P100', item_code: 'MAT-0001', description: 'Steel Bolt M8x40', unit: 'EA', price: 0.35, currency: 'USD', material_type: 'RAW', material_group: 'FASTENERS' },
  { plant: 'P100', item_code: 'MAT-0002', description: 'Steel Nut M8', unit: 'EA', price: 0.15, currency: 'USD', material_type: 'RAW', material_group: 'FASTENERS' },
  { plant: 'P100', item_code: 'MAT-0003', description: 'Hydraulic Oil 46', unit: 'L', price: 4.2, currency: 'USD', material_type: 'CONS', material_group: 'LUBRICANTS' },
  { plant: 'P200', item_code: 'MAT-0004', description: 'Bearing 6204-2RS', unit: 'EA', price: 6.8, currency: 'USD', material_type: 'SPARE', material_group: 'BEARINGS' },
  { plant: 'P200', item_code: 'MAT-0005', description: 'V-Belt A42', unit: 'EA', price: 3.5, currency: 'USD', material_type: 'SPARE', material_group: 'BELTS' },
  { plant: 'P100', item_code: 'MAT-0006', description: 'Copper Wire 2.5mm', unit: 'M', price: 0.9, currency: 'USD', material_type: 'RAW', material_group: 'ELECTRICAL' },
  { plant: 'P200', item_code: 'MAT-0007', description: 'Safety Gloves L', unit: 'PAIR', price: 2.1, currency: 'USD', material_type: 'CONS', material_group: 'PPE' },
  { plant: 'P100', item_code: 'MAT-0008', description: 'Welding Rod 3.2mm', unit: 'KG', price: 5.6, currency: 'USD', material_type: 'CONS', material_group: 'WELDING' },
];

const SAMPLE_LOCATIONS = ['A-01-01', 'A-01-02', 'A-02-01', 'B-01-01', 'B-01-02', 'B-02-01', 'C-01-01', 'C-01-02'];

const DEFAULT_ADMIN = {
  name: 'System Admin',
  email: 'admin@example.com',
  password: 'Admin@123456',
};

function seed() {
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)');
  const insertPermission = db.prepare('INSERT OR IGNORE INTO permissions (key, label) VALUES (?, ?)');
  const insertRolePerm = db.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    VALUES ((SELECT id FROM roles WHERE name = ?), (SELECT id FROM permissions WHERE key = ?))
  `);
  const insertMaterial = db.prepare(`
    INSERT OR IGNORE INTO materials (plant, item_code, description, unit, price, currency, material_type, material_group)
    VALUES (@plant, @item_code, @description, @unit, @price, @currency, @material_type, @material_group)
  `);
  const insertLocation = db.prepare('INSERT OR IGNORE INTO locations (code) VALUES (?)');

  const run = db.transaction(() => {
    ROLES.forEach((r) => insertRole.run(r.name, r.description));
    PERMISSIONS.forEach((p) => insertPermission.run(p.key, p.label));

    // Admin role gets every permission.
    PERMISSIONS.forEach((p) => insertRolePerm.run('admin', p.key));
    DEFAULT_USER_ROLE_PERMISSIONS.forEach((key) => insertRolePerm.run('user', key));

    // Default admin account (active immediately).
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(DEFAULT_ADMIN.email);
    if (!existing) {
      const hash = bcrypt.hashSync(DEFAULT_ADMIN.password, 10);
      db.prepare(`
        INSERT INTO users (name, email, password_hash, role_id, status)
        VALUES (?, ?, ?, (SELECT id FROM roles WHERE name = 'admin'), 'active')
      `).run(DEFAULT_ADMIN.name, DEFAULT_ADMIN.email, hash);
      console.log(`Created default admin: ${DEFAULT_ADMIN.email}`);
    }

    SAMPLE_MATERIALS.forEach((m) => insertMaterial.run(m));
    SAMPLE_LOCATIONS.forEach((code) => insertLocation.run(code));
  });

  run();
  console.log('Seed data applied.');
}

seed();

module.exports = { seed };
