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

/**
 * GET /api/dashboard/bins?status=all|occupied|empty
 *
 * Drill-through data for dashboard bin KPIs. Occupancy uses the same physical
 * bin-to-batch matching rule as the KPI counters, so card totals and detail
 * rows cannot silently disagree.
 */
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
    SELECT bl.id,
           bl.warehouse_code,
           bl.bin_code,
           bl.full_bin_location,
           bl.storage_type,
           bl.storage_section,
           bl.is_active,
           COUNT(DISTINCT CASE WHEN b.remaining_quantity > 0 THEN b.id END) AS batch_count,
           COUNT(DISTINCT CASE WHEN b.remaining_quantity > 0 THEN b.material_id END) AS material_count,
           COALESCE(SUM(CASE WHEN b.remaining_quantity > 0 THEN b.remaining_quantity ELSE 0 END), 0) AS available_quantity,
           CASE
             WHEN COALESCE(SUM(CASE WHEN b.remaining_quantity > 0 THEN b.remaining_quantity ELSE 0 END), 0) > 0
             THEN 'occupied' ELSE 'empty'
           END AS occupancy_status
    FROM bin_locations bl
    LEFT JOIN batches b
      ON b.warehouse_code = bl.warehouse_code
     AND b.bin_location IN (bl.bin_code, bl.full_bin_location)
    WHERE bl.is_active = 1
    GROUP BY bl.id, bl.warehouse_code, bl.bin_code, bl.full_bin_location,
             bl.storage_type, bl.storage_section, bl.is_active
    ${having}
    ORDER BY bl.warehouse_code, COALESCE(NULLIF(bl.full_bin_location, ''), bl.bin_code)
  `).all();

  return res.json({ status, count: bins.length, bins });
});

router.get('/', (req, res) => {
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);

  // --- KPI counters -------------------------------------------------------
  const totalMaterials = one('SELECT COUNT(*) AS n FROM materials').n;
  // Occupancy is measured on physical bin locations vs the batches stored in them.
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

  // --- Top lists ----------------------------------------------------------
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

  // --- Chart data ---------------------------------------------------------
  // Stock IN vs OUT per day over the last 30 days.
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
