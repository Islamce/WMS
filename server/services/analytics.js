/**
 * Inventory analytics over the canonical analytical movement contract.
 * Historical imports are append-only and never mutate live inventory. Opening
 * balances, transfers and adjustments are deliberately excluded from demand.
 */
const db = require('./../db/connection');

const WINDOW_DAYS = 90;
const LEAD_TIME_DAYS = 14;
const SERVICE_Z = 1.65;
const FAST_EVENTS = 8;
const SLOW_EVENTS = 3;
const ORDER_COST = 100;
const HOLDING_RATE = 0.2;
const OVERSTOCK_DAYS = 180;

const isoDay = (value) => value ? String(value).slice(0, 10) : null;
const today = () => new Date().toISOString().slice(0, 10);
function shiftDay(day, amount) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function dayDiff(earlier, later = today()) {
  return Math.floor((new Date(`${later}T00:00:00Z`) - new Date(`${earlier}T00:00:00Z`)) / 86400000);
}
function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function operationalCategory(row) {
  const notes = String(row.notes || '').toLowerCase();
  if (notes.startsWith('opening stock import')) return { category: 'OPENING_BALANCE', reversalOf: null };
  if (notes.startsWith('gi reversal')) return { category: 'REVERSAL', reversalOf: 'ISSUE' };
  if (notes.startsWith('reallocation')) return { category: row.transaction_type === 'IN' ? 'TRANSFER_IN' : 'TRANSFER_OUT', reversalOf: null };
  if (notes.startsWith('cycle count') || notes.startsWith('physical inventory')) {
    return { category: row.transaction_type === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', reversalOf: null };
  }
  return { category: row.transaction_type === 'IN' ? 'RECEIPT' : 'ISSUE', reversalOf: null };
}

function historyMovements() {
  return db.prepare(`SELECT h.id, COALESCE(h.material_id,m.id) AS material_id, h.material_code,
    COALESCE(h.movement_category,h.movement_type) AS movement_category, h.reversal_of_category,
    h.quantity, COALESCE(h.posting_date,h.movement_date) AS posting_date,
    h.reservation_number, h.erp_document_reference, h.external_id, h.source_system
    FROM stock_movement_history h LEFT JOIN materials m ON m.item_code=h.material_code`).all().map((row) => ({
      id: `H${row.id}`, material_id: row.material_id, material_code: row.material_code,
      category: row.movement_category, reversal_of_category: row.reversal_of_category,
      quantity: Number(row.quantity), posting_date: isoDay(row.posting_date),
      reference: row.erp_document_reference || row.reservation_number || row.external_id || null,
      source_kind: 'HISTORICAL_IMPORT', source_system: row.source_system,
    }));
}

function operationalMovements() {
  return db.prepare(`SELECT st.id, st.material_id, m.item_code AS material_code, st.transaction_type,
    st.quantity, st.transaction_date, st.notes
    FROM stock_transactions st JOIN materials m ON m.id=st.material_id`).all().map((row) => {
      const classified = operationalCategory(row);
      return {
        id: `O${row.id}`, material_id: row.material_id, material_code: row.material_code,
        category: classified.category, reversal_of_category: classified.reversalOf,
        quantity: Number(row.quantity), posting_date: isoDay(row.transaction_date),
        reference: row.notes || null, source_kind: 'OPERATIONAL_LEDGER', source_system: 'WMS',
      };
    });
}

function canonicalMovements() {
  const history = historyMovements();
  const operational = operationalMovements();
  const historicalCandidates = history.filter((movement) => movement.reference);
  const merged = [...history];
  operational.forEach((movement) => {
    const duplicate = historicalCandidates.some((candidate) => candidate.material_id === movement.material_id
      && candidate.category === movement.category && candidate.posting_date === movement.posting_date
      && Number(candidate.quantity) === Number(movement.quantity)
      && (String(movement.reference).includes(String(candidate.reference))
        || String(candidate.reference).includes(String(movement.reference))));
    if (!duplicate) merged.push(movement);
  });
  return merged;
}

function mergeIntervals(intervals) {
  const sorted = intervals.filter((interval) => interval.start && interval.end && interval.start <= interval.end)
    .sort((a, b) => a.start.localeCompare(b.start));
  const merged = [];
  sorted.forEach((interval) => {
    const last = merged[merged.length - 1];
    if (!last || interval.start > shiftDay(last.end, 1)) merged.push({ ...interval });
    else if (interval.end > last.end) last.end = interval.end;
  });
  return merged;
}

function movementCoverage(movements) {
  const end = today();
  const start = shiftDay(end, -(WINDOW_DAYS - 1));
  const intervals = [];
  const operationalStart = db.prepare(`SELECT MIN(date(transaction_date)) AS day FROM stock_transactions
    WHERE notes IS NULL OR lower(notes) NOT LIKE 'opening stock import%'`).get().day;
  if (operationalStart) intervals.push({ start: isoDay(operationalStart), end, source: 'OPERATIONAL_LEDGER' });
  db.prepare(`SELECT b.id, b.period_start, b.period_end,
    MIN(COALESCE(h.posting_date,h.movement_date)) AS actual_start,
    MAX(COALESCE(h.posting_date,h.movement_date)) AS actual_end
    FROM stock_movement_import_batches b
    LEFT JOIN stock_movement_history h ON h.import_batch_id=b.id
    WHERE b.status IN ('COMPLETED','COMPLETED_WITH_ERRORS')
      AND COALESCE(b.movement_category,b.movement_type) IN ('ISSUE','RETURN','REVERSAL')
    GROUP BY b.id`).all().forEach((batch) => intervals.push({
      start: isoDay(batch.period_start || batch.actual_start), end: isoDay(batch.period_end || batch.actual_end),
      source: `IMPORT_BATCH_${batch.id}`,
    }));
  const merged = mergeIntervals(intervals);
  let coveredDays = 0;
  merged.forEach((interval) => {
    const clippedStart = interval.start < start ? start : interval.start;
    const clippedEnd = interval.end > end ? end : interval.end;
    if (clippedStart <= clippedEnd) coveredDays += dayDiff(clippedStart, clippedEnd) + 1;
  });
  coveredDays = Math.min(WINDOW_DAYS, coveredDays);
  const complete = merged.some((interval) => interval.start <= start && interval.end >= end);
  const status = complete ? 'COMPLETE' : coveredDays > 0 ? 'PARTIAL' : 'NONE';
  const analyticalMovements = movements.filter((movement) => movement.category !== 'OPENING_BALANCE');
  const movementDates = analyticalMovements.map((movement) => movement.posting_date).filter(Boolean).sort();
  const materialIds = new Set(analyticalMovements.map((movement) => movement.material_id).filter(Boolean));
  const allMaterialIds = db.prepare('SELECT id FROM materials').all().map((row) => row.id);
  return {
    status, confidence: complete ? 'HIGH' : status === 'PARTIAL' ? 'LOW' : 'NONE',
    analysis_window_start: start, analysis_window_end: end, window_days: WINDOW_DAYS,
    covered_days: coveredDays, coverage_percent: round((coveredDays / WINDOW_DAYS) * 100, 1),
    earliest_movement_date: movementDates[0] || null,
    latest_movement_date: movementDates.at(-1) || null,
    materials_with_history: materialIds.size,
    materials_without_history: allMaterialIds.filter((id) => !materialIds.has(id)).length,
    intervals: merged,
    assumption: 'Operational ledger coverage is continuous from its first non-opening movement through today.',
    warning: complete ? null : 'Movement coverage is incomplete. No observed movement must not be interpreted as proof that no movement occurred.',
  };
}

function demandEffect(movement) {
  if (movement.category === 'ISSUE') return movement.quantity;
  if (movement.category === 'RETURN') return -movement.quantity;
  if (movement.category === 'REVERSAL' && movement.reversal_of_category === 'ISSUE') return -movement.quantity;
  return 0;
}
function receiptEffect(movement) {
  if (movement.category === 'RECEIPT') return movement.quantity;
  if (movement.category === 'REVERSAL' && movement.reversal_of_category === 'RECEIPT') return -movement.quantity;
  return 0;
}

function analyzeWithCoverage() {
  const movements = canonicalMovements();
  const coverage = movementCoverage(movements);
  const windowMovements = movements.filter((movement) => movement.posting_date >= coverage.analysis_window_start
    && movement.posting_date <= coverage.analysis_window_end && movement.category !== 'OPENING_BALANCE');
  const byMaterial = {};
  windowMovements.forEach((movement) => { (byMaterial[movement.material_id] = byMaterial[movement.material_id] || []).push(movement); });

  const materials = db.prepare(`SELECT m.id, m.item_code, m.description, m.unit, m.price, m.currency, m.material_group,
    COALESCE((SELECT SUM(remaining_quantity-reserved_quantity) FROM batches WHERE material_id=m.id),0) AS current_stock,
    (SELECT MIN(receiving_date) FROM batches WHERE material_id=m.id AND remaining_quantity>0) AS oldest_stock_date
    FROM materials m ORDER BY m.item_code`).all();

  const items = materials.map((material) => {
    const rows = byMaterial[material.id] || [];
    const issues = rows.filter((movement) => movement.category === 'ISSUE');
    const receipts = rows.filter((movement) => movement.category === 'RECEIPT');
    const dailyDemand = {};
    rows.forEach((movement) => { dailyDemand[movement.posting_date] = (dailyDemand[movement.posting_date] || 0) + demandEffect(movement); });
    const netConsumption = rows.reduce((sum, movement) => sum + demandEffect(movement), 0);
    const grossIssues = issues.reduce((sum, movement) => sum + movement.quantity, 0);
    const netReceipts = rows.reduce((sum, movement) => sum + receiptEffect(movement), 0);
    const averageDaily = Math.max(0, netConsumption) / WINDOW_DAYS;
    const mean = averageDaily;
    let sumSquares = 0;
    for (let index = 0; index < WINDOW_DAYS; index += 1) {
      const day = shiftDay(coverage.analysis_window_start, index);
      sumSquares += Math.pow(Math.max(0, dailyDemand[day] || 0) - mean, 2);
    }
    const sigma = Math.sqrt(sumSquares / WINDOW_DAYS);
    const safetyStock = round(SERVICE_Z * sigma * Math.sqrt(LEAD_TIME_DAYS));
    const reorderPoint = round(averageDaily * LEAD_TIME_DAYS + safetyStock);
    const lastIssue = issues.map((movement) => movement.posting_date).sort().at(-1) || null;
    const lastReceipt = receipts.map((movement) => movement.posting_date).sort().at(-1) || null;
    const issueEvents = issues.length;
    let classification;
    if (Number(material.current_stock) <= 0 && issueEvents === 0) classification = 'INACTIVE';
    else if (issueEvents === 0 && coverage.status !== 'COMPLETE') classification = 'UNKNOWN';
    else if (issueEvents === 0) classification = 'DEAD';
    else if (issueEvents >= FAST_EVENTS) classification = 'FAST';
    else if (issueEvents <= SLOW_EVENTS) classification = 'SLOW';
    else classification = 'NORMAL';
    const confidence = coverage.status === 'COMPLETE' ? 'HIGH' : issueEvents > 0 ? 'MEDIUM' : coverage.status === 'PARTIAL' ? 'LOW' : 'NONE';
    const daysOfCover = averageDaily > 0 ? Math.round(Number(material.current_stock) / averageDaily) : null;
    const coefficient = mean > 0 ? sigma / mean : null;
    const annualDemand = averageDaily * 365;
    const holding = Math.max((material.price || 0) * HOLDING_RATE, 0.01);
    const eoq = annualDemand > 0 ? Math.round(Math.sqrt((2 * annualDemand * ORDER_COST) / holding)) : null;
    return {
      material_id: material.id, item_code: material.item_code, description: material.description, unit: material.unit,
      material_group: material.material_group, price: material.price, current_stock: Number(material.current_stock),
      stock_value: round(Number(material.current_stock) * (material.price || 0)),
      out_qty_window: round(grossIssues), out_events_window: issueEvents, net_consumption: round(netConsumption),
      avg_monthly_consumption: round(Math.max(0, netConsumption) / WINDOW_DAYS * 30),
      avg_daily_usage: round(averageDaily), avg_daily_demand: round(averageDaily),
      consumption_value: round(Math.max(0, netConsumption) * (material.price || 0)),
      receipt_qty_window: round(netReceipts), issue_frequency_per_month: round(issueEvents / WINDOW_DAYS * 30),
      receipt_frequency_per_month: round(receipts.length / WINDOW_DAYS * 30),
      last_issue_date: lastIssue, last_receipt_date: lastReceipt,
      days_since_last_issue: lastIssue ? dayDiff(lastIssue) : null,
      stock_age_days: material.oldest_stock_date ? dayDiff(isoDay(material.oldest_stock_date)) : null,
      demand_sigma: round(sigma), demand_cv: coefficient === null ? null : round(coefficient),
      safety_stock: safetyStock, reorder_point: reorderPoint, eoq,
      below_reorder: averageDaily > 0 && Number(material.current_stock) <= reorderPoint,
      overstock: daysOfCover !== null && daysOfCover > OVERSTOCK_DAYS,
      understock: averageDaily > 0 && Number(material.current_stock) <= reorderPoint,
      days_of_cover: daysOfCover, classification, classification_confidence: confidence,
      xyz_class: coefficient === null ? 'Z' : coefficient <= 0.5 ? 'X' : coefficient <= 1 ? 'Y' : 'Z',
      fsn_class: classification === 'UNKNOWN' ? 'U' : issueEvents >= FAST_EVENTS ? 'F' : issueEvents > 0 ? 'S' : 'N',
    };
  });

  const totalValue = items.reduce((sum, item) => sum + item.consumption_value, 0);
  let cumulative = 0;
  [...items].sort((a, b) => b.consumption_value - a.consumption_value).forEach((item) => {
    if (totalValue <= 0 || item.consumption_value <= 0) item.abc_class = 'C';
    else { const before = cumulative; cumulative += item.consumption_value; item.abc_class = before < totalValue * 0.8 ? 'A' : before < totalValue * 0.95 ? 'B' : 'C'; }
  });
  return { items, coverage, movements };
}

function analyze() { return analyzeWithCoverage().items; }

function weeklyTrend(movements) {
  const cutoff = shiftDay(today(), -83);
  const weeks = {};
  movements.filter((movement) => movement.posting_date >= cutoff && movement.category !== 'OPENING_BALANCE').forEach((movement) => {
    const date = new Date(`${movement.posting_date}T00:00:00Z`);
    const weekStart = new Date(date); weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay());
    const key = weekStart.toISOString().slice(0, 10);
    const row = weeks[key] || { week: key, in_qty: 0, out_qty: 0 };
    if (['RECEIPT', 'RETURN', 'TRANSFER_IN', 'ADJUSTMENT_IN'].includes(movement.category)) row.in_qty += movement.quantity;
    if (['ISSUE', 'TRANSFER_OUT', 'ADJUSTMENT_OUT'].includes(movement.category)) row.out_qty += movement.quantity;
    if (movement.category === 'REVERSAL') {
      if (['ISSUE', 'TRANSFER_OUT', 'ADJUSTMENT_OUT'].includes(movement.reversal_of_category)) row.in_qty += movement.quantity;
      else row.out_qty += movement.quantity;
    }
    weeks[key] = row;
  });
  return Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week)).map((row) => ({ ...row, in_qty: round(row.in_qty), out_qty: round(row.out_qty) }));
}

