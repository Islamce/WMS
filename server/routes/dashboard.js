/**
 * Admin dashboard KPIs and chart data. Everything is computed live from
 * material_location_stock (current balances) and stock_transactions (history).
 */
const express = require('express');
const db = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, requirePermission('dashboard'));

router.get('/', (req, res) => {
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);

  // --- KPI counters -------------------------------------------------------
  const totalMaterials = one('SELECT COUNT(*) AS n FROM materials').n;
  const totalLocations = one('SELECT COUNT(*) AS n FROM locations').n;
  const emptyLocations = one(`
    SELECT COUNT(*) AS n FROM locations l
    WHERE NOT EXISTS (
      SELECT 1 FROM material_location_stock mls
      WHERE mls.location_id = l.id AND mls.quantity > 0
    )
  `).n;
  const totalStock = one('SELECT COALESCE(SUM(quantity), 0) AS n FROM material_location_stock').n;

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
    SELECT m.item_code, m.description, m.unit, SUM(mls.quantity) AS quantity
    FROM material_location_stock mls JOIN materials m ON m.id = mls.material_id
    GROUP BY mls.material_id HAVING quantity > 0
    ORDER BY quantity DESC LIMIT 10
  `);
  const topLocations = all(`
    SELECT l.code, SUM(mls.quantity) AS quantity
    FROM material_location_stock mls JOIN locations l ON l.id = mls.location_id
    GROUP BY mls.location_id HAVING quantity > 0
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
           SUM(mls.quantity) AS quantity
    FROM material_location_stock mls JOIN materials m ON m.id = mls.material_id
    GROUP BY material_group HAVING quantity > 0
    ORDER BY quantity DESC LIMIT 12
  `);

  const stockByLocation = all(`
    SELECT l.code, SUM(mls.quantity) AS quantity
    FROM material_location_stock mls JOIN locations l ON l.id = mls.location_id
    GROUP BY mls.location_id HAVING quantity > 0
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
