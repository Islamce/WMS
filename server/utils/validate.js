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

/** Parse pagination query params with safe bounds. */
function parsePagination(query, defaults = { page: 1, limit: 10 }) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isInteger(page) || page < 1) page = defaults.page;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) limit = defaults.limit;
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { isNonEmptyString, isEmail, isPositiveNumber, isNonNegativeNumber, isId, parsePagination };
