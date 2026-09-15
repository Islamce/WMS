/**
 * KPI dashboard — request throughput, cycle-time averages, shortage/expiry
 * metrics, FIFO/FEFO & QR compliance, and ERP posting success rate.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { getTenant } = require('./../services/tenant');
const { usesErpStaging } = require('./../services/tenantProfile');

const router = express.Router();
router.use(authenticate, requirePermission('kpi_dashboard'));

router.get('/', (req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);

  const statusCount = (statuses) => one(
    `SELECT COUNT(*) AS n FROM material_request_headers WHERE request_status IN (${statuses.map(() => '?').join(',')})`, ...statuses).n;

  const total = one('SELECT COUNT(*) AS n FROM material_request_headers').n;
  const completed = statusCount(['Completed']);
  const partiallyCompleted = statusCount(['Partially Completed', 'Closed with Shortage']);
  const rejected = statusCount(['Rejected']);
  const cancelled = statusCount(['Cancelled']);
  const erpError = statusCount(['ERP Error']);
  // ERP Error has its own tile, so leaving it inside `open` counted the same
  // request twice and any chart drawing both totalled over 100%. It is still
  // open work — it is just open work of a kind the screen already names.
  const open = total - completed - partiallyCompleted - rejected - cancelled - erpError;

  // Two cycle times are measured from erp_reservation_date, which is written in
  // exactly one place: the ERP Operator screen. The contracting workflow routes
  // past that screen, so on a contracting tenant the column is never set and
  // both averages came back 0 — indistinguishable from "instant", on a step that
  // does not exist. null says "not applicable here" and the screen can omit it.
  const erpStaged = usesErpStaging(getTenant().profileKey);

  // Average durations (minutes) between lifecycle timestamps.
  const avgMinutes = (fromCol, toCol) => {
    const r = one(`
      SELECT AVG((julianday(${toCol}) - julianday(${fromCol})) * 24 * 60) AS m
      FROM material_request_headers WHERE ${fromCol} IS NOT NULL AND ${toCol} IS NOT NULL
    `);
    // Clamp to >= 0: gi_posting_date is a date while reservation is a datetime,
    // so same-day sequences can yield a small negative diff.
    return r.m ? Math.max(0, Math.round(r.m)) : 0;
  };

  // Shortage metrics.
  const shortageLines = one("SELECT COUNT(*) AS n FROM material_request_lines WHERE line_status IN ('Shortage','Partially Picked')").n;
  const totalLines = one('SELECT COUNT(*) AS n FROM material_request_lines').n;

  // Expiry metrics.
  const expiredBatches = one("SELECT COUNT(*) AS n FROM batches WHERE expiry_date IS NOT NULL AND date(expiry_date) < date('now') AND remaining_quantity > 0").n;

  // QR & override compliance.
  const qrPass = one("SELECT COUNT(*) AS n FROM audit_trail WHERE action='QR_SCAN_PASS'").n;
  const qrFail = one("SELECT COUNT(*) AS n FROM audit_trail WHERE action='QR_SCAN_FAIL'").n;
  const overrides = one("SELECT COUNT(*) AS n FROM audit_trail WHERE action='SUPERVISOR_OVERRIDE'").n;

  // FIFO/FEFO compliance = allocations that used the expected method vs total.
  const allocTotal = one("SELECT COUNT(*) AS n FROM picking_allocations").n;
  const fifo = one("SELECT COUNT(*) AS n FROM picking_allocations WHERE allocation_method='FIFO'").n;
  const fefo = one("SELECT COUNT(*) AS n FROM picking_allocations WHERE allocation_method='FEFO'").n;

  // ERP posting success rate.
  const giSuccess = one("SELECT COUNT(*) AS n FROM erp_integration_log WHERE transaction_type='GI_POSTING' AND status='SUCCESS'").n;
  const giFail = one("SELECT COUNT(*) AS n FROM erp_integration_log WHERE transaction_type='GI_POSTING' AND status='FAILED'").n;

  res.json({
    kpis: {
      total_requests: total, completed, partially_completed: partiallyCompleted, rejected, cancelled,
      open, erp_error: erpError,
      avg_approval_minutes: avgMinutes('submitted_at', 'approved_at'),
      avg_erp_reservation_minutes: erpStaged ? avgMinutes('approved_at', 'erp_reservation_date') : null,
      avg_gi_posting_minutes: erpStaged ? avgMinutes('erp_reservation_date', 'gi_posting_date') : null,
      // On a tenant with no ERP staging, approval runs straight to the store.
      // This is the cycle time that step actually has, rather than a zero.
      avg_approval_to_issue_minutes: erpStaged ? null : avgMinutes('approved_at', 'gi_posting_date'),
      erp_staging: erpStaged,
      shortage_lines: shortageLines,
      shortage_percentage: totalLines ? Math.round((shortageLines / totalLines) * 100) : 0,
      expired_batches: expiredBatches,
      qr_scan_pass: qrPass, qr_scan_failure: qrFail, manual_override_count: overrides,
      fifo_allocations: fifo, fefo_allocations: fefo, total_allocations: allocTotal,
      erp_posting_success: giSuccess, erp_posting_failure: giFail,
      // Was 100 when nothing had ever been posted, so a brand-new tenant saw a
      // reassuring green "100% — 0 successful postings" next to its own
      // contradiction. A rate over no attempts is not 100%, it is unknown.
      erp_success_rate: (giSuccess + giFail) ? Math.round((giSuccess / (giSuccess + giFail)) * 100) : null,
    },
    by_status: all('SELECT request_status AS status, COUNT(*) AS count FROM material_request_headers GROUP BY request_status ORDER BY count DESC'),
    by_warehouse: all("SELECT issue_warehouse_code AS warehouse, COUNT(*) AS count FROM material_request_headers WHERE issue_warehouse_code IS NOT NULL GROUP BY issue_warehouse_code"),
    by_movement_type: all("SELECT movement_type, COUNT(*) AS count FROM material_request_headers WHERE movement_type IS NOT NULL GROUP BY movement_type"),
  });
});

module.exports = router;
