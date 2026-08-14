const db = require('./../db/connection');

const EVIDENCE_STATE = 'ATTESTED_PAYLOAD_UNVERIFIED';
const SUBMITTED = 'SUBMITTED';
const APPROVED = 'APPROVED';

const s = (value) => (value == null ? '' : String(value).trim());

function parseDay(value, label) {
  const day = s(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`${label} must be an ISO date (YYYY-MM-DD).`);
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new Error(`${label} must be a valid date.`);
  }
  return day;
}

function addBusinessDays(day, count) {
  const date = new Date(`${parseDay(day, 'period_end')}T00:00:00Z`);
  let added = 0;
  while (added < count) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

function normalizeExceptionWindow(raw, periodStart, periodEnd) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('exception_window must be an object when supplied.');
  }
  const start = parseDay(raw.start_date, 'exception_window.start_date');
  const end = parseDay(raw.end_date, 'exception_window.end_date');
  const reason = s(raw.reason);
  const evidenceReference = s(raw.evidence_reference);
  if (start > end || start < periodStart || end > periodEnd) {
    throw new Error('exception_window must fall within the declared scope period.');
  }
  if (!reason || !evidenceReference) {
    throw new Error('A coverage exception requires both a reason and documented evidence_reference.');
  }
  return { start_date: start, end_date: end, reason, evidence_reference: evidenceReference };
}

function scopeBatch(batchId, materialCode, plantCode, sourceSystem, periodStart, periodEnd, coveredMaterialCodes) {
  const batch = db.prepare(`SELECT id, movement_category, source_system, period_start, period_end, status,
    total_rows, inserted_rows, invalid_rows
    FROM stock_movement_import_batches WHERE id=?`).get(batchId);
  if (!batch || batch.status !== 'COMPLETED' || Number(batch.invalid_rows) !== 0) {
    throw new Error('A scope attestation requires a completed import batch with no invalid rows.');
  }
  if (batch.source_system !== sourceSystem) {
    throw new Error('source_system must match the import batch exactly.');
  }
  if (batch.period_start !== periodStart || batch.period_end !== periodEnd) {
    throw new Error('Declared scope period must match the completed import batch exactly.');
  }
  if (!Array.isArray(coveredMaterialCodes) || coveredMaterialCodes.length !== 1 || coveredMaterialCodes[0] !== materialCode) {
    throw new Error('covered_material_codes must contain exactly the attested material_code.');
  }
  const distinctScope = db.prepare(`SELECT DISTINCT material_code, plant_code
    FROM stock_movement_history WHERE import_batch_id=? ORDER BY material_code, plant_code`).all(batch.id);
  if (distinctScope.length !== 1 || distinctScope[0].material_code !== materialCode || distinctScope[0].plant_code !== plantCode) {
    throw new Error('Import batch scope must contain exactly the declared material_code and plant_code; excluded or mismatched scope is not attestable.');
  }
  return batch;
}

