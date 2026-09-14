/**
 * Flat subscription: one deployment, one customer, one term.
 *
 * WHY THIS FAILS OPEN. No `tenant_subscription` row means NO restriction, the
 * same rule `tenant_profile` already follows for editions. A licence check that
 * failed closed would turn a missing row, a failed restore or a half-applied
 * migration into a stopped warehouse. One tenant running unpaid for a week is
 * recoverable by an invoice; a site store that cannot issue material is not.
 * Every existing deployment, production included, has no row and is unaffected.
 *
 * WHY EXPIRY IS NEVER A SURPRISE. The states below are a ramp, not a switch:
 *
 *   ACTIVE        normal.
 *   EXPIRING      inside the warning window — the UI says so, nothing changes.
 *   GRACE         past the expiry date, still writing. This is what stops a
 *                 renewal three days late from stranding a storekeeper who is
 *                 halfway through a pick with material already on a forklift.
 *   READ_ONLY     past expiry AND past grace. Reads, exports and reports keep
 *                 working; writes are refused with a message naming the date.
 *   SUSPENDED     set by hand, for a customer who has actually gone away.
 *
 * WHY READ_ONLY RATHER THAN LOCKED OUT. The customer's stock records are theirs.
 * Non-payment is a reason to stop them adding to the system, never a reason to
 * take away the record of what is in their store — they still have to run the
 * site, and holding data hostage is how a supplier gets sued rather than paid.
 * Login stays open too: someone has to be able to get in, read the message and
 * renew.
 */
const db = require('./../db/connection');

const STATE = {
  UNLICENSED: 'UNLICENSED',
  ACTIVE: 'ACTIVE',
  EXPIRING: 'EXPIRING',
  GRACE: 'GRACE',
  READ_ONLY: 'READ_ONLY',
  SUSPENDED: 'SUSPENDED',
};

/** Days before expiry at which the UI starts saying so. */
const WARN_WITHIN_DAYS = 30;

let cached = null;

/** Drop the cache. Called after any write to the subscription. */
function reset() { cached = null; }

function today() { return new Date().toISOString().slice(0, 10); }

function daysBetween(fromIso, toIso) {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function readRow() {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenant_subscription'").get();
  if (!exists) return null;
  return db.prepare('SELECT * FROM tenant_subscription WHERE id = 1').get() || null;
}

/**
 * The subscription as the rest of the system should see it.
 *
 * @param {string} [asOf] ISO date, for testing a future date without waiting.
 */
function getSubscription(asOf) {
  const on = asOf || today();
  if (!asOf && cached && cached._on === on) return cached;

  const row = readRow();
  let result;

  if (!row) {
    // Unlicensed: no row, no restriction. See the header.
    result = { configured: false, state: STATE.UNLICENSED, writable: true,
      plan: null, expiresOn: null, daysRemaining: null, readOnlyFrom: null };
  } else if (row.status === 'SUSPENDED') {
    result = { configured: true, state: STATE.SUSPENDED, writable: false,
      plan: row.plan, expiresOn: row.expires_on, daysRemaining: null, readOnlyFrom: null };
  } else {
    const readOnlyFrom = addDays(row.expires_on, row.grace_days + 1);
    const daysRemaining = daysBetween(on, row.expires_on);
    let state;
    if (on >= readOnlyFrom) state = STATE.READ_ONLY;
    else if (on > row.expires_on) state = STATE.GRACE;
    else if (daysRemaining <= WARN_WITHIN_DAYS) state = STATE.EXPIRING;
    else state = STATE.ACTIVE;

    result = {
      configured: true,
      state,
      writable: state !== STATE.READ_ONLY,
      plan: row.plan,
      expiresOn: row.expires_on,
      graceDays: row.grace_days,
      readOnlyFrom,
      daysRemaining,
      reference: row.reference || null,
    };
  }

  result.message = describe(result);
  if (!asOf) { result._on = on; cached = result; }
  return result;
}

/** A sentence a storekeeper can act on, or null when there is nothing to say. */
function describe(sub) {
  switch (sub.state) {
    case STATE.EXPIRING:
      return `This subscription expires on ${sub.expiresOn} (${sub.daysRemaining} day(s) away). `
        + 'Renew before then to avoid interruption.';
    case STATE.GRACE:
      return `This subscription expired on ${sub.expiresOn}. It keeps working until `
        + `${sub.readOnlyFrom}, after which the system becomes read-only. Renew to continue.`;
    case STATE.READ_ONLY:
      return `This subscription expired on ${sub.expiresOn} and the grace period ended on `
        + `${sub.readOnlyFrom}. Your records are intact and can still be read and exported, `
        + 'but nothing new can be entered until it is renewed.';
    case STATE.SUSPENDED:
      return 'This subscription is suspended. Your records are intact and can still be read and '
        + 'exported, but nothing new can be entered. Contact your supplier.';
    default:
      return null;
  }
}

module.exports = { getSubscription, reset, STATE, WARN_WITHIN_DAYS };
