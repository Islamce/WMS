/**
 * Seed 2 — roles, permissions, movement types, warehouse master, bins,
 * batches (with expiry), shelf-life material config, and demo users for each
 * workflow role. Idempotent.
 */
const bcrypt = require('bcryptjs');
const db = require('./connection');
const { calcExpiry } = require('./../services/expiry');
const qr = require('./../services/qr');

// New screen permission keys for the MRP/WMS workflow.
const PERMISSIONS = [
  { key: 'material_requests', label: 'Material Requests' },
  { key: 'create_request', label: 'Create Material Request' },
  { key: 'approvals', label: 'Manager Approvals' },
  { key: 'erp_operator', label: 'ERP Operator Queue' },
  { key: 'warehouse_dashboard', label: 'Warehouse Dashboard' },
  { key: 'bin_batch_assignment', label: 'Bin & Batch Assignment' },
  { key: 'picker_assignment', label: 'Picker Assignment' },
  { key: 'picking', label: 'Picking Tasks' },
  { key: 'gi_posting', label: 'Goods Issue Posting' },
  { key: 'goods_receipt', label: 'Goods Receipt & QR' },
  { key: 'qr_printing', label: 'QR Label Printing' },
  { key: 'expiry_alerts', label: 'Expiry Alerts' },
  { key: 'batch_tracking', label: 'Batch Tracking' },
  { key: 'warehouses_master', label: 'Warehouse Master' },
  { key: 'bins_master', label: 'Bin Location Master' },
  { key: 'movement_types_master', label: 'Movement Type Config' },
  { key: 'audit_trail', label: 'Audit Trail' },
  { key: 'notifications', label: 'Notifications Center' },
  { key: 'kpi_dashboard', label: 'KPI Dashboard' },
  { key: 'quality', label: 'Quality Management' },
  { key: 'approvals_high_value', label: 'High-Value Approvals' },
  { key: 'cycle_count', label: 'Cycle Counting' },
  { key: 'reallocation', label: 'Stock Reallocation' },
  { key: 'inventory_count', label: 'Physical Inventory (Annual/Periodic)' },
  { key: 'shipping', label: 'Shipping & Outbound' },
  { key: 'analytical_attestation_submit', label: 'Submit Analytical Scope Attestation' },
  { key: 'analytical_attestation_approve', label: 'Approve Analytical Scope Attestation' },
];

// Roles for the end-to-end process and the screens each one gets by default.
const ROLES = {
  requester: ['dashboard', 'material_requests', 'create_request', 'notifications'],
  manager: ['dashboard', 'material_requests', 'approvals', 'notifications'],
  erp_operator: ['dashboard', 'material_requests', 'erp_operator', 'movement_types_master', 'notifications'],
  warehouse_supervisor: ['dashboard', 'warehouse_dashboard', 'bin_batch_assignment', 'picker_assignment',
    'goods_receipt', 'qr_printing', 'expiry_alerts', 'batch_tracking', 'bins_master', 'cycle_count',
    'reallocation', 'inventory_count', 'shipping', 'notifications'],
  warehouse_operator: ['dashboard', 'warehouse_dashboard', 'gi_posting', 'batch_tracking', 'cycle_count',
    'inventory_count', 'shipping', 'notifications'],
  picker: ['dashboard', 'picking', 'notifications'],
  quality: ['dashboard', 'quality', 'batch_tracking', 'expiry_alerts', 'notifications'],
  integration_admin: ['dashboard', 'material_requests', 'audit_trail', 'kpi_dashboard', 'notifications'],
  auditor: ['dashboard', 'material_requests', 'audit_trail', 'kpi_dashboard', 'notifications'],
};

const MOVEMENT_TYPES = [
  { code: '201', description: 'Goods Issue to Cost Center', direction: 'ISSUE', cost_object: 'COST_CENTER', requires_cost_center: 1 },
  { code: '221', description: 'Goods Issue to Project / WBS', direction: 'ISSUE', cost_object: 'WBS', requires_wbs: 1 },
  { code: '261', description: 'Goods Issue to Production Order', direction: 'ISSUE', cost_object: 'ORDER', requires_order: 1 },
  { code: '311', description: 'Transfer Posting between Storage Locations', direction: 'TRANSFER', cost_object: 'STORAGE' },
  { code: '101', description: 'Goods Receipt against Purchase Order', direction: 'RECEIPT', cost_object: 'PO' },
  { code: '102', description: 'Reversal of Goods Receipt', direction: 'REVERSAL', cost_object: 'PO', is_reversal: 1 },
  { code: '202', description: 'Reversal of GI to Cost Center', direction: 'REVERSAL', cost_object: 'COST_CENTER', is_reversal: 1 },
  { code: '222', description: 'Reversal of GI to Project', direction: 'REVERSAL', cost_object: 'WBS', is_reversal: 1 },
  { code: '262', description: 'Reversal of GI to Production Order', direction: 'REVERSAL', cost_object: 'ORDER', is_reversal: 1 },
];

