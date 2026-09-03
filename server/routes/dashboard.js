/**
 * Admin dashboard KPIs and chart data. Current balances come from `batches`
 * (the workflow stock source — receiving, allocation, picking and GI all
 * operate on it); movement history comes from `stock_transactions`, which the
 * ledger service writes on every goods receipt (IN) and goods issue (OUT).
 */
const express = require('express');
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, requirePermission('dashboard'));

/** GET /api/dashboard/bins?status=all|occupied|empty */
router.get('/bins', (req, res) => {
  const status = String(req.query.status || 'all').toLowerCase();
  if (!['all', 'occupied', 'empty'].includes(status)) {
    return res.status(400).json({ error: "status must be 'all', 'occupied', or 'empty'." });
  }

  const having = status === 'occupied'
    ? 'HAVING COALESCE(SUM(CASE WHEN b.remaining_quantity > 0 THEN b.remaining_quantity ELSE 0 END), 0) > 0'
    : status === 'empty'
      ? 'HAVING COALESCE(SUM(CASE WHEN b.remaining_quantity > 0 THEN b.remaining_quantity ELSE 0 END), 0) = 0'
      : '';

  const bins = db.prepare(`
    SELECT bl.id, bl.warehouse_code, bl.zone, bl.rack, bl.line_or_aisle,
           bl.level, bl.column_number, bl.bin_code, bl.full_bin_location,
           bl.capacity, bl.current_occupancy, bl.hazard_flag,
           bl.temperature_controlled_flag, bl.quality_restricted_flag,
           COUNT(DISTINCT CASE WHEN b.remaining_quantity > 0 THEN b.id END) AS batch_count,
           COUNT(DISTINCT CASE WHEN b.remaining_quantity > 0 THEN b.material_id END) AS material_count,
           COALESCE(SUM(CASE WHEN b.remaining_quantity > 0 THEN b.remaining_quantity ELSE 0 END), 0) AS available_quantity,
           CASE WHEN COALESCE(SUM(CASE WHEN b.remaining_quantity > 0 THEN b.remaining_quantity ELSE 0 END), 0) > 0
                THEN 'occupied' ELSE 'empty' END AS occupancy_status
    FROM bin_locations bl
    LEFT JOIN batches b
      ON b.warehouse_code = bl.warehouse_code
     AND b.bin_location IN (bl.bin_code, bl.full_bin_location)
    WHERE bl.is_active = 1
    GROUP BY bl.id, bl.warehouse_code, bl.zone, bl.rack, bl.line_or_aisle,
             bl.level, bl.column_number, bl.bin_code, bl.full_bin_location,
             bl.capacity, bl.current_occupancy, bl.hazard_flag,
             bl.temperature_controlled_flag, bl.quality_restricted_flag
    ${having}
    ORDER BY bl.warehouse_code, COALESCE(NULLIF(bl.full_bin_location, ''), bl.bin_code)
  `).all();

  // Attach the actual materials/quantities occupying each bin (not just counts) —
  // the mobile Bin Locations screen needs this to answer "what's in this bin".
  const contents = db.prepare(`
    SELECT b.warehouse_code, b.bin_location, b.material_id, b.material_code, b.material_description,
           COALESCE(m.unit, '') AS unit, SUM(b.remaining_quantity) AS quantity
    FROM batches b LEFT JOIN materials m ON m.id = b.material_id
    WHERE b.remaining_quantity > 0 AND b.bin_location IS NOT NULL AND b.bin_location != ''
    GROUP BY b.warehouse_code, b.bin_location, b.material_id
  `).all();
  const byBin = {};
  contents.forEach((c) => {
    const key = `${c.warehouse_code}||${c.bin_location}`;
    (byBin[key] = byBin[key] || []).push({
      material_id: c.material_id, material_code: c.material_code,
      material_description: c.material_description, unit: c.unit, quantity: c.quantity,
    });
  });
  bins.forEach((bl) => {
    bl.materials = [
      ...(byBin[`${bl.warehouse_code}||${bl.bin_code}`] || []),
      ...(byBin[`${bl.warehouse_code}||${bl.full_bin_location}`] || []),
    ];
  });

  return res.json({ status, count: bins.length, bins });
});

