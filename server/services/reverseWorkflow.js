/**
 * Generic "reverse one step" workflow action — undoes the most recently
 * completed stage of a material request and sends it back to the previous
 * queue, releasing whatever that stage reserved (ERP reservation, batch
 * allocation, picking task). This is distinct from the GI-stage "Reverse GI"
 * action (server/routes/gi.js), which reverses a *posted* goods issue after
 * stock has physically left — that always stays a full reversal, never a
 * step-back, because the physical movement already happened.
 *
 * Each stage requires the same permission as the forward action that put the
 * request there, so reversing needs the same authority as performing the step.
 */
const db = require('./../db/connection');
const audit = require('./../services/audit');
const notify = require('./../services/notify');
const erp = require('./../services/erp');
const { setHeaderStatus, releaseOpenAllocations, reopenForRepick } = require('./requests');
const { HEADER_STATUS, LINE_STATUS, REVERSE_TARGET } = require('./../workflow/states');

// Stage -> permission(s) required to reverse out of it (mirrors the permission
// that gates the forward action for that same queue).
const STAGE_PERMISSION = {
  [HEADER_STATUS.PENDING_MANAGER_APPROVAL]: ['approvals'],
  [HEADER_STATUS.UNDER_REVIEW]: ['approvals'],
  [HEADER_STATUS.APPROVED_PENDING_ERP]: ['erp_operator'],
  [HEADER_STATUS.PENDING_ERP_RESERVATION]: ['erp_operator'],
  [HEADER_STATUS.ERP_RESERVATION_CREATED]: ['erp_operator'],
  [HEADER_STATUS.MOVEMENT_TYPE_ASSIGNED]: ['erp_operator'],
  [HEADER_STATUS.WAREHOUSE_ASSIGNED]: ['bin_batch_assignment'],
  [HEADER_STATUS.PENDING_WAREHOUSE_ACTION]: ['bin_batch_assignment'],
  [HEADER_STATUS.PENDING_BIN_ASSIGNMENT]: ['bin_batch_assignment'],
  [HEADER_STATUS.LOCATION_ASSIGNED]: ['bin_batch_assignment'],
  [HEADER_STATUS.BATCH_ASSIGNED]: ['bin_batch_assignment'],
  [HEADER_STATUS.PENDING_PICKER_ASSIGNMENT]: ['bin_batch_assignment', 'picker_assignment'],
  [HEADER_STATUS.ASSIGNED_TO_PICKER]: ['picker_assignment'],
  [HEADER_STATUS.PENDING_PICKER_ACCEPTANCE]: ['picker_assignment'],
  [HEADER_STATUS.REMINDER_SENT]: ['picker_assignment'],
  [HEADER_STATUS.ESCALATED_TO_SUPERVISOR]: ['picker_assignment'],
  [HEADER_STATUS.ACCEPTED_BY_PICKER]: ['picker_assignment'],
  [HEADER_STATUS.PICKING_IN_PROGRESS]: ['picker_assignment'],
  [HEADER_STATUS.PENDING_ERP_GI]: ['gi_posting'],
  [HEADER_STATUS.ERP_ERROR]: ['gi_posting'],
};

/** True if the current user holds any of the given permission keys (admin exempt). */
function hasAny(user, keys) {
  return user.role === 'admin' || keys.some((k) => user.permissions.includes(k));
}

/** Human label for the queue a status reverses into, for the success message. */
const QUEUE_LABEL = {
  [HEADER_STATUS.DRAFT]: 'the requester (Draft)',
  [HEADER_STATUS.PENDING_MANAGER_APPROVAL]: 'Manager Approval',
  [HEADER_STATUS.MOVEMENT_TYPE_ASSIGNED]: 'the ERP Operator queue',
  [HEADER_STATUS.PENDING_BIN_ASSIGNMENT]: 'Bin & Batch Assignment',
  [HEADER_STATUS.PENDING_PICKER_ASSIGNMENT]: 'Picker Assignment',
  [HEADER_STATUS.PICKING_IN_PROGRESS]: 'Picking',
};