const WAREHOUSES = [
  { warehouse_code: 'WH01', warehouse_name: 'Central Warehouse', plant: 'P100', storage_location: '0001', warehouse_type: 'STANDARD', company: 'ACME', business_unit: 'OPS' },
  { warehouse_code: 'WH02', warehouse_name: 'Cold Store', plant: 'P100', storage_location: '0002', warehouse_type: 'COLD', company: 'ACME', business_unit: 'OPS' },
];

// Structured bins for WH01 (compact + expanded formats derived).
const BINS = [
  { warehouse_code: 'WH01', zone: 'ZA', rack: 'R01', line_or_aisle: '01', level: '01', column_number: '05' },
  { warehouse_code: 'WH01', zone: 'ZA', rack: 'R02', line_or_aisle: '01', level: '01', column_number: '09' },
  { warehouse_code: 'WH01', zone: 'ZA', rack: 'R03', line_or_aisle: '02', level: '02', column_number: '23' },
  { warehouse_code: 'WH02', zone: 'ZC', rack: 'R01', line_or_aisle: '01', level: '01', column_number: '01' },
];

function compactBin(b) {
  // R-03-02-23  => Rack-Line-Level-Column
  const rackLetter = (b.rack || 'R').replace(/[^A-Za-z]/g, '') || 'R';
  return `${rackLetter}-${b.line_or_aisle}-${b.level}-${b.column_number}`;
}
function expandedBin(b) {
  // WH01-ZA-R03-L02-C23
  return `${b.warehouse_code}-${b.zone}-${b.rack}-L${b.level}-C${b.column_number}`;
}

// Reference dropdown values (departments, plants, cost centers).
const REFERENCE_DATA = [
  ['DEPARTMENT', 'PROD', 'Production'],
  ['DEPARTMENT', 'MAINT', 'Maintenance'],
  ['DEPARTMENT', 'QA', 'Quality Assurance'],
  ['DEPARTMENT', 'LOG', 'Logistics'],
  ['DEPARTMENT', 'ENG', 'Engineering'],
  ['DEPARTMENT', 'ADMIN', 'Administration'],
  ['PLANT', 'P100', 'Plant 100 — Main'],
  ['PLANT', 'P200', 'Plant 200 — North'],
  ['COST_CENTER', 'CC-1000', 'CC-1000 Production'],
  ['COST_CENTER', 'CC-2000', 'CC-2000 Maintenance'],
  ['COST_CENTER', 'CC-3000', 'CC-3000 Quality'],
  ['COST_CENTER', 'CC-4000', 'CC-4000 Logistics'],
];

