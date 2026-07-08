/**
 * ERP-agnostic integration layer.
 *
 * The core workflow never talks to SAP/Oracle/Dynamics directly — it calls
 * this connector. The active connector is chosen by config (ERP_SYSTEM); the
 * default "MANUAL" connector expects a human operator to key in ERP numbers
 * and simply records the payload/response for traceability. To integrate a
 * real ERP later, implement the same interface (createReservation, postGoodsIssue,
 * validateMaterial, checkStock, …) in a new connector and register it below —
 * no workflow code changes.
 */
const db = require('./../db/connection');
const config = require('./../config');

const ERP_SYSTEM = process.env.ERP_SYSTEM || 'MANUAL';

function log({ requestNumber, transactionType, payload, response, status, errorCode, errorMessage, user }) {
  db.prepare(`
    INSERT INTO erp_integration_log
      (request_number, transaction_type, erp_system, payload, response, status, error_code, error_message, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    requestNumber ?? null, transactionType, ERP_SYSTEM,
    payload ? JSON.stringify(payload) : null,
    response ? JSON.stringify(response) : null,
    status, errorCode ?? null, errorMessage ?? null, user ? user.id : null
  );
}

/**
 * Manual connector. In manual mode the operator supplies the ERP identifiers
 * (reservation number, GI document number); the connector validates presence
 * and records the transaction. `simulateError` lets tests exercise the
 * ERP_ERROR path deterministically.
 */
const manual = {
  createReservation({ requestNumber, reservationNumber, referenceNumber, payload, user }) {
    if (!reservationNumber && !referenceNumber) {
      log({ requestNumber, transactionType: 'RESERVATION', payload, status: 'FAILED',
        errorCode: 'MISSING_REF', errorMessage: 'Reservation or reference number required.', user });
      return { ok: false, errorMessage: 'Reservation or reference number required.' };
    }
    const response = { reservationNumber, referenceNumber, postedAt: new Date().toISOString() };
    log({ requestNumber, transactionType: 'RESERVATION', payload, response, status: 'SUCCESS', user });
    return { ok: true, response };
  },

  postGoodsIssue({ requestNumber, payload, giDocumentNumber, fiscalYear, simulateError, user }) {
    if (simulateError) {
      const errorMessage = 'ERP posting failed: stock/period locked (simulated).';
      log({ requestNumber, transactionType: 'GI_POSTING', payload, status: 'FAILED',
        errorCode: 'ERP_POST_FAIL', errorMessage, user });
      return { ok: false, errorCode: 'ERP_POST_FAIL', errorMessage };
    }
    if (!giDocumentNumber) {
      const errorMessage = 'GI document number is required to post.';
      log({ requestNumber, transactionType: 'GI_POSTING', payload, status: 'FAILED',
        errorCode: 'MISSING_GI', errorMessage, user });
      return { ok: false, errorCode: 'MISSING_GI', errorMessage };
    }
    const response = {
      giDocumentNumber,
      fiscalYear: fiscalYear || String(new Date().getFullYear()),
      postingDate: new Date().toISOString().slice(0, 10),
      status: 'POSTED',
    };
    log({ requestNumber, transactionType: 'GI_POSTING', payload, response, status: 'SUCCESS', user });
    return { ok: true, response };
  },
};

const connectors = { MANUAL: manual };

function connector() {
  return connectors[ERP_SYSTEM] || manual;
}

module.exports = { connector, log, ERP_SYSTEM };
