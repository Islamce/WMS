/**
 * AI stock analytics engine.
 *
 * Reads the unified movement ledger (stock_transactions: IN = goods receipt,
 * OUT = goods issue) plus live batch stock, and computes per-material:
 *   - consumption velocity and movement classification (DEAD / SLOW / NORMAL / FAST)
 *   - average daily demand, demand variability
 *   - safety stock  = z * sigma_daily * sqrt(lead time)
 *   - reorder point = avg daily demand * lead time + safety stock
 *   - days of cover, stock value, below-reorder flags
 * plus warehouse-level KPIs, chart series, and rule-based natural-language
 * insights. Fully offline — no external AI service required.
 */
const db = require('./../db/connection');
const { daysUntil } = require('./expiry');

// Tunable parameters (could move to a settings table later).
const WINDOW_DAYS = 90;          // analysis window
const LEAD_TIME_DAYS = 14;       // default replenishment lead time
const SERVICE_Z = 1.65;          // ~95% service level
const FAST_EVENTS = 8;           // >= events in window -> FAST
const SLOW_EVENTS = 3;           // <= events in window -> SLOW
const DEAD_DAYS = 90;            // no issue in this many days + stock on hand -> DEAD
const ORDER_COST = 100;          // EOQ: fixed cost per replenishment order
const HOLDING_RATE = 0.2;        // EOQ: annual holding cost as a share of unit price
const OVERSTOCK_DAYS = 180;      // days of cover beyond this -> overstock

function analyze() {
  const materials = db.prepare(`
    SELECT m.id, m.item_code, m.description, m.unit, m.price, m.currency, m.material_group,
      COALESCE((SELECT SUM(remaining_quantity - reserved_quantity) FROM batches WHERE material_id = m.id), 0) AS current_stock
    FROM materials m ORDER BY m.item_code
  `).all();

  // OUT movements inside the window, grouped per material per day.
  const outs = db.prepare(`
    SELECT material_id, date(transaction_date) AS day, SUM(quantity) AS qty, COUNT(*) AS events
    FROM stock_transactions
    WHERE transaction_type = 'OUT' AND date(transaction_date) >= date('now', ?)
    GROUP BY material_id, day
  `).all(`-${WINDOW_DAYS} days`);

  const lastOut = db.prepare(`
    SELECT material_id, MAX(date(transaction_date)) AS last_day
    FROM stock_transactions WHERE transaction_type = 'OUT' GROUP BY material_id
  `).all();
  const lastOutBy = Object.fromEntries(lastOut.map((r) => [r.material_id, r.last_day]));

  const byMat = {};
  outs.forEach((r) => {
    (byMat[r.material_id] = byMat[r.material_id] || []).push(r);
  });

  const items = materials.map((m) => {
    const days = byMat[m.id] || [];
    const totalOut = days.reduce((s, d) => s + d.qty, 0);
    const events = days.reduce((s, d) => s + d.events, 0);
    const avgDaily = totalOut / WINDOW_DAYS;

    // Daily demand std-dev over the window (zero-demand days included).
    const mean = avgDaily;
    const sumSq = days.reduce((s, d) => s + Math.pow(d.qty - mean, 2), 0)
      + (WINDOW_DAYS - days.length) * Math.pow(0 - mean, 2);
    const sigma = Math.sqrt(sumSq / WINDOW_DAYS);

    const safetyStock = Math.round(SERVICE_Z * sigma * Math.sqrt(LEAD_TIME_DAYS) * 100) / 100;
    const reorderPoint = Math.round((avgDaily * LEAD_TIME_DAYS + safetyStock) * 100) / 100;

    const last = lastOutBy[m.id] || null;
    const daysSinceLastOut = last ? -daysUntil(last) : null; // daysUntil is negative for past

    let classification;
    if (m.current_stock > 0 && (events === 0 && (daysSinceLastOut === null || daysSinceLastOut > DEAD_DAYS))) {
      classification = 'DEAD';
    } else if (events === 0) {
      classification = 'INACTIVE';           // no stock, no movement
    } else if (events >= FAST_EVENTS) {
      classification = 'FAST';
    } else if (events <= SLOW_EVENTS) {
      classification = 'SLOW';
    } else {
      classification = 'NORMAL';
    }

    const daysOfCover = avgDaily > 0 ? Math.round(m.current_stock / avgDaily) : null;

    // XYZ: demand variability (coefficient of variation of daily demand).
    // X = stable (CV <= 0.5), Y = variable (<= 1.0), Z = erratic / no demand.
    const cv = mean > 0 ? sigma / mean : null;
    const xyzClass = cv === null ? 'Z' : cv <= 0.5 ? 'X' : cv <= 1.0 ? 'Y' : 'Z';

    // FSN by issue frequency (Fast / Slow / Non-moving).
    const fsnClass = events >= FAST_EVENTS ? 'F' : events > 0 ? 'S' : 'N';

    // EOQ = sqrt(2 * annual demand * order cost / holding cost per unit).
    const annualDemand = avgDaily * 365;
    const holding = Math.max((m.price || 0) * HOLDING_RATE, 0.01);
    const eoq = annualDemand > 0 ? Math.round(Math.sqrt((2 * annualDemand * ORDER_COST) / holding)) : null;

    return {
      material_id: m.id, item_code: m.item_code, description: m.description, unit: m.unit,
      material_group: m.material_group, price: m.price,
      current_stock: m.current_stock,
      stock_value: Math.round(m.current_stock * (m.price || 0) * 100) / 100,
      out_qty_window: totalOut, out_events_window: events,
      consumption_value: Math.round(totalOut * (m.price || 0) * 100) / 100,
      avg_daily_demand: Math.round(avgDaily * 100) / 100,
      demand_sigma: Math.round(sigma * 100) / 100,
      demand_cv: cv === null ? null : Math.round(cv * 100) / 100,
      safety_stock: safetyStock,
      reorder_point: reorderPoint,
      eoq,
      below_reorder: avgDaily > 0 && m.current_stock <= reorderPoint,
      overstock: daysOfCover !== null && daysOfCover > OVERSTOCK_DAYS,
      understock: avgDaily > 0 && m.current_stock <= reorderPoint,
      days_of_cover: daysOfCover,
      days_since_last_issue: daysSinceLastOut,
      classification,
      xyz_class: xyzClass,
      fsn_class: fsnClass,
    };
  });

  // ABC by consumption value share (cumulative 80% = A, 95% = B, rest = C).
  const totalValue = items.reduce((s, i) => s + i.consumption_value, 0);
  let cumulative = 0;
  [...items].sort((a, b) => b.consumption_value - a.consumption_value).forEach((i) => {
    if (totalValue <= 0 || i.consumption_value <= 0) { i.abc_class = 'C'; return; }
    const before = cumulative;
    cumulative += i.consumption_value;
    i.abc_class = before < totalValue * 0.8 ? 'A' : before < totalValue * 0.95 ? 'B' : 'C';
  });

  return items;
}