function seed2() {
  const run = db.transaction(() => {
    const insRef = db.prepare('INSERT OR IGNORE INTO reference_data (category, code, label) VALUES (?, ?, ?)');
    REFERENCE_DATA.forEach((r) => insRef.run(r[0], r[1], r[2]));
    // --- permissions ---
    const insPerm = db.prepare('INSERT OR IGNORE INTO permissions (key, label) VALUES (?, ?)');
    PERMISSIONS.forEach((p) => insPerm.run(p.key, p.label));

    // Admin gets every permission (including the new ones).
    const allPerms = db.prepare('SELECT id, key FROM permissions').all();
    const grantAdmin = db.prepare(`
      INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      VALUES ((SELECT id FROM roles WHERE name='admin'), ?)`);
    allPerms.forEach((p) => grantAdmin.run(p.id));

    // --- roles + their default permissions ---
    const insRole = db.prepare('INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)');
    const grantRole = db.prepare(`
      INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      VALUES ((SELECT id FROM roles WHERE name=?), (SELECT id FROM permissions WHERE key=?))`);
    Object.entries(ROLES).forEach(([role, perms]) => {
      insRole.run(role, `${role} role`);
      perms.forEach((key) => grantRole.run(role, key));
    });

    // --- approval matrix: high-value requests need a senior approver ---
    if (db.prepare('SELECT COUNT(*) AS n FROM approval_thresholds').get().n === 0) {
      db.prepare(`
        INSERT INTO approval_thresholds (label, min_amount, currency, required_permission)
        VALUES ('Senior approval (value ≥ 1,000)', 1000, 'USD', 'approvals_high_value')
      `).run();
    }

    // --- movement types ---
    const insMt = db.prepare(`
      INSERT OR IGNORE INTO movement_types
        (code, description, direction, cost_object, is_reversal, requires_cost_center, requires_wbs, requires_order)
      VALUES (@code, @description, @direction, @cost_object, @is_reversal, @requires_cost_center, @requires_wbs, @requires_order)`);
    MOVEMENT_TYPES.forEach((m) => insMt.run({
      is_reversal: 0, requires_cost_center: 0, requires_wbs: 0, requires_order: 0, cost_object: null, ...m,
    }));

    // --- warehouses ---
    const insWh = db.prepare(`
      INSERT OR IGNORE INTO warehouses
        (warehouse_code, warehouse_name, company, business_unit, plant, storage_location, warehouse_type)
      VALUES (@warehouse_code, @warehouse_name, @company, @business_unit, @plant, @storage_location, @warehouse_type)`);
    WAREHOUSES.forEach((w) => insWh.run(w));

    // --- bins ---
    const insBin = db.prepare(`
      INSERT OR IGNORE INTO bin_locations
        (warehouse_code, zone, rack, line_or_aisle, level, column_number, bin_code, full_bin_location, capacity)
      VALUES (@warehouse_code, @zone, @rack, @line_or_aisle, @level, @column_number, @bin_code, @full_bin_location, 1000)`);
    BINS.forEach((b) => insBin.run({ ...b, bin_code: compactBin(b), full_bin_location: expandedBin(b) }));

    // --- shelf-life material config (mark a couple of materials expiry-managed & batch-managed) ---
    // MAT-0003 Hydraulic Oil -> expiry managed; all materials -> batch managed for the demo.
    db.prepare("UPDATE materials SET is_batch_managed=1").run();
    db.prepare(`
      UPDATE materials SET is_expiry_managed=1, shelf_life_managed=1, manufacturing_date_required=1,
        expiry_date_required=1, shelf_life_period=12, shelf_life_unit='MONTHS',
        expiry_calculation_rule='FROM_MANUFACTURING', alert_before_expiry_days=90,
        block_after_expiry=1, fefo_required=1
      WHERE item_code IN ('MAT-0003','MAT-0007')
    `).run();

    // --- demo users, one per role (password: Passw0rd!) ---
    const hash = bcrypt.hashSync('Passw0rd!', 10);
    const insUser = db.prepare(`
      INSERT OR IGNORE INTO users (name, email, password_hash, role_id, status)
      VALUES (?, ?, ?, (SELECT id FROM roles WHERE name=?), 'active')`);
    const demoUsers = [
      ['Rania Requester', 'requester@example.com', 'requester'],
      ['Mark Manager', 'manager@example.com', 'manager'],
      ['Omar ERPOperator', 'erp@example.com', 'erp_operator'],
      ['Sara Supervisor', 'supervisor@example.com', 'warehouse_supervisor'],
      ['Wael WHOperator', 'whoperator@example.com', 'warehouse_operator'],
      ['Petra Picker', 'picker@example.com', 'picker'],
      ['Qamar Quality', 'quality@example.com', 'quality'],
      ['Adam Auditor', 'auditor@example.com', 'auditor'],
    ];
    demoUsers.forEach(([name, email, role]) => insUser.run(name, email, hash, role));

    // Assign WH01 supervisor.
    const sup = db.prepare("SELECT id, name FROM users WHERE email='supervisor@example.com'").get();
    if (sup) db.prepare('UPDATE warehouses SET supervisor_id=?, supervisor_name=? WHERE warehouse_code=?')
      .run(sup.id, sup.name, 'WH01');

    // --- demo batches with QR codes (so FIFO/FEFO and picking are testable) ---
    seedBatches();
  });
  run();
  console.log('Seed 2 (roles, master data, batches) applied.');
}