function buildInsights(items, coverage) {
  const insights = [];
  const list = (rows) => rows.slice(0, 3).map((item) => item.item_code).join(', ') + (rows.length > 3 ? ` (+${rows.length - 3} more)` : '');
  if (coverage.warning) insights.push({ severity: 'warning', title: `${coverage.status.toLowerCase()} movement coverage (${coverage.coverage_percent}%)`, detail: coverage.warning });
  const dead = items.filter((item) => item.classification === 'DEAD');
  if (dead.length) insights.push({ severity: 'warning', title: `${dead.length} confirmed dead-stock material(s)`, detail: `Complete coverage shows no issues in the analysis window: ${list(dead)}.` });
  const unknown = items.filter((item) => item.classification === 'UNKNOWN');
  if (unknown.length) insights.push({ severity: 'info', title: `${unknown.length} stocked material(s) remain unclassified`, detail: `Movement evidence is insufficient to label these as dead stock: ${list(unknown)}.` });
  const below = items.filter((item) => item.below_reorder);
  if (below.length) insights.push({ severity: 'critical', title: `${below.length} material(s) at or below reorder point`, detail: `Replenish soon: ${list(below)}.` });
  const fastLowCover = items.filter((item) => item.classification === 'FAST'
    && item.days_of_cover !== null && item.days_of_cover < LEAD_TIME_DAYS);
  if (fastLowCover.length) insights.push({ severity: 'critical', title: `${fastLowCover.length} fast mover(s) have less than ${LEAD_TIME_DAYS} days of cover`, detail: `${list(fastLowCover)} may run out before standard replenishment arrives.` });
  const slow = items.filter((item) => item.classification === 'SLOW' && item.current_stock > 0);
  if (slow.length) insights.push({ severity: 'info', title: `${slow.length} slow-moving material(s)`, detail: `${list(slow)} have few issue events in the analysis window.` });
  const over = items.filter((item) => item.overstock);
  if (over.length) insights.push({ severity: 'warning', title: `${over.length} overstocked material(s)`, detail: `${list(over)} carry more than ${OVERSTOCK_DAYS} days of cover.` });
  const highErratic = items.filter((item) => item.abc_class === 'A' && item.xyz_class === 'Z');
  if (highErratic.length) insights.push({ severity: 'warning', title: `${highErratic.length} high-value erratic item(s)`, detail: `${list(highErratic)} need manual replenishment review.` });
  const expiring = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(remaining_quantity),0) AS qty FROM batches
    WHERE expiry_date IS NOT NULL AND remaining_quantity>0 AND date(expiry_date) BETWEEN date('now') AND date('now','+30 days')`).get();
  if (expiring.n > 0) insights.push({ severity: 'warning', title: `${expiring.n} batch(es) expire within 30 days`, detail: `${expiring.qty} units are at expiry risk; retain FEFO controls.` });
  const hold = db.prepare("SELECT COUNT(*) AS n FROM batches WHERE quality_status='QUALITY_HOLD' AND remaining_quantity>0").get();
  if (hold.n > 0) insights.push({ severity: 'info', title: `${hold.n} batch(es) await quality inspection`, detail: 'Quality-hold stock is unavailable for allocation until released.' });
  if (!insights.length) insights.push({ severity: 'good', title: 'No analytical alert detected', detail: 'No covered dead-stock, reorder, overstock, or expiry alert was detected.' });
  return insights;
}

function fullReport() {
  const { items, coverage, movements } = analyzeWithCoverage();
  const active = items.filter((item) => item.classification !== 'INACTIVE');
  const byClass = {};
  active.forEach((item) => { byClass[item.classification] = (byClass[item.classification] || 0) + 1; });
  const matrix = {};
  ['A', 'B', 'C'].forEach((abc) => ['X', 'Y', 'Z'].forEach((xyz) => { matrix[`${abc}${xyz}`] = { count: 0, items: [] }; }));
  active.forEach((item) => { const cell = matrix[`${item.abc_class}${item.xyz_class}`]; if (cell) { cell.count += 1; if (cell.items.length < 10) cell.items.push(item.item_code); } });
  return {
    parameters: { window_days: WINDOW_DAYS, lead_time_days: LEAD_TIME_DAYS, service_level_z: SERVICE_Z,
      order_cost: ORDER_COST, holding_rate: HOLDING_RATE, overstock_days: OVERSTOCK_DAYS },
    coverage,
    summary: {
      materials_analyzed: active.length, total_stock_value: round(active.reduce((sum, item) => sum + item.stock_value, 0)),
      dead_count: byClass.DEAD || 0, unknown_count: byClass.UNKNOWN || 0, slow_count: byClass.SLOW || 0,
      normal_count: byClass.NORMAL || 0, fast_count: byClass.FAST || 0,
      below_reorder_count: active.filter((item) => item.below_reorder).length,
      overstock_count: active.filter((item) => item.overstock).length,
      dead_stock_value: round(active.filter((item) => item.classification === 'DEAD').reduce((sum, item) => sum + item.stock_value, 0)),
    },
    abc_xyz_matrix: matrix, items: active,
    top_consumers: [...active].sort((a, b) => b.net_consumption - a.net_consumption).slice(0, 10),
    weekly_trend: weeklyTrend(movements), insights: buildInsights(active, coverage),
  };
}

module.exports = { analyze, fullReport, canonicalMovements, movementCoverage, WINDOW_DAYS, LEAD_TIME_DAYS };
