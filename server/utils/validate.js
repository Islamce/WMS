/** Small input validation helpers shared by the API routes. */

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Positive finite number (> 0). */
function isPositiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

/** Non-negative finite number (>= 0). */
function isNonNegativeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0;
}

/** Positive integer, used for ids. */
function isId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0;
}

/**
 * Password policy: at least 8 characters, containing at least one letter and
 * one digit. Returns { ok, error }. Kept deliberately modest so it's usable
 * without frustrating users; tighten via the character-class checks if needed.
 */
function validatePasswordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    return { ok: false, error: 'Password must contain at least one letter and one number.' };
  }
  return { ok: true };
}

/** Parse pagination query params with safe bounds. */
function parsePagination(query, defaults = { page: 1, limit: 10 }) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isInteger(page) || page < 1) page = defaults.page;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) limit = defaults.limit;
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { isNonEmptyString, isEmail, isPositiveNumber, isNonNegativeNumber, isId, parsePagination, validatePasswordPolicy };