/**
 * GET /api/dashboard/bins/lookup?code=<value>&warehouse=<code>
 * Resolves a scanned bin QR/barcode value (bin_code or full_bin_location —
 * bin labels encode the plain bin location text, same as the picking QR
 * scan already accepts) to that bin's live contents. This is the read path
 * behind the mobile "Scan Bin" screen: point the camera at a bin label and
 * see what's stored there right now, without opening the full bin list.
 * `warehouse` disambiguates if the same short bin_code exists in more than
 * one warehouse; without it the first active match wins.
 */
router.get('/bins/lookup', (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'code is required.' });
  const warehouse = req.query.warehouse ? String(req.query.warehouse).trim() : null;

  const bin = warehouse
    ? db.prepare(`
        SELECT * FROM bin_locations
        WHERE is_active = 1 AND warehouse_code = ? AND (bin_code = ? OR full_bin_location = ?)
      `).get(warehouse, code, code)
    : db.prepare(`
        SELECT * FROM bin_locations
        WHERE is_active = 1 AND (bin_code = ? OR full_bin_location = ?)
        ORDER BY warehouse_code LIMIT 1
      `).get(code, code);

  if (!bin) return res.status(404).json({ error: `No active bin matches "${code}".` });

  const batches = db.prepare(`
    SELECT b.material_id, b.material_code, b.material_description, b.batch_number,
           b.remaining_quantity, COALESCE(m.unit, '') AS unit, b.expiry_date,
           b.manufacturing_date, b.receiving_date, b.quality_status,
           b.supplier_code, b.supplier_name
    FROM batches b LEFT JOIN materials m ON m.id = b.material_id
    WHERE b.remaining_quantity > 0 AND b.warehouse_code = ? AND b.bin_location IN (?, ?)
    ORDER BY b.expiry_date IS NULL, b.expiry_date, b.material_code
  `).all(bin.warehouse_code, bin.bin_code, bin.full_bin_location);

  const byMaterial = {};
  batches.forEach((b) => {
    const existing = byMaterial[b.material_id];
    if (existing) { existing.quantity += b.remaining_quantity; return; }
    byMaterial[b.material_id] = {
      material_id: b.material_id, material_code: b.material_code,
      material_description: b.material_description, unit: b.unit, quantity: b.remaining_quantity,
    };
  });
  const availableQuantity = batches.reduce((sum, b) => sum + b.remaining_quantity, 0);

  return res.json({
    bin: {
      id: bin.id, warehouse_code: bin.warehouse_code, zone: bin.zone, rack: bin.rack,
      line_or_aisle: bin.line_or_aisle, level: bin.level, column_number: bin.column_number,
      bin_code: bin.bin_code, full_bin_location: bin.full_bin_location, capacity: bin.capacity,
      hazard_flag: bin.hazard_flag, temperature_controlled_flag: bin.temperature_controlled_flag,
      quality_restricted_flag: bin.quality_restricted_flag,
      batch_count: batches.length, material_count: Object.keys(byMaterial).length,
      available_quantity: availableQuantity,
      occupancy_status: availableQuantity > 0 ? 'occupied' : 'empty',
      materials: Object.values(byMaterial),
      batches,
    },
  });
});

