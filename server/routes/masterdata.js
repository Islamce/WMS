/**
 * Master data & reporting: warehouses, bin locations, movement types, batches,
 * expiry alerts, audit trail, notifications, and quality actions.
 */
const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const { isNonEmptyString, isId, parsePagination } = require('./../utils/validate');
const audit = require('./../services/audit');
const { alertLevel, daysUntil } = require('./../services/expiry');
const { compactBin, expandedBin } = require('./../db/seed2');

const router = express.Router();
router.use(authenticate);

// --- Warehouses -------------------------------------------------------------
router.get('/warehouses', requirePermission(['warehouses_master', 'warehouse_dashboard']), (req, res) => {
  res.json({ warehouses: db.prepare('SELECT * FROM warehouses ORDER BY warehouse_code').all() });
});
router.post('/warehouses', requirePermission('warehouses_master'), (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.warehouse_code) || !isNonEmptyString(b.warehouse_name)) {
    return res.status(400).json({ error: 'Warehouse code and name are required.' });
  }
  if (db.prepare('SELECT 1 FROM warehouses WHERE warehouse_code=?').get(b.warehouse_code.trim())) {
    return res.status(409).json({ error: 'Warehouse code already exists.' });
  }
  db.prepare(`INSERT INTO warehouses (warehouse_code, warehouse_name, company, business_unit, plant, storage_location, warehouse_type)
    VALUES (?,?,?,?,?,?,?)`).run(b.warehouse_code.trim(), b.warehouse_name.trim(), b.company || null,
    b.business_unit || null, b.plant || null, b.storage_location || null, b.warehouse_type || 'STANDARD');
  audit.record({ entityType: 'Warehouse', action: 'CREATE', newValue: b.warehouse_code, user: req.user, sourceScreen: 'Warehouse Master' });
  res.status(201).json({ message: 'Warehouse created.' });
});