/** Weekly IN vs OUT series for the trend chart (last 12 weeks). */
function weeklyTrend() {
  return db.prepare(`
    SELECT strftime('%Y-%W', transaction_date) AS week,
      SUM(CASE WHEN transaction_type='IN' THEN quantity ELSE 0 END) AS in_qty,
      SUM(CASE WHEN transaction_type='OUT' THEN quantity ELSE 0 END) AS out_qty
    FROM stock_transactions
    WHERE date(transaction_date) >= date('now', '-84 days')
    GROUP BY week ORDER BY week
  `).all();
}

/** Rule-based natural-language insights over the analysis. */
function buildInsights(items) {
  const insights = [];
  const fmtList = (arr, n = 3) => arr.slice(0, n).map((i) => i.item_code).join(', ') + (arr.length > n ? ` (+${arr.length - n} more)` : '');

  const dead = items.filter((i) => i.classification === 'DEAD');
  if (dead.length) {
    const value = dead.reduce((s, i) => s + i.stock_value, 0);
    insights.push({ severity: 'warning', title: `${dead.length} dead-stock material(s) worth ${value.toFixed(2)}`,
      detail: `No issues in ${DEAD_DAYS}+ days with stock on hand: ${fmtList(dead)}. Consider redeployment, return to supplier, or write-off.` });
  }

  const below = items.filter((i) => i.below_reorder);
  if (below.length) {
    insights.push({ severity: 'critical', title: `${below.length} material(s) at or below reorder point`,
      detail: `Replenish soon: ${fmtList(below)}. Reorder point = avg daily demand × ${LEAD_TIME_DAYS}d lead time + safety stock.` });
  }

  const fastLowCover = items.filter((i) => i.classification === 'FAST' && i.days_of_cover !== null && i.days_of_cover < LEAD_TIME_DAYS);
  if (fastLowCover.length) {
    insights.push({ severity: 'critical', title: `${fastLowCover.length} fast mover(s) with under ${LEAD_TIME_DAYS} days of cover`,
      detail: `${fmtList(fastLowCover)} will run out before a standard replenishment arrives.` });
  }

  const slow = items.filter((i) => i.classification === 'SLOW' && i.current_stock > 0);
  if (slow.length) {
    insights.push({ severity: 'info', title: `${slow.length} slow-moving material(s)`,
      detail: `${fmtList(slow)} have very few issues in the last ${WINDOW_DAYS} days — review order quantities.` });
  }

  const over = items.filter((i) => i.overstock);
  if (over.length) {
    const value = over.reduce((s, i) => s + i.stock_value, 0);
    insights.push({ severity: 'warning', title: `${over.length} overstocked material(s) worth ${value.toFixed(2)}`,
      detail: `${fmtList(over)} carry more than ${OVERSTOCK_DAYS} days of cover — capital is tied up; pause replenishment.` });
  }

  const az = items.filter((i) => i.abc_class === 'A' && i.xyz_class === 'Z');
  if (az.length) {
    insights.push({ severity: 'warning', title: `${az.length} high-value erratic item(s) (A-Z class)`,
      detail: `${fmtList(az)} drive spend but have unpredictable demand — manage manually with safety stock and short review cycles.` });
  }

  const ax = items.filter((i) => i.abc_class === 'A' && i.xyz_class === 'X');
  if (ax.length) {
    insights.push({ severity: 'info', title: `${ax.length} item(s) suit automatic replenishment (A-X class)`,
      detail: `${fmtList(ax)} are high-value with stable demand — ideal for auto reorder at the reorder point (EOQ lot size).` });
  }

  const expiring = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(remaining_quantity), 0) AS qty FROM batches
    WHERE expiry_date IS NOT NULL AND remaining_quantity > 0
      AND date(expiry_date) <= date('now', '+30 days') AND date(expiry_date) >= date('now')
  `).get();
  if (expiring.n > 0) {
    insights.push({ severity: 'warning', title: `${expiring.n} batch(es) expiring within 30 days`,
      detail: `${expiring.qty} units at risk — FEFO picking will prioritise them; consider promotions or transfers.` });
  }

  const hold = db.prepare("SELECT COUNT(*) AS n FROM batches WHERE quality_status='QUALITY_HOLD' AND remaining_quantity > 0").get();
  if (hold.n > 0) {
    insights.push({ severity: 'info', title: `${hold.n} batch(es) awaiting quality inspection`,
      detail: 'Stock on quality hold is not available for allocation until released by the Quality team.' });
  }

  if (!insights.length) {
    insights.push({ severity: 'good', title: 'Inventory is healthy', detail: 'No dead stock, reorder breaches, or expiry risks detected.' });
  }
  return insights;
}

function fullReport() {
  const items = analyze();
  const active = items.filter((i) => i.classification !== 'INACTIVE');
  const byClass = {};
  active.forEach((i) => { byClass[i.classification] = (byClass[i.classification] || 0) + 1; });

  // 3x3 ABC-XYZ matrix (counts + item codes per cell).
  const matrix = {};
  ['A', 'B', 'C'].forEach((a) => ['X', 'Y', 'Z'].forEach((x) => { matrix[`${a}${x}`] = { count: 0, items: [] }; }));
  active.forEach((i) => {
    const cell = matrix[`${i.abc_class}${i.xyz_class}`];
    if (cell) { cell.count += 1; if (cell.items.length < 10) cell.items.push(i.item_code); }
  });

  return {
    parameters: { window_days: WINDOW_DAYS, lead_time_days: LEAD_TIME_DAYS, service_level_z: SERVICE_Z,
      order_cost: ORDER_COST, holding_rate: HOLDING_RATE, overstock_days: OVERSTOCK_DAYS },
    summary: {
      materials_analyzed: active.length,
      total_stock_value: Math.round(active.reduce((s, i) => s + i.stock_value, 0) * 100) / 100,
      dead_count: byClass.DEAD || 0,
      slow_count: byClass.SLOW || 0,
      normal_count: byClass.NORMAL || 0,
      fast_count: byClass.FAST || 0,
      below_reorder_count: active.filter((i) => i.below_reorder).length,
      overstock_count: active.filter((i) => i.overstock).length,
      dead_stock_value: Math.round(active.filter((i) => i.classification === 'DEAD').reduce((s, i) => s + i.stock_value, 0) * 100) / 100,
    },
    abc_xyz_matrix: matrix,
    items: active,
    top_consumers: [...active].sort((a, b) => b.out_qty_window - a.out_qty_window).slice(0, 10),
    weekly_trend: weeklyTrend(),
    insights: buildInsights(active),
  };
}

module.exports = { analyze, fullReport, WINDOW_DAYS, LEAD_TIME_DAYS };