router.get('/', (req, res) => {
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);

  const totalMaterials = one('SELECT COUNT(*) AS n FROM materials').n;
  const totalLocations = one('SELECT COUNT(*) AS n FROM bin_locations WHERE is_active = 1').n;
  const emptyLocations = one(`
    SELECT COUNT(*) AS n FROM bin_locations bl
    WHERE bl.is_active = 1 AND NOT EXISTS (
      SELECT 1 FROM batches b
      WHERE b.warehouse_code = bl.warehouse_code
        AND b.bin_location IN (bl.bin_code, bl.full_bin_location)
        AND b.remaining_quantity > 0
    )
  `).n;
  const totalStock = one('SELECT COALESCE(SUM(remaining_quantity), 0) AS n FROM batches').n;

  const movementSince = (type, dateExpr) => one(`
    SELECT COALESCE(SUM(quantity), 0) AS n FROM stock_transactions
    WHERE transaction_type = ? AND date(transaction_date) >= ${dateExpr}
  `, type).n;

  const stockInToday = movementSince('IN', "date('now')");
  const stockOutToday = movementSince('OUT', "date('now')");
  const stockInMonth = movementSince('IN', "date('now','start of month')");
  const stockOutMonth = movementSince('OUT', "date('now','start of month')");
  const pendingUsers = one("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'").n;

  const topMaterials = all(`
    SELECT m.item_code, m.description, m.unit, SUM(b.remaining_quantity) AS quantity
    FROM batches b JOIN materials m ON m.id = b.material_id
    GROUP BY b.material_id HAVING quantity > 0
    ORDER BY quantity DESC LIMIT 10
  `);
  const topLocations = all(`
    SELECT COALESCE(NULLIF(b.bin_location, ''), b.warehouse_code) AS code,
           SUM(b.remaining_quantity) AS quantity
    FROM batches b
    GROUP BY code HAVING quantity > 0
    ORDER BY quantity DESC LIMIT 10
  `);

  const recentTransactions = all(`
    SELECT st.id, st.transaction_type, st.quantity, st.transaction_date,
           st.reservation_number, m.item_code, m.description AS material_description,
           l.code AS location_code, u.name AS user_name
    FROM stock_transactions st
    JOIN materials m ON m.id = st.material_id
    JOIN locations l ON l.id = st.location_id
    JOIN users u ON u.id = st.user_id
    ORDER BY st.id DESC LIMIT 10
  `);

  const inOutOverTime = all(`
    SELECT date(transaction_date) AS day,
      SUM(CASE WHEN transaction_type = 'IN' THEN quantity ELSE 0 END) AS in_qty,
      SUM(CASE WHEN transaction_type = 'OUT' THEN quantity ELSE 0 END) AS out_qty
    FROM stock_transactions
    WHERE date(transaction_date) >= date('now', '-29 days')
    GROUP BY day ORDER BY day
  `);

  const stockByGroup = all(`
    SELECT COALESCE(NULLIF(m.material_group, ''), 'UNGROUPED') AS material_group,
           SUM(b.remaining_quantity) AS quantity
    FROM batches b JOIN materials m ON m.id = b.material_id
    GROUP BY material_group HAVING quantity > 0
    ORDER BY quantity DESC LIMIT 12
  `);

  const stockByLocation = all(`
    SELECT COALESCE(b.warehouse_code, 'UNASSIGNED') AS code,
           SUM(b.remaining_quantity) AS quantity
    FROM batches b
    GROUP BY code HAVING quantity > 0
    ORDER BY quantity DESC LIMIT 12
  `);

  const transactionsByUser = all(`
    SELECT u.name, COUNT(*) AS transactions
    FROM stock_transactions st JOIN users u ON u.id = st.user_id
    GROUP BY st.user_id ORDER BY transactions DESC LIMIT 10
  `);

  res.json({
    kpis: {
      total_materials: totalMaterials,
      total_locations: totalLocations,
      empty_locations: emptyLocations,
      occupied_locations: totalLocations - emptyLocations,
      total_stock: totalStock,
      stock_in_today: stockInToday,
      stock_out_today: stockOutToday,
      stock_in_month: stockInMonth,
      stock_out_month: stockOutMonth,
      pending_users: pendingUsers,
    },
    top_materials: topMaterials,
    top_locations: topLocations,
    recent_transactions: recentTransactions,
    charts: {
      in_out_over_time: inOutOverTime,
      stock_by_group: stockByGroup,
      stock_by_location: stockByLocation,
      transactions_by_user: transactionsByUser,
    },
  });
});

module.exports = router;