/** Create demo batches + QR codes if none exist yet. */
function seedBatches() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM batches').get().n;
  if (existing > 0) return;

  const mat = (code) => db.prepare('SELECT * FROM materials WHERE item_code=?').get(code);
  const bolt = mat('MAT-0001');   // batch managed, not expiry
  const oil = mat('MAT-0003');    // expiry managed
  if (!bolt || !oil) return;

  const insBatch = db.prepare(`
    INSERT INTO batches
      (batch_number, material_id, material_code, material_description, supplier_code, supplier_name,
       po_number, gr_number, receiving_date, manufacturing_date, expiry_date, shelf_life_period, shelf_life_unit,
       received_quantity, remaining_quantity, warehouse_code, bin_location, quality_status, fifo_date, fefo_date)
    VALUES (@batch_number, @material_id, @material_code, @material_description, @supplier_code, @supplier_name,
       @po_number, @gr_number, @receiving_date, @manufacturing_date, @expiry_date, @shelf_life_period, @shelf_life_unit,
       @received_quantity, @remaining_quantity, @warehouse_code, @bin_location, @quality_status, @fifo_date, @fefo_date)`);

  const mkBatch = (b) => {
    const id = insBatch.run(b).lastInsertRowid;
    const full = db.prepare('SELECT * FROM batches WHERE id=?').get(id);
    const qrId = qr.generateForBatch(full, { uom: b.uom });
    db.prepare('UPDATE batches SET qr_code_id=? WHERE id=?').run(qrId, id);
    return id;
  };

  // FIFO demo (non-expiry material) across 3 bins/batches — mirrors the spec example.
  mkBatch({ batch_number: 'B-BOLT-001', material_id: bolt.id, material_code: bolt.item_code, material_description: bolt.description,
    supplier_code: 'SUP01', supplier_name: 'Fasteners Co', po_number: 'PO-1001', gr_number: 'GR-1001',
    receiving_date: '2026-06-01', manufacturing_date: null, expiry_date: null, shelf_life_period: null, shelf_life_unit: null,
    received_quantity: 40, remaining_quantity: 40, warehouse_code: 'WH01', bin_location: 'R-01-01-05',
    quality_status: 'RELEASED', fifo_date: '2026-06-01', fefo_date: null, uom: bolt.unit });
  mkBatch({ batch_number: 'B-BOLT-002', material_id: bolt.id, material_code: bolt.item_code, material_description: bolt.description,
    supplier_code: 'SUP01', supplier_name: 'Fasteners Co', po_number: 'PO-1002', gr_number: 'GR-1002',
    receiving_date: '2026-06-15', manufacturing_date: null, expiry_date: null, shelf_life_period: null, shelf_life_unit: null,
    received_quantity: 70, remaining_quantity: 70, warehouse_code: 'WH01', bin_location: 'R-02-01-09',
    quality_status: 'RELEASED', fifo_date: '2026-06-15', fefo_date: null, uom: bolt.unit });
  mkBatch({ batch_number: 'B-BOLT-003', material_id: bolt.id, material_code: bolt.item_code, material_description: bolt.description,
    supplier_code: 'SUP02', supplier_name: 'Bolt Supply', po_number: 'PO-1003', gr_number: 'GR-1003',
    receiving_date: '2026-07-01', manufacturing_date: null, expiry_date: null, shelf_life_period: null, shelf_life_unit: null,
    received_quantity: 100, remaining_quantity: 100, warehouse_code: 'WH01', bin_location: 'R-03-02-23',
    quality_status: 'RELEASED', fifo_date: '2026-07-01', fefo_date: null, uom: bolt.unit });

  // FEFO demo (expiry material): two batches, nearest expiry should be picked first.
  const oilMfg1 = '2026-01-01', oilExp1 = calcExpiry(oilMfg1, 12, 'MONTHS'); // 2027-01-01
  const oilMfg2 = '2026-06-01', oilExp2 = calcExpiry(oilMfg2, 12, 'MONTHS'); // 2027-06-01
  mkBatch({ batch_number: 'B-OIL-EARLY', material_id: oil.id, material_code: oil.item_code, material_description: oil.description,
    supplier_code: 'SUP03', supplier_name: 'Lubricants Ltd', po_number: 'PO-2001', gr_number: 'GR-2001',
    receiving_date: '2026-01-05', manufacturing_date: oilMfg1, expiry_date: oilExp1, shelf_life_period: 12, shelf_life_unit: 'MONTHS',
    received_quantity: 50, remaining_quantity: 50, warehouse_code: 'WH01', bin_location: 'R-01-01-05',
    quality_status: 'RELEASED', fifo_date: '2026-01-05', fefo_date: oilExp1, uom: oil.unit });
  mkBatch({ batch_number: 'B-OIL-LATE', material_id: oil.id, material_code: oil.item_code, material_description: oil.description,
    supplier_code: 'SUP03', supplier_name: 'Lubricants Ltd', po_number: 'PO-2002', gr_number: 'GR-2002',
    receiving_date: '2026-06-05', manufacturing_date: oilMfg2, expiry_date: oilExp2, shelf_life_period: 12, shelf_life_unit: 'MONTHS',
    received_quantity: 80, remaining_quantity: 80, warehouse_code: 'WH01', bin_location: 'R-02-01-09',
    quality_status: 'RELEASED', fifo_date: '2026-06-05', fefo_date: oilExp2, uom: oil.unit });
}

if (require.main === module) {
  seed2();
}

module.exports = { seed2, compactBin, expandedBin };