// --- Bin locations ----------------------------------------------------------
router.get('/bins', requirePermission(['bins_master', 'bin_batch_assignment']), (req, res) => {
  const wh = req.query.warehouse_code;
  const rows = wh
    ? db.prepare('SELECT * FROM bin_locations WHERE warehouse_code=? ORDER BY full_bin_location').all(wh)
    : db.prepare('SELECT * FROM bin_locations ORDER BY warehouse_code, full_bin_location').all();
  res.json({ bins: rows });
});
router.post('/bins', requirePermission('bins_master'), (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.warehouse_code)) return res.status(400).json({ error: 'Warehouse is required.' });
  if (!db.prepare('SELECT 1 FROM warehouses WHERE warehouse_code=?').get(b.warehouse_code)) {
    return res.status(404).json({ error: 'Warehouse not found.' });
  }
  const bin = { warehouse_code: b.warehouse_code, zone: b.zone || 'ZA', rack: b.rack || 'R01',
    line_or_aisle: b.line_or_aisle || '01', level: b.level || '01', column_number: b.column_number || '01' };
  const bin_code = b.bin_code || compactBin(bin);
  const full = b.full_bin_location || expandedBin(bin);
  if (db.prepare('SELECT 1 FROM bin_locations WHERE warehouse_code=? AND full_bin_location=?').get(b.warehouse_code, full)) {
    return res.status(409).json({ error: 'Bin already exists in this warehouse.' });
  }
  db.prepare(`INSERT INTO bin_locations
      (warehouse_code, zone, rack, line_or_aisle, level, column_number, bin_code, full_bin_location, capacity,
       hazard_flag, temperature_controlled_flag, quality_restricted_flag)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(bin.warehouse_code, bin.zone, bin.rack, bin.line_or_aisle,
    bin.level, bin.column_number, bin_code, full, b.capacity || 1000,
    b.hazard_flag ? 1 : 0, b.temperature_controlled_flag ? 1 : 0, b.quality_restricted_flag ? 1 : 0);
  audit.record({ entityType: 'BinLocation', action: 'CREATE', newValue: full, user: req.user, sourceScreen: 'Bin Master' });
  res.status(201).json({ message: 'Bin location created.', bin_code, full_bin_location: full });
});

// --- Movement types ---------------------------------------------------------
router.get('/movement-types', requirePermission(['movement_types_master', 'erp_operator']), (req, res) => {
  res.json({ movement_types: db.prepare('SELECT * FROM movement_types ORDER BY code').all() });
});
router.post('/movement-types', requirePermission('movement_types_master'), (req, res) => {
  const b = req.body || {};
  if (!isNonEmptyString(b.code) || !isNonEmptyString(b.description)) {
    return res.status(400).json({ error: 'Code and description are required.' });
  }
  if (db.prepare('SELECT 1 FROM movement_types WHERE code=?').get(b.code.trim())) {
    return res.status(409).json({ error: 'Movement type code already exists.' });
  }
  db.prepare(`INSERT INTO movement_types (code, description, direction, cost_object, is_reversal,
      requires_cost_center, requires_wbs, requires_order) VALUES (?,?,?,?,?,?,?,?)`).run(
    b.code.trim(), b.description.trim(), b.direction || 'ISSUE', b.cost_object || null,
    b.is_reversal ? 1 : 0, b.requires_cost_center ? 1 : 0, b.requires_wbs ? 1 : 0, b.requires_order ? 1 : 0);
  audit.record({ entityType: 'MovementType', action: 'CREATE', newValue: b.code, user: req.user, sourceScreen: 'Movement Type Config' });
  res.status(201).json({ message: 'Movement type created.' });
});

// --- Batches ----------------------------------------------------------------
router.get('/batches', requirePermission(['batch_tracking', 'bin_batch_assignment', 'quality']), (req, res) => {
  const q = (req.query.search || '').trim();
  const like = `%${q}%`;
  const where = q ? 'WHERE batch_number LIKE ? OR material_code LIKE ? OR warehouse_code LIKE ?' : '';
  const params = q ? [like, like, like] : [];
  const rows = db.prepare(`
    SELECT *, (remaining_quantity - reserved_quantity) AS available_quantity
    FROM batches ${where} ORDER BY material_code, fefo_date, fifo_date LIMIT 200
  `).all(...params);
  res.json({ batches: rows.map((b) => ({ ...b, alert_level: alertLevel(b.expiry_date), days_to_expiry: daysUntil(b.expiry_date) })) });
});

/** POST /api/master/batches/:id/quality — quality user sets batch quality status. */
router.post('/batches/:id/quality', requirePermission('quality'), (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });
  const { quality_status, reason } = req.body || {};
  const valid = ['RELEASED', 'QUALITY_HOLD', 'BLOCKED', 'REJECTED'];
  if (!valid.includes(quality_status)) return res.status(400).json({ error: `quality_status must be one of ${valid.join(', ')}.` });
  db.prepare("UPDATE batches SET quality_status=?, is_blocked=?, blocked_reason=?, updated_at=datetime('now') WHERE id=?")
    .run(quality_status, quality_status === 'RELEASED' ? 0 : 1, quality_status === 'RELEASED' ? null : (reason || null), batch.id);
  db.prepare('UPDATE qr_codes SET quality_status=? WHERE batch_id=?').run(quality_status, batch.id);
  audit.record({ entityType: 'Batch', entityId: batch.id, action: 'QUALITY_STATUS',
    oldValue: batch.quality_status, newValue: quality_status, reason, user: req.user, sourceScreen: 'Quality' });
  res.json({ message: `Batch quality status set to ${quality_status}.` });
});

// --- Expiry alerts ----------------------------------------------------------
router.get('/expiry-alerts', requirePermission('expiry_alerts'), (req, res) => {
  const batches = db.prepare(`
    SELECT id, batch_number, material_code, material_description, warehouse_code, bin_location,
           expiry_date, remaining_quantity, quality_status
    FROM batches WHERE expiry_date IS NOT NULL AND remaining_quantity > 0
    ORDER BY expiry_date
  `).all();
  const enriched = batches
    .map((b) => ({ ...b, days_to_expiry: daysUntil(b.expiry_date), alert_level: alertLevel(b.expiry_date) }))
    .filter((b) => b.alert_level && b.alert_level !== 'OK');
  const summary = { EXPIRED: 0, NEAR_EXPIRY: 0, CRITICAL: 0, EARLY_WARNING: 0 };
  enriched.forEach((b) => { summary[b.alert_level] = (summary[b.alert_level] || 0) + 1; });
  res.json({ alerts: enriched, summary });
});

// --- Audit trail ------------------------------------------------------------
router.get('/audit', requirePermission('audit_trail'), (req, res) => {
  const { page, limit, offset } = parsePagination(req.query, { page: 1, limit: 25 });
  const filters = [];
  const params = [];
  if (req.query.request_number) { filters.push('request_number = ?'); params.push(req.query.request_number); }
  if (req.query.entity_type) { filters.push('entity_type = ?'); params.push(req.query.entity_type); }
  if (req.query.action) { filters.push('action = ?'); params.push(req.query.action); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM audit_trail ${where}`).get(...params);
  const rows = db.prepare(`SELECT * FROM audit_trail ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ audit: rows, total, page, limit });
});

module.exports = router;
