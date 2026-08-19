/**
 * Seed 3 — AI analytics sample dataset + permission updates.
 *
 * - Adds the ai_analytics permission and grants it to the relevant roles.
 * - Grants goods_receipt to the ERP operator (GR-number step) per the process.
 * - Adds 12 sample materials with distinct movement profiles (fast / normal /
 *   slow / dead), released batches with on-hand stock, and ~120 days of
 *   deterministic IN/OUT ledger history so the AI engine has data to analyze.
 *
 * Idempotent: guarded by an existing-sample check.
 */
const db = require('./connection');
const qr = require('./../services/qr');
const { locationForWarehouse } = require('./../services/ledger');

// Deterministic PRNG so seeded analytics results are reproducible.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// profile: outsPerMonth (events), qty range, initial stock multiplier
const SAMPLE_MATERIALS = [
  ['MAT-0101', 'Filter Cartridge 5µm', 'EA', 12.5, 'FILTERS', 'fast'],
  ['MAT-0102', 'Conveyor Roller 60mm', 'EA', 28.0, 'CONVEYOR', 'fast'],
  ['MAT-0103', 'Grease EP2', 'KG', 6.4, 'LUBRICANTS', 'fast'],
  ['MAT-0104', 'Sensor Prox M12', 'EA', 42.0, 'ELECTRICAL', 'normal'],
  ['MAT-0105', 'Gasket DN50', 'EA', 3.1, 'SEALS', 'normal'],
  ['MAT-0106', 'Air Hose 10mm', 'M', 2.2, 'PNEUMATIC', 'normal'],
  ['MAT-0107', 'Relay 24VDC', 'EA', 8.9, 'ELECTRICAL', 'slow'],
  ['MAT-0108', 'Coupling Insert L100', 'EA', 15.7, 'COUPLINGS', 'slow'],
  ['MAT-0109', 'Paint Epoxy Grey', 'L', 11.3, 'CHEMICALS', 'slow'],
  ['MAT-0110', 'Obsolete PLC Card X20', 'EA', 480.0, 'ELECTRICAL', 'dead'],
  ['MAT-0111', 'Legacy Motor Brush Set', 'EA', 34.5, 'SPARES', 'dead'],
  ['MAT-0112', 'Special Flange DN200', 'EA', 96.0, 'PIPING', 'dead'],
];

const PROFILES = {
  fast: { eventsIn90: 16, qtyMin: 5, qtyMax: 25, stockDays: 20 },
  normal: { eventsIn90: 6, qtyMin: 3, qtyMax: 12, stockDays: 45 },
  slow: { eventsIn90: 2, qtyMin: 1, qtyMax: 4, stockDays: 120 },
  dead: { eventsIn90: 0, qtyMin: 0, qtyMax: 0, stockDays: 0 },
};

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10) + ' 10:00:00';
}

