const express = require('express');
const db = require('./../db/connection');
const { authenticate, requirePermission } = require('./../middleware/auth');
const audit = require('./../services/audit');
const {
  APPROVED,
  EVIDENCE_STATE,
  assertApprovalEligible,
  submittedAttestation,
  validateSubmission,
} = require('./../services/analyticalAttestations');

const router = express.Router();
router.use(authenticate);

function publicAttestation(row) {
  return {
    id: row.id,
    import_batch_id: row.import_batch_id,
    material_code: row.material_code,
    plant_code: row.plant_code,
    source_system: row.source_system,
    source_extract_reference: row.source_extract_reference,
    data_generated_at: row.data_generated_at,
    period_start: row.period_start,
    period_end: row.period_end,
    supersedes_attestation_id: row.supersedes_attestation_id || null,
    exception_window: row.exception_window_json ? JSON.parse(row.exception_window_json) : null,
    evidence_state: row.evidence_state,
    status: row.status,
    submitted_by: row.submitted_by,
    submitted_by_name: row.submitted_by_name,
    submitted_at: row.submitted_at,
    approved_by: row.approved_by,
    approved_by_name: row.approved_by_name,
    approved_at: row.approved_at,
  };
}

router.post('/', requirePermission('analytical_attestation_submit'), (req, res) => {
  let input;
  try {
    input = validateSubmission(req.body || {});
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const run = db.transaction(() => {
    const created = db.prepare(`INSERT INTO analytical_scope_attestations
      (import_batch_id, material_id, material_code, plant_code, source_system, source_extract_reference,
       data_generated_at, period_start, period_end, exception_window_json, supersedes_attestation_id, evidence_state,
       submitted_by, submitted_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.batch.id, input.material.id, input.materialCode, input.plantCode,
        input.sourceSystem, input.sourceExtractReference, input.dataGeneratedAt,
        input.periodStart, input.periodEnd, input.exceptionWindow ? JSON.stringify(input.exceptionWindow) : null,
        input.supersedesId, EVIDENCE_STATE, req.user.id, req.user.name || req.user.email || null);
    const id = Number(created.lastInsertRowid);
    const attestation = db.prepare('SELECT * FROM analytical_scope_attestations WHERE id=?').get(id);
    audit.record({
      entityType: 'AnalyticalScopeAttestation', entityId: id, action: 'SUBMIT_SCOPE_ATTESTATION', user: req.user,
      newValue: {
        import_batch_id: input.batch.id, material_code: input.materialCode, plant_code: input.plantCode,
        source_system: input.sourceSystem, period_start: input.periodStart, period_end: input.periodEnd,
        evidence_state: EVIDENCE_STATE, supersedes_attestation_id: input.supersedesId,
      }, sourceScreen: 'Analytics Scope Attestation',
    });
    return { id, attestation };
  });

  try {
    const result = run();
    res.status(201).json({ message: 'Scope attestation evidence submitted for separate approval.',
      attestation: publicAttestation(result.attestation), supersedes_attestation_id: input.supersedesId });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/approve', requirePermission('analytical_attestation_approve'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Attestation id must be a positive integer.' });

  const run = db.transaction(() => {
    const attestation = submittedAttestation(id);
    if (attestation.submitted_by === req.user.id) {
      throw new Error('The submitting user may not approve the same scope attestation.');
    }
    const eligibleOn = assertApprovalEligible(attestation);
    const supersedesId = attestation.supersedes_attestation_id || null;
    if (supersedesId !== null) {
      const prior = db.prepare(`SELECT a.id, a.status, a.material_id, a.plant_code, a.import_batch_id,
        s.replacement_attestation_id
        FROM analytical_scope_attestations a
        LEFT JOIN analytical_scope_attestation_supersessions s ON s.prior_attestation_id=a.id
        WHERE a.id=?`).get(supersedesId);
      if (!prior || prior.status !== APPROVED || prior.replacement_attestation_id
        || prior.material_id !== attestation.material_id || prior.plant_code !== attestation.plant_code
        || prior.import_batch_id === attestation.import_batch_id) {
        throw new Error('Replacement approval must supersede one active approved attestation for the same material and plant using a new import batch.');
      }
    }
    const updated = db.prepare(`UPDATE analytical_scope_attestations
      SET status=?, approved_by=?, approved_by_name=?, approved_at=datetime('now')
      WHERE id=? AND status='SUBMITTED'`).run(APPROVED, req.user.id, req.user.name || req.user.email || null, id);
    if (updated.changes !== 1) throw new Error('Attestation is no longer awaiting approval.');
    if (supersedesId !== null) {
      db.prepare(`INSERT INTO analytical_scope_attestation_supersessions
        (prior_attestation_id, replacement_attestation_id, superseded_by)
        VALUES (?, ?, ?)`).run(supersedesId, id, req.user.id);
    }
    const approved = db.prepare('SELECT * FROM analytical_scope_attestations WHERE id=?').get(id);
    audit.record({
      entityType: 'AnalyticalScopeAttestation', entityId: id, action: 'APPROVE_SCOPE_ATTESTATION', user: req.user,
      newValue: {
        material_code: approved.material_code, plant_code: approved.plant_code,
        period_start: approved.period_start, period_end: approved.period_end,
        evidence_state: approved.evidence_state, eligible_on: eligibleOn,
        supersedes_attestation_id: supersedesId,
      }, sourceScreen: 'Analytics Scope Attestation',
    });
    return approved;
  });

  try {
    const approved = run();
    res.json({ message: 'Scope attestation approved; analytical evidence remains payload-unverified.',
      attestation: publicAttestation(approved) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
