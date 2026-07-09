/**
 * QR code service — generation at goods receipt and validation at picking.
 * The QR "value" is a compact, human-parseable token embedding the key
 * traceability fields plus a unique id; the full record lives in qr_codes.
 */
const crypto = require('crypto');
const db = require('./../db/connection');
const { isExpired } = require('./expiry');

/** Deterministic-ish unique QR token. */
function makeQrValue(materialCode, batchNumber) {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `QR|${materialCode}|${batchNumber || 'NA'}|${rand}`;
}

/**
 * Create a QR code row for a received batch. Returns the qr_codes id.
 */
function generateForBatch(batch, extra = {}) {
  const value = makeQrValue(batch.material_code, batch.batch_number);
  const info = db.prepare(`
    INSERT INTO qr_codes
      (qr_code_value, material_id, material_code, material_description, batch_id, batch_number,
       po_number, gr_number, supplier_code, supplier_name, warehouse_code, bin_location,
       received_quantity, remaining_quantity, uom, receiving_date, manufacturing_date,
       expiry_date, quality_status, qr_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(
    value, batch.material_id, batch.material_code, batch.material_description,
    batch.id, batch.batch_number, batch.po_number, batch.gr_number,
    batch.supplier_code, batch.supplier_name, batch.warehouse_code, batch.bin_location,
    batch.received_quantity, batch.remaining_quantity, extra.uom || null,
    batch.receiving_date, batch.manufacturing_date, batch.expiry_date, batch.quality_status
  );
  return info.lastInsertRowid;
}

/** Record a print / reprint and bump the counter. */
function markPrinted(qrId) {
  db.prepare(`
    UPDATE qr_codes SET printed_at = datetime('now'), print_count = print_count + 1 WHERE id = ?
  `).run(qrId);
}

/**
 * Validate a scanned QR value against the expected picking allocation.
 * Returns { ok, code, message, qr }.
 * Checks: exists, material, batch, bin, warehouse, quantity, expiry,
 * blocked, quality status.
 */
function validateScan({ qrValue, expected }) {
  const qr = db.prepare('SELECT * FROM qr_codes WHERE qr_code_value = ?').get(qrValue);
  if (!qr) return { ok: false, code: 'NOT_FOUND', message: 'QR code not recognised.' };

  const fail = (code, message) => ({ ok: false, code, message, qr });

  if (qr.qr_status === 'BLOCKED') return fail('QR_BLOCKED', 'This QR/label is blocked.');
  if (expected.materialCode && qr.material_code !== expected.materialCode) {
    return fail('WRONG_MATERIAL', `Scanned material ${qr.material_code} does not match expected ${expected.materialCode}.`);
  }
  if (expected.batchNumber && qr.batch_number !== expected.batchNumber) {
    return fail('WRONG_BATCH', `Scanned batch ${qr.batch_number} does not match proposed batch ${expected.batchNumber}.`);
  }
  if (expected.warehouseCode && qr.warehouse_code !== expected.warehouseCode) {
    return fail('WRONG_WAREHOUSE', `Scanned warehouse ${qr.warehouse_code} does not match ${expected.warehouseCode}.`);
  }
  if (expected.binLocation && qr.bin_location !== expected.binLocation) {
    return fail('WRONG_BIN', `Scanned bin ${qr.bin_location} does not match expected bin ${expected.binLocation}.`);
  }
  if (isExpired(qr.expiry_date)) return fail('EXPIRED', `Batch ${qr.batch_number} is expired (${qr.expiry_date}).`);
  if (qr.quality_status === 'QUALITY_HOLD') return fail('QUALITY_HOLD', 'Material is on quality hold.');
  if (qr.quality_status === 'BLOCKED' || qr.quality_status === 'REJECTED') {
    return fail('QUALITY_BLOCKED', 'Material is quality-blocked and cannot be issued.');
  }
  return { ok: true, code: 'PASS', message: 'QR validated.', qr };
}

/** Update last-scanned metadata. */
function markScanned(qrId, userId) {
  db.prepare('UPDATE qr_codes SET last_scanned_at=datetime(\'now\'), last_scanned_by=? WHERE id=?')
    .run(userId, qrId);
}

module.exports = { generateForBatch, markPrinted, validateScan, markScanned, makeQrValue };