function seed3() {
  // --- permissions -----------------------------------------------------------
  db.prepare("INSERT OR IGNORE INTO permissions (key, label) VALUES ('ai_analytics', 'AI Stock Analytics')").run();
  // WMS-R15: analytics read access (ai_analytics) let holders finalize movement-history
  // imports, which permanently commits data used for DEAD-stock and analytics decisions.
  // movement_import_finalize is a distinct, narrower permission for that specific action;
  // preview/chunk-insert remain covered by the existing ai_analytics/goods_receipt/stock_out roles.
  db.prepare("INSERT OR IGNORE INTO permissions (key, label) VALUES ('movement_import_finalize', 'Finalize Movement History Import')").run();
  const grant = db.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    VALUES ((SELECT id FROM roles WHERE name=?), (SELECT id FROM permissions WHERE key=?))`);
  // AI analytics for management/analysis roles (admin inherits everything).
  ['admin', 'manager', 'warehouse_supervisor', 'warehouse_operator', 'auditor', 'integration_admin']
    .forEach((r) => grant.run(r, 'ai_analytics'));
  // Finalize is restricted to roles that own data-quality accountability for the
  // committed history, not every role that can merely read analytics.
  ['admin', 'warehouse_supervisor', 'integration_admin'].forEach((r) => grant.run(r, 'movement_import_finalize'));
  // The store ERP operator performs the GR-number step on the receiving screen.
  grant.run('erp_operator', 'goods_receipt');
  // Requester defaults: workflow screens instead of the retired stock in/out.
  ['create_request', 'material_requests', 'notifications'].forEach((k) => grant.run('user', k));

  // --- sample dataset (once) --------------------------------------------------
  const exists = db.prepare("SELECT 1 FROM materials WHERE item_code='MAT-0101'").get();
  if (exists) { console.log('Seed 3: sample dataset already present.'); return; }

  const rand = mulberry32(20260710);
  const admin = db.prepare("SELECT id FROM users WHERE email='admin@example.com'").get();
  const userId = admin ? admin.id : 1;
  const WH = 'WH01';
  locationForWarehouse(WH); // ensure the ledger location exists

  const insMat = db.prepare(`
    INSERT INTO materials (plant, item_code, description, unit, price, currency, material_type, material_group, is_batch_managed)
    VALUES ('P100', ?, ?, ?, ?, 'USD', 'SPARE', ?, 1)`);
  const insBatch = db.prepare(`
    INSERT INTO batches
      (batch_number, material_id, material_code, material_description, supplier_code, supplier_name,
       po_number, gr_number, receiving_date, received_quantity, remaining_quantity,
       warehouse_code, bin_location, quality_status, fifo_date)
    VALUES (?, ?, ?, ?, 'SUP10', 'Sample Supplies Co', ?, ?, ?, ?, ?, ?, 'R-01-01-05', 'RELEASED', ?)`);
  const insTx = db.prepare(`
    INSERT INTO stock_transactions
      (transaction_type, movement_category, movement_classification_status, material_id, location_id, quantity, user_id, notes, transaction_date)
    VALUES (?, ?, 'EXPLICIT', ?, (SELECT id FROM locations WHERE code=?), ?, ?, ?, ?)`);

  const run = db.transaction(() => {
    SAMPLE_MATERIALS.forEach(([code, desc, unit, price, group, profileName], idx) => {
      const p = PROFILES[profileName];
      const matId = insMat.run(code, desc, unit, price, group).lastInsertRowid;

      // Movement history: spread OUT events across the last 90 days.
      let consumed = 0;
      for (let e = 0; e < p.eventsIn90; e++) {
        const day = Math.floor(rand() * 88) + 1;
        const qty = Math.round(p.qtyMin + rand() * (p.qtyMax - p.qtyMin));
        insTx.run('OUT', 'ISSUE', matId, WH, qty, userId, 'Sample GI history', daysAgo(day));
        consumed += qty;
      }
      // Dead stock: one old receipt ~110 days ago, nothing since.
      const receipts = profileName === 'dead' ? [[110, 40 + Math.floor(rand() * 30)]]
        : [[100, consumed], [30, Math.max(20, Math.round(consumed * 0.6))]];
      let received = 0;
      receipts.forEach(([day, qty], rIdx) => {
        if (qty <= 0) return;
        insTx.run('IN', 'RECEIPT', matId, WH, qty, userId, 'Sample GR history', daysAgo(day));
        received += qty;
      });

      // Current on-hand batch = received - consumed (kept realistic per profile).
      // MAT-0103 is left intentionally low so the "below reorder point" insight
      // has a live example in the demo data.
      const onHand = code === 'MAT-0103' ? 8
        : Math.max(profileName === 'dead' ? received : received - consumed,
          profileName === 'fast' ? 15 : 5);
      const batchNo = `B-${code}-SAMPLE`;
      const bId = insBatch.run(batchNo, matId, code, desc, `PO-S${100 + idx}`, `GR-S${100 + idx}`,
        daysAgo(30).slice(0, 10), onHand, onHand, WH, daysAgo(30).slice(0, 10)).lastInsertRowid;
      const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(bId);
      const qrId = qr.generateForBatch(batch, { uom: unit });
      db.prepare('UPDATE batches SET qr_code_id=? WHERE id=?').run(qrId, bId);
    });
  });
  run();
  console.log('Seed 3: AI sample dataset created (12 materials, 120-day movement history).');
}

if (require.main === module) {
  seed3();
}

module.exports = { seed3 };
