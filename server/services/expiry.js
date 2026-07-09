/**
 * Shelf-life / expiry helpers: expiry calculation and alert classification.
 */

/** Add a shelf-life period to a base date. Returns YYYY-MM-DD. */
function calcExpiry(baseDate, period, unit) {
  if (!baseDate || !period) return null;
  const d = new Date(baseDate + 'T00:00:00Z');
  if (isNaN(d)) return null;
  const n = Number(period);
  const u = (unit || 'MONTHS').toUpperCase();
  if (u === 'DAYS') d.setUTCDate(d.getUTCDate() + n);
  else if (u === 'YEARS') d.setUTCFullYear(d.getUTCFullYear() + n);
  else d.setUTCMonth(d.getUTCMonth() + n); // MONTHS default
  return d.toISOString().slice(0, 10);
}

/** Whole days from today (UTC) until the given date (negative = already past). */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(target)) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((target.getTime() - todayUtc) / 86400000);
}

/**
 * Classify a batch's expiry into an alert level.
 * Returns one of: EXPIRED, NEAR_EXPIRY (<=7d), CRITICAL (<=30d),
 * EARLY_WARNING (<=90d), OK, or null when not expiry-managed.
 */
function alertLevel(expiryDate) {
  const d = daysUntil(expiryDate);
  if (d === null) return null;
  if (d < 0) return 'EXPIRED';
  if (d <= 7) return 'NEAR_EXPIRY';
  if (d <= 30) return 'CRITICAL';
  if (d <= 90) return 'EARLY_WARNING';
  return 'OK';
}

function isExpired(expiryDate) {
  const d = daysUntil(expiryDate);
  return d !== null && d < 0;
}

module.exports = { calcExpiry, daysUntil, alertLevel, isExpired };