function validateSubmission(body) {
  const batchId = Number(body.import_batch_id);
  if (!Number.isInteger(batchId) || batchId <= 0) throw new Error('import_batch_id is required.');
  const materialCode = s(body.material_code);
  const plantCode = s(body.plant_code);
  const sourceSystem = s(body.source_system);
  const sourceExtractReference = s(body.source_extract_reference);
  const dataGeneratedAt = s(body.data_generated_at);
  const periodStart = parseDay(body.period_start, 'period_start');
  const periodEnd = parseDay(body.period_end, 'period_end');
  if (periodStart > periodEnd) throw new Error('period_start must not be after period_end.');
  if (!materialCode || !plantCode || !sourceSystem || !sourceExtractReference || !dataGeneratedAt) {
    throw new Error('material_code, plant_code, source_system, source_extract_reference, and data_generated_at are required.');
  }
  const material = db.prepare('SELECT id, plant FROM materials WHERE item_code=?').get(materialCode);
  if (!material || material.plant !== plantCode) {
    throw new Error('Attested material_code must resolve to the declared plant_code.');
  }
  const exceptionWindow = normalizeExceptionWindow(body.exception_window, periodStart, periodEnd);
  const supersedesId = body.supersedes_attestation_id == null ? null : Number(body.supersedes_attestation_id);
  if (supersedesId !== null && (!Number.isInteger(supersedesId) || supersedesId <= 0)) {
    throw new Error('supersedes_attestation_id must be a positive integer when supplied.');
  }
  const batch = scopeBatch(batchId, materialCode, plantCode, sourceSystem, periodStart, periodEnd, body.covered_material_codes);
  let supersedes = null;
  if (supersedesId !== null) {
    supersedes = db.prepare(`SELECT a.*, s.replacement_attestation_id
      FROM analytical_scope_attestations a
      LEFT JOIN analytical_scope_attestation_supersessions s ON s.prior_attestation_id=a.id
      WHERE a.id=?`).get(supersedesId);
    if (!supersedes || supersedes.status !== APPROVED || supersedes.replacement_attestation_id
      || supersedes.material_id !== material.id || supersedes.plant_code !== plantCode
      || supersedes.import_batch_id === batch.id) {
      throw new Error('Replacement attestation must supersede one active approved attestation for the same material and plant using a new import batch.');
    }
  } else {
    const active = db.prepare(`SELECT a.id FROM analytical_scope_attestations a
      LEFT JOIN analytical_scope_attestation_supersessions s ON s.prior_attestation_id=a.id
      WHERE a.status=? AND a.material_id=? AND a.plant_code=? AND a.period_start=? AND a.period_end=?
        AND s.prior_attestation_id IS NULL LIMIT 1`).get(APPROVED, material.id, plantCode, periodStart, periodEnd);
    if (active) throw new Error('An active approved attestation already covers this material, plant, and period; submit a replacement attestation instead.');
  }
  return {
    batch, material, materialCode, plantCode, sourceSystem, sourceExtractReference,
    dataGeneratedAt, periodStart, periodEnd, exceptionWindow, supersedesId,
  };
}

function submittedAttestation(id) {
  const attestation = db.prepare('SELECT * FROM analytical_scope_attestations WHERE id=?').get(id);
  if (!attestation || attestation.status !== SUBMITTED) throw new Error('Attestation is missing or is no longer awaiting approval.');
  return attestation;
}

function assertApprovalEligible(attestation, today = new Date().toISOString().slice(0, 10)) {
  const eligibleOn = addBusinessDays(attestation.period_end, 5);
  if (today < eligibleOn) {
    throw new Error(`Five-business-day posting cut-off has not elapsed; approval is eligible on ${eligibleOn}.`);
  }
  return eligibleOn;
}

function activeStockPlants(materialId) {
  return db.prepare(`SELECT DISTINCT COALESCE(w.plant, m.plant) AS plant_code
    FROM batches b
    JOIN materials m ON m.id=b.material_id
    LEFT JOIN warehouses w ON w.warehouse_code=b.warehouse_code
    WHERE b.material_id=? AND (b.remaining_quantity-b.reserved_quantity)>0
    ORDER BY plant_code`).all(materialId).map((row) => row.plant_code).filter(Boolean);
}

function activeAttestationForMaterial(material) {
  const plants = activeStockPlants(material.id);
  if (plants.length !== 1 || plants[0] !== material.plant) return null;
  const row = db.prepare(`SELECT a.id, a.plant_code, a.period_start, a.period_end, a.source_system,
    a.source_extract_reference, a.data_generated_at, a.exception_window_json, a.evidence_state, a.approved_at
    FROM analytical_scope_attestations a
    LEFT JOIN analytical_scope_attestation_supersessions s ON s.prior_attestation_id=a.id
    WHERE a.status=? AND a.material_id=? AND a.plant_code=? AND s.prior_attestation_id IS NULL
    ORDER BY a.approved_at DESC, a.id DESC LIMIT 1`).get(APPROVED, material.id, material.plant);
  if (!row) return null;
  return {
    ...row,
    exception_window: row.exception_window_json ? JSON.parse(row.exception_window_json) : null,
    evidence_state: EVIDENCE_STATE,
  };
}

module.exports = {
  APPROVED,
  EVIDENCE_STATE,
  SUBMITTED,
  activeAttestationForMaterial,
  assertApprovalEligible,
  validateSubmission,
  submittedAttestation,
};
