/**
 * Spend by project — the question a contracting owner pays to answer, and the
 * one this system could not answer until now: wbs_element appeared in no
 * report, KPI or dashboard query. Every goods issue stamps request_line_id on
 * its ledger row (server/routes/gi.js), the line carries the request, the
 * request carries the project, and materials carry a price. One join.
 *
 * GET /api/reports/project-spend?from=YYYY-MM-DD&to=YYYY-MM-DD[&project=CODE]
 *
 * The window is mandatory and bounded. Measured at one million ledger rows an
 * all-time roll-up is 2.5 s of a fully blocked event loop (better-sqlite3 is
 * synchronous); a windowed one is 300 ms. Never make "all time" the landing
 * state. The predicate compares the raw column so idx_stock_tx_spend serves it.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');

const router = express.Router();
router.use(authenticate, requirePermission('kpi_dashboard'));

const MAX_WINDOW_DAYS = 366;
const isoDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

function windowFrom(query) {
  const today = new Date().toISOString().slice(0, 10);
  const from = query.from || `${today.slice(0, 7)}-01`;
  const to = query.to || today;
  if (!isoDay(from) || !isoDay(to)) return { error: 'from and to must be dates in YYYY-MM-DD form.' };
  if (from > to) return { error: 'from must not be after to.' };
  const span = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (span > MAX_WINDOW_DAYS) {
    return { error: `The window may not exceed ${MAX_WINDOW_DAYS} days. Narrow it, or run the report per year.` };
  }
  return { from, to };
}

/**
 * Signed issued quantity per ledger row. A goods-issue reversal is an IN row
 * carrying request_line_id whose original was an ISSUE; counting only OUT rows
 * would leave a reversed issue counted as spend forever. Same rule as
 * analytics.js demandEffect().
 */
const SPEND_ROWS = `
  SELECT st.material_id, st.request_line_id,
         CASE WHEN st.movement_category = 'ISSUE' THEN st.quantity
              WHEN st.movement_category = 'REVERSAL' AND orig.movement_category = 'ISSUE' THEN -st.quantity
              ELSE 0 END AS signed_qty
  FROM stock_transactions st
  LEFT JOIN stock_transactions orig ON orig.id = st.reversal_of_transaction_id
  WHERE st.movement_category IN ('ISSUE', 'REVERSAL')
    AND st.transaction_date >= ? AND st.transaction_date < date(?, '+1 day')
    AND st.request_line_id IS NOT NULL
`;

router.get('/project-spend', (req, res) => {
  const w = windowFrom(req.query);
  if (w.error) return res.status(400).json({ error: w.error });
  const params = [w.from, w.to];
  const projectFilter = req.query.project ? "AND COALESCE(h.wbs_element, '') = ?" : '';
  if (req.query.project) params.push(String(req.query.project));

  const rows = db.prepare(`
    WITH spend AS (${SPEND_ROWS})
    SELECT COALESCE(NULLIF(h.wbs_element, ''), '(no project)') AS project,
           ${req.query.project ? 'm.item_code, m.description, m.unit, m.price,' : ''}
           COUNT(*) AS movements,
           ROUND(SUM(s.signed_qty), 3) AS quantity,
           ROUND(SUM(s.signed_qty * COALESCE(m.price, 0)), 2) AS spend,
           SUM(CASE WHEN COALESCE(m.price, 0) <= 0 THEN 1 ELSE 0 END) AS unpriced_movements
    FROM spend s
    JOIN material_request_lines l ON l.id = s.request_line_id
    JOIN material_request_headers h ON h.id = l.request_id
    JOIN materials m ON m.id = s.material_id
    WHERE 1 = 1 ${projectFilter}
    GROUP BY ${req.query.project ? 'm.id' : 'project'}
    ORDER BY spend DESC, quantity DESC
    ${req.query.project ? 'LIMIT 500' : ''}
  `).all(...params);

  // Coverage. request_line_id is written only by the goods-issue path and
  // only since migration 026/027 - issues posted before it are invisible
  // here. Say how many, rather than let a short bar read as a small spend.
  const cov = db.prepare(`
    SELECT COUNT(*) AS total_issues,
           SUM(CASE WHEN request_line_id IS NOT NULL THEN 1 ELSE 0 END) AS attributable_issues
    FROM stock_transactions
    WHERE movement_category = 'ISSUE' AND transaction_date >= ? AND transaction_date < date(?, '+1 day')
  `).get(w.from, w.to);
  const unpricedMaterials = db.prepare(`
    WITH spend AS (${SPEND_ROWS})
    SELECT COUNT(DISTINCT s.material_id) AS n FROM spend s JOIN materials m ON m.id = s.material_id WHERE COALESCE(m.price, 0) <= 0
  `).get(w.from, w.to).n;

  res.json({
    window: { from: w.from, to: w.to },
    project: req.query.project || null,
    rows,
    coverage: {
      attributable_issues: cov.attributable_issues || 0,
      total_issues: cov.total_issues || 0,
      unpriced_materials: unpricedMaterials,
    },
    // Not a valuation. materials.price is a single current price with no
    // effective date; every figure here reprices the moment a material's
    // price is edited. Said on screen, not just here.
    price_basis: 'Current material price at the time the report is run - not the price when the material was issued. Editing a price changes historical figures.',
  });
});

module.exports = router;