/**
 * Reverse a request one step. Throws { status } errors on an ineligible stage,
 * missing permission, or unsafe state (e.g. stock already physically picked).
 * Returns { message, status: newStatus }.
 */
function reverseOneStep(header, { user, reason }) {
  const from = header.request_status;
  const to = REVERSE_TARGET[from];
  if (!to) {
    const closed = [HEADER_STATUS.GI_POSTED, HEADER_STATUS.COMPLETED, HEADER_STATUS.PARTIALLY_COMPLETED,
      HEADER_STATUS.CLOSED_WITH_SHORTAGE].includes(from);
    const err = new Error(closed
      ? `Request is ${from} — use "Reverse GI" instead, which reverses the physical stock movement.`
      : `Request cannot be reversed from its current status ('${from}').`);
    err.status = 400;
    throw err;
  }
  const requiredPerm = STAGE_PERMISSION[from];
  if (requiredPerm && !hasAny(user, requiredPerm)) {
    const err = new Error('You do not have permission to reverse this stage.');
    err.status = 403;
    throw err;
  }

  const run = db.transaction(() => {
    // Shared by the picker-assignment and allocation-stage branches below:
    // both undo whatever allocation exists and drop the lines back to
    // Reserved, then move the header to its (branch-specific) `to` status.
    const undoAllocationAndReserve = () => {
      releaseOpenAllocations(header.id);
      db.prepare(`
        UPDATE material_request_lines
        SET bin_location=NULL, batch_number=NULL, batch_id=NULL, qr_code_id=NULL,
            fifo_sequence=NULL, fefo_sequence=NULL, line_status=?, updated_at=datetime('now')
        WHERE request_id=?
      `).run(LINE_STATUS.RESERVED, header.id);
      setHeaderStatus(header, to, { user, reason, sourceScreen: 'Reverse Workflow' });
    };

    // --- Picking stages: undo the picker assignment/task only. Blocked if any
    // line has already been physically picked — that stock movement can only
    // be undone via GI's "Return to Picker" / "Reverse GI", not this action.
    if ([HEADER_STATUS.ASSIGNED_TO_PICKER, HEADER_STATUS.PENDING_PICKER_ACCEPTANCE, HEADER_STATUS.REMINDER_SENT,
      HEADER_STATUS.ESCALATED_TO_SUPERVISOR, HEADER_STATUS.ACCEPTED_BY_PICKER, HEADER_STATUS.PICKING_IN_PROGRESS].includes(from)) {
      const anyPicked = db.prepare(
        "SELECT 1 FROM material_request_lines WHERE request_id=? AND picked_quantity > 0 LIMIT 1"
      ).get(header.id);
      if (anyPicked) {
        const err = new Error('Some lines have already been picked — reverse from Goods Issue ("Return to Picker") instead.');
        err.status = 400;
        throw err;
      }
      const task = db.prepare(
        "SELECT * FROM picking_tasks WHERE request_id=? AND task_status NOT IN ('Picking Completed','Cancelled') ORDER BY id DESC LIMIT 1"
      ).get(header.id);
      if (task) {
        db.prepare("UPDATE picking_tasks SET task_status='Cancelled', updated_at=datetime('now') WHERE id=?").run(task.id);
      }
      // Un-scan any allocations back to proposed; the batch reservation itself
      // (made at allocation time) is untouched — only the picker/task is undone.
      db.prepare("UPDATE picking_allocations SET status='PROPOSED', scanned_qr_value=NULL, scan_result=NULL WHERE request_id=? AND status='SCANNED'")
        .run(header.id);
      db.prepare(`
        UPDATE material_request_lines SET line_status=?, updated_at=datetime('now')
        WHERE request_id=? AND line_status IN (?,?)
      `).run(LINE_STATUS.BATCH_ASSIGNED, header.id, LINE_STATUS.PICKING_IN_PROGRESS, LINE_STATUS.QR_VERIFIED);
      setHeaderStatus(header, to, { user, reason, sourceScreen: 'Reverse Workflow' });

    // --- GI stage: reuse the exact "return to picker" logic.
    } else if ([HEADER_STATUS.PENDING_ERP_GI, HEADER_STATUS.ERP_ERROR].includes(from)) {
      reopenForRepick(header, { user, reason, sourceScreen: 'Reverse Workflow' });

    // --- Picker-assignment queue: undo the FIFO/FEFO allocation.
    } else if (from === HEADER_STATUS.PENDING_PICKER_ASSIGNMENT) {
      undoAllocationAndReserve();

    // --- Allocation stage (before or during the allocate step): undo any
    // allocation made so far and go back to the ERP operator's last status.
    } else if ([HEADER_STATUS.WAREHOUSE_ASSIGNED, HEADER_STATUS.PENDING_WAREHOUSE_ACTION,
      HEADER_STATUS.PENDING_BIN_ASSIGNMENT, HEADER_STATUS.LOCATION_ASSIGNED, HEADER_STATUS.BATCH_ASSIGNED].includes(from)) {
      undoAllocationAndReserve();

    // --- ERP stage: cancel the reservation (if one was made) and clear the
    // ERP-entered fields so the operator starts clean if resubmitted.
    } else if ([HEADER_STATUS.APPROVED_PENDING_ERP, HEADER_STATUS.PENDING_ERP_RESERVATION,
      HEADER_STATUS.ERP_RESERVATION_CREATED, HEADER_STATUS.MOVEMENT_TYPE_ASSIGNED].includes(from)) {
      if (header.erp_reservation_number || header.erp_reference_number) {
        erp.connector().cancelReservation({
          requestNumber: header.request_number, reservationNumber: header.erp_reservation_number,
          referenceNumber: header.erp_reference_number, user,
        });
      }
      db.prepare(`
        UPDATE material_request_lines SET line_status=?, updated_at=datetime('now')
        WHERE request_id=? AND line_status IN (?,?)
      `).run(LINE_STATUS.APPROVED, header.id, LINE_STATUS.PENDING_ERP_RESERVATION, LINE_STATUS.RESERVED);
      setHeaderStatus(header, to, { user, reason, sourceScreen: 'Reverse Workflow', set: {
        erp_reservation_number: null, erp_reference_number: null, erp_reservation_date: null, erp_created_by: null,
        movement_type: null, movement_type_description: null, storage_location: null,
        issue_warehouse_code: null, issue_warehouse_name: null,
      } });

    // --- Approval stage: undo the submit, back to Draft for the requester.
    } else if ([HEADER_STATUS.PENDING_MANAGER_APPROVAL, HEADER_STATUS.UNDER_REVIEW].includes(from)) {
      db.prepare("UPDATE material_request_lines SET line_status=?, updated_at=datetime('now') WHERE request_id=?")
        .run(LINE_STATUS.DRAFT, header.id);
      setHeaderStatus(header, to, { user, reason, sourceScreen: 'Reverse Workflow' });
    }

    audit.record({ entityType: 'MaterialRequestHeader', entityId: header.id, requestNumber: header.request_number,
      action: 'REVERSED_ONE_STEP', oldValue: from, newValue: to, reason, user, sourceScreen: 'Reverse Workflow' });
  });
  run();

  notify.send({ requestNumber: header.request_number, recipientUserId: header.requester_id,
    notificationType: 'REQUEST_REVERSED', title: `Request ${header.request_number} sent back a step`,
    message: `Returned to ${QUEUE_LABEL[to] || to}.${reason ? ` Reason: ${reason}` : ''}` });

  return { message: `Request reversed to ${QUEUE_LABEL[to] || to}.`, status: to };
}

module.exports = { reverseOneStep };
