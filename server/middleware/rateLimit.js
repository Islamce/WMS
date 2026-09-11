/**
 * Login rate limiter — dependency-free, in-memory.
 *
 * Counts FAILED login attempts per (client IP + email). After MAX_FAILURES
 * within WINDOW_MS the pair is blocked until the window expires (HTTP 429).
 * A successful login clears the counter.
 */
const { WindowCounter } = require('../utils/windowCounter');

const WINDOW_MS = 15 * 60 * 1000;  // 15 minutes
const MAX_FAILURES = 10;

const counter = new WindowCounter();

function keyFor(req) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const email = String((req.body && req.body.email) || '').toLowerCase().trim();
  return `${ip}|${email}`;
}

/** Express middleware: reject when the failure budget is exhausted. */
function loginRateLimit(req, res, next) {
  const now = Date.now();
  if (counter.size > 10000) counter.prune(WINDOW_MS, now); // bound memory under abuse
  const key = keyFor(req);
  const entry = counter.buckets.get(key);
  if (entry && now - entry.windowStart <= WINDOW_MS && entry.count >= MAX_FAILURES) {
    const retryMin = Math.ceil((entry.windowStart + WINDOW_MS - now) / 60000);
    return res.status(429).json({
      error: `Too many failed login attempts. Try again in ~${retryMin} minute(s).`,
    });
  }
  next();
}

/** Call on a failed login to consume one attempt from the budget. */
function recordLoginFailure(req) {
  counter.bucket(keyFor(req), WINDOW_MS).count += 1;
}

/** Call on a successful login to clear the counter for this key. */
function clearLoginFailures(req) {
  counter.buckets.delete(keyFor(req));
}

module.exports = { loginRateLimit, recordLoginFailure, clearLoginFailures, WINDOW_MS, MAX_FAILURES };
